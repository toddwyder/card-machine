import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  formatResetDate,
  parseCommandCodeUsage,
  parseChatGptUsage,
  parseClaudeUsage,
  readSubscriptions,
} from './subscriptions.js';

const NOW = Date.parse('2026-11-22T18:00:00.000Z');

test('formatResetDate formats same-day (<24h) resets as lowercase time', () => {
  const inThreeHours = Date.parse('2026-11-22T21:38:00.000Z');
  assert.equal(formatResetDate(inThreeHours, NOW, { timeZone: 'UTC' }), 'resets 9:38 pm');
});

test('formatResetDate formats 1-5 day resets as short weekday', () => {
  const thursday = Date.parse('2026-11-26T12:00:00.000Z');
  assert.equal(formatResetDate(thursday, NOW, { timeZone: 'UTC' }), 'resets Thu');
});

test('formatResetDate formats 6+ day resets as short month and day', () => {
  const nextWeek = Date.parse('2026-11-29T18:00:00.000Z');
  assert.equal(formatResetDate(nextWeek, NOW, { timeZone: 'UTC' }), 'resets Nov 29');
});

test('formatResetDate returns empty string for null, undefined, or invalid values', () => {
  assert.equal(formatResetDate(null, NOW), '');
  assert.equal(formatResetDate(undefined, NOW), '');
  assert.equal(formatResetDate(Number.NaN, NOW), '');
  assert.equal(formatResetDate('not-a-date', NOW), '');
});

test('parseCommandCodeUsage picks the tighter window and formats resetAt', () => {
  const fiveHourReset = Date.parse('2026-11-22T21:30:00.000Z');
  const weeklyReset = Date.parse('2026-11-26T12:00:00.000Z');
  const result = parseCommandCodeUsage(
    {
      email: 'secret@example.com',
      apiKey: 'cc_secret_key',
      windowLimits: {
        fiveHour: { used: 3.5, cap: 14, resetAt: fiveHourReset },
        weekly: { used: 28, cap: 35, resetAt: weeklyReset },
      },
    },
    NOW,
    { timeZone: 'UTC' },
  );

  assert.deepEqual(result, {
    id: 'commandcode',
    name: 'CommandCode',
    status: 'ok',
    percentLeft: 20,
    resetAt: '2026-11-26T12:00:00.000Z',
    resetLabel: 'resets Thu',
    windowLabel: 'weekly',
  });
});

test('parseCommandCodeUsage breaks equal-percent ties toward nearer reset and clamps bounds', () => {
  const fiveHourReset = Date.parse('2026-11-22T20:15:00.000Z');
  const weeklyReset = Date.parse('2026-11-28T20:15:00.000Z');

  const tied = parseCommandCodeUsage(
    {
      windowLimits: {
        fiveHour: { used: 0, cap: 14, resetAt: fiveHourReset },
        weekly: { used: 0, cap: 35, resetAt: weeklyReset },
      },
    },
    NOW,
    { timeZone: 'UTC' },
  );
  assert.equal(tied.status, 'ok');
  assert.equal(tied.percentLeft, 100);
  assert.equal(tied.windowLabel, '5-hour');
  assert.equal(tied.resetLabel, 'resets 8:15 pm');

  const overCap = parseCommandCodeUsage(
    {
      windowLimits: {
        fiveHour: { used: 20, cap: 14, resetAt: fiveHourReset },
      },
    },
    NOW,
    { timeZone: 'UTC' },
  );
  assert.equal(overCap.status, 'ok');
  assert.equal(overCap.percentLeft, 0);
});

test('parseCommandCodeUsage returns unknown on invalid or empty payload', () => {
  const expected = { id: 'commandcode', name: 'CommandCode', status: 'unknown' };
  assert.deepEqual(parseCommandCodeUsage(null, NOW), expected);
  assert.deepEqual(parseCommandCodeUsage({}, NOW), expected);
  assert.deepEqual(
    parseCommandCodeUsage({ windowLimits: { fiveHour: { used: 1, cap: 0 } } }, NOW),
    expected,
  );
});

