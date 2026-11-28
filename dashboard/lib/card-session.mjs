// Start one card, and read back the session it runs in.
//
// Start does what stock pstack does: it opens one Mastra Code session and tells it to follow
// pstack on the card. Nothing in this module decides what the card needs or checks on the work.
// Its only job is to hold the session, to read the session's own to-do list back for the Run
// view, and to hand back a small record of when the run began and how it ended.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

// The skill reaches the session as standing instructions rather than as a file it is told to go
// and read, so it holds from the first call to the last and cannot fall out of a compacted history.
const POTETO_SKILL = join(REPO_ROOT, '.agents', 'skills', 'poteto-mode', 'SKILL.md');

export const SESSION_DIR = process.env.RUN_VIEW_SESSION_DIR ?? join(REPO_ROOT, '.artifacts', 'run-view');

const RECORD = 'run.json';
const SETTINGS = 'settings.json';
const STATE = 'state.db';

// A record still counts as a live run only while the process running it keeps saying so. The
// session writes a beat into the record every couple of seconds; a beat that has stopped means
// the process that held the session is gone, so the run ended without leaving a result.
const BEAT_MS = 2_000;
const LIVE_WITHIN_MS = 30_000;

const isLive = record => !record.endedAt && Date.now() - Number(record.heartbeatAt ?? 0) < LIVE_WITHIN_MS;

const recordPath = () => join(SESSION_DIR, RECORD);
const settingsPath = () => join(SESSION_DIR, SETTINGS);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeRecord(record) {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(recordPath(), `${JSON.stringify(record, null, 2)}\n`);
}

