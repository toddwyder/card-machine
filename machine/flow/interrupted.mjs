// Runs left "running" by a Studio that died. A card's run lives in the memory of
// the process that started it, so when that process is killed the saved run
// still says "running" and nothing will ever finish it. Studio asks this module
// at boot, before it serves its first request: for every run still marked
// running whose owner is gone, cancel it and post the cause on its card.
//
// The cause comes from the record the process left behind, not from a guess:
// the user manager's journal names an out-of-memory kill or the result the unit
// stopped with, and the run's own start time bounds where to look.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getIssue, postComment } from '../../scripts/linear-cli.mjs';
import { pendingInterruptedRuns, stopInterruptedRun } from './crash-stop.mjs';

const OOM = /killed by the OOM killer|result 'oom-kill'/;
const FAILED = /Failed with result '([^']+)'/;
const TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:Z|[+-]\d{2}:?\d{2})/;

// The unit this Studio runs under, read from its own cgroup. A process started
// outside systemd has no unit, and then there is no journal to read.
export function studioUnit(cgroup = readCgroup()) {
  const last = String(cgroup ?? '').trim().split('/').filter(Boolean).pop() ?? '';
  return last.endsWith('.service') ? last : null;
}

function readCgroup() {
  try {
    return readFileSync('/proc/self/cgroup', 'utf8');
  } catch {
    return '';
  }
}

// What the user manager said about this unit since `since`. Anything else on the
// box is irrelevant to why this run stopped.
export function journalSince(unit, { exec = execFileSync } = {}) {
  if (!unit) return () => '';
  return since => {
    try {
      return exec('journalctl', ['-q', '--user-unit', unit, '--since', since, '-o', 'short-iso', '--no-pager'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return '';
    }
  };
}

// The clock time the unit's last stop was recorded at, in the card author's
// own zone, because "00:34 PT" is what Todd reads on the card.
function clockAt(line, timeZone) {
  const match = TIME.exec(line);
  if (!match) return null;
  const at = new Date(`${match[1]}Z`);
  if (Number.isNaN(at.valueOf())) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

export function interruptionCause(journal, { timeZone = 'America/Los_Angeles' } = {}) {
  const lines = String(journal ?? '').split('\n');
  const killed = lines.find(line => OOM.test(line));
  if (killed) {
    const at = clockAt(killed, timeZone);
    return at ? `the out-of-memory kill at ${at} Pacific` : 'an out-of-memory kill';
  }
  const failed = lines.map(line => ({ line, match: FAILED.exec(line) })).find(entry => entry.match);
  if (failed) {
    const at = clockAt(failed.line, timeZone);
    return at ? `Studio stopped (${failed.match[1]}) at ${at} Pacific` : `Studio stopped (${failed.match[1]})`;
  }
  return 'Studio was stopped before the run finished';
}

function beatPath(dir, runId) {
  return join(dir, 'heartbeat', `${runId}.json`);
}

// Written by whatever process is driving a run right now, and refreshed, so a
// Studio that boots while another process is mid-run leaves that run alone.
export function keepBeat(dir, runId, { everyMs = 5000, beat = beatRun } = {}) {
  beat(dir, runId);
  const timer = setInterval(() => beat(dir, runId), everyMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    try {
      rmSync(beatPath(dir, runId), { force: true });
    } catch {
      // A missing heartbeat is the same as a stopped one.
    }
  };
}

export function beatRun(dir, runId) {
  const path = beatPath(dir, runId);
  mkdirSync(join(dir, 'heartbeat'), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 });
}

export function runOwner(dir, runId, { now = Date.now(), maxAgeMs = 120000, alive = pidAlive } = {}) {
  let beat;
  try {
    beat = JSON.parse(readFileSync(beatPath(dir, runId), 'utf8'));
  } catch {
    return null;
  }
  const age = now - Date.parse(beat?.at ?? '');
  if (!Number.isFinite(age) || age > maxAgeMs) return null;
  return alive(beat.pid) ? beat.pid : null;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function cardOf(run) {
  const snapshot = typeof run?.snapshot === 'string' ? safeParse(run.snapshot) : run?.snapshot;
  return snapshot?.value?.card ?? snapshot?.initialState?.card ?? snapshot?.context?.input?.card ?? '';
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const readCardComments = async card => {
  const issue = await getIssue(card, { includeComments: true });
  return (issue?.comments?.nodes ?? []).map(node => node.body ?? '');
};

export async function reconcileInterruptedRuns({
  dir,
  store,
  workflow,
  readJournal = journalSince(studioUnit()),
  timeZone = 'America/Los_Angeles',
  readComments = readCardComments,
  postComment: post = postComment,
  owner = runId => runOwner(dir, runId),
  log = console,
}) {
  const stopped = [];
  const failed = [];
  const notify = async ({ runId, card, cause }) => {
    await stopInterruptedRun({ dir, workflow, store, runId, card, cause, readComments, postComment: post });
    stopped.push({ runId, card, cause });
  };

  for (const record of pendingInterruptedRuns(dir)) {
    if (owner(record.runId)) continue;
    try {
      await notify(record);
    } catch (error) {
      failed.push({ runId: record.runId, card: record.card, error });
    }
  }

  const { runs = [] } = await store.listWorkflowRuns({ workflowName: workflow.id, status: 'running', perPage: false });
  for (const run of runs) {
    const runId = run.runId;
    if (owner(runId)) continue;
    const card = cardOf(run);
    if (!card) {
      log.warn?.(`A run (${runId}) was left running and names no card, so it cannot be stopped with a comment.`);
      failed.push({ runId, card: '', error: new Error('run names no card') });
      continue;
    }
    try {
      const since = new Date(run.createdAt ?? Date.now()).toISOString();
      await notify({ runId, card, cause: interruptionCause(readJournal(since), { timeZone }) });
    } catch (error) {
      failed.push({ runId, card, error });
    }
  }

  if (failed.length) {
    for (const item of failed) log.error?.(`Could not stop interrupted run ${item.runId}: ${item.error?.message ?? item.error}`);
  }
  return { stopped, failed };
}
