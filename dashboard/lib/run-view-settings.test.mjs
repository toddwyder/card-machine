import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRunViewSettings } from './run-view-settings.mjs';

test('the three warning limits come from one settings file', () => {
  assert.deepEqual(readRunViewSettings(), { stuckAfterMs: 420000, quotaLowPercent: 20, burningFastTokens: 100000 });
});

test('a settings file missing a limit is refused rather than defaulted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-view-settings-'));
  const file = join(dir, 'run-view.json');
  writeFileSync(file, JSON.stringify({ stuckAfterMs: 420000, quotaLowPercent: 20 }));
  assert.throws(() => readRunViewSettings(file), /burningFastTokens/);
  rmSync(dir, { recursive: true, force: true });
});
