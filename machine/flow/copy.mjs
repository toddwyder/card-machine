import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { boundedCommand, builderLock, LOCK_WAIT_SECONDS } from './bounded-sandbox.mjs';

const execFileAsync = promisify(execFile);
const SCRATCH = join(homedir(), '.local/state/julia-scratch');
const MODULE_TREES = ['', 'dashboard'];
const LOCK_STAMP = '.card-lock-sha';
const inflightInstalls = new Map();

const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const lockHash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const readStamp = modulesDir => {
  try {
    return readlinkSync(join(modulesDir, LOCK_STAMP));
  } catch {
    return '';
  }
};
const writeStamp = (modulesDir, hash) => {
  mkdirSync(modulesDir, { recursive: true });
  const stamp = join(modulesDir, LOCK_STAMP);
  rmSync(stamp, { force: true });
  symlinkSync(hash, stamp);
};

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const name = card => card.replace(/[^\w.-]+/g, '-');
const branch = card => `card/${name(card)}`;
const baseRef = card => `refs/card-base/${name(card)}`;

export function copiesRoot(env = process.env) {
  return join(env.FLOW_SCRATCH ?? SCRATCH, 'cards');
}

export function copyFolder(card, env = process.env) {
  return join(copiesRoot(env), name(card));
}

function hasOrigin(repo) {
  try {
    return git(repo, ['remote']).split(/\r?\n/).includes('origin');
  } catch {
    return false;
  }
}

export function startedFrom(repo) {
  if (hasOrigin(repo)) {
    try {
      git(repo, ['fetch', '--no-tags', '--quiet', 'origin', 'main']);
    } catch (error) {
      const detail = String(error?.stderr ?? error?.message ?? error).trim();
      throw new Error(`Failed to fetch latest main from origin in ${repo}: ${detail}`);
    }
    try {
      return git(repo, ['rev-parse', '--verify', 'origin/main^{commit}']);
    } catch {
      throw new Error(`${repo} has no origin/main commit after fetch.`);
    }
  }
  try {
    return git(repo, ['rev-parse', '--verify', 'refs/heads/main^{commit}']);
  } catch {
    throw new Error(`${repo} has no main branch to make a card's copy from.`);
  }
}

export function selectInstaller(env = process.env) {
  const candidates = ['bun'];
  const bunHome = env.BUN_INSTALL || (env.HOME ? join(env.HOME, '.bun') : '');
  if (bunHome) candidates.push(join(bunHome, 'bin', 'bun'));

  for (const candidate of candidates) {
    if (candidate !== 'bun' && !existsSync(candidate)) continue;
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore', env });
      return { command: candidate, args: ['install', '--frozen-lockfile'], env: {} };
    } catch {
      // Try next candidate.
    }
  }

  return {
    command: 'npm',
    args: ['ci', '--include=dev', '--no-audit', '--no-fund'],
    env: {
      npm_config_omit: '',
      NODE_OPTIONS: [env.NODE_OPTIONS, '--max-old-space-size=2048'].filter(Boolean).join(' '),
    },
  };
}

function installShellCommand({ treeDir, modulesDir, hash, lock, slice, memoryMax, ownerUnit, env = process.env }) {
  const stamp = join(modulesDir, LOCK_STAMP);
  const run = selectInstaller(env);
  const envPrefix = Object.entries(run.env)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join(' ');
  const installLine = [envPrefix, quote(run.command), ...run.args.map(quote)].filter(Boolean).join(' ');
  const installCmd = `cd ${quote(treeDir)} && rm -rf ${quote(modulesDir)} && ${installLine}`;
  const runInstall = slice
    ? boundedCommand(installCmd, { slice, memoryMax, ownerUnit, description: 'Card dependency install' })
    : installCmd;
  const guarded = `if [ "$(readlink ${quote(stamp)} 2>/dev/null)" = ${quote(hash)} ]; then exit 0; fi; ${runInstall} && mkdir -p ${quote(modulesDir)} && ln -sfn ${quote(hash)} ${quote(stamp)}`;
  return lock ? `flock --verbose --timeout ${LOCK_WAIT_SECONDS} ${quote(lock)} /bin/sh -c ${quote(guarded)}` : guarded;
}

export function syncCopyModules({ repo, folder, lock = process.platform === 'linux' ? builderLock() : null, slice, memoryMax, ownerUnit, install, env = process.env } = {}) {
  for (const tree of MODULE_TREES) {
    const lockFile = join(folder, tree, 'package-lock.json');
    if (!existsSync(lockFile)) continue;
    const hash = lockHash(lockFile);
    const treeDir = join(folder, tree);
    const modulesDir = join(treeDir, 'node_modules');
    if (readStamp(modulesDir) === hash) continue;

    const repoLock = repo ? join(repo, tree, 'package-lock.json') : '';
    const repoModules = repo ? join(repo, tree, 'node_modules') : '';
    const sameLock = Boolean(repo && existsSync(repoLock) && readFileSync(repoLock).equals(readFileSync(lockFile)));
    if (sameLock && existsSync(join(repoModules, '.package-lock.json'))) {
      rmSync(modulesDir, { recursive: true, force: true });
      execFileSync('cp', ['-al', repoModules, modulesDir]);
      writeStamp(modulesDir, hash);
      continue;
    }

    if (typeof install === 'function') {
      install(treeDir, hash);
      writeStamp(modulesDir, hash);
      continue;
    }

    if (process.platform === 'linux') {
      const cmd = installShellCommand({ treeDir, modulesDir, hash, lock, slice, memoryMax, ownerUnit, env });
      execFileSync('/bin/sh', ['-c', cmd], { stdio: 'inherit', env });
    } else {
      const run = selectInstaller(env);
      rmSync(modulesDir, { recursive: true, force: true });
      execFileSync(run.command, run.args, { cwd: treeDir, stdio: 'inherit', env: { ...env, ...run.env } });
      writeStamp(modulesDir, hash);
    }
  }
}

