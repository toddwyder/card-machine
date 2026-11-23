import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkMemoryRecord, isMemoryWatchEnabled, lowestFreeRam } from './memory-watch.mjs';

test('isMemoryWatchEnabled enables under Studio service or explicit FLOW_MEMORY_WATCH_DIR unless off', () => {
  assert.equal(isMemoryWatchEnabled({ env: {}, unit: 'card-machine-studio.service' }), true);
  assert.equal(isMemoryWatchEnabled({ env: {}, unit: 'card-machine-self-studio.service' }), true);
  assert.equal(isMemoryWatchEnabled({ env: { FLOW_MEMORY_WATCH_DIR: '/tmp/mw' }, unit: null }), true);
  assert.equal(isMemoryWatchEnabled({ env: { FLOW_MEMORY_WATCH_DIR: 'off' }, unit: 'card-machine-studio.service' }), false);
  assert.equal(isMemoryWatchEnabled({ env: {}, unit: null }), false);
});

test('checkMemoryRecord fails when directory is missing or latest sample is stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-check-'));
  try {
    const missing = checkMemoryRecord({ dir: join(dir, 'nope'), now: Date.parse('2026-11-23T01:00:00Z') });
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /memory record is stopped/i);

    const logDir = join(dir, 'mw');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, '2026-11.jsonl'), '{"t":"2026-11-23T00:00:30Z","mem":{"avail":6271295488}}\n');
    const stale = checkMemoryRecord({ dir: logDir, now: Date.parse('2026-11-23T02:00:00Z') });
    assert.equal(stale.ok, false);
    assert.match(stale.reason, /memory record is stopped/i);
    assert.match(stale.reason, /2026-11-23T00:00:30Z/);

    const fresh = checkMemoryRecord({ dir: logDir, now: Date.parse('2026-11-23T00:00:40Z') });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.latestAt, '2026-11-23T00:00:30Z');
    assert.equal(fresh.availableMb, Math.floor(6271295488 / (1024 * 1024)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lowestFreeRam returns the lowest available memory sample within the run window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-low-'));
  try {
    writeFileSync(join(dir, '2026-11.jsonl'), [
      JSON.stringify({ t: '2026-11-23T00:59:50Z', mem: { avail: 1000 * 1024 * 1024 } }),
      JSON.stringify({ t: '2026-11-23T01:00:00Z', mem: { avail: 5000 * 1024 * 1024 } }),
      JSON.stringify({ t: '2026-11-23T01:00:10Z', mem: { avail: 3200 * 1024 * 1024 } }),
      JSON.stringify({ t: '2026-11-23T01:00:20Z', mem: { avail: 4100 * 1024 * 1024 } }),
      JSON.stringify({ t: '2026-11-23T01:05:00Z', mem: { avail: 500 * 1024 * 1024 } }),
    ].join('\n') + '\n');

    const result = lowestFreeRam({
      dir,
      since: '2026-11-23T01:00:00Z',
      until: '2026-11-23T01:01:00Z',
    });
    assert.deepEqual(result, {
      lowestMb: 3200,
      at: '2026-11-23T01:00:10Z',
      samples: 3,
    });
    assert.equal(lowestFreeRam({ dir, since: '2026-11-23T02:00:00Z', until: '2026-11-23T02:05:00Z' }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
