// Fresh checkouts for a card session and its separate checker.
//
// The launcher takes a new worktree of the project repo at origin/main; the
// checker takes a new worktree at the pull request's head commit. Dependencies
// are hardlinked from a cache keyed by the lockfiles, because two full installs
// do not fit beside a running session.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Disposable checkouts live in the scratch tree the server already prunes.
export const STATE_ROOT = join(homedir(), '.local', 'state', 'julia-scratch', 'card-sessions');

// The project checkout and its GitHub name come from the machine environment,
// never from a literal in this repository. When they are not exported, they are
// read from the unit file that runs the machine on this server.
export function machineEnvironment(env = process.env) {
  if (env.CARD_PROJECT_REPO || env.FLOW_PROJECT_REPO) return env;
  const unit = env.FLOW_UNIT_FILE || join(homedir(), '.config', 'systemd', 'user', 'card-machine-studio.service');
  if (!existsSync(unit)) return env;
  const fromUnit = {};
  for (const line of readFileSync(unit, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^Environment=([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) fromUnit[match[1]] = match[2];
  }
  return { ...fromUnit, ...env };
}

export function resolveProjectRepo(env = process.env) {
  const source = machineEnvironment(env);
  const repo = source.CARD_PROJECT_REPO || source.FLOW_PROJECT_REPO;
  if (!repo) throw new Error('CARD_PROJECT_REPO or FLOW_PROJECT_REPO must name the project checkout.');
  return repo;
}

export function projectGithubRepo(env = process.env) {
  const source = machineEnvironment(env);
  const repo = source.CARD_PROJECT_GITHUB_REPO || source.FLOW_PROJECT_GITHUB_REPO;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error('CARD_PROJECT_GITHUB_REPO or FLOW_PROJECT_GITHUB_REPO must name the project repository as owner/name.');
  }
  return repo;
}

export function git(repo, args, options = {}) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    ...options,
  }).trim();
}

export function assertProjectRepo(repo) {
  if (!existsSync(join(repo, '.git'))) {
    throw new Error(`${repo} is not a git checkout. Set CARD_PROJECT_REPO to the project checkout.`);
  }
  const remote = git(repo, ['remote', 'get-url', 'origin']);
  const expected = projectGithubRepo();
  if (!remote.replace(/\.git$/, '').endsWith(expected)) {
    throw new Error(`${repo} points at ${remote}, not at ${expected}. Set CARD_PROJECT_REPO and CARD_PROJECT_GITHUB_REPO.`);
  }
  return remote;
}

export function sessionStamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

export function sessionPath(name, stamp = sessionStamp()) {
  const dir = join(STATE_ROOT, `${name}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function fetchMain(repo) {
  git(repo, ['fetch', '--quiet', 'origin', 'main']);
  return git(repo, ['rev-parse', 'origin/main']);
}

export function fetchPullRequestHead(repo, pr) {
  git(repo, ['fetch', '--quiet', 'origin', `pull/${pr}/head`]);
  return git(repo, ['rev-parse', 'FETCH_HEAD']);
}

export function addWorktree(repo, sha, dir) {
  if (existsSync(dir)) {
    throw new Error(`${dir} already exists; refusing to reuse a checkout.`);
  }
  git(repo, ['worktree', 'add', '--detach', '--quiet', dir, sha]);
  return dir;
}

export function removeWorktree(repo, dir) {
  if (!existsSync(dir)) return;
  try {
    git(repo, ['worktree', 'remove', '--force', dir]);
  } catch {
    rmSync(dir, { recursive: true, force: true });
  }
  try {
    git(repo, ['worktree', 'prune']);
  } catch {
    // A prune failure leaves a stale entry; the next add still works.
  }
}

function lockDigest(worktree) {
  const hash = createHash('sha256');
  for (const file of ['package.json', 'package-lock.json', 'dashboard/package.json', 'dashboard/package-lock.json']) {
    const path = join(worktree, file);
    if (existsSync(path)) hash.update(file).update(readFileSync(path));
  }
  return hash.digest('hex').slice(0, 16);
}

function cacheDeps(worktree, cacheRoot) {
  const trees = ['', 'dashboard'].filter(tree => existsSync(join(worktree, tree, 'node_modules')));
  for (const tree of trees) {
    const target = join(cacheRoot, tree, 'node_modules');
    if (!existsSync(target)) return false;
  }
  for (const tree of trees) {
    const target = join(worktree, tree, 'node_modules');
    if (existsSync(target)) continue;
    // Hardlinks keep a second 2.6 GB tree off the disk the running session uses.
    mkdirSync(join(worktree, tree), { recursive: true });
    execFileSync('cp', ['-al', join(cacheRoot, tree, 'node_modules'), target], { timeout: 10 * 60_000 });
  }
  return true;
}

// The cache is filled by a throwaway checkout of the same commit, so a session
// never installs into the tree it is about to edit.
export function prepareDependencies(worktree, { repo }) {
  const digest = lockDigest(worktree);
  const cacheRoot = join(STATE_ROOT, 'deps', `project-${digest}`);
  if (existsSync(join(cacheRoot, '.ready')) && cacheDeps(worktree, cacheRoot)) {
    return { source: 'cache', cacheRoot };
  }

  const staging = `${cacheRoot}.staging-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    const install = addWorktree(repo, git(worktree, ['rev-parse', 'HEAD']), join(staging, 'tree'));
    const bun = execFileSync('bash', ['-lc', 'command -v bun || true'], { encoding: 'utf8' }).trim();
    const runInstall = cwd => {
      if (bun) {
        execFileSync(bun, ['install', '--frozen-lockfile'], { cwd, stdio: 'inherit', timeout: 15 * 60_000 });
      } else {
        execFileSync('npm', ['ci'], { cwd, stdio: 'inherit', timeout: 20 * 60_000 });
      }
    };
    runInstall(install);
    if (existsSync(join(install, 'dashboard', 'package.json'))) runInstall(join(install, 'dashboard'));
    for (const tree of ['', 'dashboard']) {
      if (existsSync(join(install, tree, 'node_modules'))) {
        mkdirSync(join(staging, tree), { recursive: true });
        cpSync(join(install, tree, 'node_modules'), join(staging, tree, 'node_modules'), { recursive: true, verbatimSymlinks: true });
      }
    }
    writeFileSync(join(staging, '.ready'), new Date().toISOString());
    if (!existsSync(cacheRoot)) {
      try {
        renameSync(staging, cacheRoot);
      } catch {
        // Another session finished the same cache first.
      }
    }
  } finally {
    removeWorktree(repo, join(staging, 'tree'));
    rmSync(staging, { recursive: true, force: true });
  }

  if (!existsSync(join(cacheRoot, '.ready'))) {
    throw new Error(`Dependency cache ${cacheRoot} was not built.`);
  }
  cacheDeps(worktree, cacheRoot);
  return { source: 'installed', cacheRoot };
}

export function dependencyMarker(worktree) {
  return existsSync(join(worktree, 'node_modules'));
}
