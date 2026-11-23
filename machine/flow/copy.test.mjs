import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { closeCopy, copyFolder, copiesRoot, findLeftoverWork, openCopy, selectInstaller, startedFrom, syncCopyModules } from './copy.mjs';

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

test('a card whose dependency list differs from main installs once per change and reuses the result', t => {
  const { repo, env } = studio(t);
  writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ name: 'app', lockfileVersion: 3, packages: {} }));
  mkdirSync(join(repo, 'node_modules'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', '.package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));
  git(repo, ['add', 'package-lock.json']);
  git(repo, ['-c', 'user.email=copy@test', '-c', 'user.name=copy', 'commit', '--quiet', '-m', 'lock']);

  let installs = 0;
  const fakeInstall = treeDir => {
    installs += 1;
    mkdirSync(join(treeDir, 'node_modules', 'demo-lib'), { recursive: true });
    writeFileSync(join(treeDir, 'node_modules', '.package-lock.json'), '{"lockfileVersion":3}');
    writeFileSync(join(treeDir, 'node_modules', 'demo-lib', 'index.js'), `module.exports = ${installs};\n`);
  };

  // Same lockfile as main: hardlinks (or copies) main's modules with zero installs.
  const copy = openCopy({ repo, card: 'JUL-361-DEPS', env, install: fakeInstall });
  assert.equal(installs, 0, 'matching lockfile must not run an installer');

  // Card changes its dependency list: installs once.
  writeFileSync(join(copy.folder, 'package-lock.json'), JSON.stringify({ name: 'app', lockfileVersion: 3, packages: { 'node_modules/demo-lib': { version: '1.0.0' } } }));
  openCopy({ repo, card: 'JUL-361-DEPS', env, install: fakeInstall });
  assert.equal(installs, 1, 'differing lockfile installs once');
  assert.equal(existsSync(join(copy.folder, 'node_modules', 'demo-lib', 'index.js')), true);

  // Opening again without another dependency change does not reinstall.
  openCopy({ repo, card: 'JUL-361-DEPS', env, install: fakeInstall });
  assert.equal(installs, 1, 'unchanged lockfile reuses installed modules');

  // Changing the dependency list a second time installs once more.
  writeFileSync(join(copy.folder, 'package-lock.json'), JSON.stringify({ name: 'app', lockfileVersion: 3, packages: { 'node_modules/demo-lib': { version: '2.0.0' } } }));
  openCopy({ repo, card: 'JUL-361-DEPS', env, install: fakeInstall });
  assert.equal(installs, 2, 'second dependency change installs once more');
});

test('selectInstaller picks bun on PATH, falls back to HOME/.bun/bin/bun, and falls back to npm when absent', { skip: process.platform === 'win32' }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'copy-installer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pathBin = join(dir, 'path-bin');
  const homeDir = join(dir, 'home');
  const homeBunDir = join(homeDir, '.bun', 'bin');
  mkdirSync(pathBin, { recursive: true });
  mkdirSync(homeBunDir, { recursive: true });

  const stub = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "1.4.5"; exit 0; fi\nexit 0\n';
  writeFileSync(join(pathBin, 'bun'), stub, { mode: 0o755 });
  writeFileSync(join(homeBunDir, 'bun'), stub, { mode: 0o755 });

  const fromPath = selectInstaller({ PATH: pathBin, HOME: dir });
  assert.equal(fromPath.command, 'bun');
  assert.deepEqual(fromPath.args, ['install', '--frozen-lockfile']);

  const fromHome = selectInstaller({ PATH: '/nonexistent', HOME: homeDir });
  assert.equal(fromHome.command, join(homeBunDir, 'bun'));
  assert.deepEqual(fromHome.args, ['install', '--frozen-lockfile']);

  const fallback = selectInstaller({ PATH: '/nonexistent', HOME: dir });
  assert.equal(fallback.command, 'npm');
  assert.deepEqual(fallback.args, ['ci', '--include=dev', '--no-audit', '--no-fund']);
  assert.equal(fallback.env.npm_config_omit, '');
  assert.match(fallback.env.NODE_OPTIONS, /--max-old-space-size=2048/);
});

test('syncCopyModules runs bun install --frozen-lockfile when bun is available and clears hardlinked modules without touching main', { skip: process.platform === 'win32' }, t => {
  const { dir, repo, env } = studio(t);
  writeFileSync(join(repo, 'package.json'), '{"name":"app"}\n');
  writeFileSync(join(repo, 'package-lock.json'), '{"lockfileVersion":3,"v":1}\n');
  mkdirSync(join(repo, 'node_modules', 'main-only'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', '.package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(repo, 'node_modules', 'main-only', 'index.js'), 'module.exports = "main";\n');
  git(repo, ['add', 'package.json', 'package-lock.json']);
  git(repo, ['-c', 'user.email=copy@test', '-c', 'user.name=copy', 'commit', '--quiet', '-m', 'lock']);

  const copy = openCopy({ repo, card: 'JUL-BUN-TEST', env });
  assert.equal(existsSync(join(copy.folder, 'node_modules', 'main-only', 'index.js')), true);

  const bin = join(dir, 'bin');
  const logFile = join(dir, 'bun.log');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'bun'),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "1.4.5"; exit 0; fi\nprintf '%s %s\\n' "$PWD" "$*" >> ${JSON.stringify(logFile)}\nmkdir -p node_modules/new-lib\n`,
    { mode: 0o755 }
  );

  writeFileSync(join(copy.folder, 'package-lock.json'), '{"lockfileVersion":3,"v":2}\n');
  syncCopyModules({
    repo,
    folder: copy.folder,
    lock: null,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  const logged = execFileSync('cat', [logFile], { encoding: 'utf8' }).trim();
  assert.equal(logged, `${copy.folder} install --frozen-lockfile`);
  assert.equal(existsSync(join(copy.folder, 'node_modules', 'new-lib')), true);
  assert.equal(existsSync(join(copy.folder, 'node_modules', 'main-only')), false, 'stale hardlinked package from main was cleared');
  assert.equal(existsSync(join(repo, 'node_modules', 'main-only', 'index.js')), true, 'main node_modules stayed intact');
});

test('a card copy points its origin remote at the project repository origin', t => {
  const { dir, repo, env } = studio(t);
  const origin = join(dir, 'origin.git');
  git(dir, ['clone', '--bare', '--quiet', repo, origin]);
  git(repo, ['remote', 'add', 'origin', origin]);

  const copy = openCopy({ repo, card: 'JUL-411-ORIGIN', env });
  assert.equal(git(copy.folder, ['remote', 'get-url', 'origin']), origin);
});
