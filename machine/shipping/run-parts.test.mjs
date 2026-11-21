import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prepareDependencies } from './run-parts.mjs';

function trees(root) {
  const found = [root, path.join(root, 'dashboard')];
  for (const tree of found) {
    fs.mkdirSync(tree, { recursive: true });
    fs.writeFileSync(path.join(tree, 'package.json'), '{}');
    fs.writeFileSync(path.join(tree, 'package-lock.json'), '{}');
  }
  return found;
}

function stub(root, name) {
  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'calls.log');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, name),
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then exit 0; fi',
      `printf 'start %s %s\\n' "$PWD" "$*" >> ${JSON.stringify(calls)}`,
      '/bin/sleep 0.2',
      `printf 'end %s\\n' "$PWD" >> ${JSON.stringify(calls)}`,
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  return { bin, calls };
}

function installLines(calls) {
  return fs
    .readFileSync(calls, 'utf8')
    .split('\n')
    .filter(Boolean);
}

function withPath(bin, run, { only = false } = {}) {
  const previous = process.env.PATH;
  process.env.PATH = only ? bin : `${bin}:${previous}`;
  try {
    return run();
  } finally {
    process.env.PATH = previous;
  }
}

test('the root and dashboard trees are installed one at a time, with bun when it is there', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-install-'));
  const [main, dashboard] = trees(root);
  const { bin, calls } = stub(root, 'bun');

  withPath(bin, () => prepareDependencies(root, { timeoutMs: 10_000 }));

  const lines = installLines(calls);
  assert.deepEqual(lines.map(line => line.split(' ')[0]), ['start', 'end', 'start', 'end']);
  assert.equal(lines[0], `start ${main} install --frozen-lockfile`);
  assert.equal(lines[2], `start ${dashboard} install --frozen-lockfile`);
});

test('a machine without bun installs the same trees with npm and dev dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-install-'));
  const [main, dashboard] = trees(root);
  const { bin, calls } = stub(root, 'npm');

  withPath(bin, () => prepareDependencies(root, { timeoutMs: 10_000 }), { only: true });

  const lines = installLines(calls);
  assert.deepEqual(lines.map(line => line.split(' ')[0]), ['start', 'end', 'start', 'end']);
  assert.equal(lines[0], `start ${main} ci --include=dev --no-audit --no-fund`);
  assert.equal(lines[2], `start ${dashboard} ci --include=dev --no-audit --no-fund`);
});

test('a tree installed from the same lockfile is not installed again', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-install-'));
  trees(root);
  const { bin, calls } = stub(root, 'bun');

  withPath(bin, () => {
    prepareDependencies(root, { timeoutMs: 10_000 });
    prepareDependencies(root, { timeoutMs: 10_000 });
  });

  assert.equal(installLines(calls).length, 4);
});

test('a changed lockfile installs the tree again', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-install-'));
  trees(root);
  const { bin, calls } = stub(root, 'bun');

  withPath(bin, () => {
    prepareDependencies(root, { timeoutMs: 10_000 });
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
    prepareDependencies(root, { timeoutMs: 10_000 });
  });

  assert.equal(installLines(calls).filter(line => line.startsWith('start')).length, 3);
});

test('a checkout whose lockfile matches main links the installed trees instead of installing', () => {
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-main-'));
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'shipping-review-'));
  for (const relative of ['', 'dashboard']) {
    const mainTree = path.join(mainRoot, relative);
    const reviewTree = path.join(checkout, relative);
    fs.mkdirSync(path.join(mainTree, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(mainTree, 'node_modules', '.package-lock.json'), '{"lockfileVersion":3}\n');
    fs.writeFileSync(path.join(mainTree, 'package-lock.json'), '{"lockfileVersion":3}\n');
    fs.mkdirSync(reviewTree, { recursive: true });
    fs.writeFileSync(path.join(reviewTree, 'package-lock.json'), '{"lockfileVersion":3}\n');
  }

  const { bin, calls } = stub(checkout, 'bun');
  fs.writeFileSync(path.join(bin, 'bun'), '#!/bin/sh\nexit 9\n', { mode: 0o755 });

  withPath(bin, () => prepareDependencies(checkout, { mainRoot, timeoutMs: 5_000 }));

  assert.equal(fs.existsSync(calls), false);
  for (const relative of ['', 'dashboard']) {
    const installed = path.join(checkout, relative, 'node_modules');
    assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
    assert.equal(fs.existsSync(path.join(installed, '.package-lock.json')), true);
    assert.match(fs.readFileSync(path.join(installed, '.card-dependencies'), 'utf8'), /^[0-9a-f]{64}\n$/);
  }
});
