#!/usr/bin/env node
// Starts a second, separate Mastra Code session that acts as the Shipping
// playbook's independent verifier for one project pull request. It checks the
// PR's Vercel preview with e2e, changes no code, merges nothing, and posts one
// comment whose first line is exactly PASS or exactly FAIL.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { leadModelId } from '../machine/flow/models.mjs';
import {
  beginLedger,
  cardFromPullRequest,
  commitSession,
  ledgerPath,
  makeCardCostControl,
  readLedger,
  remainingForChecker,
  resolveLimit,
} from './card-session/budget.mjs';
import { checkerInstructions } from './card-session/instructions.mjs';
import { bootSession, closeSession, loadProgram, runSession, sessionCost, useSessionState, writeSessionSettings } from './card-session/session.mjs';
import {
  addWorktree,
  assertProjectRepo,
  fetchPullRequestHead,
  prepareDependencies,
  projectGithubRepo,
  resolveProjectRepo,
  sessionPath,
} from './card-session/worktree.mjs';

const PREVIEW_WAIT_MINUTES = 10;

const stripAnsi = text => text.replace(/\u001b\[[0-9;]*m/g, '');

function gh(args, options = {}) {
  const out = execFileSync('gh', args, {
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', GH_FORCE_TTY: '0' },
    ...options,
  });
  return stripAnsi(out).trim();
}

function parseArgs(argv) {
  const args = { pr: null, repo: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--repo') args.repo = argv[++index] ?? null;
    else if (flag.startsWith('-')) throw new Error(`unknown argument ${flag}`);
    else if (!args.pr) args.pr = Number(flag);
    else throw new Error(`unexpected argument ${flag}`);
  }
  if (!Number.isInteger(args.pr) || args.pr <= 0) throw new Error('usage: card-check.mjs <pull request number> [--repo <checkout>]');
  return args;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function previewUrlFromDeployment(deployment, statuses) {
  const ready = statuses.find(status => status.state === 'success' && (status.environment_url || status.target_url));
  return ready ? ready.environment_url || ready.target_url : null;
}

function readPreview(sha) {
  const deployments = JSON.parse(gh(['api', `repos/${projectGithubRepo()}/deployments?ref=${sha}&per_page=20`]));
  const previews = deployments.filter(deployment => !/production/i.test(deployment.environment ?? ''));
  for (const deployment of previews) {
    const statuses = JSON.parse(gh(['api', `repos/${projectGithubRepo()}/deployments/${deployment.id}/statuses?per_page=20`]));
    const url = previewUrlFromDeployment(deployment, statuses);
    if (url) return url;
  }
  return null;
}

async function waitForPreview(sha) {
  const deadline = Date.now() + PREVIEW_WAIT_MINUTES * 60_000;
  while (Date.now() < deadline) {
    const url = readPreview(sha);
    if (url) return url;
    console.error(`[${new Date().toISOString()}] waiting for a preview deployment of ${sha.slice(0, 8)}`);
    await sleep(15_000);
  }
  return null;
}

function postVerdict(pr, body) {
  const path = join(sessionPath(`verdict-${pr}`), 'comment.md');
  writeFileSync(path, `${body.trimEnd()}\n`);
  gh(['pr', 'comment', String(pr), '--repo', projectGithubRepo(), '--body-file', path]);
  return path;
}

function newestVerdict(pr) {
  const body = gh(['pr', 'view', String(pr), '--repo', projectGithubRepo(), '--json', 'comments']);
  const comments = JSON.parse(body).comments ?? [];
  const newest = [...comments].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!newest) return null;
  return String(newest.body ?? '').trimStart().split(/\r?\n/, 1)[0].trim();
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`card-check: ${error.message}`);
    process.exit(64);
  }

  let booted = null;
  try {
    const pr = JSON.parse(gh(['pr', 'view', String(args.pr), '--repo', projectGithubRepo(), '--json', 'number,title,headRefOid,headRefName,state,url']));
    const card = cardFromPullRequest(pr) ?? `pr-${pr.number}`;
    if (!readLedger(ledgerPath(card)).updatedAt) beginLedger(card, resolveLimit());
    const ledger = readLedger(ledgerPath(card));
    const path = ledgerPath(card);
    const remaining = remainingForChecker(ledger);

    console.error(`card-check: PR #${pr.number} head ${pr.headRefOid.slice(0, 8)} card ${card} remaining $${remaining}`);
    if (remaining <= 0.001) {
      postVerdict(pr.number, `FAIL\n\nThe card's dollar limit is spent (limit $${ledger.limitUsd.toFixed(2)}, lead $${ledger.leadUsd.toFixed(2)}, checker $${ledger.checkerUsd.toFixed(2)}), so no check ran.`);
      process.exitCode = 1;
      return;
    }

    const previewUrl = await waitForPreview(pr.headRefOid);
    if (!previewUrl) {
      postVerdict(pr.number, `FAIL\n\nNo preview deployment became ready for ${pr.headRefOid} within ${PREVIEW_WAIT_MINUTES} minutes, so e2e could not run.`);
      process.exitCode = 1;
      return;
    }
    console.error(`card-check: preview ${previewUrl}`);

    const repo = args.repo || resolveProjectRepo();
    assertProjectRepo(repo);
    const sha = fetchPullRequestHead(repo, pr.number);
    const sessionDir = sessionPath(`check-${pr.number}`);
    useSessionState(sessionDir);
    const worktree = join(sessionDir, 'work');
    addWorktree(repo, sha, worktree);
    prepareDependencies(worktree, { repo });

    const model = leadModelId();
    const program = await loadProgram();
    const costControl = makeCardCostControl(program.TokenCostControl, { path, field: 'checkerUsd', limitUsd: ledger.limitUsd });
    booted = await bootSession({
      worktree,
      sessionDir,
      settingsPath: writeSessionSettings(sessionDir, { model }),
      hostInstructions: checkerInstructions({
        pr,
        worktree,
        previewUrl,
        e2eOutput: `.e2e/deployed/check-${pr.number}`,
      }),
      costControl,
      program,
    });

    const result = await runSession({
      booted: booted.booted,
      runMC: booted.runMC,
      model,
      resourceId: card,
      title: `Checker ${card} PR ${pr.number}`,
      timeoutMs: 45 * 60_000,
      prompt: `Check pull request #${pr.number} now.`,
      policy: booted.autoApprovePolicy,
    });
    const record = await sessionCost(booted.booted, card);
    if (record?.totalUsd != null) commitSession(path, 'checkerUsd', costControl.sessionBaseline, record.totalUsd);
    await closeSession(booted.booted);
    booted = null;

    const verdict = newestVerdict(pr.number);
    console.error(`card-check: session ${result.status} (exit ${result.exitCode}), cost $${record?.totalUsd ?? '-'}, newest verdict ${verdict ?? 'none'}`);
    process.exitCode = verdict === 'PASS' && result.status === 'completed' ? 0 : 1;
  } catch (error) {
    console.error(`card-check: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (booted?.booted) await closeSession(booted.booted).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();