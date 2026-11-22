import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import ACCOUNTS from '../../config/accounts.json' with { type: 'json' };
import { parseWindows as parseCommandCode } from './commandcode.mjs';
import { parseWindows as parseClaude } from './claude.mjs';
import { parseWindows as parseChatgpt } from './chatgpt.mjs';

const TIMEOUT_MS = 5000;
const CACHE_MS = 60_000;

const ACCOUNT_NAMES = new Map(ACCOUNTS.accounts.map(account => [account.id, account.name]));

// One entry per subscription the machine can spend. auth returns the send function and the
// headers for one read, or null when there is no second attempt. A second call with
// {fresh: true} is the single retry after a 401.
export const SUBSCRIPTIONS = [
  { id: 'chatgpt', url: 'https://chatgpt.com/backend-api/wham/usage', auth: chatgptAuth, parse: parseChatgpt },
  { id: 'claude', url: 'https://api.anthropic.com/api/oauth/usage', auth: claudeAuth, parse: parseClaude },
  { id: 'commandcode', url: 'https://api.commandcode.ai/alpha/billing/credits', auth: commandCodeAuth, parse: parseCommandCode },
].map(entry => ({ ...entry, name: ACCOUNT_NAMES.get(entry.id) ?? entry.id }));

// ChatGPT's request needs the OAuth wrapper that adds a live bearer per call, so this
// provider's transport comes from credentials rather than the plain fetch. There is no
// second attempt: the wrapper already refreshes the token.
async function chatgptAuth({ credentials }, { fresh = false } = {}) {
  if (fresh) return null;
  return { fetch: await credentials.chatgpt(), headers: {} };
}

async function claudeAuth({ fetch, credentials }, { fresh = false } = {}) {
  const token = fresh ? await credentials.refreshAnthropic() : await credentials.anthropic();
  if (!token) throw new Error('no stored Claude sign-in');
  return { fetch, headers: { authorization: `Bearer ${token}` } };
}

async function commandCodeAuth({ fetch, credentials }) {
  const key = await credentials.commandcode();
  if (!key) throw new Error('no stored CommandCode key');
  return { fetch, headers: { authorization: `Bearer ${key}` } };
}

// What the server already has on disk: Mastra Code's stored sign-ins, and the CommandCode
// CLI's key file. Nothing here is passed to the browser.
export function defaultCredentials() {
  let storage = null;
  const authStorage = async () => {
    if (!storage) {
      const { createAuthStorage } = await import('@mastra/code-sdk');
      storage = createAuthStorage();
    }
    return storage;
  };
  return {
    chatgpt: async () => {
      const { buildOpenAICodexOAuthFetch } = await import('@mastra/code-sdk/providers/openai-codex');
      return buildOpenAICodexOAuthFetch({ rewriteUrl: false });
    },
    anthropic: async () => (await authStorage()).getApiKey('anthropic'),
    refreshAnthropic: async () => (await authStorage()).forceRefreshActiveAccount('anthropic'),
    commandcode: async () => JSON.parse(await readFile(join(homedir(), '.commandcode', 'auth.json'), 'utf8')).apiKey,
  };
}

// A fresh reading stays usable for a minute, so a 2-second poll does not become 30 calls a
// minute. A failed read is never cached and never replaces an old fresh one.
const sharedCache = new Map();

function unknown(entry, readAt) {
  return { id: entry.id, name: entry.name, status: 'unknown', readAt };
}

async function request(entry, ctx, fresh) {
  const auth = await entry.auth(ctx, { fresh });
  if (!auth) return null;
  return auth.fetch(entry.url, { headers: auth.headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function readOne(entry, ctx) {
  const readAt = ctx.now();
  const cached = ctx.cache.get(entry.id);
  if (cached && cached.until > readAt) return cached.reading;
  try {
    let response = await request(entry, ctx, false);
    if (response?.status === 401) response = await request(entry, ctx, true);
    if (!response?.ok) return unknown(entry, readAt);
    const windows = entry.parse(await response.json());
    if (!windows) return unknown(entry, readAt);
    const reading = { id: entry.id, name: entry.name, status: 'fresh', readAt, windows };
    ctx.cache.set(entry.id, { reading, until: readAt + CACHE_MS });
    return reading;
  } catch {
    return unknown(entry, readAt);
  }
}

// Each subscription read on the server, in one type: a fresh value with a window list, or
// "unknown". A non-200, a missing or invalid field, a throw and a timeout are all unknown.
export async function readSubscriptions({ fetch = globalThis.fetch, now = Date.now, credentials = defaultCredentials(), cache = sharedCache } = {}) {
  const ctx = { fetch, now, credentials, cache };
  return Promise.all(SUBSCRIPTIONS.map(entry => readOne(entry, ctx)));
}
