import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Disposable trees live where the server rulebook keeps them, never in /tmp.
const SCRATCH = join(homedir(), '.local', 'state', 'julia-scratch');
mkdirSync(SCRATCH, { recursive: true });

test('a cleanup removes an ended run and a dead service while a waiting card keeps every file', async () => {
  const root = mkdtempSync(join(SCRATCH, 'cleanup-isolation-'));
  const card = join(root, 'cards', 'JUL-999');
  const leftovers = [join(root, 'live-feed-ended01'), join(root, 'studio-run'), join(root, 'remediation-record-ended')];
  mkdirSync(join(card, 'repo'), { recursive: true });
  mkdirSync(join(card, 'notes'), { recursive: true });
  mkdirSync(join(root, 'cards', 'JUL-998'), { recursive: true });
  writeFileSync(join(card, 'repo', 'work.mjs'), 'export const pending = true;\n');
  writeFileSync(join(card, 'notes', 'plan.md'), '# plan\n');
  writeFileSync(join(root, 'cards', 'JUL-998', 'resumable.txt'), 'waiting card\n');
  for (const path of leftovers) {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'scratch.bin'), 'leftover\n');
  }

  const dead = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
  dead.unref();

  const { cleanLeftovers } = await import('./check-server-in-use.mjs');
  cleanLeftovers(
    {
      ok: false,
      studioReachable: true,
      activeCards: ['JUL-999'],
      kept: [
        { kind: 'scratch-card', name: 'JUL-999' },
        { kind: 'scratch-card', name: 'JUL-998' },
      ],
      leftovers: [
        ...leftovers.map(path => ({ kind: 'scratch', name: path, rssMb: 0, diskMb: 1, reason: 'Ended run' })),
        { kind: 'process', name: `${dead.pid} sleep 300`, pid: dead.pid, rssMb: 0, diskMb: 0, reason: 'Ended run' },
      ],
    },
    { local: true },
  );

  assert.deepEqual(
    leftovers.filter(path => existsSync(path)),
    [],
    'every planted leftover of the ended run is gone',
  );
  assert.ok(existsSync(join(card, 'repo', 'work.mjs')), 'the waiting card keeps its work');
  assert.ok(existsSync(join(card, 'notes', 'plan.md')), 'the waiting card keeps its notes');
  assert.ok(existsSync(join(root, 'cards', 'JUL-998', 'resumable.txt')), 'the other waiting card keeps its file');

  const state = readFileSync(`/proc/${dead.pid}/stat`, 'utf8').split(') ')[1]?.[0];
  assert.ok(state === undefined || state === 'Z', 'the ended run process is stopped');

  rmSync(root, { recursive: true, force: true });
});

test('a cleanup leaves every planted file alone while Studio does not answer', async () => {
  const root = mkdtempSync(join(SCRATCH, 'cleanup-silent-'));
  const planted = [join(root, 'live-feed-silent'), join(root, 'studio-run'), join(root, 'cards', 'JUL-999')];
  for (const path of planted) {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'file.txt'), 'not a leftover while Studio is silent\n');
  }

  const { cleanLeftovers } = await import('./check-server-in-use.mjs');
  cleanLeftovers(
    {
      ok: false,
      studioReachable: false,
      studioError: 'Connection refused',
      activeCards: [],
      kept: [],
      leftovers: planted.map(path => ({ kind: 'scratch', name: path, rssMb: 0, diskMb: 1, reason: 'Leftover' })),
    },
    { local: true },
  );

  assert.deepEqual(
    planted.filter(path => !existsSync(path)),
    [],
    'nothing is removed while Studio is silent',
  );

  rmSync(root, { recursive: true, force: true });
});

test('the in-use rules keep a waiting card and hand the finished card folder to the cleanup', async () => {
  const root = mkdtempSync(join(SCRATCH, 'cleanup-rules-'));
  const waiting = join(root, 'cards', 'JUL-999');
  const finished = join(root, 'cards', 'JUL-387');
  mkdirSync(join(waiting, 'notes'), { recursive: true });
  mkdirSync(join(finished, 'repo'), { recursive: true });
  writeFileSync(join(waiting, 'notes', 'plan.md'), '# plan\n');
  writeFileSync(join(finished, 'repo', 'old.mjs'), 'export const done = true;\n');

  const { evaluateServerState } = await import('./server-in-use.mjs');
  const { cleanLeftovers } = await import('./check-server-in-use.mjs');
  const evaluation = evaluateServerState({
    studioReachable: true,
    activeCards: ['JUL-999'],
    runs: [
      { card: 'JUL-999', status: 'running', ended: false },
      { card: 'JUL-387', status: 'success', ended: true },
    ],
    userUnits: [],
    systemUnits: [],
    processes: [],
    checkouts: [],
    worktrees: [],
    scratchEntries: [
      { name: 'JUL-999', path: waiting, diskMb: 1 },
      { name: 'JUL-387', path: finished, diskMb: 1 },
    ],
    scratchCards: [],
    builderArtifacts: [],
    flowStudioEntries: [],
    mastracodeEntries: [],
    homeExtras: [],
  });

  assert.deepEqual(evaluation.leftovers.map(item => item.name), [finished]);
  assert.ok(evaluation.kept.some(item => item.name === waiting));

  cleanLeftovers(evaluation, { local: true });

  assert.equal(existsSync(finished), false, 'the finished card folder is removed');
  assert.ok(existsSync(join(waiting, 'notes', 'plan.md')), 'the waiting card keeps its notes');
  rmSync(root, { recursive: true, force: true });
});
