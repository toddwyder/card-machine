import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foldRunView, helperName, readLiveEvents } from './run-view.mjs';

const SETTINGS = { stuckAfterMs: 420000, quotaLowPercent: 20, burningFastTokens: 100000 };
const fixture = name => readFileSync(new URL(`./fixtures/live/${name}`, import.meta.url), 'utf8');
const eventsOf = name => readLiveEvents(fixture(name));
const NOW = 1763700055000;

const freshSubscription = (id, name, windows) => ({ id, name, status: 'fresh', readAt: NOW, windows });
const fold = (over = {}) => foldRunView({ settings: SETTINGS, now: NOW, events: [], subscriptions: [], ...over });

test('a running card shows where it is, what it has used, and who is working', () => {
  const snapshot = fold({ events: eventsOf('running.jsonl') });
  assert.equal(snapshot.run.status, 'running');
  assert.equal(snapshot.run.title, "Mission control's Run view");
  assert.equal(snapshot.run.stage.id, 'flow-build');
  assert.equal(snapshot.run.stage.label, 'Build the slices');
  assert.equal(snapshot.run.step, 'Architect the shape');
  assert.deepEqual(snapshot.run.stages.map(stage => stage.id), ['start', 'start-build', 'flow-build']);
  assert.deepEqual(snapshot.run.stages.map(stage => stage.status), ['done', 'done', 'started']);
  assert.equal(snapshot.run.usage.tokens, 12000 + 900 + 4000 + 4000 + 400);
  assert.equal(snapshot.run.runningMs, NOW - 1763700000000);
  assert.deepEqual(snapshot.warnings, []);
});

test('each helper is its own card and its actions run newest first, one per call', () => {
  const [lead, helper] = fold({ events: eventsOf('running.jsonl') }).run.helpers;
  assert.equal(lead.name, 'Lead');
  assert.equal(helper.name, 'Feature Refactoring 1');
  assert.deepEqual(helper.actions.map(action => action.name), ['Read a skill', 'Run a command']);
  assert.deepEqual(helper.actions.map(action => action.status), ['started', 'done']);
  assert.equal(lead.actions.length, 1);
  assert.equal(lead.status, 'working');
});

test('the same event id twice counts once', () => {
  const [runLine, stageLine] = fixture('torn.jsonl').split('\n');
  const snapshot = fold({ events: readLiveEvents(`${runLine}\n${stageLine}\n${stageLine}\n${stageLine}`) });
  assert.equal(snapshot.run.stages.length, 1);
  assert.deepEqual(snapshot.run.stages.map(stage => stage.id), ['flow-build']);
});

test('a half-written last line is skipped, not fatal', () => {
  const snapshot = fold({ events: eventsOf('torn.jsonl') });
  assert.equal(snapshot.run.stage.id, 'flow-build');
  assert.deepEqual(snapshot.run.stages.map(stage => stage.id), ['flow-build']);
  assert.equal(readLiveEvents('').length, 0);
  assert.equal(readLiveEvents('not json\n{"id":"a","kind":"run"}\n').length, 1);
});

test('seven quiet minutes become a stuck run with a stuck warning', () => {
  const events = eventsOf('running.jsonl');
  const lastAt = 1763700050000;
  const stuck = fold({ events, now: lastAt + 8 * 60000 });
  assert.equal(stuck.run.status, 'stuck');
  assert.equal(stuck.run.helpers.at(-1).status, 'stuck');
  assert.deepEqual(stuck.warnings.map(warning => warning.title), ['Stuck']);
  assert.match(stuck.warnings[0].text, /8 minutes/);
  assert.equal(fold({ events, now: lastAt + 5 * 60000 }).run.status, 'running');
});

test('a stopped run says so, on the run and in a warning', () => {
  const snapshot = fold({
    events: eventsOf('failed.jsonl'),
    runStatus: { status: 'failed', createdAt: 1763700000000, updatedAt: 1763700025000 },
  });
  assert.equal(snapshot.run.status, 'stopped');
  assert.equal(snapshot.run.stage.status, 'failed');
  assert.deepEqual(snapshot.warnings.map(warning => warning.kind), ['stopped']);
});

test('a finished run reads as finished and keeps no warnings', () => {
  const snapshot = fold({
    events: eventsOf('failed.jsonl'),
    runStatus: { status: 'success', createdAt: 1763700000000, updatedAt: 1763700025000 },
  });
  assert.equal(snapshot.run.status, 'finished');
  assert.equal(snapshot.run.runningMs, 25000);
  assert.equal(snapshot.lastResult, null);
});

test('the run waits for Todd while the UAT stage is open', () => {
  const events = readLiveEvents('{"id":"a","at":1763700000000,"kind":"run","card":"JUL-361","title":"A card"}\n{"id":"b","at":1763700010000,"kind":"stage","stage":"acceptance","status":"started"}\n');
  assert.equal(fold({ events }).run.status, 'waiting_for_you');
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

test('a failed reading is unknown, with no number and no warning', () => {
  const snapshot = fold({ subscriptions: [{ id: 'claude', name: 'Claude', status: 'unknown', readAt: NOW, reason: '401' }] });
  assert.equal(snapshot.subscriptions[0].status, 'unknown');
  assert.equal(snapshot.subscriptions[0].windows, undefined);
  assert.deepEqual(snapshot.warnings, []);
});

test('one model call over the burning limit names the agent that made it', () => {
  const snapshot = fold({ events: eventsOf('burning.jsonl') });
  assert.deepEqual(snapshot.warnings.map(warning => warning.kind), ['burning_fast']);
  assert.match(snapshot.warnings[0].text, /^Lead used 138,000 tokens in one model call\.$/);
});

test('nothing running shows no run at all, and the subscriptions still answer', () => {
  const snapshot = fold({ subscriptions: [freshSubscription('chatgpt', 'ChatGPT', [{ window: 'weekly', percentLeft: 96, resetsAt: 1764300000000 }])] });
  assert.equal(snapshot.run, null);
  assert.deepEqual(snapshot.warnings, []);
  assert.equal(snapshot.subscriptions.length, 1);
  assert.equal(snapshot.observedAt, NOW);
});

test('a dollar figure is passed through as an estimate, never invented', () => {
  const estimateUsd = () => 0.0125;
  assert.equal(fold({ events: eventsOf('running.jsonl') }).run.usage.dollarsEstimate, null);
  assert.equal(fold({ events: eventsOf('running.jsonl'), estimateUsd }).run.usage.dollarsEstimate, 0.025);
});

test('an agent id becomes a name Todd can read', () => {
  assert.equal(helperName('flow-build'), 'Lead');
  assert.equal(helperName('pstack-feature-refactoring-2'), 'Feature Refactoring 2');
  assert.equal(helperName('pstack-bug-fix-1'), 'Bug Fix 1');
});

test('a run whose calls have no published price reports no dollar figure', () => {
  const snapshot = fold({ events: eventsOf('running.jsonl'), estimateUsd: () => null });
  assert.equal(snapshot.run.usage.dollarsEstimate, null);
  assert.equal(snapshot.run.usage.tokens > 0, true);
});
