import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { test } from 'node:test';

import { healthUrl } from '../card-live.mjs';
import { previewUrlFromDeployment } from '../card-check.mjs';
import {
  beginLedger,
  beginSession,
  cardFromPullRequest,
  commitSession,
  ledgerPath,
  readLedger,
  remainingForChecker,
  resolveLimit,
} from './budget.mjs';
import { goalObjective } from './instructions.mjs';
import { writeSessionSettings } from './session.mjs';

test('resolveLimit defaults to 4 and refuses a non-positive value', () => {
  assert.equal(resolveLimit({}), 4);
  assert.equal(resolveLimit({ CARD_LIMIT_DOLLARS: '1' }), 1);
  assert.equal(resolveLimit({ FLOW_CARD_LIMIT_DOLLARS: '2.5' }), 2.5);
  assert.throws(() => resolveLimit({ CARD_LIMIT_DOLLARS: '0' }), /positive/);
  assert.throws(() => resolveLimit({ CARD_LIMIT_DOLLARS: 'cheap' }), /positive/);
});

test('a session adds its spend to what earlier sessions of the same side committed', () => {
  const card = `JUL-TEST-${process.pid}`;
  const { path } = beginLedger(card, 1);
  try {
    const firstLead = beginSession(path, 'leadUsd');
    commitSession(path, 'leadUsd', firstLead, 0.2);
    // The guard writes the same running total many times; it must not add up.
    commitSession(path, 'leadUsd', firstLead, 0.2);
    assert.equal(readLedger(path).leadUsd, 0.2);
    const secondLead = beginSession(path, 'leadUsd');
    commitSession(path, 'leadUsd', secondLead, 0.1);
    assert.equal(readLedger(path).leadUsd, 0.3);
    const checker = beginSession(path, 'checkerUsd');
    commitSession(path, 'checkerUsd', checker, 0.05);
    commitSession(path, 'checkerUsd', checker, 0.15);
    assert.equal(readLedger(path).checkerUsd, 0.15);
    assert.equal(remainingForChecker(readLedger(path)), 0.55);
    assert.equal(ledgerPath(card), path);
  } finally {
    rmSync(dirname(path), { recursive: true, force: true });
  }
});

test('a missing ledger reads as zero so a checker can still refuse to run', () => {
  const ledger = readLedger(join(tmpdir(), `no-ledger-${process.pid}.json`));
  assert.deepEqual(ledger, { card: null, limitUsd: 0, leadUsd: 0, checkerUsd: 0, updatedAt: null });
});

test('the card id comes from the branch first, then the title, then the body', () => {
  assert.equal(cardFromPullRequest({ headRefName: 'card/JUL-401', title: 'JUL-400', body: 'JUL-399' }), 'JUL-401');
  assert.equal(cardFromPullRequest({ title: 'JUL-400 something' }), 'JUL-400');
  assert.equal(cardFromPullRequest({ headRefName: 'card/jul-418' }), 'JUL-418');
  assert.equal(cardFromPullRequest({ body: 'no card here' }), null);
});

test('the goal objective is the card done means plus the merge and live e2e line', () => {
  const objective = goalObjective('## Done means\n- first\n- second\n\n## Proof\n- ignored');
  assert.match(objective, /^- first$/m);
  assert.match(objective, /^- second$/m);
  assert.doesNotMatch(objective, /ignored/);
  assert.match(objective, /merged after the checker posted PASS, and e2e passes against the live site/);
  assert.throws(() => goalObjective('## Proof\n- only proof'), /no done means/);
});

test('a preview URL only comes from a successful deployment status', () => {
  assert.equal(previewUrlFromDeployment({}, [{ state: 'pending' }]), null);
  assert.equal(
    previewUrlFromDeployment({}, [{ state: 'success', environment_url: 'https://preview.example' }]),
    'https://preview.example',
  );
  assert.equal(previewUrlFromDeployment({}, [{ state: 'success', target_url: 'https://target.example' }]), 'https://target.example');
});

test('the health probe would not double the slash', () => {
  assert.equal(healthUrl('https://julia.example'), 'https://julia.example/api/health');
  assert.equal(healthUrl('https://julia.example/'), 'https://julia.example/api/health');
});

test('one settings file gives the lead model to every helper type and the judge', () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-settings-'));
  try {
    const path = writeSessionSettings(dir, { model: 'commandcode/deepseek/deepseek-v4.1-flash' });
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(settings.models.subagentModels, {
      explore: 'commandcode/deepseek/deepseek-v4.1-flash',
      plan: 'commandcode/deepseek/deepseek-v4.1-flash',
      execute: 'commandcode/deepseek/deepseek-v4.1-flash',
    });
    assert.equal(settings.models.goalJudgeModel, 'commandcode/deepseek/deepseek-v4.1-flash');
    assert.equal(settings.preferences.subagentsEnabled, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
