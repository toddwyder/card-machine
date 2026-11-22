import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { foldRunView, helperName, readLiveEvents } from './run-view.mjs';
import { LIVE_TYPES, liveType } from '../../machine/flow/live-schema.mjs';
import { SCENES, writeScene } from '../scripts/live-scenes.mjs';
import { createLiveFeed, liveFileIn } from '../../machine/flow/live.mjs';

const SETTINGS = { stuckAfterMs: 420000, quotaLowPercent: 20, burningFastTokens: 100000 };
const NOW = 1795315660000;

// Every log a test reads comes out of the machine's own writer, never from a hand-written file.
const sceneDir = scene => mkdtempSync(join(tmpdir(), `run-view-${scene}-`));
const sceneLog = (scene, over = {}) => readFileSync(writeScene(sceneDir(scene), scene, { now: NOW, ...over }), 'utf8');
const eventsOf = (scene, over) => readLiveEvents(sceneLog(scene, over));

const freshSubscription = (id, name, windows) => ({ id, name, status: 'fresh', readAt: NOW, windows });
const fold = (over = {}) => foldRunView({ settings: SETTINGS, now: NOW, events: [], subscriptions: [], ...over });

test('a running card shows where it is, what it has used, and who is working', () => {
  const snapshot = fold({ events: eventsOf('running') });
  assert.equal(snapshot.run.status, 'running');
  assert.equal(snapshot.run.title, "Mission control's Run view");
  assert.equal(snapshot.run.stage.id, 'flow-build');
  assert.equal(snapshot.run.stage.label, 'Build the slices');
  assert.equal(snapshot.run.step, 'Architect the shape');
  assert.deepEqual(snapshot.run.stages.map(stage => stage.id), ['start', 'start-build', 'flow-build']);
  assert.deepEqual(snapshot.run.stages.map(stage => stage.status), ['done', 'done', 'started']);
  assert.equal(snapshot.run.usage.tokens, 82400);
  assert.equal(snapshot.run.runningMs, NOW - snapshot.run.startedAt);
  assert.equal(snapshot.run.runningMs > 0, true);
  assert.deepEqual(snapshot.warnings, []);
});

test('every event the writer emits is a type the shared schema and the fold know', () => {
  const lines = readLiveEvents(sceneLog('running'));
  assert.equal(lines.length > 0, true);
  const written = new Set(lines.map(event => liveType(event)));
  assert.deepEqual([...written].sort(), [...LIVE_TYPES].sort());
});

test('each helper is its own card and its actions run newest first, one per call', () => {
  const [lead, helper] = fold({ events: eventsOf('running') }).run.helpers;
  assert.equal(lead.name, 'Lead');
  assert.equal(helper.name, 'Feature Refactoring 1');
  assert.deepEqual(helper.actions.map(action => action.name), ['Read a skill', 'Run a command', 'Read a file']);
  assert.deepEqual(helper.actions.map(action => action.status), ['done', 'done', 'done']);
  assert.equal(lead.actions.length, 0);
  assert.equal(lead.status, 'working');
});

