import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkNoJuliaReach } from './check-no-julia-reach.mjs';

const repoRoot = join(import.meta.dirname, '..');

test('repository has no reach into Julia repository', () => {
  assert.deepEqual(checkNoJuliaReach(repoRoot), []);
});

test('planted reach into Julia repository fails and names the reach', t => {
  const dir = mkdtempSync(join(tmpdir(), 'no-julia-reach-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'machine', 'flow'), { recursive: true });
  const planted = `import { read } from '../../${'julia'}-next/lib/recipes.js';\n`;
  writeFileSync(join(dir, 'machine', 'flow', 'planted.mjs'), planted);

  const failures = checkNoJuliaReach(dir);
  assert.equal(failures.length > 0, true);
  assert.match(failures.join('\n'), /machine\/flow\/planted\.mjs:1:/);
  assert.match(failures.join('\n'), new RegExp(`${'julia'}-next`));
});