test('parseChatGptUsage picks the tighter window and converts unix seconds', () => {
  const primaryResetSec = Math.floor(Date.parse('2026-11-22T20:05:00.000Z') / 1000);
  const secondaryResetSec = Math.floor(Date.parse('2026-11-26T15:00:00.000Z') / 1000);

  const result = parseChatGptUsage(
    {
      email: 'secret@example.com',
      account_id: 'acct_12345',
      rate_limit: {
        primary_window: { used_percent: 10, reset_at: primaryResetSec },
        secondary_window: { used_percent: 62.4, reset_at: secondaryResetSec },
      },
    },
    NOW,
    { timeZone: 'UTC' },
  );

  assert.deepEqual(result, {
    id: 'chatgpt',
    name: 'ChatGPT',
    status: 'ok',
    percentLeft: 38,
    resetAt: '2026-11-26T15:00:00.000Z',
    resetLabel: 'resets Thu',
    windowLabel: 'weekly',
  });
});

test('parseChatGptUsage returns unknown on invalid payload', () => {
  const expected = { id: 'chatgpt', name: 'ChatGPT', status: 'unknown' };
  assert.deepEqual(parseChatGptUsage(null, NOW), expected);
  assert.deepEqual(parseChatGptUsage({ rate_limit: {} }, NOW), expected);
});

test('parseClaudeUsage picks the tighter window and formats ISO resets_at', () => {
  const result = parseClaudeUsage(
    {
      account_id: 'org_secret',
      five_hour: { utilization: 73.6, resets_at: '2026-11-22T22:10:00.000Z' },
      seven_day: { utilization: 25, resets_at: '2026-11-27T00:00:00.000Z' },
    },
    NOW,
    { timeZone: 'UTC' },
  );

  assert.deepEqual(result, {
    id: 'claude',
    name: 'Claude',
    status: 'ok',
    percentLeft: 26,
    resetAt: '2026-11-22T22:10:00.000Z',
    resetLabel: 'resets 10:10 pm',
    windowLabel: '5-hour',
  });
});

test('parseClaudeUsage returns unknown on invalid payload', () => {
  const expected = { id: 'claude', name: 'Claude', status: 'unknown' };
  assert.deepEqual(parseClaudeUsage(null, NOW), expected);
  assert.deepEqual(parseClaudeUsage({ five_hour: { utilization: 'bad' } }, NOW), expected);
});

