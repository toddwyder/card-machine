import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { RequestContext } from '@mastra/core/request-context';

const ENV_FILE = 'scripts/julia-agents.env';
const KNOWN_SERVICE_KEYS = new Set([
  'COMMANDCODE_API_KEY',
  'CMD_API_KEY',
  'LINEAR_API_KEY',
  'LINEAR_CLIENT_ID',
  'LINEAR_CLIENT_SECRET',
  'LINEAR_OAUTH_SCOPE',
  'SENTRY_AUTH_TOKEN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'AXIOM_TOKEN',
  'AXIOM_DATASET',
  'STITCH_API_KEY',
]);

export function readAgentServiceKeys(envFile) {
  const keys = new Set(['LINEAR_API_KEY']);
  if (envFile && existsSync(envFile)) {
    for (const rawLine of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (/^[A-Z0-9_]+$/.test(key)) keys.add(key);
    }
  }
  return [...keys];
}

export function sandboxEnv({ repo, env = process.env, home = homedir() } = {}) {
  const result = { HOME: home };
  const keys = readAgentServiceKeys(repo ? join(repo, ENV_FILE) : '');
  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) {
      result[key] = value;
    }
  }
  return result;
}

function buildProbeScript({ extraKeys = [], requireBrowser = false, playwrightFallback, endpoints = {} } = {}) {
  const config = JSON.stringify({
    extraKeys,
    requireBrowser,
    playwrightFallback,
    endpoints: {
      linear: endpoints.linear ?? 'https://api.linear.app/graphql',
      commandcode: endpoints.commandcode ?? 'https://api.commandcode.ai/provider/v1/models',
      sentry: endpoints.sentry ?? 'https://sentry.io/api/0',
      axiom: endpoints.axiom ?? 'https://api.axiom.co/v2/datasets',
      stitch: endpoints.stitch ?? 'https://stitch.googleapis.com/mcp',
    },
  });

  return `
const cfg = ${config};
const env = process.env;
const failures = [];

async function probe(service, requiredKeys, run) {
  const missing = requiredKeys.filter(k => !env[k]);
  if (missing.length > 0) {
    failures.push({ service, reason: 'missing ' + missing.join(', ') });
    return;
  }
  try {
    const res = await run();
    if (!res.ok) {
      failures.push({ service, reason: 'HTTP ' + res.status });
    }
  } catch (err) {
    failures.push({ service, reason: String(err?.message ?? err) });
  }
}

const checks = [
  probe('linear', ['LINEAR_API_KEY'], () =>
    fetch(cfg.endpoints.linear, {
      method: 'POST',
      headers: { Authorization: env.LINEAR_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { id } }' }),
      signal: AbortSignal.timeout(10000),
    }),
  ),
  probe('commandcode', [env.COMMANDCODE_API_KEY ? 'COMMANDCODE_API_KEY' : 'CMD_API_KEY'], () =>
    fetch(cfg.endpoints.commandcode, {
      headers: { Authorization: 'Bearer ' + (env.COMMANDCODE_API_KEY || env.CMD_API_KEY) },
      signal: AbortSignal.timeout(10000),
    }),
  ),
  probe('sentry', ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'], () =>
    fetch(cfg.endpoints.sentry + '/projects/' + encodeURIComponent(env.SENTRY_ORG) + '/' + encodeURIComponent(env.SENTRY_PROJECT) + '/issues/?limit=1', {
      headers: { Authorization: 'Bearer ' + env.SENTRY_AUTH_TOKEN },
      signal: AbortSignal.timeout(10000),
    }),
  ),
  probe('axiom', ['AXIOM_TOKEN', 'AXIOM_DATASET'], () =>
    fetch(cfg.endpoints.axiom + '/' + encodeURIComponent(env.AXIOM_DATASET), {
      headers: { Authorization: 'Bearer ' + env.AXIOM_TOKEN },
      signal: AbortSignal.timeout(10000),
    }),
  ),
  probe('stitch', ['STITCH_API_KEY'], () =>
    fetch(cfg.endpoints.stitch, {
      method: 'POST',
      headers: { 'X-Goog-Api-Key': env.STITCH_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }),
      signal: AbortSignal.timeout(10000),
    }),
  ),
];

for (const key of cfg.extraKeys) {
  if (!env[key]) failures.push({ service: key, reason: 'missing ' + key });
}

if (cfg.requireBrowser) {
  checks.push((async () => {
    let browser;
    try {
      let pw;
      try {
        pw = await import('playwright');
      } catch {
        pw = await import(cfg.playwrightFallback);
      }
      browser = await pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setContent('<h1>ok</h1>');
      const text = await page.locator('h1').textContent();
      if (text !== 'ok') failures.push({ service: 'browser', reason: 'unexpected page content' });
    } catch (err) {
      failures.push({ service: 'browser', reason: String(err?.message ?? err) });
    } finally {
      await browser?.close?.().catch(() => {});
    }
  })());
}

await Promise.all(checks);
console.log(JSON.stringify({ ok: failures.length === 0, failures }));
`;
}

