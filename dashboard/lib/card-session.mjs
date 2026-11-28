// Start one card, and read back the run it began.
//
// Start does what stock pstack does: it opens one Mastra Code session and tells it to follow
// pstack on the card. The session runs in a process of its own (see machine/card-run.mjs), so a restart of
// mission control does not end the card with it. This module's job is to decide when Start may
// begin a card, to launch that process, and to read the record it writes back for the Run view.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLibSQLStore } from '@mastra/code-sdk/utils/storage-factory';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

export const SESSION_DIR = process.env.RUN_VIEW_SESSION_DIR ?? join(REPO_ROOT, '.artifacts', 'run-view');

const RECORD = 'run.json';
const PAYLOAD = 'run-payload.json';
const STATE = 'state.db';

// A record still counts as a live run only while the process running it keeps saying so. The
// session writes a beat into the record every couple of seconds; a beat that has stopped means
// the process that held the session is gone, so the run ended without leaving a result.
export const BEAT_MS = 2_000;
const LIVE_WITHIN_MS = 30_000;

export const isLive = (record, now = Date.now()) => !record.endedAt && now - Number(record.heartbeatAt ?? 0) < LIVE_WITHIN_MS;

export const recordPath = (dir = SESSION_DIR) => join(dir, RECORD);
const payloadPath = (dir = SESSION_DIR) => join(dir, PAYLOAD);
const statePath = (dir = SESSION_DIR) => join(dir, STATE);

export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeRecord(dir, record) {
  await mkdir(dir, { recursive: true });
  await writeFile(recordPath(dir), `${JSON.stringify(record, null, 2)}\n`);
}

// The to-do list is stock Mastra thread state, read through the store the session writes it
// with. It lives in the session's own file, so this opens that file for the read and closes it
// again; a store that cannot answer is treated as no list at all rather than a broken screen.
async function readThreadTasks(threadId, dir) {
  const file = statePath(dir);
  if (!threadId || !existsSync(file)) return null;
  const storage = buildLibSQLStore({ id: 'run-view-thread-state', url: `file:${file}` });
  try {
    const store = await storage.getStore('threadState');
    const value = await store?.getState({ threadId, type: 'task' });
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  } finally {
    await storage.close().catch(() => {});
  }
}

/**
 * The last run Start began, with the session's to-do list read back.
 * @returns {Promise<{card: string, title: string, startedAt: number, endedAt: number|null, status: string,
 *   threadId: string|null, tasks: object[]|null, tokens: number, lastActivityAt: number|null} | null>}
 */
export async function readCardSession({ dir = SESSION_DIR } = {}) {
  const record = await readJson(recordPath(dir));
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
    tasks: await readThreadTasks(shown.threadId, dir),
    tokens: Number.isFinite(shown.tokens) ? shown.tokens : 0,
    largestStepTokens: Number.isFinite(shown.largestStepTokens) ? shown.largestStepTokens : 0,
    lastActivityAt: Number.isFinite(shown.lastActivityAt) ? shown.lastActivityAt : null,
  };
}

export async function isRunning({ dir = SESSION_DIR } = {}) {
  const record = await readJson(recordPath(dir));
  return Boolean(record && isLive(record));
}

/**
 * The command that runs one card outside mission control. A session started as a child of the
 * mission control service dies with that service, because a service restart kills its whole
 * cgroup. A transient unit of its own does not, and `systemd-run` returns as soon as the unit is
 * up, so Start answers before the session has finished booting. The keys the session needs are
 * supplied by the launcher the machine already uses, because `systemd-run --user` does not pass
 * the caller's environment on.
 */
export function detachedCommand({ unit, payload, repo = REPO_ROOT }) {
  return {
    command: 'systemd-run',
    cwd: repo,
    args: [
      '--user',
      `--unit=${unit}`,
      '--collect',
      '--slice=card.slice',
      `--property=WorkingDirectory=${repo}`,
      process.execPath,
      join(repo, 'scripts', 'julia-agents.mjs'),
      '--',
      process.execPath,
      join(repo, 'machine', 'card-run.mjs'),
      '--payload',
      payload,
    ],
  };
}

// `systemd-run --user` finds the user's manager through the runtime directory, and the mission
// control service is started with no XDG_RUNTIME_DIR of its own, so the launcher passes one on.
// Without it the launch fails with "Failed to connect to bus: No medium found".
export function launcherEnv(environment = process.env) {
  return {
    ...environment,
    XDG_RUNTIME_DIR: environment.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}`,
  };
}

// A child left in the caller's process group is killed with the caller. Detaching puts it in a
// process group of its own, and unref lets the caller exit without waiting for it.
export function launchDetached({ command, args, cwd }) {
  return new Promise((started, failed) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', 'ignore', 'pipe'], env: launcherEnv() });
    let detail = '';
    child.stderr?.on('data', chunk => { detail = `${detail}${chunk}`.slice(0, 500); });
    child.once('error', failed);
    child.once('exit', code => (code === 0
      ? started()
      : failed(new Error(`Could not start a card session: ${detail.trim() || `exit ${code}`}`))));
    child.unref();
  });
}

/**
 * Begin one card. Rejects while a run is live, because the Run view shows one run at a time.
 * @param {{identifier: string, title: string, description?: string, url?: string}} card
 * @param {{model: string, now?: number, dir?: string, launch?: Function}} options
 */
export async function startCard(card, { model, now = Date.now(), dir = SESSION_DIR, launch = launchDetached } = {}) {
  if (await isRunning({ dir })) throw Object.assign(new Error('A card is already running.'), { status: 409 });
  const startedAt = now;
  const record = {
    card: card.identifier, title: card.title, startedAt, endedAt: null, status: 'running',
    threadId: null, tokens: 0, largestStepTokens: 0, lastActivityAt: startedAt, heartbeatAt: startedAt,
  };
  // The record is written before the launch, so a second press is refused while the session boots.
  await writeRecord(dir, record);
  const payload = payloadPath(dir);
  await writeFile(payload, `${JSON.stringify({ card, model, sessionDir: dir, startedAt }, null, 2)}\n`);

  try {
    await launch(detachedCommand({ unit: `card-run-${card.identifier.toLowerCase()}-${startedAt}`, payload }));
  } catch (error) {
    await writeRecord(dir, { ...record, status: 'stopped', endedAt: Date.now() });
    throw error;
  }
  return { card: card.identifier, title: card.title, startedAt };
}