test('readSubscriptions fetches all three providers, sends expected headers, and sanitizes output', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jul-361-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const ccSecret = 'cc_live_secret_token_999';
  const claudeSecret = 'sk-ant-oat01-secret-token-888';
  fs.writeFileSync(authPath, JSON.stringify({ apiKey: ccSecret }));

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init?.headers, hasSignal: Boolean(init?.signal) });
    if (url === 'https://api.commandcode.ai/alpha/billing/credits') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          email: 'todd@secret.invalid',
          windowLimits: {
            fiveHour: { used: 7, cap: 14, resetAt: Date.parse('2026-11-22T21:00:00.000Z') },
            weekly: { used: 3.5, cap: 35, resetAt: Date.parse('2026-11-27T00:00:00.000Z') },
          },
        }),
      };
    }
    if (url === 'https://api.anthropic.com/api/oauth/usage') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: { utilization: 15, resets_at: '2026-11-22T20:00:00.000Z' },
          seven_day: { utilization: 40, resets_at: '2026-11-26T00:00:00.000Z' },
        }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const openaiCalls = [];
  const openaiFetch = async (url, init) => {
    openaiCalls.push({ url, hasSignal: Boolean(init?.signal) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        account_id: 'acct_secret_777',
        rate_limit: {
          primary_window: {
            used_percent: 5,
            reset_at: Math.floor(Date.parse('2026-11-22T20:30:00.000Z') / 1000),
          },
          secondary_window: {
            used_percent: 20,
            reset_at: Math.floor(Date.parse('2026-11-26T00:00:00.000Z') / 1000),
          },
        },
      }),
    };
  };

  try {
    const result = await readSubscriptions({
      fetchImpl,
      now: NOW,
      commandCodeAuthPath: authPath,
      openaiFetch,
      anthropicTokenProvider: async () => claudeSecret,
    });

    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map((r) => [r.id, r.name, r.status, r.percentLeft, r.windowLabel]),
      [
        ['commandcode', 'CommandCode', 'ok', 50, '5-hour'],
        ['chatgpt', 'ChatGPT', 'ok', 80, 'weekly'],
        ['claude', 'Claude', 'ok', 60, 'weekly'],
      ],
    );

    const ccCall = calls.find((c) => c.url === 'https://api.commandcode.ai/alpha/billing/credits');
    assert.equal(ccCall?.headers?.Authorization, `Bearer ${ccSecret}`);
    assert.equal(ccCall?.hasSignal, true);

    const claudeCall = calls.find((c) => c.url === 'https://api.anthropic.com/api/oauth/usage');
    assert.equal(claudeCall?.headers?.Authorization, `Bearer ${claudeSecret}`);
    assert.equal(claudeCall?.headers?.['anthropic-beta'], 'oauth-2025-04-20');
    assert.equal(claudeCall?.hasSignal, true);

    assert.equal(openaiCalls.length, 1);
    assert.equal(openaiCalls[0].url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.equal(openaiCalls[0].hasSignal, true);

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(ccSecret), false);
    assert.equal(serialized.includes(claudeSecret), false);
    assert.equal(serialized.includes('todd@secret.invalid'), false);
    assert.equal(serialized.includes('acct_secret_777'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readSubscriptions returns unknown per failing provider without affecting others', async () => {
  const missingAuthPath = path.join(os.tmpdir(), `does-not-exist-${Date.now()}.json`);
  let fetchCalled = false;

  const result = await readSubscriptions({
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('should not be called when auth is missing');
    },
    now: NOW,
    commandCodeAuthPath: missingAuthPath,
    openaiFetch: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    }),
    anthropicTokenProvider: async () => null,
  });

  assert.equal(fetchCalled, false);
  assert.deepEqual(result, [
    { id: 'commandcode', name: 'CommandCode', status: 'unknown' },
    { id: 'chatgpt', name: 'ChatGPT', status: 'unknown' },
    { id: 'claude', name: 'Claude', status: 'unknown' },
  ]);
});

test('readSubscriptions supports api_key and token fallbacks in CommandCode auth.json', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jul-361-alt-'));
  const authPath = path.join(tmpDir, 'auth.json');
  fs.writeFileSync(authPath, JSON.stringify({ token: 'alt_cc_token' }));

  let seenAuth = null;
  try {
    const result = await readSubscriptions({
      fetchImpl: async (url, init) => {
        if (url === 'https://api.commandcode.ai/alpha/billing/credits') {
          seenAuth = init?.headers?.Authorization;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              windowLimits: {
                fiveHour: { used: 0, cap: 10, resetAt: Date.parse('2026-11-22T20:00:00.000Z') },
              },
            }),
          };
        }
        return { ok: false, status: 500, json: async () => ({}) };
      },
      now: NOW,
      commandCodeAuthPath: authPath,
      openaiFetch: async () => {
        throw new Error('network down');
      },
      anthropicTokenProvider: async () => {
        throw new Error('auth error');
      },
    });

    assert.equal(seenAuth, 'Bearer alt_cc_token');
    assert.equal(result[0].status, 'ok');
    assert.equal(result[0].percentLeft, 100);
    assert.deepEqual(result[1], { id: 'chatgpt', name: 'ChatGPT', status: 'unknown' });
    assert.deepEqual(result[2], { id: 'claude', name: 'Claude', status: 'unknown' });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