export async function ensureCopyModules({ repo, folder, lock = process.platform === 'linux' ? builderLock() : null, slice, memoryMax, ownerUnit, env = process.env, log = () => {} } = {}) {
  for (const tree of MODULE_TREES) {
    const lockFile = join(folder, tree, 'package-lock.json');
    if (!existsSync(lockFile)) continue;
    const hash = lockHash(lockFile);
    const treeDir = join(folder, tree);
    const modulesDir = join(treeDir, 'node_modules');
    if (readStamp(modulesDir) === hash) continue;

    const key = `${treeDir}:${hash}`;
    if (!inflightInstalls.has(key)) {
      const task = (async () => {
        const repoLock = repo ? join(repo, tree, 'package-lock.json') : '';
        const repoModules = repo ? join(repo, tree, 'node_modules') : '';
        const sameLock = Boolean(repo && existsSync(repoLock) && readFileSync(repoLock).equals(readFileSync(lockFile)));
        if (sameLock && existsSync(join(repoModules, '.package-lock.json'))) {
          rmSync(modulesDir, { recursive: true, force: true });
          await execFileAsync('cp', ['-al', repoModules, modulesDir]);
          writeStamp(modulesDir, hash);
          return;
        }
        const cmd = installShellCommand({ treeDir, modulesDir, hash, lock, slice, memoryMax, ownerUnit, env });
        const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', cmd], { env, maxBuffer: 10 * 1024 * 1024 });
        if (stdout) log(stdout);
        if (stderr) log(stderr);
      })().finally(() => inflightInstalls.delete(key));
      inflightInstalls.set(key, task);
    }
    await inflightInstalls.get(key);
  }
}

function baseOf(folder, card) {
  if (!existsSync(folder)) return '';
  try {
    return git(folder, ['rev-parse', '--verify', `${baseRef(card)}^{commit}`]);
  } catch {
    return '';
  }
}

export function findExistingRemoteBranch(repo, card) {
  if (!hasOrigin(repo)) return null;
  try {
    const out = git(repo, ['ls-remote', '--heads', 'origin', branch(card)]);
    if (!out) return null;
    const sha = out.split(/\s+/)[0];
    return { branch: branch(card), sha };
  } catch {
    return null;
  }
}

export function findLeftoverWork({ repo, card, findPr, env = process.env }) {
  if (existsSync(copyFolder(card, env))) return '';
  const reasons = [];
  const remote = findExistingRemoteBranch(repo, card);
  if (remote) reasons.push(`branch ${remote.branch} already exists on origin at ${remote.sha.slice(0, 8)}`);
  if (hasOrigin(repo) && findPr) {
    try {
      const found = findPr(repo, card);
      if (found?.pr) reasons.push(`open pull request #${found.pr} already exists for ${card}`);
      else if (/\d+ open pull requests name/i.test(found?.reason ?? '')) reasons.push(found.reason);
    } catch {
    }
  }
  if (reasons.length === 0) return '';
  return `Leftover work on GitHub for ${card}: ${reasons.join('; ')}. Stopped before creating a diverging branch; decide whether to resume, merge, or close and delete the earlier work.`;
}

// The copy is its own repository, not a worktree of the studio's. A card's commands
// run in a jail where only the copy is writable, so the git folder the helpers commit
// with has to live inside it.
export function openCopy({ repo, card, env = process.env, install } = {}) {
  const folder = copyFolder(card, env);
  if (existsSync(folder)) {
    const base = baseOf(folder, card);
    if (base) {
      syncCopyModules({ repo, folder, install });
      return { folder, base, fresh: false };
    }
  }
  const remote = findExistingRemoteBranch(repo, card);
  if (remote) {
    throw new Error(`Leftover work on GitHub for ${card}: branch ${remote.branch} already exists on origin at ${remote.sha.slice(0, 8)}.`);
  }
  closeCopy({ repo, card, env });

  const base = startedFrom(repo);
  mkdirSync(copiesRoot(env), { recursive: true });
  git(repo, ['clone', '--quiet', '--shared', '--no-checkout', repo, folder]);
  git(folder, ['checkout', '--quiet', '-B', branch(card), base]);
  git(folder, ['update-ref', baseRef(card), base]);
  syncCopyModules({ repo, folder, install });
  return { folder, base, fresh: true };
}

export function closeCopy({ repo, card, env = process.env }) {
  const folder = copyFolder(card, env);
  const had = existsSync(folder);
  if (had) {
    try {
      git(repo, ['fetch', '--quiet', '--no-tags', folder, `+${branch(card)}:${branch(card)}`]);
    } catch {
    }
  }
  rmSync(folder, { recursive: true, force: true });
  try {
    git(repo, ['worktree', 'prune']);
    git(repo, ['update-ref', '-d', baseRef(card)]);
  } catch {
  }
  return had;
}
