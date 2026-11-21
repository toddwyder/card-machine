import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { closeCopy, copyFolder, copiesRoot, findLeftoverWork, openCopy, startedFrom } from './copy.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function studio(t) {
  const dir = mkdtempSync(join(tmpdir(), 'copy-case-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'studio');
  mkdirSync(repo);
  writeFileSync(join(repo, 'README.md'), 'studio\n');
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.email=copy@test', '-c', 'user.name=copy', 'commit', '--quiet', '-m', 'main']);
  return { dir, repo, env: { FLOW_SCRATCH: join(dir, 'scratch') } };
}

test('a card’s copy goes when the card ends and the studio repository never holds it', t => {
  const { repo, env } = studio(t);
  const copy = openCopy({ repo, card: 'JUL-402', env });
  writeFileSync(join(copy.folder, 'pushed.txt'), 'the build’s work\n');
  git(copy.folder, ['add', '-A']);
  git(copy.folder, ['-c', 'user.email=helper@test', '-c', 'user.name=helper', 'commit', '--quiet', '-m', 'the work']);

  assert.equal(git(copy.folder, ['rev-parse', '--show-toplevel']), copy.folder, 'the copy is its own repository');
  assert.equal(existsSync(join(copy.folder, '.git', 'HEAD')), true, 'so the helpers can commit inside their jail');
  assert.equal(git(repo, ['branch', '--list', 'card/JUL-402']), '', 'the studio repository grows no card branch while the card works');
  assert.equal(git(repo, ['worktree', 'list']).includes('JUL-402'), false, 'and knows no card worktree');

  assert.equal(closeCopy({ repo, card: 'JUL-402', env }), true);
  assert.equal(existsSync(copy.folder), false);
  assert.equal(git(repo, ['show', 'card/JUL-402:pushed.txt']).trim(), 'the build’s work', 'the work stays with the branch for the pull request');
  assert.equal(closeCopy({ repo, card: 'JUL-402', env }), false, 'closing twice is quiet');
});

test('a helper commits in the copy without touching the studio repository', t => {
  const { repo, env } = studio(t);
  const copy = openCopy({ repo, card: 'JUL-405', env });
  const before = git(repo, ['rev-parse', 'main']);

  writeFileSync(join(copy.folder, 'work.txt'), 'done\n');
  git(copy.folder, ['add', '-A']);
  git(copy.folder, ['-c', 'user.email=helper@test', '-c', 'user.name=helper', 'commit', '--quiet', '-m', 'the helper’s work']);

  assert.equal(git(copy.folder, ['rev-parse', '--abbrev-ref', 'HEAD']), 'card/JUL-405');
  assert.notEqual(git(copy.folder, ['rev-parse', 'HEAD']), before);
  assert.equal(git(repo, ['rev-parse', 'main']), before, 'the studio main branch stays where it was');
});

test('a card name that is not a plain word still gets a usable folder and branch', t => {
  const { repo, env } = studio(t);
  const copy = openCopy({ repo, card: 'JUL 403/a', env });

  assert.equal(copyFolder('JUL 403/a', env), join(copiesRoot(env), 'JUL-403-a'));
  assert.equal(existsSync(copy.folder), true);
  assert.equal(git(copy.folder, ['branch', '--list', 'card/JUL-403-a']).includes('card/JUL-403-a'), true);
});

test('a repository with no main branch says so instead of making an empty copy', t => {
  const dir = mkdtempSync(join(tmpdir(), 'copy-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '--quiet', '--initial-branch=main']);

  assert.throws(() => startedFrom(dir), /has no main branch/);
});

test('a repository whose origin fetch fails throws instead of using a stale main', t => {
  const { repo } = studio(t);
  git(repo, ['remote', 'add', 'origin', join(repo, 'missing-remote')]);

  assert.throws(() => startedFrom(repo), /Failed to fetch latest main from origin/);
});

test('a card with an existing remote branch is refused before creating a diverging worktree', t => {
  const { dir, repo, env } = studio(t);
  const origin = join(dir, 'origin.git');
  git(dir, ['clone', '--bare', '--quiet', repo, origin]);
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['branch', 'card/JUL-404']);
  git(repo, ['push', '--quiet', 'origin', 'card/JUL-404']);
  git(repo, ['branch', '-D', 'card/JUL-404']);

  const reason = findLeftoverWork({ repo, card: 'JUL-404', findPr: () => ({ pr: 534 }), env });
  assert.match(reason, /card\/JUL-404 already exists on origin/);
  assert.match(reason, /open pull request #534/);
  assert.throws(() => openCopy({ repo, card: 'JUL-404', env }), /Leftover work on GitHub for JUL-404/);
});