export async function checkAgentAccess({
  agentName,
  agent,
  checkout,
  repo = checkout,
  requireBrowser = false,
  endpoints,
}) {
  const ws = await agent.getWorkspace({ requestContext: new RequestContext([['cardCheckout', checkout]]) });
  if (!ws?.sandbox) {
    return {
      agent: agentName,
      ok: false,
      failures: [{ service: 'workspace', reason: 'agent has no sandbox' }],
    };
  }
  const extraKeys = readAgentServiceKeys(repo ? join(repo, ENV_FILE) : '').filter(k => !KNOWN_SERVICE_KEYS.has(k));
  const playwrightFallback = pathToFileURL(join(repo, 'node_modules/playwright/index.mjs')).href;
  const script = buildProbeScript({ extraKeys, requireBrowser, playwrightFallback, endpoints });

  await ws.sandbox.start();
  try {
    const res = await ws.sandbox.executeCommand(process.execPath, ['--input-type=module', '-e', script]);
    if (res.exitCode !== 0) {
      return {
        agent: agentName,
        ok: false,
        failures: [{ service: 'sandbox', reason: (res.stderr || res.stdout || `exit ${res.exitCode}`).trim() }],
      };
    }
    const parsed = JSON.parse(res.stdout.trim());
    return { agent: agentName, ok: Boolean(parsed.ok), failures: parsed.failures ?? [] };
  } catch (error) {
    return {
      agent: agentName,
      ok: false,
      failures: [{ service: 'sandbox', reason: String(error?.message ?? error) }],
    };
  } finally {
    await ws.sandbox.stop();
  }
}

async function collectWorkspaceAgents(agents, { checkBrowser = true } = {}) {
  const entries = [];
  const seen = new Set();
  const add = async (agentName, agent, options = {}) => {
    if (!agent || typeof agent.getWorkspace !== 'function' || seen.has(agent)) return;
    seen.add(agent);
    const ws = await agent.getWorkspace({ requestContext: new RequestContext([['cardCheckout', process.cwd()]]) }).catch(() => null);
    if (ws) entries.push({ agentName, agent, ...options });
  };

  await add('Lead', agents?.build);
  const subagents = (await agents?.build?.listAgents?.()) ?? agents?.build?.agents ?? {};
  for (const [key, helper] of Object.entries(subagents)) {
    await add(helper?.name ? `${helper.name} (${key})` : key, helper);
  }
  await add('Shipping', agents?.shipping, { requireBrowser: checkBrowser });

  for (const [key, agent] of Object.entries(agents ?? {})) {
    if (key === 'build' || key === 'shipping') continue;
    await add(agent?.name ?? key, agent);
  }
  return entries;
}

export async function verifyRunAccess({
  agents,
  checkout,
  repo = checkout,
  checkBrowser = true,
  endpoints,
} = {}) {
  const targets = await collectWorkspaceAgents(agents, { checkBrowser });
  if (targets.length === 0) return { ok: true, failures: [], reason: '' };

  const results = [];
  for (const { agentName, agent, requireBrowser } of targets) {
    results.push(await checkAgentAccess({ agentName, agent, checkout, repo, requireBrowser: Boolean(requireBrowser), endpoints }));
  }
  const failures = results.flatMap(r => r.failures.map(f => ({ agent: r.agent, service: f.service, reason: f.reason })));
  if (failures.length === 0) return { ok: true, failures: [], reason: '' };

  const summary = failures.map(f => `${f.agent}: ${f.service} (${f.reason})`).join('; ');
  return {
    ok: false,
    failures,
    reason: `Start-of-run access check failed: ${summary}`,
  };
}

export async function stopIfAccessMissing({ inputData, state, setState }, options) {
  const access = await verifyRunAccess(options);
  if (access.ok) return null;
  await setState({ ...state, stopPart: 'Access', stopWhy: access.reason, stopped: true });
  return { card: state.card || inputData.card, kind: state.kind || inputData.kind, ...inputData, stopped: true, detail: access.reason };
}
