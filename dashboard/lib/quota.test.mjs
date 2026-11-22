import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ACCOUNTS from '../config/accounts.json' with { type: 'json' };
import { SUBSCRIPTIONS, readSubscriptions } from './quota/index.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/quota/${name}.json`, import.meta.url), 'utf8'));
const url = id => SUBSCRIPTIONS.find(entry => entry.id === id).url;
const ok = body => ({ ok: true, status: 200, json: async () => body });
const failure = status => ({ ok: false, status, json: async () => ({}) });
const byId = readings => new Map(readings.map(reading => [reading.id, reading]));

function fakeFetch(replies) {
  const calls = [];
  const fetch = async (target, init = {}) => {
    calls.push({ url: target, authorization: init.headers?.authorization ?? null });
    const reply = replies[target];
    if (!reply) throw new Error(`unexpected url ${target}`);
    return typeof reply === 'function' ? reply(target, init, calls) : reply;
  };
  return { fetch, calls };
}

// ChatGPT's transport is credential-shaped because it carries the OAuth refresh, so a fake
// request there is injected the same way as the stored tokens.
const credentials = (fetch, token = 'test-token') => ({
  chatgpt: async () => fetch,
  anthropic: async () => token,
  refreshAnthropic: async () => `${token}-refreshed`,
  commandcode: async () => token,
});

const allFresh = () => ({
  [url('chatgpt')]: ok(fixture('chatgpt')),
  [url('claude')]: ok(fixture('claude')),
  [url('commandcode')]: ok(fixture('commandcode')),
});

test('Every subscription reads fresh, with each window keeping its own percent and reset date', async () => {
  const { fetch, calls } = fakeFetch(allFresh());
  const readings = byId(await readSubscriptions({ fetch, now: () => 1_700_000_000_000, credentials: credentials(fetch), cache: new Map() }));

  assert.equal(readings.size, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(readings.get('chatgpt'), {
    id: 'chatgpt',
    name: 'ChatGPT plan',
    status: 'fresh',
    readAt: 1_700_000_000_000,
    windows: [
      { window: 'five_hour', percentLeft: 97, resetsAt: 1_795_258_000_000 },
      { window: 'weekly', percentLeft: 96, resetsAt: 1_795_755_827_000 },
    ],
  });
  assert.deepEqual(readings.get('claude'), {
    id: 'claude',
    name: 'Claude subscription',
    status: 'fresh',
    readAt: 1_700_000_000_000,
    windows: [
      { window: 'five_hour', percentLeft: 89, resetsAt: 1_795_255_200_468 },
      { window: 'weekly', percentLeft: 98, resetsAt: 1_795_842_000_468 },
    ],
  });
  assert.deepEqual(readings.get('commandcode').windows, [
    { window: 'five_hour', percentLeft: 100, resetsAt: null },
    { window: 'weekly', percentLeft: 100, resetsAt: null },
  ]);
});

test('CommandCode percent left comes from used and cap, and windowLimits.limited is ignored', async () => {
  const body = {
    windowLimits: {
      limited: true,
      fiveHour: { used: 7, cap: 14, resetAt: 1_795_258_000_000 },
      weekly: { used: 35, cap: 35, resetAt: 1_795_755_827_000 },
    },
  };
  const { fetch } = fakeFetch({ ...allFresh(), [url('commandcode')]: ok(body) });
  const reading = byId(await readSubscriptions({ fetch, now: () => 1, credentials: credentials(fetch), cache: new Map() })).get('commandcode');

  assert.deepEqual(reading.windows, [
    { window: 'five_hour', percentLeft: 50, resetsAt: 1_795_258_000_000 },
    { window: 'weekly', percentLeft: 0, resetsAt: 1_795_755_827_000 },
  ]);
});

test('Claude retries once with a refreshed token; ChatGPT does not retry', async () => {
  const claude = fakeFetch({ ...allFresh(), [url('claude')]: failure(401) });
  const readings = byId(await readSubscriptions({ fetch: claude.fetch, now: () => 1, credentials: credentials(claude.fetch), cache: new Map() }));
  assert.deepEqual(claude.calls.filter(call => call.url === url('claude')).map(call => call.authorization), [
    'Bearer test-token',
    'Bearer test-token-refreshed',
  ]);
  assert.equal(readings.get('claude').status, 'unknown');

  const chatgpt = fakeFetch({ ...allFresh(), [url('chatgpt')]: failure(401) });
  await readSubscriptions({ fetch: chatgpt.fetch, now: () => 1, credentials: credentials(chatgpt.fetch), cache: new Map() });
  assert.equal(chatgpt.calls.filter(call => call.url === url('chatgpt')).length, 1);
});

test('A failed status, a thrown error, a timeout and a missing field each answer unknown', async () => {
  const replies = {
    [url('chatgpt')]: failure(500),
    [url('claude')]: () => { throw new Error('socket hang up'); },
    [url('commandcode')]: () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); },
  };
  const { fetch } = fakeFetch(replies);
  const readings = await readSubscriptions({ fetch, now: () => 7, credentials: credentials(fetch), cache: new Map() });
  for (const reading of readings) assert.deepEqual(reading, { id: reading.id, name: reading.name, status: 'unknown', readAt: 7 });

  const missing = fixture('chatgpt');
  delete missing.rate_limit.secondary_window;
  const partial = fakeFetch({ ...allFresh(), [url('chatgpt')]: ok(missing) });
  const partialReadings = await readSubscriptions({ fetch: partial.fetch, now: () => 8, credentials: credentials(partial.fetch), cache: new Map() });
  assert.equal(byId(partialReadings).get('chatgpt').status, 'unknown');
});

test('A fresh reading is reused for a minute, and a failed read never shows the old one', async () => {
  let clock = 1_000;
  const happy = fakeFetch(allFresh());
  const failing = fakeFetch({ ...allFresh(), [url('chatgpt')]: failure(500) });
  const cache = new Map();

  await readSubscriptions({ fetch: happy.fetch, now: () => clock, credentials: credentials(happy.fetch), cache });
  clock += 59_000;
  const reused = byId(await readSubscriptions({ fetch: failing.fetch, now: () => clock, credentials: credentials(failing.fetch), cache }));
  assert.equal(failing.calls.length, 0);
  assert.equal(reused.get('chatgpt').status, 'fresh');

  clock += 2_000;
  const stale = byId(await readSubscriptions({ fetch: failing.fetch, now: () => clock, credentials: credentials(failing.fetch), cache }));
  assert.equal(stale.get('chatgpt').status, 'unknown');
  assert.equal(failing.calls.filter(call => call.url === url('claude')).length, 1);
});

test('The result never carries a credential', async () => {
  const { fetch } = fakeFetch(allFresh());
  const readings = await readSubscriptions({ fetch, now: () => 1, credentials: credentials(fetch, 'sk-secret-value'), cache: new Map() });
  const text = JSON.stringify(readings);
  assert.equal(text.includes('sk-secret-value'), false);
  assert.equal(/token|bearer|apiKey/i.test(text), false);
});

test('The registry covers the account list and carries no id the accounts do not have', () => {
  assert.deepEqual(SUBSCRIPTIONS.map(entry => entry.id).sort(), ACCOUNTS.accounts.map(account => account.id).sort());
  for (const entry of SUBSCRIPTIONS) assert.equal(entry.name, ACCOUNTS.accounts.find(account => account.id === entry.id).name);
});
