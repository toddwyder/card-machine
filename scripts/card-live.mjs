#!/usr/bin/env node
// Blocks until the live site serves the given commit, then runs e2e against it.
// This is how a card session waits for a deploy: the command returns only with a
// result, so nobody has to end a turn to wait.

import { execFileSync, spawn } from 'node:child_process';
import { cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectGithubRepo } from './card-session/worktree.mjs';
import { bypassHeaders } from './card-session/vercel.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = { commit: null, url: null, output: null, timeoutMinutes: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--commit') args.commit = argv[++index] ?? null;
    else if (flag === '--url') args.url = argv[++index] ?? null;
    else if (flag === '--output') args.output = argv[++index] ?? null;
    else if (flag === '--timeout-minutes') args.timeoutMinutes = Number(argv[++index]);
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!args.commit) throw new Error('--commit <sha> is required');
  if (!Number.isFinite(args.timeoutMinutes) || args.timeoutMinutes <= 0) throw new Error('--timeout-minutes must be a positive number');
  return args;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function healthUrl(base) {
  return new URL('/api/health', base.endsWith('/') ? base : `${base}/`).href;
}

const stripAnsi = text => text.replace(/\u001b\[[0-9;]*m/g, '');

function gh(args) {
  const out = execFileSync('gh', args, {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', GH_FORCE_TTY: '0' },
  });
  return stripAnsi(out);
}

// The live address is whatever the deployment for this commit reported, so no
// project-specific URL lives in this repository. A deployment older than the
// merge commit serves an older checkout, so the commit picks the deployment.
export function productionUrl(repository, commit) {
  const deployments = JSON.parse(gh(['api', `repos/${repository}/deployments?environment=Production&per_page=20`]));
  const matching = commit ? (deployments ?? []).filter(deployment => deployment.ref === commit) : [];
  for (const deployment of [...matching, ...(deployments ?? [])]) {
    const statuses = JSON.parse(gh(['api', `repos/${repository}/deployments/${deployment.id}/statuses`]));
    const live = (statuses ?? []).find(status => status.state === 'success' && (status.environment_url || status.target_url));
    if (live) return live.environment_url || live.target_url;
  }
  throw new Error(commit ? `no successful production deployment of ${commit.slice(0, 8)} found for ${repository}` : `no successful production deployment found for ${repository}`);
}

async function servedCommit(base) {
  try {
    const response = await fetch(healthUrl(base), {
      headers: { 'x-health-probe': 'card-live', ...bypassHeaders() },
    });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const body = await response.json();
    return { ok: body?.status === 'ok', commit: body?.commit ?? null, reason: body?.status ?? 'no status' };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function waitForCommit({ commit, url, timeoutMinutes, resolveUrl }) {
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let target = url;
  let last = null;
  while (Date.now() < deadline) {
    if (!target) {
      try {
        target = resolveUrl();
        console.error(`card-live: live site ${target}`);
      } catch (error) {
        last = { ok: false, reason: error.message };
        console.error(`[${new Date().toISOString()}] waiting: ${error.message}`);
        await sleep(15_000);
        continue;
      }
    }
    const reading = await servedCommit(target);
    last = reading;
    if (reading.ok && reading.commit === commit) return { ...reading, url: target };
    console.error(`[${new Date().toISOString()}] waiting: serving ${reading.commit?.slice(0, 8) ?? reading.reason}`);
    await sleep(15_000);
  }
  return { ...last, url: target, timedOut: true };
}

// The stock e2e runner does the work. Its output must sit inside this repository,
// so a requested folder elsewhere is copied out after a passing run.
function runE2e({ url, commit, output }) {
  const inRepo = join('.e2e', 'deployed', `live-${commit.slice(0, 8)}`);
  const child = spawn(join(repo, 'node_modules', '.bin', 'e2e'), ['run', '--config', 'e2e.preview.config.ts', '--output', inRepo], {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, JULIA_PREVIEW_URL: url, JULIA_COMMIT: commit, JULIA_E2E_OUTPUT: inRepo },
  });
  child.on('exit', code => {
    if (code === 0 && output) cpSync(join(repo, inRepo), output, { recursive: true, force: true });
    process.exit(code ?? 1);
  });
  return child;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`card-live: ${error.message}`);
    process.exit(64);
  }

  if (args.url) console.error(`card-live: live site ${args.url}`);
  const reading = await waitForCommit({
    ...args,
    resolveUrl: () => productionUrl(projectGithubRepo(), args.commit),
  });
  if (reading.timedOut) {
    console.error(`card-live: ${reading.url ?? 'the live site'} did not serve ${args.commit} within ${args.timeoutMinutes} minutes (last: ${reading.reason})`);
    process.exit(1);
  }

  console.error(`card-live: ${reading.url} serves ${args.commit}; running e2e`);
  const child = runE2e({ ...args, url: reading.url });
  child.on('error', error => {
    console.error(`card-live: could not run e2e: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', code => process.exit(code ?? 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
