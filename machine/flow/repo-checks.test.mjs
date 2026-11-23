import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildCheckPlan, isDocsOnly, runRepoChecks } from './repo-checks.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function tempRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'repo-checks-'));
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  writeFileSync(join(dir, 'renovate.json'), '{}\n');
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'init']);
  const base = git(dir, ['rev-parse', 'HEAD']);
  return { dir, base };
}

test('isDocsOnly returns true only when all changed files are markdown', () => {
  assert.equal(isDocsOnly([]), false);
  assert.equal(isDocsOnly(['README.md', 'docs/guide.md']), true);
  assert.equal(isDocsOnly(['README.md', 'machine/flow/steps.mjs']), false);
});

test('buildCheckPlan omits check-branch-pr and skips package-tests/web for docs-only changes', () => {
  const docsPlan = buildCheckPlan({ hasRenovate: true, docsOnly: true });
  assert.equal(docsPlan.some(s => s.command.includes('check-branch-pr')), false);
  assert.equal(docsPlan.some(s => s.command.includes('test-owners')), false);
  assert.equal(docsPlan.some(s => s.command.includes('guard:flow')), false);
  assert.equal(docsPlan.some(s => s.command.includes('machine-programs')), true);

  const codePlan = buildCheckPlan({ hasRenovate: true, docsOnly: false });
  assert.equal(codePlan.some(s => s.command.includes('check-branch-pr')), false);
  assert.equal(codePlan.some(s => s.command.includes('test-owners.mjs --run local')), true);
  assert.equal(codePlan.some(s => s.command.includes('guard:flow')), true);
  assert.equal(codePlan.some(s => s.command.includes('guard:boundaries')), true);
});

test('runRepoChecks skips when no files changed, fails on uncommitted changes, and stops on first failing check with output', async t => {
  const { dir, base } = tempRepo(t);

  const noChanges = await runRepoChecks({ checkout: dir, base, lock: null });
  assert.deepEqual(noChanges, { ok: true, skipped: true, docsOnly: false, files: [] });

  writeFileSync(join(dir, 'dirty.txt'), 'uncommitted\n');
  const dirty = await runRepoChecks({ checkout: dir, base, lock: null });
  assert.equal(dirty.ok, false);
  assert.match(dirty.reason, /uncommitted changes/i);
  rmSync(join(dir, 'dirty.txt'));

  writeFileSync(join(dir, 'app.mjs'), 'export const x = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'add app']);

  const ran = [];
  const failResult = await runRepoChecks({
    checkout: dir,
    base,
    lock: null,
    syncModules: false,
    runStep: async (step) => {
      ran.push(step.name);
      if (step.command.includes('check-skill-names')) {
        return { ok: false, output: 'Duplicate skill name: dup' };
      }
      return { ok: true, output: '' };
    },
  });
  assert.equal(failResult.ok, false);
  assert.match(failResult.reason, /Check skill names are unique/);
  assert.match(failResult.reason, /Duplicate skill name: dup/);
  assert.equal(ran.includes('Guard the workflow folder'), false);

  const passResult = await runRepoChecks({
    checkout: dir,
    base,
    lock: null,
    syncModules: false,
    runStep: async () => ({ ok: true, output: '' }),
  });
  assert.equal(passResult.ok, true);
  assert.equal(passResult.docsOnly, false);
});