test('a half-written last line is skipped, not fatal, and a repeated id counts once', () => {
  const log = sceneLog('torn');
  const lines = log.split('\n').filter(Boolean);
  assert.match(lines.at(-1), /^\{"id":"torn-1"/);
  const events = readLiveEvents(log);
  assert.equal(events.length, lines.length - 1);
  const [first, second] = lines;
  assert.equal(readLiveEvents(`${first}\n${second}\n${second}\n${second}`).length, 2);
  assert.equal(readLiveEvents('').length, 0);
  assert.equal(readLiveEvents('not json\n').length, 0);
});

test('seven quiet minutes become a stuck run with a stuck warning', () => {
  const events = eventsOf('running');
  const lastAt = events.reduce((last, event) => Math.max(last, event.at), 0);
  const stuck = fold({ events, now: lastAt + 8 * 60000 });
  assert.equal(stuck.run.status, 'stuck');
  assert.equal(stuck.run.helpers.at(-1).status, 'stuck');
  assert.deepEqual(stuck.warnings.map(warning => warning.title), ['Stuck']);
  assert.match(stuck.warnings[0].text, /8 minutes/);
  assert.equal(fold({ events, now: lastAt + 5 * 60000 }).run.status, 'running');
});

test('a stopped run says so, whether the row or only the log says it', () => {
  const withRow = fold({ events: eventsOf('stopped'), runStatus: { status: 'failed', createdAt: NOW - 360000, updatedAt: NOW - 60000 } });
  assert.equal(withRow.run.status, 'stopped');
  assert.equal(withRow.run.stage.status, 'failed');
  assert.deepEqual(withRow.warnings.map(warning => warning.kind), ['stopped']);
  const logOnly = fold({ events: eventsOf('stopped') });
  assert.equal(logOnly.run.status, 'stopped');
  assert.deepEqual(logOnly.warnings.map(warning => warning.kind), ['stopped']);
});

test('a finished run reads as finished and keeps no warnings', () => {
  const withRow = fold({ events: eventsOf('finished'), runStatus: { status: 'success', createdAt: NOW - 360000, updatedAt: NOW - 20000 } });
  assert.equal(withRow.run.status, 'finished');
  assert.equal(withRow.run.runningMs > 0, true);
  assert.equal(withRow.lastResult, null);
  assert.deepEqual(withRow.warnings, []);
  assert.equal(fold({ events: eventsOf('finished') }).run.status, 'finished');
});

test('the run waits for Todd while the UAT stage is open', () => {
  const snapshot = fold({ events: eventsOf('uat') });
  assert.equal(snapshot.run.status, 'waiting_for_you');
  assert.equal(snapshot.run.stage.id, 'acceptance');
  assert.equal(snapshot.run.stage.status, 'waiting');
  assert.deepEqual(snapshot.warnings, []);
});

test('a stage that waits is waiting, and goes back to running when the machine resumes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-view-resume-'));
  const feed = createLiveFeed({ file: liveFileIn(dir, 'JUL-361'), logger: { warn() {} } });
  feed.run({ card: 'JUL-361', title: 'A card', at: NOW });
  const read = () => readLiveEvents(readFileSync(liveFileIn(dir, 'JUL-361'), 'utf8'), { now: NOW });
  feed.stage({ stage: 'acceptance', status: 'started' });
  feed.stage({ stage: 'acceptance', status: 'waiting' });
  assert.equal(fold({ events: read() }).run.status, 'waiting_for_you');
  feed.stage({ stage: 'acceptance', status: 'started' });
  assert.equal(fold({ events: read() }).run.status, 'running');
  feed.stage({ stage: 'acceptance', status: 'done' });
  feed.stage({ stage: 'land', status: 'started' });
  assert.equal(fold({ events: read() }).run.status, 'running');
});

test('a run with no stored row still shows from its own log', () => {
  const snapshot = fold({ events: eventsOf('running'), runStatus: null });
  assert.equal(snapshot.run.card, 'JUL-361');
  assert.equal(snapshot.run.title, "Mission control's Run view");
  assert.equal(snapshot.run.stage.id, 'flow-build');
  assert.equal(snapshot.run.step, 'Architect the shape');
  assert.equal(snapshot.run.usage.tokens > 0, true);
  assert.equal(snapshot.run.startedAt > 0, true);
  assert.equal(snapshot.lastResult, null);
});

test('a subscription at or under the low mark raises one quota warning per window', () => {
  const snapshot = fold({
    subscriptions: [
      freshSubscription('claude', 'Claude', [{ window: 'five_hour', percentLeft: 11, resetsAt: 1763710000000 }, { window: 'weekly', percentLeft: 98, resetsAt: 1764300000000 }]),
      freshSubscription('chatgpt', 'ChatGPT', [{ window: 'five_hour', percentLeft: 20, resetsAt: 1763710000000 }]),
    ],
  });
  assert.deepEqual(snapshot.warnings.map(warning => warning.kind), ['quota_low', 'quota_low']);
  assert.match(snapshot.warnings[0].text, /Claude: 11% of this 5-hour window left/);
  assert.deepEqual(snapshot.subscriptions[0].windows.map(window => window.low), [true, false]);
  assert.deepEqual(snapshot.subscriptions[1].windows.map(window => window.low), [true]);
});

