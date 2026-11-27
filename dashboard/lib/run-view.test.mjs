import test from 'node:test';
import assert from 'node:assert/strict';
import { foldRunView, playbookName, readPlaybooks, runSteps } from './run-view.mjs';

const settings = { stuckAfterMs: 420000, quotaLowPercent: 20, burningFastTokensPerMinute: 25000 };
const now = Date.parse('2026-11-27T12:00:00Z');

// The steps are read from the skill itself, because that is what the screen compares a session's
// to-do list against. A fixture that invented its own step text would prove nothing.
const playbooks = readPlaybooks();
const stepsOf = playbook => playbooks.find(candidate => candidate.id === playbook).steps.map(step => step.text);

// A to-do list as a session writes it: a playbook's own steps, in order, with one status each.
// The ids say nothing a playbook can be read from: what a session calls its own steps is not
// something the screen can lean on.
const listOf = (playbook, statuses, detail = () => '') => stepsOf(playbook).map((text, index) => ({
  id: `step-${playbook}-${index + 1}`,
  content: `${text}${detail(index)}`,
  status: statuses[index] ?? 'pending',
}));

// One item, on one step of a playbook: `step('feature', 2, 'in_progress')`.
const step = (playbook, order, status, content = stepsOf(playbook)[order - 1]) => ({ id: `step-${playbook}-${order}`, content, status });

const session = (overrides = {}) => ({
  card: 'JUL-419',
  title: 'Todd presses Start on a card',
  startedAt: now - 60000,
  endedAt: null,
  status: 'running',
  threadId: 'thread-1',
  tasks: null,
  tokens: 0,
  lastActivityAt: now - 1000,
  ...overrides,
});

const fold = overrides => foldRunView({ session: session(overrides), subscriptions: [], settings, now });

test('every playbook names itself as the stage when its own steps are on the list', () => {
  assert.ok(playbooks.length >= 20, 'the playbooks were found');
  for (const playbook of playbooks) {
    const steps = runSteps(listOf(playbook.id, ['in_progress']));
    assert.equal(steps.stage, playbookName(playbook.id), `${playbook.id} names itself`);
    assert.equal(steps.total, playbook.steps.length, `${playbook.id} shows every step it has`);
    assert.equal(steps.index, 1, `${playbook.id} starts on its first step`);
    assert.equal(steps.current.title, playbook.steps[0].text);
  }
});

test('the stage is the playbook of the step the run is on', () => {
  const tasks = listOf('feature', []);
  tasks[0].status = 'completed';
  tasks[1].status = 'in_progress';
  const steps = runSteps(tasks);
  assert.equal(steps.stage, 'Feature');
  assert.equal(steps.index, 2);
  assert.equal(steps.total, 8);
  assert.equal(steps.current.title, stepsOf('feature')[1]);
});

test('a session that writes its own detail after a step still lands on that step', () => {
  // The real list from JUL-419: each item is the step's name, then the session's own detail.
  const tasks = listOf('feature', Array(8).fill('pending'), index => `: the session's own detail for step ${index + 1}`);
  tasks[4].status = 'in_progress';
  const steps = runSteps(tasks);
  assert.equal(steps.stage, 'Feature');
  assert.equal(steps.total, 8);
  assert.equal(steps.index, 5);
  assert.equal(steps.current.title, tasks[4].content);
});

test('the run follows the session into the playbook it appended after its own', () => {
  const shipped = [...listOf('feature', Array(8).fill('completed')), ...listOf('shipping', ['in_progress'])];
  const steps = runSteps(shipped);
  assert.equal(steps.stage, 'Shipping');
  assert.equal(steps.index, 1);
  assert.equal(steps.total, 6);
  assert.deepEqual(steps.list.map(step => step.playbook), Array(6).fill('shipping'));
});

test('an in-progress step in an earlier playbook wins', () => {
  const tasks = [...listOf('feature', []), ...listOf('shipping', [])];
  tasks[0].status = 'completed';
  tasks[1].status = 'in_progress';
  const steps = runSteps(tasks);
  assert.equal(steps.stage, 'Feature');
  assert.equal(steps.total, 8);
  assert.equal(steps.index, 2);
});

test('a step the session wrote in its own words stays on the list', () => {
  const tasks = listOf('feature', []);
  tasks.splice(2, 0, { id: 'step-own', content: 'Ask Todd which card title to use', status: 'pending' });
  const steps = runSteps(tasks);
  assert.equal(steps.stage, 'Feature');
  assert.equal(steps.total, 9);
  assert.equal(steps.list[2].title, 'Ask Todd which card title to use');
});

test('a finished list reads its last step, and a list no playbook writes reads nothing', () => {
  const done = listOf('babysit', Array(6).fill('completed'));
  const steps = runSteps(done);
  assert.equal(steps.index, 6);
  assert.equal(steps.stage, 'Babysit');
  assert.equal(runSteps([]).stage, '');
  assert.equal(runSteps(null).total, 0);
  // One word is not enough to say which playbook an item is about, even when a playbook uses it.
  assert.deepEqual(runSteps([{ id: 'card-branch', content: 'Branch', status: 'pending' }]).list, []);
});

test('only a live session is drawn as a run', () => {
  const run = fold({ tasks: listOf('feature', ['in_progress']) }).run;
  assert.equal(run.status, 'running');
  assert.equal(run.card, 'JUL-419');
  assert.equal(run.runningMs, 60000);
  assert.equal(run.stage, 'Feature');
  assert.ok(stepsOf('feature')[0].startsWith(run.step), 'the step on screen names the step in hand');
  assert.equal(run.steps.total, 8);
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
  const tasks = listOf('feature', []);
  tasks[4].status = 'in_progress';
  const quiet = fold({ lastActivityAt: now - 8 * 60000, tasks });
  assert.equal(quiet.run.status, 'stuck');
  assert.equal(quiet.warnings.find(x => x.kind === 'stuck').text, 'Nothing has happened in the run for 8 minutes.');

  const stopped = fold({ status: 'stopped', endedAt: now - 1000, tasks });
  const text = stopped.warnings.find(x => x.kind === 'stopped').text;
  assert.ok(text.startsWith('The run stopped at “Verify on the matching surface'), text);
  assert.deepEqual(fold({ status: 'unknown', endedAt: now }).warnings.map(x => x.kind), ['ended_unknown']);
});

test('a run that spends faster than the limit is a burning warning, naming the rate', () => {
  // 300,000 tokens in ten minutes is 30,000 a minute.
  const burning = fold({ startedAt: now - 10 * 60000, tokens: 300000 }).warnings;
  assert.equal(burning.find(x => x.kind === 'burning_fast').text, 'The run is using 30,000 tokens a minute.');
  assert.equal(fold({ startedAt: now - 10 * 60000, tokens: 200000 }).warnings.length, 0);
});

test('a run a minute old is measured against the minute it has had', () => {
  // 10,000 tokens in twenty seconds would read as 30,000 a minute without the floor.
  const warnings = fold({ startedAt: now - 20000, tokens: 10000 }).warnings;
  assert.equal(warnings.length, 0);
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
