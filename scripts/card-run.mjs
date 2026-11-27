#!/usr/bin/env node
// Starts one Linear card as a single headless Mastra Code session in a fresh
// worktree of the project's main branch, with goal mode on. Nobody types into it: the run
// ends either done (exit 0), paused, or by timeout (exit 2). It never retries.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { leadModelId } from '../machine/flow/models.mjs';
import { getIssue } from './linear-cli.mjs';
import { beginLedger, commitSession, makeCardCostControl, readLedger, remainingForChecker, resolveLimit } from './card-session/budget.mjs';
import { goalObjective, leadInstructions } from './card-session/instructions.mjs';
import { bootSession, closeSession, loadProgram, runSession, sessionCost, useSessionState, writeSessionSettings } from './card-session/session.mjs';
import {
  STATE_ROOT,
  addWorktree,
  assertProjectRepo,
  fetchMain,
  prepareDependencies,
  resolveProjectRepo,
  sessionPath,
} from './card-session/worktree.mjs';

const TIMEOUT_MS = Number(process.env.CARD_SESSION_IDLE_MS ?? 30 * 60_000);

function parseArgs(argv) {
  const args = { card: null, limit: null, repo: null, keep: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--limit') args.limit = Number(argv[++index]);
    else if (flag === '--repo') args.repo = argv[++index] ?? null;
    else if (flag === '--keep') args.keep = true;
    else if (flag.startsWith('-')) throw new Error(`unknown argument ${flag}`);
    else if (!args.card) args.card = flag;
    else throw new Error(`unexpected argument ${flag}`);
  }
  if (!args.card) throw new Error('usage: card-run.mjs <JUL-xxx> [--limit 1.00] [--repo <checkout>] [--keep]');
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit <= 0)) throw new Error('--limit must be a positive number of dollars');
  return args;
}

// One card run at a time: two sessions would share the worktree state and the
// Studio lock expectations the server already relies on.
function takeLock() {
  mkdirSync(STATE_ROOT, { recursive: true });
  const path = join(STATE_ROOT, 'session.lock');
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, 'utf8').trim());
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    if (alive) throw new Error(`a card session is already running (pid ${pid}); lock ${path}`);
    rmSync(path, { force: true });
  }
  writeFileSync(path, `${process.pid}\n`);
  return () => rmSync(path, { force: true });
}

function say(line) {
  console.log(line);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`card-run: ${error.message}`);
    process.exit(64);
  }

  const release = takeLock();
  let booted = null;
  try {
    const card = await getIssue(args.card);
    if (!card) throw new Error(`Linear card ${args.card} was not found`);
    const objective = goalObjective(card.description ?? '');

    const repo = args.repo || resolveProjectRepo();
    assertProjectRepo(repo);
    const base = fetchMain(repo);

    const sessionDir = sessionPath(card.identifier);
    useSessionState(sessionDir);
    const worktree = join(sessionDir, 'work');
    addWorktree(repo, base, worktree);
    prepareDependencies(worktree, { repo });

    const model = leadModelId();
    const limitUsd = args.limit ?? resolveLimit();
    const { path: ledgerPath } = beginLedger(card.identifier, limitUsd);
    const settingsPath = writeSessionSettings(sessionDir, { model });
    const branch = `card/${card.identifier.toLowerCase()}`;
    const hostInstructions = leadInstructions({ card, worktree, branch, sessionDir });

    say(`card: ${card.identifier} ${card.title}`);
    say(`limitUsd: ${limitUsd}`);
    say(`model: ${model}`);
    say(`worktree: ${worktree}`);
    say(`session: ${sessionDir}`);

    const program = await loadProgram();
    const costControl = makeCardCostControl(program.TokenCostControl, {
      path: ledgerPath,
      field: 'leadUsd',
      limitUsd,
    });

    booted = await bootSession({ worktree, sessionDir, settingsPath, hostInstructions, costControl, program });
    const result = await runSession({
      booted: booted.booted,
      runMC: booted.runMC,
      model,
      resourceId: card.identifier,
      title: `${card.identifier} ${card.title}`,
      timeoutMs: TIMEOUT_MS,
      goal: { objective, judgeModelId: model, maxRuns: 50 },
      policy: booted.autoApprovePolicy,
    });

    const record = await sessionCost(booted.booted, card.identifier);
    if (record?.totalUsd != null) commitSession(ledgerPath, 'leadUsd', costControl.sessionBaseline, record.totalUsd);

    say(`status: ${result.status}`);
    say(`exit: ${result.exitCode}`);
    say(`thread: ${result.threadId ?? '-'}`);
    say(`reason: ${result.reason ?? '-'}`);
    say(`iterations: ${result.iterations ?? '-'} of ${result.maxRuns ?? '-'}`);
    say(`tokens: ${result.usage?.totalTokens ?? '-'}`);
    say(`costUsd: ${record?.totalUsd ?? '-'}`);
    say(`remainingForCheckerUsd: ${remainingForChecker(readLedger(ledgerPath))}`);
    say(`worktree: ${worktree}`);
    if (result.error) say(`error: ${result.error.message}`);
    process.exitCode = result.exitCode ?? 1;
  } catch (error) {
    console.error(`card-run: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (booted?.booted) await closeSession(booted.booted).catch(() => {});
    release();
  }
}

main();
