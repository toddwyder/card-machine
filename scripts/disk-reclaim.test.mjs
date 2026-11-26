import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseSizeMb, planReclaim, reclaimDisk, supersededRollbacks } from './disk-reclaim.mjs';

function fixturePaths() {
  const root = mkdtempSync(join(tmpdir(), 'reclaim-test-'));
  const cache = join(root, 'npm-cache');
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, 'entry'), 'x');
  const playwright = join(root, 'ms-playwright');
  mkdirSync(join(playwright, 'chromium-1243'), { recursive: true });
  mkdirSync(join(playwright, 'chromium-1255'), { recursive: true });
  const tmp = join(root, 'tmp');
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'old-file'), 'x');
  return {
    root,
    cacheDirs: [{ id: 'npm-cache', what: 'npm package cache', path: cache }],
    playwrightDir: playwright,
    tmpDir: tmp,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const IMAGES = [
  { repository: 'moneypenny-web', tag: 'latest', id: 'sha256:latest', createdMs: 0, sizeMb: 2490 },
  { repository: 'moneypenny-web', tag: 'live-before-savefix-20261126T153216Z', id: 'sha256:new', createdMs: 0, sizeMb: 2490 },
  { repository: 'moneypenny-web', tag: 'live-before-main-sync-20261126T073906Z', id: 'sha256:old', createdMs: 0, sizeMb: 2480 },
  { repository: 'moneypenny-web', tag: 'live-before-pr6-20261126T065901Z', id: 'sha256:older', createdMs: 0, sizeMb: 2450 },
  { repository: 'pgvector/pgvector', tag: 'pg16', id: 'sha256:pg', createdMs: 0, sizeMb: 647 },
];

function fakeRun({ free } = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args].join(' '));
    if (command === 'du') return '120\t/home/ubuntu/.cache/thing\n';
    if (args.includes('image') && args.includes('ls')) return IMAGES.map(image => JSON.stringify({
      Repository: image.repository,
      Tag: image.tag,
      ID: image.id,
      CreatedAt: '2026-11-26 07:39:06 +0000 UTC',
      Size: `${(image.sizeMb / 1000).toFixed(2)}GB`,
    })).join('\n');
    if (args.includes('system') && args.includes('df')) {
      return ['{"Type":"Images","Size":"10.65GB"}', '{"Type":"Build Cache","Size":"6.642GB"}'].join('\n');
    }
    if (free && (args.includes('prune') || args.includes('rmi'))) free.bytes += 3_000_000_000;
    return '';
  };
  return { run, calls };
}

test('parseSizeMb reads docker and du size strings', () => {
  assert.equal(parseSizeMb('2.49GB'), 2490);
  assert.equal(parseSizeMb('647MB'), 647);
  assert.equal(parseSizeMb('1.2kB'), 0);
  assert.equal(parseSizeMb('nonsense'), 0);
});

test('supersededRollbacks keeps the newest rollback tag per repository', () => {
  const superseded = supersededRollbacks(IMAGES);
  assert.deepEqual(superseded.map(image => image.id).sort(), ['sha256:old', 'sha256:older']);
});

test('planReclaim measures sizes without deleting anything', () => {
  const { run, calls } = fakeRun();
  const steps = planReclaim({ run, now: Date.now(), docker: true, ...fixturePaths() });
  const byId = new Map(steps.map(step => [step.id, step]));

  assert.equal(byId.size > 0, true);
  assert.ok(steps.some(step => step.id === 'docker-build-cache' && step.sizeMb === 6642));
  assert.ok(steps.some(step => step.id === 'docker-superseded' && step.sizeMb === 4930));
  assert.ok(calls.every(call => !call.includes('prune')), 'planning must not prune');
  assert.ok(calls.every(call => !call.includes('rmi')), 'planning must not remove images');
});