test('one reading keeps every window it read, each with its own number and reset', () => {
  const snapshot = fold({
    subscriptions: [
      freshSubscription('claude', 'Claude', [
        { window: 'five_hour', percentLeft: 11, resetsAt: 1763710000000 },
        { window: 'weekly', percentLeft: 98, resetsAt: 1764300000000 },
      ]),
    ],
  });
  const [subscription] = snapshot.subscriptions;
  assert.deepEqual(subscription.windows.map(window => window.window), ['five_hour', 'weekly']);
  assert.deepEqual(subscription.windows.map(window => window.percentLeft), [11, 98]);
  assert.deepEqual(subscription.windows.map(window => window.resetsAt), [1763710000000, 1764300000000]);
  assert.equal(subscription.windows[1].resetsAt === subscription.windows[0].resetsAt, false);
});

test('a failed reading is unknown, with no number and no warning, and says why', () => {
  const snapshot = fold({ subscriptions: [{ id: 'claude', name: 'Claude', status: 'unknown', readAt: NOW, reason: 'sign-in expired' }] });
  assert.equal(snapshot.subscriptions[0].status, 'unknown');
  assert.equal(snapshot.subscriptions[0].reason, 'sign-in expired');
  assert.equal(snapshot.subscriptions[0].windows, undefined);
  assert.deepEqual(snapshot.warnings, []);
});

// The reason is a closed set, so an error message or a status code from a caller cannot ride
// along into the browser.
test('a reason outside the four short ones becomes "reading failed"', () => {
  for (const offered of ['401', 'socket hang up', undefined, null, 42]) {
    const snapshot = fold({ subscriptions: [{ id: 'claude', name: 'Claude', status: 'unknown', readAt: NOW, reason: offered }] });
    assert.equal(snapshot.subscriptions[0].reason, 'reading failed');
  }
});

test('one model call over the burning limit names the agent that made it', () => {
  const snapshot = fold({ events: eventsOf('burning') });
  assert.deepEqual(snapshot.warnings.map(warning => warning.kind), ['burning_fast']);
  assert.match(snapshot.warnings[0].text, /^Feature Refactoring 1 used 242,400 tokens in one model call\.$/);
});

test('nothing running shows no run at all, and the subscriptions still answer', () => {
  const snapshot = fold({ subscriptions: [freshSubscription('chatgpt', 'ChatGPT', [{ window: 'weekly', percentLeft: 96, resetsAt: 1764300000000 }])] });
  assert.equal(snapshot.run, null);
  assert.deepEqual(snapshot.warnings, []);
  assert.equal(snapshot.subscriptions.length, 1);
  assert.equal(snapshot.observedAt, NOW);
});

test('nothing running but a stored row says what the last run did', () => {
  const snapshot = fold({ runStatus: { status: 'success', createdAt: NOW - 3600000, updatedAt: NOW - 3500000 } });
  assert.equal(snapshot.run, null);
  assert.deepEqual(snapshot.lastResult, { status: 'finished', at: NOW - 3500000 });
});

test('a dollar figure is passed through as an estimate, never invented', () => {
  const estimateUsd = () => 0.0125;
  assert.equal(fold({ events: eventsOf('running') }).run.usage.dollarsEstimate, null);
  assert.equal(fold({ events: eventsOf('running'), estimateUsd }).run.usage.dollarsEstimate, 0.0125);
});

test('an agent id becomes a name Todd can read', () => {
  assert.equal(helperName('flow-build'), 'Lead');
  assert.equal(helperName('pstack-feature-refactoring-2'), 'Feature Refactoring 2');
  assert.equal(helperName('pstack-bug-fix-1'), 'Bug Fix 1');
});

test('a run whose calls have no published price reports no dollar figure', () => {
  const snapshot = fold({ events: eventsOf('running'), estimateUsd: () => null });
  assert.equal(snapshot.run.usage.dollarsEstimate, null);
  assert.equal(snapshot.run.usage.tokens > 0, true);
});

