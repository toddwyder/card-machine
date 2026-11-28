// The process that runs one card.
//
// Start launches this outside mission control so the card does not die with the screen that
// started it: mission control restarts whenever the dashboard is rebuilt, and a session living
// inside it was killed mid-sentence twice on JUL-419. This process is started by Start as a
// systemd unit of its own, boots one Mastra Code session, tells it to follow pstack on the card,
// and writes what the run has done into the record the Run view reads.
//
// Nothing here decides what the card needs or checks on the work. Its only job is to hold the
// session and to write the run's own numbers down.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BEAT_MS, readJson, recordPath, writeRecord } from '../dashboard/lib/card-session.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const STATE = 'state.db';
const SETTINGS = 'settings.json';

// A partial settings file is merged over the stock defaults. It carries only what the session
// needs to behave: the built-in helpers, and a trace for each model call. The model every helper
// call runs on is set on the session itself, just below, so it stays one value in one place.
export function sessionSettings() {
  return {
    preferences: { subagentsEnabled: true },
    observability: { localTracing: true, resources: {} },
  };
}

async function writeSessionSettings(dir) {
  const settings = join(dir, SETTINGS);
  await mkdir(dir, { recursive: true });
  await writeFile(settings, `${JSON.stringify(sessionSettings(), null, 2)}\n`);
  return settings;
}

function order(card) {
  return [
    `Follow pstack on ${card.identifier}: ${card.title}`,
    card.url ? card.url : '',
    '',
    card.description ?? '',
    '',
    'You are running alone. Do not end your turn to wait for anything, and do not ask a question.',
  ].filter(line => line !== '').join('\n');
}

/**
 * What the session is booted with. The skill is passed in whole, so the session follows pstack
 * from its first call to its last without being told to go and read anything. Every helper call
 * runs on `model`, the model the run itself runs on, so a delegated step cannot drift onto a
 * different account's model than the run it serves.
 */
export function sessionConfig({ settingsPath, subagents, model, repo = REPO_ROOT, dir }) {
  return {
    cwd: repo,
    settingsPath,
    createInitialThread: true,
    ...(model ? { initialState: { subagentModelId: model } } : {}),
    storage: { backend: 'libsql', url: `file:${join(dir, STATE)}`, isRemote: false },
    subagents,
    disableBuiltinTools: ['ask_user', 'submit_plan'],
    plansDir: join(dir, 'plans'),
    planApprovalStartsGoal: false,
    hostInstructions: readFileSync(join(repo, '.agents', 'skills', 'poteto-mode', 'SKILL.md'), 'utf8'),
    coAuthor: {
      name: 'mastracode',
      email: '284800079+mastra-platform[bot]@users.noreply.github.com',
    },
  };
}

async function bootSession(dir, model) {
  const settings = await writeSessionSettings(dir);
  process.env.MASTRA_DB_PATH = join(dir, STATE);
  process.env.MASTRA_OBSERVABILITY_DB_PATH = join(dir, 'observability.duckdb');
  const { bootLocalAgentController, builtinSubagents, runMC, autoApprovePolicy } = await import('@mastra/code-sdk');
  const booted = await bootLocalAgentController(sessionConfig({
    settingsPath: settings,
    dir,
    model,
    subagents: builtinSubagents.map(definition => ({ ...definition, maxSteps: definition.maxSteps ?? 1000 })),
  }));
  return { booted, runMC, autoApprovePolicy };
}

async function closeSession(booted) {
  const { controller, storageMaintenance, observability } = booted;
  try { await controller.stopNotificationDispatch?.(); } catch {}
  try { await observability?.flush?.(); } catch {}
  await new Promise(done => setTimeout(done, 2000));
  try { await observability?.shutdown?.(); } catch {}
  try { await storageMaintenance?.closeStorage?.(); } catch {}
  await new Promise(done => setTimeout(done, 1000));
}

const valueAfter = name => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1] ?? null;
};

export async function main() {
  const payloadPath = valueAfter('--payload');
  if (!payloadPath || !existsSync(payloadPath)) throw new Error('No card to run.');
  const { card, model, sessionDir: dir, startedAt } = JSON.parse(await readFile(payloadPath, 'utf8'));

  // A record still counts as a live run only while the process running it keeps saying so. The
  // beat starts before the boot, because a boot can take longer than a reader is willing to wait.
  let record = {
    card: card.identifier, title: card.title, startedAt, endedAt: null, status: 'running',
    threadId: null, tokens: 0, largestStepTokens: 0, lastActivityAt: startedAt, heartbeatAt: Date.now(),
  };
  const beat = setInterval(() => {
    record.heartbeatAt = Date.now();
    void writeRecord(dir, record);
  }, BEAT_MS);
  await writeRecord(dir, record);

  let session;
  try {
    session = await bootSession(dir, model);
  } catch (error) {
    console.error('[card]', error?.message ?? error);
    clearInterval(beat);
    record = { ...record, status: 'stopped', endedAt: Date.now() };
    await writeRecord(dir, record);
    process.exitCode = 1;
    return;
  }

  const { booted, runMC, autoApprovePolicy } = session;
  // The boot opens a first, empty thread; the run then works in a thread of its own. The record
  // follows the session's current thread so the to-do list is read from the thread doing the work.
  const currentThreadId = () => booted.session?.thread?.getId?.() ?? record.threadId;
  record.threadId = currentThreadId();

  const run = runMC({
    controller: booted.controller,
    session: booted.session,
    model,
    mode: 'build',
    thinkingLevel: 'off',
    policy: autoApprovePolicy,
    title: `${card.identifier} ${card.title}`,
    prompt: order(card),
  });

  // What the run has spent, and when the session last did anything. Both come from the run's own
  // events, so the screen never counts tokens it did not see the session report.
  let lastWrite = 0;
  const keepCurrent = async () => {
    record.lastActivityAt = Date.now();
    record.threadId = currentThreadId();
    if (record.lastActivityAt - lastWrite < BEAT_MS) return;
    lastWrite = record.lastActivityAt;
    await writeRecord(dir, record);
  };

  let status = 'stopped';
  try {
    for await (const event of run) {
      if (event?.type === 'usage_update' && Number.isFinite(event.usage?.totalTokens)) {
        record.tokens += event.usage.totalTokens;
        record.largestStepTokens = Math.max(record.largestStepTokens, event.usage.totalTokens);
      }
      if (event?.type === 'error') console.error('[card]', event.error?.message ?? 'session error');
      await keepCurrent();
    }
    const result = await run.result;
    status = result?.status === 'completed' || result?.status === 'done' ? 'finished' : 'stopped';
  } catch (error) {
    console.error('[card]', error?.message ?? error);
  } finally {
    clearInterval(beat);
    await closeSession(booted);
    const current = (await readJson(recordPath(dir))) ?? {};
    const endedAt = Date.now();
    await writeRecord(dir, {
      ...current, card: card.identifier, title: card.title, startedAt, endedAt, status,
      threadId: currentThreadId(), tokens: record.tokens, largestStepTokens: record.largestStepTokens,
      lastActivityAt: endedAt, heartbeatAt: endedAt,
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
