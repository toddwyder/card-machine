// A session folder the Run view can be pointed at. Every scene writes the same files a real run
// leaves behind: the record Start writes (`run.json`), the session's own to-do list (a real
// `state.db`), the saved subscriptions, and the Ready-card list the idle screen offers. The app
// reads them through its own readers, so no scene is faked by importing app internals. The one
// import it takes is the playbook reader: a to-do list has to carry a playbook's own words for the
// screen to name the stage, and copying those words here would let them drift from the skill.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPlaybooks } from '../lib/run-view.mjs';

const here = new URL('.', import.meta.url);

// The session directory. `RUN_VIEW_SESSION_DIR` points the app here.
export const FLOW_DIR = fileURLToPath(new URL('./test-results/flow', here));
export const RUN_FILE = join(FLOW_DIR, 'run.json');
export const STATE_FILE = join(FLOW_DIR, 'state.db');
export const SUBSCRIPTIONS_FILE = join(FLOW_DIR, 'subscriptions.json');
export const READY_FILE = join(FLOW_DIR, 'ready.json');

const hours = 60 * 60 * 1000;
const minutes = 60 * 1000;

// The one instant every scene and the app read the clock at. A scene writes its times as offsets
// from here and the server folds the screen at the same number, so no label depends on how long
// the test took to get to the screenshot. It still reads as a real run: 09:30 UTC on a Monday
// morning, with the five-hour windows refilling that afternoon.
export const NOW = Date.parse('2026-11-23T09:30:00Z');

const CARD = 'JUL-419';
const TITLE = 'Todd presses Start on a card';
const THREAD = 'thread-jul-419';

// What the three subscriptions read: two fresh, one that failed to read, and a set whose
// five-hour window is nearly gone.
const READINGS = {
  normal: now => [
    { id: 'claude', name: 'Claude', status: 'fresh', readAt: now, windows: [
      { window: 'five_hour', percentLeft: 64, resetsAt: now + 3 * hours },
      { window: 'weekly', percentLeft: 88, resetsAt: now + 4 * 24 * hours },
    ] },
    { id: 'chatgpt', name: 'ChatGPT', status: 'fresh', readAt: now, windows: [
      { window: 'five_hour', percentLeft: 51, resetsAt: now + 3 * hours },
      { window: 'weekly', percentLeft: 72, resetsAt: now + 4 * 24 * hours },
    ] },
    { id: 'commandcode', name: 'CommandCode', status: 'unknown', readAt: now, reason: 'reading failed' },
  ],
  low: now => [
    { id: 'claude', name: 'Claude', status: 'fresh', readAt: now, windows: [
      { window: 'five_hour', percentLeft: 11, resetsAt: now + 2 * hours },
      { window: 'weekly', percentLeft: 98, resetsAt: now + 4 * 24 * hours },
    ] },
    { id: 'chatgpt', name: 'ChatGPT', status: 'fresh', readAt: now, windows: [
      { window: 'five_hour', percentLeft: 64, resetsAt: now + 3 * hours },
      { window: 'weekly', percentLeft: 88, resetsAt: now + 4 * 24 * hours },
    ] },
    { id: 'commandcode', name: 'CommandCode', status: 'unknown', readAt: now, reason: 'reading failed' },
  ],
  // A stored sign-in whose token no longer works: not the same as no sign-in at all.
  stale: now => [
    { id: 'claude', name: 'Claude', status: 'unknown', readAt: now, reason: 'sign-in expired' },
    { id: 'chatgpt', name: 'ChatGPT', status: 'fresh', readAt: now, windows: [
      { window: 'five_hour', percentLeft: 51, resetsAt: now + 3 * hours },
      { window: 'weekly', percentLeft: 72, resetsAt: now + 4 * 24 * hours },
    ] },
    { id: 'commandcode', name: 'CommandCode', status: 'unknown', readAt: now, reason: 'no stored sign-in' },
  ],
};

// The session's own to-do list. The screen names the stage from the steps' own text, so every
// item here is a line of the playbook the session is following; the ids say nothing.
const stepsOf = playbook => readPlaybooks().find(entry => entry.id === playbook).steps.map(step => step.text);

const tasks = (playbook, statuses) =>
  stepsOf(playbook).map((content, index) => ({ id: `step-${index + 1}`, content, status: statuses[index] ?? 'pending' }));

const FEATURE = tasks('feature', ['completed', 'in_progress']);

const SHIPPING = tasks('shipping', ['completed', 'completed', 'in_progress']);

const FINISHED_FEATURE = FEATURE.map(step => ({ ...step, status: 'completed' }));

const STOPPED_FEATURE = tasks('feature', ['completed', 'completed', 'completed', 'in_progress']);

const READY_CARDS = [
  { id: 'card-1', identifier: 'JUL-407', title: 'Mission control shows the Run view', createdAt: '2026-11-23T08:00:00Z' },
  { id: 'card-2', identifier: 'JUL-361', title: 'A card can be started from Mission control', createdAt: '2026-11-23T08:10:00Z' },
];

