import test from 'node:test';
import assert from 'node:assert/strict';
import { foldRunView, playbookName, runSteps } from './run-view.mjs';

const settings = { stuckAfterMs: 420000, quotaLowPercent: 20, burningFastTokens: 100000 };
const now = Date.parse('2026-11-27T12:00:00Z');

const step = (playbook, order, status, content = `Step ${order}`) => ({ id: `${playbook}-${order}`, content, status });

const session = (overrides = {}) => ({
  card: 'JUL-419',
  title: 'Todd presses Start on a card',
  startedAt: now - 60000,
  endedAt: null,
  status: 'running',
  threadId: 'thread-1',
  tasks: null,
  tokens: 0,
  largestStepTokens: 0,
  lastActivityAt: now - 1000,
  ...overrides,
});

const fold = overrides => foldRunView({ session: session(overrides), subscriptions: [], settings, now });

test('the stage is the playbook of the step the run is on', () => {
  const tasks = [step('feature', 1, 'completed'), step('feature', 2, 'in_progress'), step('feature', 3, 'pending')];
  assert.deepEqual(runSteps(tasks).list.map(x => x.id), ['feature-1', 'feature-2', 'feature-3']);
  const steps = runSteps(tasks);
  assert.equal(steps.stage, 'Feature');
  assert.equal(steps.index, 2);
  assert.equal(steps.total, 3);
  assert.equal(steps.current.title, 'Step 2');
});

test('the stage changes when the session moves to another playbook', () => {
  const feature = [step('feature', 1, 'completed'), step('feature', 2, 'completed')];
  assert.equal(fold({ tasks: feature }).run.stage, 'Feature');
  const shipping = [...feature, step('shipping', 1, 'in_progress'), step('shipping', 2, 'pending')];
  assert.equal(fold({ tasks: shipping }).run.stage, 'Shipping');
});

test('steps read in playbook order, and Opening a PR is the last step of Feature', () => {
  const tasks = [step('feature', 8, 'pending', 'Run Opening a PR'), step('feature', 2, 'completed')];
  const steps = runSteps(tasks);
  assert.deepEqual(steps.list.map(x => x.id), ['feature-2', 'feature-8']);
  assert.equal(steps.list.at(-1).title, 'Run Opening a PR');
  // Nothing in hand: the run is on the next step it has not passed.
  assert.equal(steps.index, 2);
});

test('a finished list reads its last step, and no playbook steps reads nothing', () => {
  const done = [step('babysit', 1, 'completed'), step('babysit', 2, 'completed')];
  const steps = runSteps(done);
  assert.equal(steps.index, 2);
  assert.equal(steps.stage, 'Babysit');
  assert.equal(runSteps([]).stage, '');
  assert.equal(runSteps(null).total, 0);
  assert.deepEqual(runSteps([{ id: 'card-branch', content: 'Branch', status: 'pending' }]).list, []);
});

test('only a live session is drawn as a run', () => {
  const run = fold({ tasks: [step('feature', 1, 'in_progress')] }).run;
  assert.equal(run.status, 'running');
  assert.equal(run.card, 'JUL-419');
  assert.equal(run.runningMs, 60000);
  assert.equal(run.stage, 'Feature');
  assert.equal(run.step, 'Step 1');
  assert.equal(run.steps.total, 1);
  assert.equal(run.usage.dollarsEstimate, null);
});

test('an ended session leaves the quiet screen with its result', () => {
  for (const [status, expected] of [['finished', 'finished'], ['stopped', 'stopped'], ['unknown', 'ended_unknown']]) {
    const snapshot = fold({ status, endedAt: now - 1000, tasks: [step('feature', 1, 'completed')] });
    assert.equal(snapshot.run, null);
    assert.equal(snapshot.lastResult.status, expected);
    assert.equal(snapshot.lastResult.at, now - 1000);
  }
  assert.equal(foldRunView({ session: null, subscriptions: [], settings, now }).lastResult, null);
});

test('a session that has gone quiet is stuck, and a stopped one says where it stopped', () => {
  const quiet = fold({ lastActivityAt: now - 8 * 60000, tasks: [step('feature', 2, 'in_progress', 'Build the slices')] });
  assert.equal(quiet.run.status, 'stuck');
  assert.equal(quiet.warnings.find(x => x.kind === 'stuck').text, 'Nothing has happened in the run for 8 minutes.');

  const stopped = fold({ status: 'stopped', endedAt: now - 1000, tasks: [step('feature', 2, 'in_progress', 'Build the slices')] });
  assert.equal(stopped.warnings.find(x => x.kind === 'stopped').text, 'The run stopped at “Build the slices”.');
  assert.deepEqual(fold({ status: 'unknown', endedAt: now }).warnings.map(x => x.kind), ['ended_unknown']);
});

test('a single model call over the limit is a burning warning, naming the tokens', () => {
  const warnings = fold({ largestStepTokens: 120000 }).warnings;
  assert.equal(warnings.find(x => x.kind === 'burning_fast').text, 'One model call used 120,000 tokens.');
  assert.equal(fold({ largestStepTokens: 100000 }).warnings.length, 0);
});

test('a subscription under the limit names itself and its window', () => {
  const subscriptions = [{
    id: 'claude', name: 'Claude', status: 'fresh', readAt: now,
    windows: [{ window: 'weekly', percentLeft: 12, resetsAt: now + 86400000 }],
  }];
  const snapshot = foldRunView({ session: null, subscriptions, settings, now });
  assert.deepEqual(snapshot.warnings.map(x => x.kind), ['quota_low']);
  assert.equal(snapshot.warnings[0].text, 'Claude: 12% of this week left.');
  assert.equal(snapshot.subscriptions[0].windows[0].low, true);
});

test('a reading that failed says so in one of the four short reasons', () => {
  const subscriptions = [{ id: 'chatgpt', name: 'ChatGPT', status: 'unknown', reason: 'sign-in expired' }];
  const [reading] = foldRunView({ session: null, subscriptions, settings, now }).subscriptions;
  assert.equal(reading.status, 'unknown');
  assert.equal(reading.reason, 'sign-in expired');
  const hostile = [{ id: 'chatgpt', name: 'ChatGPT', status: 'unknown', reason: '<script>alert(1)</script>' }];
  assert.equal(foldRunView({ session: null, subscriptions: hostile, settings, now }).subscriptions[0].reason, 'reading failed');
});

test('a playbook name reads as a person writes it', () => {
  assert.equal(playbookName('feature'), 'Feature');
  assert.equal(playbookName('bug-fix'), 'Bug fix');
  assert.equal(playbookName('opening-a-pr'), 'Opening a PR');
  assert.equal(playbookName('babysit'), 'Babysit');
  assert.equal(playbookName(''), '');
});
