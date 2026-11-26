#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readlinkSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { statfsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_TARGET_GB = 20;

const CACHE_DIRS = [
  { id: 'npm-cache', what: 'npm package cache', path: '/home/ubuntu/.npm/_cacache' },
  { id: 'uv-cache', what: 'uv package cache', path: '/home/ubuntu/.cache/uv' },
  { id: 'firebase-cache', what: 'Firebase CLI cache', path: '/home/ubuntu/.cache/firebase' },
];

const PLAYWRIGHT_DIR = '/home/ubuntu/.cache/ms-playwright';
const TMP_DIR = '/tmp';
const TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TMP_KEEP = new Set(['mc']);
const TMP_KEEP_PREFIX = 'systemd-private-';
const MASTRACODE_TRACE_DB = '/home/ubuntu/.local/share/mastracode/observability.duckdb';
const MASTRACODE_TRACE_MAX_MB = 2048;

export function fileIsHeld(path) {
  const targets = [path, `${path}-wal`];
  const myUid = process.getuid?.() ?? null;
  let pids = [];
  try {
    pids = readdirSync('/proc').filter(name => /^\d+$/.test(name));
  } catch {
    return true;
  }
  for (const pid of pids) {
    let fds = [];
    try {
      // The files this guard protects live in this user's home, so only this user's processes can
      // hold them open. Another account's file descriptors are not a reason to keep one forever.
      if (myUid !== null && statSync(`/proc/${pid}`).uid !== myUid) continue;
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      // A process that hides its own descriptors (sshd, sudo, anything setuid or non-dumpable) is not
      // the Mastra Code session that would hold this store, so its silence is not a reason to keep it.
      continue;
    }
    for (const fd of fds) {
      let link;
      try {
        link = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      if (targets.includes(link)) return true;
    }
  }
  return false;
}

function defaultRun(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function readFreeBytes(statfs = () => statfsSync('/')) {
  const disk = statfs();
  return Number(disk.bavail) * Number(disk.bsize);
}

export function parseSizeMb(text) {
  const match = String(text).trim().match(/^([\d.]+)\s*([kmgt]?b)$/i);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor = { b: 1 / 1_000_000, kb: 1 / 1000, mb: 1, gb: 1000, tb: 1_000_000 }[unit] ?? 1;
  return Math.round(value * factor);
}

function tagTime(tag) {
  const match = String(tag).match(/(\d{8})T(\d{6})Z/);
  if (!match) return 0;
  const [, day, time] = match;
  return Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  );
}

export function supersededRollbacks(images) {
  const byRepo = new Map();
  for (const image of images) {
    if (image.tag === '<none>' || !/-before-/.test(image.tag)) continue;
    const list = byRepo.get(image.repository) ?? [];
    list.push(image);
    byRepo.set(image.repository, list);
  }
  const superseded = [];
  for (const list of byRepo.values()) {
    const sorted = [...list].sort((a, b) => (tagTime(b.tag) || b.createdMs) - (tagTime(a.tag) || a.createdMs));
    superseded.push(...sorted.slice(1));
  }
  return superseded;
}

export function readDockerImages(run = defaultRun) {
  const raw = run('sudo', ['-n', 'docker', 'image', 'ls', '--format', '{{json .}}']);
  return raw
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const entry = JSON.parse(line);
      return {
        repository: entry.Repository,
        tag: entry.Tag,
        id: entry.ID,
        createdMs: Date.parse(entry.CreatedAt) || 0,
        sizeMb: parseSizeMb(entry.Size),
      };
    });
}

export function readDockerUsedImages(run = defaultRun) {
  const ids = run('sudo', ['-n', 'docker', 'ps', '-aq'])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const byId = ids.length === 0
    ? []
    : run('sudo', ['-n', 'docker', 'inspect', '--format', '{{.Image}}', ...ids])
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  const byName = run('sudo', ['-n', 'docker', 'ps', '-a', '--format', '{{.Image}}'])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  return [...byId, ...byName];
}

export function unusedImages(images, usedRefs) {
  const short = id => String(id).replace(/^sha256:/, '').slice(0, 12);
  return images.filter(image => {
    if (image.tag === '<none>') return false;
    if (/-before-/.test(image.tag)) return false;
    const name = `${image.repository}:${image.tag}`;
    return !usedRefs.some(ref => ref === name || short(ref) === short(image.id));
  });
}