test('every scene writes a log the fold can read', () => {
  for (const scene of SCENES) {
    if (scene === 'quiet') continue;
    const events = eventsOf(scene);
    for (const event of events) assert.equal(LIVE_TYPES.includes(liveType(event)), true, `${scene}: ${JSON.stringify(event)}`);
    assert.doesNotThrow(() => fold({ events }));
  }
});

// The count on screen is the machine's own task list, so it cannot show a step the run never had.
test('the step row is the machine task list, counted and named', () => {
  const { run } = fold({ events: eventsOf('running') });
  assert.equal(run.steps.total, 8);
  assert.equal(run.steps.index, 2);
  assert.equal(run.steps.list.length, 8);
  assert.equal(run.steps.list[1].title, 'Architect the shape');
  assert.equal(run.steps.list[1].status, 'in_progress');
  assert.equal(run.steps.list[0].status, 'completed');
  assert.equal(run.steps.list[2].status, 'pending');
  // One lookup decides both, so the step's name and its number cannot disagree.
  assert.equal(run.step, run.steps.list[run.steps.index - 1].title);
});

// A step the machine was told to skip keeps its own shape, and the reason stays out of the pill.
test('a skipped step reads as skipped, without its reason in the row', () => {
  const skipped = fold({ events: eventsOf('running') }).run.steps.list.find(step => step.id === 'playbook_7');
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.title, 'Interrogate the design');
  assert.equal(skipped.short.includes('skip:'), false);
});

test('a long step keeps a pill-sized name', () => {
  const long = fold({ events: eventsOf('running') }).run.steps.list.find(step => step.id === 'playbook_4');
  assert.equal(long.short.length <= 43, true);
  assert.equal(long.short.endsWith('…'), true);
  assert.equal(long.title.startsWith(long.short.slice(0, 12)), true);
});

test('the step row follows the machine numbering, not the order it arrived in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-view-order-'));
  const file = liveFileIn(dir, 'JUL-361');
  const feed = createLiveFeed({ file, now: () => NOW });
  feed.run({ card: 'JUL-361', title: 'A card out of order' });
  feed.tasks({
    agent: 'flow-build',
    tasks: [
      { id: 'playbook_10', title: 'Tenth step', status: 'pending' },
      { id: 'playbook_2', title: 'Second step', status: 'completed' },
      { id: 'playbook_1', title: 'First step', status: 'completed' },
    ],
  });
  const { run } = fold({ events: readLiveEvents(readFileSync(file, 'utf8')) });
  assert.deepEqual(run.steps.list.map(step => step.id), ['playbook_1', 'playbook_2', 'playbook_10']);
  assert.equal(run.steps.index, 3);
  assert.equal(run.steps.total, 3);
  assert.equal(run.step, null);
});

test('a finished run counts its last step, never step zero', () => {
  const { run } = fold({ events: eventsOf('finished') });
  assert.equal(run.steps.total, 8);
  assert.equal(run.steps.index, 8);
  assert.equal(run.steps.list.every(step => step.status === 'completed'), true);
});

test('a run that ends on cleanup reads as finished, and one that ends elsewhere does not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-view-last-stage-'));
  const file = liveFileIn(dir, 'JUL-361');
  const feed = createLiveFeed({ file, now: () => NOW });
  feed.run({ card: 'JUL-361', title: 'A card that ran to its last stage' });
  for (const [stage, status] of [
    ['flow-build', 'done'],
    ['retro', 'done'],
    ['cleanup', 'started'],
  ]) feed.stage({ stage, status });
  const midRun = fold({ events: readLiveEvents(readFileSync(file, 'utf8')) });
  assert.equal(midRun.run.status, 'running');
  assert.equal(midRun.run.stage.id, 'cleanup');

  feed.stage({ stage: 'cleanup', status: 'done' });
  const ended = fold({ events: readLiveEvents(readFileSync(file, 'utf8')) });
  assert.equal(ended.run.status, 'finished');
  assert.equal(ended.run.stage.label, 'Clean up after the card');
  assert.deepEqual(ended.warnings, []);
});
