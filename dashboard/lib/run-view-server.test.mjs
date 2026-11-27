import test from 'node:test';
import assert from 'node:assert/strict';
import { readRunViewSnapshot } from './run-view-server.mjs';

const now = Date.parse('2026-11-27T12:00:00Z');
const subscriptions = [{ id: 'claude', name: 'Claude', status: 'unknown', reason: 'no stored sign-in' }];
const card = { id: 'a', identifier: 'JUL-419', title: 'Start on the Run view', createdAt: '2026-11-27T00:00:00Z' };
const live = {
  card: 'JUL-420', title: 'A run', startedAt: now - 1000, endedAt: null, status: 'running',
  // The step's words are what names the stage, so the fixture carries a playbook's own step.
  threadId: 't', tasks: [{ id: 'a-1', content: 'Trace the affected subsystem.', status: 'in_progress' }],
  tokens: 1200, largestStepTokens: 900, lastActivityAt: now - 500,
};

test('an idle screen offers the Ready cards and draws no run', async () => {
  const snapshot = await readRunViewSnapshot({ now, subscriptions, session: null, readyCards: { cards: [card] } });
  assert.equal(snapshot.run, null);
  assert.equal(snapshot.lastResult, null);
  assert.deepEqual(snapshot.readyCards.cards.map(x => x.identifier), ['JUL-419']);
  assert.equal(snapshot.subscriptions[0].reason, 'no stored sign-in');
});

test('a run on screen draws its stage and steps and reads no cards', async () => {
  const snapshot = await readRunViewSnapshot({ now, subscriptions, session: live, readyCards: { cards: [card] } });
  assert.equal(snapshot.run.stage, 'Feature');
  assert.equal(snapshot.run.step, 'Trace the affected subsystem');
  assert.equal(snapshot.run.usage.tokens, 1200);
  assert.deepEqual(snapshot.readyCards.cards, []);
});

test('a list that cannot be read says so instead of looking empty', async () => {
  const saved = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  try {
    const snapshot = await readRunViewSnapshot({ now, subscriptions, session: null });
    assert.equal(snapshot.readyCards.error, 'Could not read the Ready cards.');
    assert.deepEqual(snapshot.readyCards.cards, []);
  } finally {
    if (saved !== undefined) process.env.LINEAR_API_KEY = saved;
  }
});