export function readDockerBuildCacheMb(run = defaultRun) {
  const raw = run('sudo', ['-n', 'docker', 'system', 'df', '--format', '{{json .}}']);
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (entry.Type === 'Build Cache') return parseSizeMb(entry.Size);
  }
  return 0;
}

function duMb(path, run = defaultRun) {
  if (!existsSync(path)) return 0;
  try {
    return Number(run('du', ['-sm', path]).split(/\s+/)[0]) || 0;
  } catch {
    return 0;
  }
}

function oldPlaywrightBrowsers(nowMs, playwrightDir = PLAYWRIGHT_DIR) {
  if (!existsSync(playwrightDir)) return [];
  const families = new Map();
  for (const name of readdirSync(playwrightDir)) {
    const match = name.match(/^(.+)-(\d+)$/);
    if (!match) continue;
    const [, family, build] = match;
    const list = families.get(family) ?? [];
    list.push({ name, family, build: Number(build) });
    families.set(family, list);
  }
  const stale = [];
  for (const list of families.values()) {
    const newest = Math.max(...list.map(entry => entry.build));
    for (const entry of list) if (entry.build !== newest) stale.push(join(playwrightDir, entry.name));
  }
  return stale.filter(() => nowMs > 0);
}

function oldTmpEntries(nowMs, tmpDir = TMP_DIR) {
  if (!existsSync(tmpDir)) return [];
  const stale = [];
  for (const name of readdirSync(tmpDir)) {
    // The socket folder belongs to Mastra Code, and a systemd private folder belongs to a live service.
    if (TMP_KEEP.has(name) || name.startsWith(TMP_KEEP_PREFIX)) continue;
    const path = join(tmpDir, name);
    try {
      const stats = statSync(path);
      if (nowMs - stats.mtimeMs > TMP_MAX_AGE_MS) stale.push(path);
    } catch {
      // A file that vanishes mid-scan is already gone.
    }
  }
  return stale;
}

function removeQuietly(path) {
  try {
    rmSync(path, { recursive: true, force: true });
    return 'removed';
  } catch (error) {
    return `skipped ${error.code ?? error.message}`;
  }
}

function dockerCommand(run, args) {
  try {
    return run('sudo', ['-n', 'docker', ...args]);
  } catch (error) {
    return `docker failed: ${error.message.split('\n')[0]}`;
  }
}

