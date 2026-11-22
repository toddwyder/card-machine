// The parts of a run that both runners need: the checkout of a pull request's
// head, the trace file name for one review, the guard that stops a rerun from
// posting twice, and the `gh` comment. They live apart from `run.mjs` so the
// remediation runner can check out and comment the same way without starting
// the shipping run.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDER_SLICE, COMMAND_MEMORY_MAX, boundedCommand, builderLock, sliceMemoryMax } from '../flow/bounded-sandbox.mjs';
import { selectInstaller } from '../flow/copy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, '../..');

export function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function prepareCheckout(pr, runDir, checkout) {
  git(['fetch', '--no-tags', '--quiet', 'origin', `pull/${pr}/head`]);
  const sha = git(['rev-parse', 'FETCH_HEAD^{commit}']);
  try {
    git(['worktree', 'remove', '--force', checkout]);
  } catch {
    // No worktree there yet; the add below fails loudly if something else is.
  }
  try {
    git(['worktree', 'prune']);
  } catch {
    // Prune is tidiness; a stale registration fails the add with a clear message.
  }
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.dirname(checkout), { recursive: true });
  git(['worktree', 'add', '--detach', '--quiet', checkout, sha]);
  return sha;
}

// A review runs the card's checks, and those need the dev dependencies. Install
// the root and dashboard trees one after the other, never together: two npm ci
// runs at once took 3.4 GB on this 7.6 GB server and the kernel killed Studio.
// A tree installed from the same lockfile is reused.
//
// Bun installs this lockfile under a 1.2 GB ceiling in about 10 s; npm 11 needs
// about 3.8 GB and 90 s for the same tree, which is more than the builder slice
// allows. A command that runs out of memory must be the one that dies.
//
// The install runs inside the builder slice under the same lock card commands
// take, so a shipping install and a card command never install or build at the
// same time, and an install that outgrows the slice is the one that dies.
const INSTALL_TREES = ['', 'dashboard'];

const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

function inBuilderSlice() {
  return sliceMemoryMax(BUILDER_SLICE) !== null && Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);
}

function installInvocation(run) {
  const plain = [run.command, ...run.args].map(quote).join(' ');
  if (!inBuilderSlice()) return plain;
  const ceiling = sliceMemoryMax(BUILDER_SLICE);
  const scoped = boundedCommand(plain, {
    memoryMax: Math.min(COMMAND_MEMORY_MAX, ceiling),
    lock: builderLock(),
    description: 'Card dependencies install',
  });
  return `test "$(systemctl --user show ${quote(BUILDER_SLICE)} --property=MemoryMax --value)" = ${quote(ceiling)} && exec ${scoped}`;
}

function lockHash(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function markInstalled(marker, hash) {
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${hash}\n`, { mode: 0o600 });
}

function sameContents(left, right) {
  try {
    return fs.readFileSync(left).equals(fs.readFileSync(right));
  } catch {
    return false;
  }
}

function removeTree(target) {
  try {
    if (fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
    else fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Nothing installed yet.
  }
}

export function prepareDependencies(checkout, { log = () => {}, timeoutMs = 15 * 60_000, mainRoot = repoRoot } = {}) {
  for (const relative of INSTALL_TREES) {
    const cwd = path.join(checkout, relative);
    const lock = path.join(cwd, 'package-lock.json');
    const nodeModules = path.join(cwd, 'node_modules');
    const marker = path.join(nodeModules, '.card-dependencies');
    if (!fs.existsSync(lock)) continue;
    const hash = lockHash(lock);

    // A pull request that does not change the lockfile can use the tree already
    // installed in the main checkout, so the review starts without an install.
    const mainModules = path.join(mainRoot, relative, 'node_modules');
    if (
      sameContents(lock, path.join(mainRoot, relative, 'package-lock.json')) &&
      fs.existsSync(path.join(mainModules, '.package-lock.json'))
    ) {
      removeTree(nodeModules);
      // A hardlink clone is a real directory, so Next's Turbopack accepts it;
      // a symlink to an external tree is rejected as an invalid external path.
      execFileSync('cp', ['-al', mainModules, nodeModules]);
      markInstalled(marker, hash);
      log(`Cloned ${relative || 'root'} dependencies from the main checkout; the lockfile matches.`);
      continue;
    }

    try {
      if (fs.readFileSync(marker, 'utf8').trim() === hash) continue;
    } catch {
      // No installed tree yet, or one from a different lockfile; install it.
    }
    const run = selectInstaller();
    log(`Installing ${relative || 'root'} dependencies once with ${run.command}, from the lockfile.`);
    execFileSync('/bin/sh', ['-c', installInvocation(run)], {
      cwd,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, ...run.env },
      timeout: timeoutMs,
    });
    markInstalled(marker, hash);
  }
}

export function traceFileFor(pr, label = 'shipping') {
  const dir = process.env.JULIA_TRACES_DIR || path.join(os.homedir(), '.local', 'share', 'mastracode', 'traces');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${stamp}-${process.pid}-${label}-pr-${pr}.duckdb`);
}

// A posting step reads the saved result first: a run that reached the pull request
// and then died must not comment a second time when it is started again.
export function savedPosting(runDir, pr, sha, card) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(runDir, 'record.json'), 'utf8'));
    if (saved.pr !== pr || saved.sha !== sha || saved.card?.identifier !== card) return null;
    return saved.posted?.url ? saved : null;
  } catch {
    return null;
  }
}

export function postComment(pr, bodyFile) {
  const url = execFileSync('gh', ['pr', 'comment', String(pr), '--body-file', bodyFile], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return url.split(/\s+/).find(part => part.startsWith('http')) ?? url;
}