// The to-do list is stock Mastra thread state. Reading it beside the running session is a read of
// the same file the session writes, so it is opened read-only and any row it cannot parse is
// treated as no list at all rather than a broken screen.
function readThreadTasks(threadId) {
  const file = join(SESSION_DIR, STATE);
  if (!threadId || !existsSync(file)) return null;
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('select value from mastra_thread_state where threadId = ? and type = ?').get(threadId, 'task');
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/**
 * The last run Start began, with the session's to-do list read back.
 * @returns {Promise<{card: string, title: string, startedAt: number, endedAt: number|null, status: string,
 *   threadId: string|null, tasks: object[]|null, tokens: number, lastActivityAt: number|null} | null>}
 */
export async function readCardSession() {
  const record = await readJson(recordPath());
  if (!record || typeof record.card !== 'string') return null;
  const running = isLive(record);
  // A record left behind by a process that is gone is a run that ended without a result.
  const unread = !record.endedAt && !running;
  const shown = unread ? { ...record, status: 'unknown', endedAt: record.startedAt } : record;
  return {
    card: shown.card,
    title: shown.title,
    startedAt: shown.startedAt,
    endedAt: shown.endedAt ?? null,
    status: shown.status,
    threadId: shown.threadId ?? null,
    tasks: readThreadTasks(shown.threadId),
    tokens: Number.isFinite(shown.tokens) ? shown.tokens : 0,
    largestStepTokens: Number.isFinite(shown.largestStepTokens) ? shown.largestStepTokens : 0,
    lastActivityAt: Number.isFinite(shown.lastActivityAt) ? shown.lastActivityAt : null,
  };
}

export async function isRunning() {
  const record = await readJson(recordPath());
  return Boolean(record && isLive(record));
}

// A partial settings file is merged over the stock defaults. The session gets the built-in
// helpers, a trace for each model call, and the same model everywhere, which is what the
// machine's own sessions already do.
async function writeSessionSettings() {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(settingsPath(), `${JSON.stringify({
    preferences: { subagentsEnabled: true },
    observability: { localTracing: true, resources: {} },
  }, null, 2)}\n`);
  return settingsPath();
}

function order(card) {
  return [
    `Follow pstack on ${card.identifier}: ${card.title}`,
    card.url ? card.url : '',
    '',
    card.description ?? '',
    '',
    'Name every to-do id `<playbook>-<number>`, using the kebab-case name of the playbook this card is routed to and the step number, and copy that playbook\'s steps into the to-do list in order. Keep the list current as the work moves.',
    'You are running alone. Do not end your turn to wait for anything, and do not ask a question.',
  ].filter(line => line !== '').join('\n');
}

/**
 * What the session is booted with. The skill is passed in whole, so the session follows pstack
 * from its first call to its last without being told to go and read anything.
 */
export function sessionConfig({ settingsPath, subagents }) {
  return {
    cwd: REPO_ROOT,
    settingsPath,
    createInitialThread: true,
    storage: { backend: 'libsql', url: `file:${join(SESSION_DIR, STATE)}`, isRemote: false },
    subagents,
    disableBuiltinTools: ['ask_user', 'submit_plan'],
    plansDir: join(SESSION_DIR, 'plans'),
    planApprovalStartsGoal: false,
    hostInstructions: readFileSync(POTETO_SKILL, 'utf8'),
    coAuthor: {
      name: 'mastracode',
      email: '284800079+mastra-platform[bot]@users.noreply.github.com',
    },
  };
}

async function bootSession() {
  const settings = await writeSessionSettings();
  process.env.MASTRA_DB_PATH = join(SESSION_DIR, STATE);
  process.env.MASTRA_OBSERVABILITY_DB_PATH = join(SESSION_DIR, 'observability.duckdb');
  const { bootLocalAgentController, builtinSubagents, runMC, autoApprovePolicy } = await import('@mastra/code-sdk');
  const booted = await bootLocalAgentController(sessionConfig({
    settingsPath: settings,
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

/**
 * Begin one card. Rejects while a run is live, because the Run view shows one run at a time.
 * @param {{identifier: string, title: string, description?: string, url?: string}} card
 * @param {{model: string, now?: number}} options
 */
export async function startCard(card, { model, now = Date.now() } = {}) {
  if (await isRunning()) throw Object.assign(new Error('A card is already running.'), { status: 409 });
  const startedAt = now;
  let threadId = null;
  let tokens = 0;
  let largestStepTokens = 0;
  let lastActivityAt = startedAt;
  const writeState = extra => writeRecord({
    card: card.identifier, title: card.title, startedAt, endedAt: null, status: 'running',
    threadId, tokens, largestStepTokens, lastActivityAt, heartbeatAt: Date.now(), ...extra,
  }).catch(() => {});

  await writeState();

  let session = null;
  try {
    session = await bootSession();
  } catch (error) {
    await writeState({ endedAt: Date.now(), status: 'stopped' });
    throw error;
  }

  const { booted, runMC, autoApprovePolicy } = session;
  // The boot opens a first, empty thread; the run then works in a thread of its own. The record
  // follows the session's current thread so the to-do list is read from the thread doing the work.
  const currentThreadId = () => booted.session?.thread?.getId?.() ?? threadId;
  threadId = currentThreadId();
  await writeState();

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
  // events, so the screen never counts tokens it did not see the session report. The beat under it
  // is what tells the next read that this process still holds the session.
  let lastWrite = 0;
  const keepCurrent = async () => {
    lastActivityAt = Date.now();
    threadId = currentThreadId();
    if (lastActivityAt - lastWrite < 2000) return;
    lastWrite = lastActivityAt;
    await writeState();
  };
  const beat = setInterval(() => { threadId = currentThreadId(); void writeState(); }, BEAT_MS);

  void (async () => {
    let status = 'stopped';
    try {
      for await (const event of run) {
        if (event?.type === 'usage_update' && Number.isFinite(event.usage?.totalTokens)) {
          tokens += event.usage.totalTokens;
          largestStepTokens = Math.max(largestStepTokens, event.usage.totalTokens);
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
      const current = await readJson(recordPath());
      const endedAt = Date.now();
      await writeRecord({ ...(current ?? {}), card: card.identifier, title: card.title, startedAt, endedAt, status, threadId, tokens, largestStepTokens, lastActivityAt: endedAt, heartbeatAt: endedAt });
    }
  })();

  return { card: card.identifier, title: card.title, startedAt, threadId: currentThreadId() };
}
