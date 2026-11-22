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
  for (const rel of [
    'machine/flow/planted.mjs',
    'machine/merge/planted.mjs',
    'machine/remediation/planted.mjs',
    'machine/shipping/planted.mjs',
    'scripts/planted.test.mjs',
  ]) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), `import { read } from '../../${'julia'}-next/lib/recipes.js';\n`);
  }

  const failures = checkNoJuliaReach(dir);
  assert.match(failures.join('\n'), /machine\/flow\/planted\.mjs:1:/);
  assert.match(failures.join('\n'), /machine\/merge\/planted\.mjs:1:/);
  assert.match(failures.join('\n'), /machine\/remediation\/planted\.mjs:1:/);
  assert.match(failures.join('\n'), /machine\/shipping\/planted\.mjs:1:/);
  assert.match(failures.join('\n'), /scripts\/planted\.test\.mjs:1:/);
  assert.match(failures.join('\n'), new RegExp(`${'julia'}-next`));
});

test('a sibling import inside the dashboard is not a reach', t => {
  const dir = mkdtempSync(join(tmpdir(), 'no-julia-reach-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'dashboard/app/api/run-view'), { recursive: true });
  writeFileSync(
    join(dir, 'dashboard/app/api/run-view/route.js'),
    "import { read } from '../../../lib/run-view-server.mjs';\n",
  );
  writeFileSync(join(dir, 'dashboard/app/page.jsx'), "import { read } from '../lib/run-view-server.mjs';\n");

  assert.deepEqual(checkNoJuliaReach(dir), []);
});

test('a sibling import that climbs past the repository root fails', t => {
  const dir = mkdtempSync(join(tmpdir(), 'no-julia-reach-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib/planted.mjs'), "import { read } from '../../lib/recipes.js';\n");

  const failures = checkNoJuliaReach(dir);
  assert.match(failures.join('\n'), /lib\/planted\.mjs:1: relative import past the repository root/);
});
