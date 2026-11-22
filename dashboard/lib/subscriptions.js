import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthStorage } from '@mastra/code-sdk/auth/index';
import { buildOpenAICodexOAuthFetch } from '@mastra/code-sdk/providers/openai-codex';

const FETCH_TIMEOUT_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;
const COMMANDCODE_USAGE_URL = 'https://api.commandcode.ai/alpha/billing/credits';
const CHATGPT_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';

function unknownReading(id, name) {
  return { id, name, status: 'unknown' };
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toResetMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function formatResetDate(resetAtMs, now = Date.now(), { timeZone } = {}) {
  const targetMs = toResetMs(resetAtMs);
  if (targetMs === null) return '';

  const baseNow = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const diffMs = targetMs - baseNow;
  const date = new Date(targetMs);

  if (diffMs >= 0 && diffMs < DAY_MS) {
    const formatted = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
    }).format(date);
    return `resets ${formatted.toLowerCase()}`;
  }

  if (diffMs >= DAY_MS && diffMs < 6 * DAY_MS) {
    const weekday = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone,
    }).format(date);
    return `resets ${weekday}`;
  }

  const monthDay = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(date);
  return `resets ${monthDay}`;
}

function pickTighterWindow(candidates) {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate.percentLeft < best.percentLeft) {
      best = candidate;
    } else if (
      candidate.percentLeft === best.percentLeft &&
      candidate.resetAtMs !== null &&
      (best.resetAtMs === null || candidate.resetAtMs < best.resetAtMs)
    ) {
      best = candidate;
    }
  }
  return best;
}

function toOkReading(id, name, winner, now, options) {
  const resetAt = winner.resetAtMs !== null ? new Date(winner.resetAtMs).toISOString() : null;
  return {
    id,
    name,
    status: 'ok',
    percentLeft: winner.percentLeft,
    resetAt,
    resetLabel: formatResetDate(winner.resetAtMs, now, options),
    windowLabel: winner.windowLabel,
  };
}

export function parseCommandCodeUsage(payload, now = Date.now(), options = {}) {
  const limits = payload?.windowLimits;
  if (!limits || typeof limits !== 'object') {
    return unknownReading('commandcode', 'CommandCode');
  }

  const candidates = [];
  for (const [key, windowLabel] of [
    ['fiveHour', '5-hour'],
    ['weekly', 'weekly'],
  ]) {
    const win = limits[key];
    if (
      win &&
      typeof win.used === 'number' &&
      Number.isFinite(win.used) &&
      typeof win.cap === 'number' &&
      Number.isFinite(win.cap) &&
      win.cap > 0
    ) {
      candidates.push({
        percentLeft: clampPercent(((win.cap - win.used) / win.cap) * 100),
        resetAtMs: toResetMs(win.resetAt),
        windowLabel,
      });
    }
  }

  const winner = pickTighterWindow(candidates);
  if (!winner) return unknownReading('commandcode', 'CommandCode');
  return toOkReading('commandcode', 'CommandCode', winner, now, options);
}

export function parseChatGptUsage(payload, now = Date.now(), options = {}) {
  const rateLimit = payload?.rate_limit;
  if (!rateLimit || typeof rateLimit !== 'object') {
    return unknownReading('chatgpt', 'ChatGPT');
  }

  const candidates = [];
  for (const [key, windowLabel] of [
    ['primary_window', '5-hour'],
    ['secondary_window', 'weekly'],
  ]) {
    const win = rateLimit[key];
    if (win && typeof win.used_percent === 'number' && Number.isFinite(win.used_percent)) {
      const resetAtMs =
        typeof win.reset_at === 'number' && Number.isFinite(win.reset_at)
          ? win.reset_at * 1000
          : null;
      candidates.push({
        percentLeft: clampPercent(100 - win.used_percent),
        resetAtMs,
        windowLabel,
      });
    }
  }

  const winner = pickTighterWindow(candidates);
  if (!winner) return unknownReading('chatgpt', 'ChatGPT');
  return toOkReading('chatgpt', 'ChatGPT', winner, now, options);
}

export function parseClaudeUsage(payload, now = Date.now(), options = {}) {
  if (!payload || typeof payload !== 'object') {
    return unknownReading('claude', 'Claude');
  }

  const candidates = [];
  for (const [key, windowLabel] of [
    ['five_hour', '5-hour'],
    ['seven_day', 'weekly'],
  ]) {
    const win = payload[key];
    if (win && typeof win.utilization === 'number' && Number.isFinite(win.utilization)) {
      candidates.push({
        percentLeft: clampPercent(100 - win.utilization),
        resetAtMs: toResetMs(win.resets_at),
        windowLabel,
      });
    }
  }

  const winner = pickTighterWindow(candidates);
  if (!winner) return unknownReading('claude', 'Claude');
  return toOkReading('claude', 'Claude', winner, now, options);
}

function readCommandCodeApiKey(authPath) {
  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    const key = parsed?.apiKey || parsed?.api_key || parsed?.token;
    return typeof key === 'string' && key.trim() !== '' ? key.trim() : null;
  } catch {
    return null;
  }
}

async function defaultAnthropicTokenProvider() {
  const storage = new AuthStorage();
  const credential = await storage.getOAuthCredential('anthropic');
  return typeof credential?.access === 'string' && credential.access.trim() !== ''
    ? credential.access
    : null;
}

async function readCommandCode({ fetchImpl, now, commandCodeAuthPath }) {
  try {
    const apiKey = readCommandCodeApiKey(commandCodeAuthPath);
    if (!apiKey) return unknownReading('commandcode', 'CommandCode');

    const response = await fetchImpl(COMMANDCODE_USAGE_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response?.ok) return unknownReading('commandcode', 'CommandCode');

    const body = await response.json();
    return parseCommandCodeUsage(body, now);
  } catch {
    return unknownReading('commandcode', 'CommandCode');
  }
}

async function readChatGpt({ now, openaiFetch }) {
  try {
    const fetchFn = openaiFetch ?? buildOpenAICodexOAuthFetch({ rewriteUrl: false });
    const response = await fetchFn(CHATGPT_USAGE_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response?.ok) return unknownReading('chatgpt', 'ChatGPT');

    const body = await response.json();
    return parseChatGptUsage(body, now);
  } catch {
    return unknownReading('chatgpt', 'ChatGPT');
  }
}

async function readClaude({ fetchImpl, now, anthropicTokenProvider }) {
  try {
    const getToken = anthropicTokenProvider ?? defaultAnthropicTokenProvider;
    const token = await getToken();
    if (typeof token !== 'string' || token.trim() === '') {
      return unknownReading('claude', 'Claude');
    }

    const response = await fetchImpl(CLAUDE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': CLAUDE_OAUTH_BETA,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response?.ok) return unknownReading('claude', 'Claude');

    const body = await response.json();
    return parseClaudeUsage(body, now);
  } catch {
    return unknownReading('claude', 'Claude');
  }
}

export async function readSubscriptions({
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  commandCodeAuthPath = path.join(os.homedir(), '.commandcode', 'auth.json'),
  openaiFetch,
  anthropicTokenProvider,
} = {}) {
  const currentNow = typeof now === 'function' ? now() : now;
  return Promise.all([
    readCommandCode({ fetchImpl, now: currentNow, commandCodeAuthPath }),
    readChatGpt({ now: currentNow, openaiFetch }),
    readClaude({ fetchImpl, now: currentNow, anthropicTokenProvider }),
  ]);
}
