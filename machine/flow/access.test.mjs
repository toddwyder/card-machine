import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { RequestContext } from '@mastra/core/request-context';
import { createAgents } from './agents.mjs';
import { installLeadModel } from '../../scripts/install-lead-model.mjs';

const repo = process.cwd();

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'flow-access-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('Shipping workspace loads pstack skills and inherits services from scripts/julia-agents.env', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  installLeadModel(leadModelFile);
  const previous = {
    LINEAR_API_KEY: process.env.LINEAR_API_KEY,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    AXIOM_TOKEN: process.env.AXIOM_TOKEN,
    UNRELATED_SECRET: process.env.UNRELATED_SECRET,
  };
  t.after(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  process.env.LINEAR_API_KEY = 'Bearer linear-repro-token';
  process.env.SENTRY_AUTH_TOKEN = 'sentry-repro-token';
  process.env.AXIOM_TOKEN = 'axiom-repro-token';
  process.env.UNRELATED_SECRET = 'must-not-leak';

  const { shipping } = createAgents({ repo, leadModelFile, model: 'openai/gpt-6.1-sol' });
  const ws = await shipping.getWorkspace({ requestContext: new RequestContext([['cardCheckout', repo]]) });
  const skills = await ws.skills?.list?.();
  assert.ok(Array.isArray(skills) && skills.some(s => s.name === 'poteto-mode'), 'Shipping workspace should load poteto-mode skill');

  await ws.sandbox.start();
  try {
    const res = await ws.sandbox.executeCommand(process.execPath, [
      '-e',
      'console.log(JSON.stringify({ linear: process.env.LINEAR_API_KEY ?? null, sentry: process.env.SENTRY_AUTH_TOKEN ?? null, axiom: process.env.AXIOM_TOKEN ?? null, unrelated: process.env.UNRELATED_SECRET ?? null }))',
    ]);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {
      linear: 'Bearer linear-repro-token',
      sentry: 'sentry-repro-token',
      axiom: 'axiom-repro-token',
      unrelated: null,
    });
  } finally {
    await ws.sandbox.stop();
  }
});

test('start-of-run check catches missing service access before build spends anything, naming service and agent', async t => {
  const { verifyRunAccess } = await import('./access.mjs');
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  installLeadModel(leadModelFile);
  const previous = process.env.LINEAR_API_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = previous;
  });
  delete process.env.LINEAR_API_KEY;

  const agents = createAgents({ repo, leadModelFile, model: 'openai/gpt-6.1-sol' });
  const result = await verifyRunAccess({ agents, checkout: repo, repo, checkBrowser: false });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Shipping/i);
  assert.match(result.reason, /linear/i);
});

import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { verifyRunAccess } from './access.mjs';

test('a new service added to scripts/julia-agents.env reaches Lead, helpers, and Shipping', async t => {
  const dir = temporary(t);
  const scriptsDir = join(dir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, 'julia-agents.env'), 'LINEAR_CLIENT_ID=op://v/i/k\nCUSTOM_ADDED_SERVICE_KEY=op://v/i/k\n');
  mkdirSync(join(dir, '.agents/skills/poteto-mode'), { recursive: true });
  writeFileSync(join(dir, '.agents/skills/poteto-mode/SKILL.md'), '# poteto');
  const leadModelFile = join(dir, 'lead-model');
  installLeadModel(leadModelFile);

  const prev = process.env.CUSTOM_ADDED_SERVICE_KEY;
  t.after(() => {
    if (prev === undefined) delete process.env.CUSTOM_ADDED_SERVICE_KEY;
    else process.env.CUSTOM_ADDED_SERVICE_KEY = prev;
  });
  process.env.CUSTOM_ADDED_SERVICE_KEY = 'added-service-secret';

  const agents = createAgents({ repo: dir, leadModelFile, model: 'openai/gpt-6.1-sol' });
  const helper = Object.values(await agents.build.listAgents())[0];
  const leadWs = await agents.build.getWorkspace({ requestContext: new RequestContext([['cardCheckout', dir]]) });
  assert.equal(leadWs.sandbox, undefined, 'Lead has no sandbox');
  for (const [name, agent] of [['Helper', helper], ['Shipping', agents.shipping]]) {
    const ws = await agent.getWorkspace({ requestContext: new RequestContext([['cardCheckout', dir]]) });
    await ws.sandbox.start();
    try {
      const res = await ws.sandbox.executeCommand(process.execPath, ['-e', 'console.log(process.env.CUSTOM_ADDED_SERVICE_KEY ?? "")']);
      assert.equal(res.exitCode, 0, `${name}: ${res.stderr}`);
      assert.equal(res.stdout.trim(), 'added-service-secret', `${name} should receive CUSTOM_ADDED_SERVICE_KEY`);
    } finally {
      await ws.sandbox.stop();
    }
  }
});

test('verifyRunAccess passes with real browser and local service endpoints, and catches HTTP 401', async t => {
  const dir = temporary(t);
  const leadModelFile = join(dir, 'lead-model');
  installLeadModel(leadModelFile);
  let axiomStatus = 200;
  const server = createServer((req, res) => {
    const status = req.url.startsWith('/axiom') ? axiomStatus : 200;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: status === 200 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const endpoints = {
    linear: `${base}/linear`,
    commandcode: `${base}/commandcode`,
    sentry: `${base}/sentry`,
    axiom: `${base}/axiom`,
  };

  const keys = {
    LINEAR_API_KEY: 'Bearer ok',
    COMMANDCODE_API_KEY: 'ok',
    SENTRY_AUTH_TOKEN: 'ok',
    SENTRY_ORG: 'org',
    SENTRY_PROJECT: 'proj',
    AXIOM_TOKEN: 'ok',
    AXIOM_DATASET: 'ds',
  };
  const prev = Object.fromEntries(Object.keys(keys).map(k => [k, process.env[k]]));
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  Object.assign(process.env, keys);

  const full = createAgents({ repo, leadModelFile, model: 'openai/gpt-6.1-sol' });
  const helpers = await full.build.listAgents();
  const firstHelper = Object.values(helpers)[0];
  full.build.listAgents = async () => ({ featureRefactoring: firstHelper });
  const minimalAgents = { build: full.build, shipping: full.shipping };

  const pass = await verifyRunAccess({ agents: minimalAgents, checkout: repo, repo, checkBrowser: true, endpoints });
  assert.equal(pass.ok, true, pass.reason);

  axiomStatus = 401;
  const fail = await verifyRunAccess({ agents: minimalAgents, checkout: repo, repo, checkBrowser: false, endpoints });
  assert.equal(fail.ok, false);
  assert.match(fail.reason, /featureRefactoring\): axiom \(HTTP 401\)/);
  assert.match(fail.reason, /Shipping: axiom \(HTTP 401\)/);
});