test('reclaimDisk runs the docker steps and leaves package caches alone once the target is met', () => {
  const fixture = fixturePaths();
  const free = { bytes: 30_000_000_000 };
  const { run, calls } = fakeRun({ free });
  const statfs = () => ({ bavail: free.bytes / 1000, bfree: free.bytes / 1000, blocks: 80_000_000, bsize: 1000 });

  const result = reclaimDisk({ targetGb: 20, run, statfs, now: Date.now(), docker: true, ...fixture });

  assert.equal(result.steps.find(step => step.id === 'docker-build-cache').ran, true);
  assert.equal(result.steps.find(step => step.id === 'docker-superseded').ran, true);
  const cacheSteps = result.steps.filter(step => !step.id.startsWith('docker') && step.id !== 'mastracode-trace-store');
  assert.ok(cacheSteps.every(step => step.ran === false), 'package caches and /tmp stay when the target is met');
  assert.deepEqual(readdirSync(fixture.cacheDirs[0].path), ['entry']);
  assert.ok(calls.some(call => call.includes('builder prune -af')));
  fixture.cleanup();
});

test('removes the Mastra Code trace store only when no session holds it and it is over the ceiling', () => {
  const root = mkdtempSync(join(tmpdir(), 'reclaim-trace-'));
  const tracePath = join(root, 'observability.duckdb');
  writeFileSync(tracePath, 'x'.repeat(1024));
  const run = (command, args) => {
    if (command === 'du') return '14000\t' + args.at(-1) + '\n';
    return '';
  };

  const held = planReclaim({ run, docker: false, traceStorePath: tracePath, traceMaxMb: 2048, isHeld: () => true, ...fixturePaths() });
  const heldStep = held.find(step => step.id === 'mastracode-trace-store');
  assert.equal(heldStep.sizeMb, 0);
  assert.match(heldStep.action(), /live Mastra Code session holds the store/);
  assert.equal(existsSync(tracePath), true, 'a held store stays put');

  const idle = planReclaim({ run, docker: false, traceStorePath: tracePath, traceMaxMb: 2048, isHeld: () => false, ...fixturePaths() });
  const idleStep = idle.find(step => step.id === 'mastracode-trace-store');
  assert.equal(idleStep.sizeMb, 14000);
  assert.equal(idleStep.action(), 'removed');
  assert.equal(existsSync(tracePath), false, 'an idle store over the ceiling is deleted');
  rmSync(root, { recursive: true, force: true });
});

test('reclaimDisk falls through to caches and /tmp while free space is under the target', () => {
  const fixture = fixturePaths();
  const free = { bytes: 5_000_000_000 };
  const { run } = fakeRun({ free });
  const statfs = () => ({ bavail: free.bytes / 1000, bfree: free.bytes / 1000, blocks: 80_000_000, bsize: 1000 });

  const result = reclaimDisk({
    targetGb: 20,
    run,
    statfs,
    now: Date.now() + 48 * 60 * 60 * 1000,
    docker: true,
    traceStorePath: join(fixture.root, 'no-trace.duckdb'),
    isHeld: () => true,
    ...fixture,
  });

  assert.equal(result.steps.find(step => step.id === 'npm-cache').ran, true);
  assert.equal(result.steps.find(step => step.id === 'playwright-old-browsers').ran, true);
  assert.equal(result.steps.find(step => step.id === 'tmp-old-entries').ran, true);
  assert.deepEqual(readdirSync(fixture.playwrightDir), ['chromium-1255']);
  assert.deepEqual(readdirSync(fixture.tmpDir), []);
  fixture.cleanup();
});

test('the /tmp sweep never touches the Mastra Code socket folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'reclaim-tmp-'));
  const keep = join(root, 'mc');
  mkdirSync(keep, { recursive: true });
  writeFileSync(join(keep, 'socket'), 'x');
  const stale = join(root, 'old-file');
  writeFileSync(stale, 'x');
  const run = (command, args) => (command === 'du' ? '1\t' + args.at(-1) + '\n' : '');

  const steps = planReclaim({ run, docker: false, cacheDirs: [], tmpDir: root, now: Date.now() + 48 * 60 * 60 * 1000 });
  steps.find(step => step.id === 'tmp-old-entries').action();

  assert.equal(existsSync(join(keep, 'socket')), true, '/tmp/mc stays');
  assert.equal(existsSync(stale), false, 'an ordinary old entry goes');
  rmSync(root, { recursive: true, force: true });
});