export function planReclaim({
  run = defaultRun,
  now = Date.now(),
  docker = true,
  cacheDirs = CACHE_DIRS,
  playwrightDir = PLAYWRIGHT_DIR,
  tmpDir = TMP_DIR,
  traceStorePath = MASTRACODE_TRACE_DB,
  traceMaxMb = MASTRACODE_TRACE_MAX_MB,
  isHeld = fileIsHeld,
} = {}) {
  const steps = [];
  if (docker) {
    try {
      const images = readDockerImages(run);
      const superseded = supersededRollbacks(images);
      steps.push({
        id: 'docker-build-cache',
        what: 'Docker build cache',
        sizeMb: readDockerBuildCacheMb(run),
        always: true,
        action: () => dockerCommand(run, ['builder', 'prune', '-af']),
      });
      steps.push({
        id: 'docker-dangling',
        what: 'Docker dangling images',
        sizeMb: 0,
        always: true,
        action: () => dockerCommand(run, ['image', 'prune', '-f']),
      });
      steps.push({
        id: 'docker-superseded',
        what: `Docker superseded rollback images (${superseded.map(image => `${image.repository}:${image.tag}`).join(', ') || 'none'})`,
        sizeMb: superseded.reduce((acc, image) => acc + image.sizeMb, 0),
        always: true,
        action: () => (superseded.length === 0
          ? 'nothing to remove'
          : dockerCommand(run, ['rmi', ...superseded.map(image => image.id)])),
      });
      const unused = unusedImages(images, readDockerUsedImages(run));
      steps.push({
        id: 'docker-unused-images',
        what: `Docker images no container uses and no rollback needs (${unused.map(image => `${image.repository}:${image.tag}`).join(', ') || 'none'})`,
        sizeMb: unused.reduce((acc, image) => acc + image.sizeMb, 0),
        always: true,
        action: () => (unused.length === 0
          ? 'nothing to remove'
          : dockerCommand(run, ['rmi', ...unused.map(image => image.id)])),
      });
    } catch (error) {
      steps.push({ id: 'docker-unavailable', what: `Docker cleanup unavailable (${error.message.split('\n')[0]})`, sizeMb: 0, always: true, action: () => 'skipped' });
    }
  }
  for (const cache of cacheDirs) {
    steps.push({
      id: cache.id,
      what: cache.what,
      sizeMb: duMb(cache.path, run),
      always: false,
      action: () => removeQuietly(cache.path),
    });
  }
  const playwrightStale = oldPlaywrightBrowsers(now, playwrightDir);
  steps.push({
    id: 'playwright-old-browsers',
    what: `Superseded Playwright browser builds (${playwrightStale.map(path => path.split('/').pop()).join(', ') || 'none'})`,
    sizeMb: playwrightStale.reduce((acc, path) => acc + duMb(path, run), 0),
    always: false,
    action: () => {
      for (const path of playwrightStale) removeQuietly(path);
      return 'removed';
    },
  });
  const traceStoreMb = duMb(traceStorePath, run);
  const traceStoreHeld = existsSync(traceStorePath) && isHeld(traceStorePath);
  steps.push({
    id: 'mastracode-trace-store',
    what: `Mastra Code local trace store above ${traceMaxMb} MB with no session holding it (${traceStoreMb} MB${traceStoreHeld ? ', in use now' : ''})`,
    sizeMb: traceStoreMb > traceMaxMb && !traceStoreHeld ? traceStoreMb : 0,
    always: true,
    action: () => {
      if (traceStoreHeld) return 'kept: a live Mastra Code session holds the store';
      if (traceStoreMb <= traceMaxMb) return 'kept: under the size ceiling';
      return removeQuietly(traceStorePath);
    },
  });
  const tmpStale = oldTmpEntries(now, tmpDir);
  steps.push({
    id: 'tmp-old-entries',
    what: `Scratch files in /tmp older than 24h (${tmpStale.length} entries)`,
    sizeMb: tmpStale.reduce((acc, path) => acc + duMb(path, run), 0),
    always: false,
    action: () => {
      for (const path of tmpStale) removeQuietly(path);
      return 'removed';
    },
  });
  return steps;
}

export function reclaimDisk({
  targetGb = DEFAULT_TARGET_GB,
  run = defaultRun,
  statfs = () => statfsSync('/'),
  now = Date.now(),
  docker = true,
  cacheDirs,
  playwrightDir,
  tmpDir,
  traceStorePath,
  traceMaxMb,
  isHeld,
  onStep = () => {},
} = {}) {
  const targetBytes = targetGb * 1_000_000_000;
  const freeBefore = readFreeBytes(statfs);
  const steps = planReclaim({ run, now, docker, cacheDirs, playwrightDir, tmpDir, traceStorePath, traceMaxMb, isHeld });
  const results = [];
  for (const step of steps) {
    const free = readFreeBytes(statfs);
    if (!step.always && free >= targetBytes) {
      results.push({ id: step.id, what: step.what, sizeMb: step.sizeMb, ran: false, freedMb: 0 });
      continue;
    }
    const output = step.action();
    const freedMb = Math.max(0, Math.round((readFreeBytes(statfs) - free) / 1_000_000));
    results.push({ id: step.id, what: step.what, sizeMb: step.sizeMb, ran: true, freedMb, output });
    onStep(results.at(-1));
  }
  return { freeBeforeBytes: freeBefore, freeAfterBytes: readFreeBytes(statfs), targetGb, steps: results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    const plan = planReclaim();
    let total = 0;
    for (const step of plan) {
      total += step.sizeMb;
      console.log(`- [${step.id}] ${step.what}: ${step.sizeMb} MB`);
    }
    const free = readFreeBytes();
    console.log(`Free now: ${(free / 1_000_000_000).toFixed(2)} GB`);
    console.log(`Projected free after reclaim: ${((free + total * 1_000_000) / 1_000_000_000).toFixed(2)} GB`);
  } else {
    const result = reclaimDisk({ onStep: step => console.log(`- ${step.what}: freed ${step.freedMb} MB`) });
    console.log(JSON.stringify({ freeBeforeBytes: result.freeBeforeBytes, freeAfterBytes: result.freeAfterBytes }));
  }
}