// Each scene is the record a real run would leave plus its to-do list. A live scene beats at the
// moment `prepare()` runs because the liveness check uses the machine's real clock, not the
// pinned one the screen folds at.
const SCENES = {
  // A live run halfway through Feature, with its step in hand.
  running: now => ({ tasks: FEATURE, record: liveRecord(now, { startedAt: now - 6 * minutes }) }),
  // The session has opened but has not written its to-do list yet, so it has no playbook name.
  'no-todo': now => ({ tasks: null, record: liveRecord(now, { startedAt: now - 2 * minutes }) }),
  // The session moved on to another playbook: the stage and the count follow its list.
  shipping: now => ({ tasks: SHIPPING, record: liveRecord(now, { startedAt: now - 9 * minutes }) }),
  // A live session whose last activity is older than the quiet limit.
  stuck: now => ({ tasks: FEATURE, record: liveRecord(now, { startedAt: now - 12 * minutes, lastActivityAt: now - 8 * minutes }) }),
  // One model call over the burning limit.
  burning: now => ({ tasks: FEATURE, record: liveRecord(now, { startedAt: now - 7 * minutes, tokens: 264000, largestStepTokens: 240000 }) }),
  // Ended runs: the record carries the end and the session's own result.
  finished: now => ({ tasks: FINISHED_FEATURE, record: endedRecord(now, 'finished') }),
  stopped: now => ({ tasks: STOPPED_FEATURE, record: endedRecord(now, 'stopped') }),
  // A record whose process stopped beating without writing an end: shown as ended, result unknown.
  'ended-unknown': now => ({
    tasks: FEATURE,
    record: {
      ...baseRecord(now, { startedAt: now - 60 * minutes }),
      status: 'running',
      endedAt: null,
      heartbeatAt: Date.now() - 10 * minutes,
    },
  }),
  // No session at all: the idle screen offers the Ready cards.
  idle: () => ({ tasks: null, record: null }),
  // No session and an empty queue.
  empty: () => ({ tasks: null, record: null }),
  // No session and a Ready list the app cannot read.
  unreadable: () => ({ tasks: null, record: null }),
};

function baseRecord(now, { startedAt = now - 6 * minutes, tokens = 84000, largestStepTokens = 12000, lastActivityAt = now - 30 * 1000 } = {}) {
  return {
    card: CARD,
    title: TITLE,
    startedAt,
    endedAt: null,
    status: 'running',
    threadId: THREAD,
    tokens,
    largestStepTokens,
    lastActivityAt,
    heartbeatAt: Date.now(),
  };
}

function liveRecord(now, overrides = {}) {
  return baseRecord(now, overrides);
}

function endedRecord(now, status) {
  return {
    ...baseRecord(now, { startedAt: now - 60 * minutes, lastActivityAt: now - 2 * minutes }),
    status,
    endedAt: now - 1 * minutes,
  };
}

function readyFor(scene) {
  if (scene === 'empty') return 'empty';
  if (scene === 'unreadable') return 'unreadable';
  if (scene === 'finished' || scene === 'stopped' || scene === 'ended-unknown') return 'empty';
  return 'cards';
}

function writeReady(kind) {
  if (kind === 'unreadable') {
    writeFileSync(READY_FILE, '{ this is not the card list');
    return;
  }
  writeFileSync(READY_FILE, JSON.stringify(kind === 'empty' ? [] : READY_CARDS, null, 2));
}

// A real SQLite database with the schema Mastra writes the session's to-do list into. A scene
// with no list still gets the table, so the app reads an empty list rather than a broken file.
function writeState(tasks, now) {
  const db = new DatabaseSync(STATE_FILE);
  try {
    db.exec('CREATE TABLE mastra_thread_state (threadId TEXT, type TEXT, value TEXT, createdAt INTEGER, updatedAt INTEGER, PRIMARY KEY(threadId, type))');
    if (tasks) {
      db.prepare('INSERT INTO mastra_thread_state (threadId, type, value, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
        .run(THREAD, 'task', JSON.stringify(tasks), now, now);
    }
  } finally {
    db.close();
  }
}

/** Rebuild the session folder as one scene with one set of readings, and return its path. */
export function prepare({ scene = 'running', readings = 'normal', now = NOW, ready = readyFor(scene) } = {}) {
  const build = SCENES[scene];
  if (!build) throw new Error(`unknown scene ${scene}`);
  rmSync(FLOW_DIR, { recursive: true, force: true });
  mkdirSync(FLOW_DIR, { recursive: true });

  const { tasks, record } = build(now);
  if (record) writeFileSync(RUN_FILE, `${JSON.stringify(record, null, 2)}\n`);
  writeState(tasks, now);
  writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(READINGS[readings](now), null, 2));
  writeReady(ready);
  return FLOW_DIR;
}

/** The spend of a live run as it goes: rewrite the record's tokens the way the next calls would. */
export function recordSpend(tokens) {
  const record = JSON.parse(readFileSync(RUN_FILE, 'utf8'));
  writeFileSync(RUN_FILE, `${JSON.stringify({ ...record, tokens, heartbeatAt: Date.now() }, null, 2)}\n`);
}

export const buildFixture = (now = NOW) => prepare({ now });
