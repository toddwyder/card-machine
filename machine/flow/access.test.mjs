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
    STITCH_API_KEY: process.env.STITCH_API_KEY,
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
  process.env.STITCH_API_KEY = 'stitch-repro-token';
  process.env.UNRELATED_SECRET = 'must-not-leak';

  const { shipping } = createAgents({ repo, leadModelFile, model: 'openai/gpt-6.1-sol' });
  const ws = await shipping.getWorkspace({ requestContext: new RequestContext([['cardCheckout', repo]]) });
  const skills = await ws.listSkills?.();
  assert.ok(Array.isArray(skills) && skills.some(s => s.name === 'poteto-mode'), 'Shipping workspace should load poteto-mode skill');

  await ws.sandbox.start();
  try {
    const res = await ws.sandbox.executeCommand(process.execPath, [
      '-e',
      'console.log(JSON.stringify({ linear: process.env.LINEAR_API_KEY ?? null, sentry: process.env.SENTRY_AUTH_TOKEN ?? null, axiom: process.env.AXIOM_TOKEN ?? null, stitch: process.env.STITCH_API_KEY ?? null, unrelated: process.env.UNRELATED_SECRET ?? null }))',
    ]);
    assert.equal(res.exitCode, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), {
      linear: 'Bearer linear-repro-token',
      sentry: 'sentry-repro-token',
      axiom: 'axiom-repro-token',
      stitch: 'stitch-repro-token',
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
