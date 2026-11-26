import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCleanScript } from './check-server-in-use.mjs';
import { IN_USE_SPEC, evaluateServerState, formatDryRun, formatReport } from './server-in-use.mjs';

function cleanSnapshot(overrides = {}) {
  return {
    studioReachable: true,
    activeCards: [],
    userUnits: [
      { name: 'card-machine-studio.service', load: 'loaded', active: 'active', sub: 'running' },
      { name: 'datasette-viewer.service', load: 'loaded', active: 'active', sub: 'running' },
      { name: 'julia-disk-check.timer', load: 'loaded', active: 'active', sub: 'waiting' },
      { name: 'dbus.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    systemUnits: [
      { name: 'tailscaled.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    processes: [
      { pid: 100, rssKb: 720000, cmd: 'node mastra dev', serviceUnit: 'card-machine-studio.service' },
      { pid: 101, rssKb: 120000, cmd: 'node dashboard/server.js', serviceUnit: 'card-machine-run-view.service' },
      { pid: 102, rssKb: 35000, cmd: 'datasette serve mastra.db', serviceUnit: 'datasette-viewer.service' },
      { pid: 103, rssKb: 7000, cmd: 'sshd: ubuntu@notty', serviceUnit: null },
    ],
    checkouts: [
      { path: '/home/ubuntu/julia-flow-repo', diskMb: 40 },
      { path: '/home/ubuntu/julia-dashboard', diskMb: 1800 },
      { path: '/home/ubuntu/julia-mastra', diskMb: 2450 },
    ],
    worktrees: [
      { path: '/home/ubuntu/julia-dashboard', diskMb: 1800 },
    ],
    scratchEntries: [
      { name: 'cards', path: '/home/ubuntu/.local/state/julia-scratch/cards', diskMb: 0 },
      { name: 'com.agilebits.op.1000', path: '/home/ubuntu/.local/state/julia-scratch/com.agilebits.op.1000', diskMb: 0 },
    ],
    scratchCards: [],
    builderArtifacts: [],
    flowStudioEntries: [
      { name: 'state.db', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/state.db', diskMb: 1 },
      { name: 'trace.duckdb', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/trace.duckdb', diskMb: 10 },
    ],
    mastracodeEntries: [
      { name: 'mastra.db', path: '/home/ubuntu/.local/share/mastracode/mastra.db', diskMb: 381 },
      { name: 'settings.json', path: '/home/ubuntu/.local/share/mastracode/settings.json', diskMb: 0 },
      { name: 'auth.json', path: '/home/ubuntu/.local/share/mastracode/auth.json', diskMb: 0 },
    ],
    homeExtras: [],
    ...overrides,
  };
}

function withOldSetupUnit() {
  return {
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'julia-old-address.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    unitFiles: {
      'julia-old-address.service': {
        file: '/home/ubuntu/.config/systemd/user/julia-old-address.service',
        WorkingDirectory: '/home/ubuntu/julia-dashboard',
        ExecStart: '/usr/bin/node server.js',
      },
    },
  };
}

function withStrayMastracodeFile() {
  return {
    mastracodeEntries: [
      ...cleanSnapshot().mastracodeEntries,
      { name: 'session-store.duckdb', path: '/home/ubuntu/.local/share/mastracode/session-store.duckdb', diskMb: 11, isDir: false },
    ],
  };
}

test('passes when the server holds only items in use right now', () => {
  const result = evaluateServerState(cleanSnapshot());
  assert.equal(result.ok, true);
  assert.equal(result.leftovers.length, 0);
  assert.match(formatReport(result), /Server in-use check: PASS/);
});

test('fails on leftover timer/service, failed unit, process, worktree, scratch, artifacts, and trace files', () => {
  const result = evaluateServerState(cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'julia-studio-health.timer', load: 'loaded', active: 'active', sub: 'waiting' },
      { name: 'jul324-start-machine.service', load: 'loaded', active: 'failed', sub: 'failed' },
    ],
    processes: [
      ...cleanSnapshot().processes,
      { pid: 999, rssKb: 230000, cmd: 'command-code --yolo', serviceUnit: null },
    ],
    worktrees: [
      ...cleanSnapshot().worktrees,
      { path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-387', diskMb: 400 },
    ],
    scratchEntries: [
      ...cleanSnapshot().scratchEntries,
      { name: 'verify-julia', path: '/home/ubuntu/.local/state/julia-scratch/verify-julia', diskMb: 2200 },
    ],
    scratchCards: [
      { name: 'JUL-387', path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-387', diskMb: 400 },
    ],
    builderArtifacts: [
      { name: 'machine', path: '/home/ubuntu/julia-builder/.artifacts/machine', diskMb: 660 },
    ],
    flowStudioEntries: [
      { name: 'state.db', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/state.db', diskMb: 8 },
      { name: 'trace.duckdb', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/trace.duckdb', diskMb: 2700 },
      { name: 'JUL-362', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/JUL-362', diskMb: 1 },
    ],
    mastracodeEntries: [
      ...cleanSnapshot().mastracodeEntries,
      { name: 'traces', path: '/home/ubuntu/.local/share/mastracode/traces', diskMb: 2000, isDir: true },
      { name: 'backup.duckdb', path: '/home/ubuntu/.local/share/mastracode/backup.duckdb', diskMb: 11, isDir: false },
    ],
    homeExtras: [
      { name: 'dist', path: '/home/ubuntu/dist', diskMb: 3 },
    ],
  }));

  assert.equal(result.ok, false);
  const kinds = new Set(result.leftovers.map(item => item.kind));
  assert.ok(kinds.has('user-unit'));
  assert.ok(kinds.has('process'));
  assert.ok(kinds.has('worktree'));
  assert.ok(kinds.has('scratch'));
  assert.ok(kinds.has('scratch-card'));
  assert.ok(kinds.has('builder-artifact'));
  assert.ok(kinds.has('flow-studio-card'));
  assert.ok(kinds.has('mastracode'));
  assert.ok(kinds.has('home-extra'));
  // The Run view serves the Studio folder, so its trace database is data in use, not a leftover.
  assert.ok(result.kept.some(item => item.name.endsWith('/trace.duckdb')));
  assert.ok(result.leftovers.every(item => !item.name.endsWith('/trace.duckdb')));
  // A folder a session may be writing into stays; the stray file beside it goes.
  assert.ok(result.kept.some(item => item.name.endsWith('/traces')));
  assert.ok(result.leftovers.some(item => item.name.endsWith('/backup.duckdb')));
  assert.match(formatReport(result), /Server in-use check: FAIL/);
});

test('allows an active Studio card worktree and run folder, but rejects inactive ones', () => {
  const result = evaluateServerState(cleanSnapshot({
    activeCards: ['JUL-410'],
    runs: [
      { card: 'JUL-410', status: 'running', ended: false },
      { card: 'JUL-387', status: 'success', ended: true },
    ],
    worktrees: [
      ...cleanSnapshot().worktrees,
      { path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-410', diskMb: 300 },
      { path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-387', diskMb: 300 },
    ],
    scratchCards: [
      { name: 'JUL-410', path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-410', diskMb: 300 },
      { name: 'JUL-387', path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-387', diskMb: 300 },
    ],
    flowStudioEntries: [
      { name: 'JUL-410', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/JUL-410', diskMb: 2 },
      { name: 'JUL-387', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/JUL-387', diskMb: 2 },
    ],
  }));

  assert.equal(result.ok, false);
  assert.equal(result.leftovers.length, 3);
  assert.ok(result.leftovers.every(item => item.name.includes('JUL-387')));
  assert.ok(result.kept.some(item => item.name.includes('JUL-410')));
});

test('when Studio is unreachable, every card worktree, copy, run folder, trace db, and potential card process is kept', () => {
  const result = evaluateServerState(cleanSnapshot({
    studioReachable: false,
    studioError: 'Connection refused',
    activeCards: [],
    processes: [
      ...cleanSnapshot().processes,
      { pid: 999, rssKb: 230000, cmd: 'command-code --yolo', serviceUnit: null },
    ],
    worktrees: [
      ...cleanSnapshot().worktrees,
      { path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-362', diskMb: 400 },
    ],
    scratchCards: [
      { name: 'JUL-362', path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-362', diskMb: 400 },
    ],
    flowStudioEntries: [
      { name: 'state.db', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/state.db', diskMb: 1 },
      { name: 'trace.duckdb', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/trace.duckdb', diskMb: 900 },
      { name: 'JUL-362', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/JUL-362', diskMb: 4 },
    ],
  }));

  assert.equal(result.ok, false);
  assert.equal(result.studioReachable, false);
  assert.equal(result.leftovers.length, 0);
  assert.ok(result.kept.some(item => item.name.includes('JUL-362') && item.kind === 'worktree'));
  assert.ok(result.kept.some(item => item.name.includes('JUL-362') && item.kind === 'scratch-card'));
  assert.ok(result.kept.some(item => item.name.includes('JUL-362') && item.kind === 'flow-studio-card'));
  assert.ok(result.kept.some(item => item.name.includes('command-code') && item.kind === 'process'));
  assert.ok(result.kept.some(item => item.name.includes('trace.duckdb') && item.kind === 'flow-studio'));
  assert.match(formatReport(result), /Studio unreachable: Connection refused; preserving card work/);
});

test('when Studio is silent nothing counts as a leftover, so no cleanup can remove anything in use', () => {
  const result = evaluateServerState(cleanSnapshot({
    studioReachable: false,
    studioError: 'Connection refused',
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'julia-studio-health.timer', load: 'loaded', active: 'active', sub: 'waiting' },
      { name: 'jul324-start-machine.service', load: 'loaded', active: 'failed', sub: 'failed' },
    ],
    processes: [
      ...cleanSnapshot().processes,
      { pid: 999, rssKb: 230000, cmd: 'node stray-runner.js', serviceUnit: null },
    ],
    checkouts: [
      ...cleanSnapshot().checkouts,
      { path: '/home/ubuntu/julia-old', diskMb: 900 },
    ],
    scratchEntries: [
      ...cleanSnapshot().scratchEntries,
      { name: 'verify-julia', path: '/home/ubuntu/.local/state/julia-scratch/verify-julia', diskMb: 2200 },
    ],
    mastracodeEntries: [
      ...cleanSnapshot().mastracodeEntries,
      { name: 'traces', path: '/home/ubuntu/.local/share/mastracode/traces', diskMb: 2000, isDir: true },
      { name: 'backup.duckdb', path: '/home/ubuntu/.local/share/mastracode/backup.duckdb', diskMb: 11, isDir: false },
    ],
    homeExtras: [
      { name: 'dist', path: '/home/ubuntu/dist', diskMb: 3 },
    ],
  }));

  assert.equal(result.ok, false, 'a silent Studio is still reported as a problem');
  assert.deepEqual(result.leftovers, []);
  assert.equal(result.kept.length > 0, true);
  assert.match(buildCleanScript(result), /Studio unreachable: keeping everything/);
});

test('keeps the memory recorder and Studio as in-use units, even when a unit reports failed', () => {  const snapshot = cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'memory-watch.service', load: 'loaded', active: 'active', sub: 'running' },
      { name: 'card-machine-studio.service', load: 'loaded', active: 'failed', sub: 'failed' },
    ],
    checkouts: [
      ...cleanSnapshot().checkouts,
      { path: '/home/ubuntu/card-machine', diskMb: 5000 },
      { path: '/home/ubuntu/card-machine-project', diskMb: 3200 },
    ],
  });

  const result = evaluateServerState(snapshot);

  assert.equal(result.ok, true);
  for (const name of ['memory-watch.service', 'card-machine-studio.service']) {
    assert.ok(
      result.kept.some(item => item.kind === 'user-unit' && item.name === name),
      `${name} must be kept in use`,
    );
  }
  for (const path of ['/home/ubuntu/card-machine', '/home/ubuntu/card-machine-project']) {
    assert.ok(result.kept.some(item => item.kind === 'checkout' && item.name === path), `${path} must be kept in use`);
  }
});

test('never deletes the unit file of a unit that is in the in-use list', () => {
  for (const name of ['memory-watch.service', 'card-machine-studio.service']) {
    assert.ok(IN_USE_SPEC.userUnits.has(name), `${name} must stay in the in-use list`);
    const script = buildCleanScript({ studioReachable: true, activeCards: [], leftovers: [{ kind: 'user-unit', name }] });
    assert.doesNotMatch(script, /disable --now/, `${name} must not be disabled`);
    assert.doesNotMatch(script, new RegExp(`rm -f .*${name}`), `${name} unit file must not be removed`);
    assert.match(script, /refusing to delete protected unit/);
  }
});

test('a dry run lists kept services and what would be deleted, without cleaning', () => {
  const result = evaluateServerState(cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'memory-watch.service', load: 'loaded', active: 'active', sub: 'running' },
      { name: 'card-machine-studio.service', load: 'loaded', active: 'active', sub: 'running' },
      { name: 'julia-studio-health.timer', load: 'loaded', active: 'active', sub: 'waiting' },
    ],
  }));

  const report = formatDryRun(result, {
    freeBytes: 5_000_000_000,
    reclaim: [{ what: 'Docker build cache', sizeMb: 6000 }],
  });

  assert.match(report, /\[user-unit\] memory-watch\.service/);
  assert.match(report, /\[user-unit\] card-machine-studio\.service/);
  assert.match(report, /Would delete:/);
  assert.match(report, /\[user-unit\] julia-studio-health\.timer: 0 MB disk/);
  assert.match(report, /\[reclaim\] Docker build cache: 6000 MB/);
  assert.match(report, /Free now: 5\.00 GB/);
  assert.match(report, /Projected free after this cleanup: 11\.00 GB/);
});

test('a service that runs from the old setup fails the check and is removed by the next cleanup', () => {
  const result = evaluateServerState(cleanSnapshot({
    systemUnits: [
      ...cleanSnapshot().systemUnits,
      { name: 'julia-studio-health.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    unitFiles: {
      'julia-studio-health.service': {
        file: '/etc/systemd/system/julia-studio-health.service',
        WorkingDirectory: '/home/ubuntu/julia-dashboard',
        ExecStart: '/usr/bin/node scripts/health.mjs',
      },
    },
  }));

  assert.equal(result.ok, false);
  const leftover = result.leftovers.find(item => item.kind === 'old-setup-unit');
  assert.equal(leftover.name, 'julia-studio-health.service');
  assert.equal(leftover.scope, 'system');
  assert.match(leftover.reason, /old setup \(\/home\/ubuntu\/julia-dashboard\)/);

  const script = buildCleanScript(result);
  assert.match(script, /sudo -n systemctl disable --now 'julia-studio-health\.service'/);
  assert.match(script, /sudo -n rm -f '\/etc\/systemd\/system\/julia-studio-health\.service'/);
});

test('a timer wakes a service that runs from the old setup, so an inactive service still fails', () => {
  const result = evaluateServerState(cleanSnapshot({
    systemUnits: [
      ...cleanSnapshot().systemUnits,
      { name: 'julia-dashboard-sweep.timer', load: 'loaded', active: 'active', sub: 'waiting' },
      { name: 'julia-dashboard-sweep.service', load: 'loaded', active: 'inactive', sub: 'dead' },
    ],
    enabledUnits: ['julia-dashboard-sweep.timer'],
    unitFiles: {
      'julia-dashboard-sweep.service': {
        file: '/etc/systemd/system/julia-dashboard-sweep.service',
        WorkingDirectory: '/home/ubuntu/julia-dashboard',
        ExecStart: '/usr/bin/node scripts/sweep.mjs',
      },
    },
  }));

  const caught = result.leftovers.filter(item => item.kind === 'old-setup-unit').map(item => item.name);
  assert.deepEqual(caught, ['julia-dashboard-sweep.service']);
});

test('units another card owns are kept even when they run from the old setup', () => {
  const result = evaluateServerState(cleanSnapshot({
    systemUnits: [
      ...cleanSnapshot().systemUnits,
      { name: 'julia-skills-update.timer', load: 'loaded', active: 'active', sub: 'waiting' },
      { name: 'julia-skills-update.service', load: 'loaded', active: 'inactive', sub: 'dead' },
    ],
    unitFiles: {
      'julia-skills-update.service': {
        file: '/etc/systemd/system/julia-skills-update.service',
        WorkingDirectory: '/home/ubuntu/julia-dashboard',
        ExecStart: '/usr/bin/node scripts/julia-agents.mjs -- node scripts/update-skills.mjs',
      },
    },
  }));

  assert.equal(result.leftovers.filter(item => /julia-skills-update/.test(item.name)).length, 0);
  const kept = result.kept.filter(item => /julia-skills-update/.test(item.name)).map(item => item.name);
  assert.deepEqual(kept.sort(), ['julia-skills-update.service', 'julia-skills-update.timer']);
});

test('a Mastra Code file a live session holds open is kept, and a stray one is not', async () => {
  const { openSync, closeSync, mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const dir = mkdtempSync(join(homedir(), '.local', 'state', 'julia-scratch', 'held-'));
  const heldPath = join(dir, 'session-store.duckdb');
  writeFileSync(heldPath, 'open in this session');
  const strayPath = join(dir, 'leftover.duckdb');
  writeFileSync(strayPath, 'nobody holds this');
  const fd = openSync(heldPath, 'r');

  try {
    const evaluation = evaluateServerState({
      ...cleanSnapshot(),
      mastracodeEntries: [
        { name: 'session-store.duckdb', path: heldPath, diskMb: 11 },
        { name: 'leftover.duckdb', path: strayPath, diskMb: 5 },
      ],
    });
    const held = evaluation.kept.find(item => item.name === heldPath);
    assert.ok(held, 'the file a session holds open is kept');
    assert.match(held.usedBy, /holds this file open/);
    assert.equal(evaluation.leftovers.length, 1, 'the file nobody holds is the only leftover');
    assert.equal(evaluation.leftovers[0].name, strayPath);
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a unit the in-use list names is kept even while it still runs from an old folder', () => {
  const result = evaluateServerState(cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'card-machine-run-view.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    unitFiles: {
      'card-machine-run-view.service': {
        file: '/home/ubuntu/.config/systemd/user/card-machine-run-view.service',
        WorkingDirectory: '/home/ubuntu/julia-dashboard',
        ExecStart: '/usr/local/bin/node node_modules/next/dist/bin/next start',
      },
    },
  }));

  assert.equal(result.leftovers.length, 0);
  assert.ok(result.kept.some(item => item.name === 'card-machine-run-view.service'));
  assert.equal(buildCleanScript(result), '');
});

test('a running card keeps its copy and worktree wherever the run put them', () => {
  const comment = 'nothing below the card folder is a leftover while that card runs';
  const result = evaluateServerState(cleanSnapshot({
    activeCards: ['JUL-417'],
    worktrees: [
      ...cleanSnapshot().worktrees,
      { path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-417/repo', diskMb: 620 },
    ],
    scratchEntries: [
      ...cleanSnapshot().scratchEntries,
      { name: 'remediation', path: '/home/ubuntu/.local/state/julia-scratch/remediation/JUL-417/build', diskMb: 410 },
    ],
  }));

  assert.equal(result.leftovers.length, 0, comment);
  assert.ok(result.kept.some(item => item.name.endsWith('/cards/JUL-417/repo')));
  assert.ok(result.kept.some(item => item.name.endsWith('/remediation/JUL-417/build')));
});

test('a leftover name from the run form is quoted, so it can never run a command', () => {
  const script = buildCleanScript({
    studioReachable: true,
    activeCards: [],
    leftovers: [{ kind: 'home-extra', name: '/home/ubuntu/dist/$(id)`whoami`', diskMb: 3, reason: 'Stray build output' }],
  });

  assert.ok(script.startsWith("rm -rf '/home/ubuntu/dist/$(id)`whoami`'"), script);
  assert.doesNotMatch(script, /rm -rf (?!')[^\n]*\$\(id\)/);
});

test('a name with a single quote in it is escaped, not handed to the shell', () => {
  const script = buildCleanScript({
    studioReachable: true,
    activeCards: [],
    leftovers: [{ kind: 'scratch', name: "/home/ubuntu/.local/state/julia-scratch/it's", diskMb: 1, reason: 'Leftover scratch' }],
  });

  assert.ok(script.startsWith(`rm -rf '/home/ubuntu/.local/state/julia-scratch/it'\\''s'`), script);
});

test('while a card runs, scratch folders and build output that carry no card name stay', () => {
  const result = evaluateServerState(cleanSnapshot({
    activeCards: ['JUL-417'],
    scratchEntries: [
      ...cleanSnapshot().scratchEntries,
      { name: 'dashboard-model-catalog-3f2a', path: '/home/ubuntu/.local/state/julia-scratch/dashboard-model-catalog-3f2a', diskMb: 20 },
    ],
    flowStudioEntries: [
      ...cleanSnapshot().flowStudioEntries,
      { name: 'archived-runs', path: '/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/archived-runs', diskMb: 2 },
    ],
    homeExtras: [{ name: 'dist', path: '/home/ubuntu/dist', diskMb: 30 }],
  }));

  assert.equal(result.leftovers.length, 0, JSON.stringify(result.leftovers));
  assert.ok(result.kept.some(item => item.name.endsWith('dashboard-model-catalog-3f2a')));
  assert.ok(result.kept.some(item => item.name.endsWith('/archived-runs')));
  assert.ok(result.kept.some(item => item.name === '/home/ubuntu/dist'));
});

test('a folder named like pr-42 is work, not an ended card run, so a running card keeps it', () => {
  const result = evaluateServerState(cleanSnapshot({
    activeCards: ['JUL-417'],
    runs: [
      { card: 'JUL-417', status: 'running', ended: false },
      { card: 'JUL-387', status: 'success', ended: true },
    ],
    scratchEntries: [
      ...cleanSnapshot().scratchEntries,
      { name: 'pr-42', path: '/home/ubuntu/.local/state/julia-scratch/pr-42', diskMb: 120 },
      { name: 'build-2', path: '/home/ubuntu/.local/state/julia-scratch/build-2', diskMb: 40 },
      // Shaped like a card name, but no run lists it, so it is a build's folder, not a finished card's.
      { name: 'NODE-22', path: '/home/ubuntu/.local/state/julia-scratch/NODE-22', diskMb: 40 },
      { name: 'JUL-387', path: '/home/ubuntu/.local/state/julia-scratch/cards/JUL-387', diskMb: 90 },
    ],
  }));

  assert.equal(result.leftovers.length, 1, JSON.stringify(result.leftovers));
  assert.equal(result.leftovers[0].name, '/home/ubuntu/.local/state/julia-scratch/cards/JUL-387');
});

test('the same folders are leftovers again once no card runs', () => {
  const result = evaluateServerState(cleanSnapshot({
    scratchEntries: [
      ...cleanSnapshot().scratchEntries,
      { name: 'dashboard-model-catalog-3f2a', path: '/home/ubuntu/.local/state/julia-scratch/dashboard-model-catalog-3f2a', diskMb: 20 },
    ],
    homeExtras: [{ name: 'dist', path: '/home/ubuntu/dist', diskMb: 30 }],
  }));

  assert.ok(result.leftovers.some(item => item.name.endsWith('dashboard-model-catalog-3f2a')));
  assert.ok(result.leftovers.some(item => item.name === '/home/ubuntu/dist'));
});

test('a leftover unit found outside the home config folder is removed where it actually lives', () => {
  const result = evaluateServerState(cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'jul-old-job.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    unitFiles: {
      'jul-old-job.service': {
        file: '/etc/systemd/user/jul-old-job.service',
        ExecStart: '/usr/bin/node /home/ubuntu/card-machine/scripts/x.mjs',
      },
    },
  }));

  const leftover = result.leftovers.find(item => item.name === 'jul-old-job.service');
  assert.equal(leftover?.file, '/etc/systemd/user/jul-old-job.service');
  // The user session lets go of the unit; root owns the file, so sudo removes it.
  assert.match(buildCleanScript(result), /sudo -n rm -f '\/etc\/systemd\/user\/jul-old-job\.service'/);
});

test('a worktree a running card made without its name in the path stays', () => {
  const result = evaluateServerState(cleanSnapshot({
    activeCards: ['JUL-417'],
    worktrees: [
      ...cleanSnapshot().worktrees,
      { path: '/home/ubuntu/wt-verify-1', diskMb: 200 },
    ],
  }));

  assert.equal(result.leftovers.length, 0, JSON.stringify(result.leftovers));
  assert.ok(result.kept.some(item => item.name === '/home/ubuntu/wt-verify-1'));
});

test('a Studio database a live session writes is named in use, not left to a lucky file scan', () => {
  for (const name of ['mastra-vectors.db', 'mastra-vectors.db-wal', 'mastra-vectors.db-shm', 'observability.duckdb.wal']) {
    assert.ok(IN_USE_SPEC.mastracodeFixed.has(name), `${name} must be in use`);
  }
});

test('a drop-in that points at the old setup makes its unit a leftover, and the real file is the one removed', () => {
  const result = evaluateServerState(cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'julia-old-address.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    unitFiles: {
      'julia-old-address.service': {
        file: '/home/ubuntu/.config/systemd/user/julia-old-address.service',
        ExecStart: '/usr/bin/node /home/ubuntu/card-machine/scripts/x.mjs',
        WorkingDirectory: '/home/ubuntu/julia-dashboard',
      },
    },
  }));

  const leftover = result.leftovers.find(item => item.kind === 'old-setup-unit');
  assert.ok(leftover, JSON.stringify(result.leftovers));
  assert.equal(leftover.file, '/home/ubuntu/.config/systemd/user/julia-old-address.service');
  const script = buildCleanScript(result);
  assert.match(script, /rm -f '\/home\/ubuntu\/\.config\/systemd\/user\/julia-old-address\.service'/);
});

test('a unit a running card started is kept, and stopped once no card runs', () => {
  const snapshot = {
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'julia-card-service.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    builderArtifacts: [
      { name: 'run-123', path: '/home/ubuntu/julia-builder/.artifacts/run-123', diskMb: 40 },
    ],
  };
  snapshot.userUnits.push({ name: 'julia-card-timer.service', load: 'loaded', active: 'inactive', sub: 'dead' });
  const running = evaluateServerState(cleanSnapshot({ ...snapshot, activeCards: ['JUL-417'] }));
  assert.equal(running.leftovers.length, 0, JSON.stringify(running.leftovers));
  assert.ok(running.kept.some(item => item.name === 'julia-card-timer.service'), 'a service its card has not started yet stays');
  assert.ok(running.kept.some(item => item.name === 'julia-card-service.service'));
  assert.ok(running.kept.some(item => item.name.endsWith('/run-123')));

  const idle = evaluateServerState(cleanSnapshot(snapshot));
  assert.ok(idle.leftovers.some(item => item.name === 'julia-card-service.service'));
  assert.ok(idle.leftovers.some(item => item.name.endsWith('/run-123')));
});

test('a unit that runs from the old setup is still stopped while no card runs', () => {
  const result = evaluateServerState(cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'julia-old-address.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    unitFiles: {
      'julia-old-address.service': {
        file: '/home/ubuntu/.config/systemd/user/julia-old-address.service',
        ExecStart: '/usr/bin/node /home/ubuntu/julia-dashboard/server.js',
      },
    },
  }));

  assert.ok(result.leftovers.some(item => item.kind === 'old-setup-unit' && item.name === 'julia-old-address.service'));
});

test('a unit whose drop-in writes the old path in quotes still counts as the old setup', () => {
  const result = evaluateServerState(cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name: 'julia-old-address.service', load: 'loaded', active: 'active', sub: 'running' },
    ],
    unitFiles: {
      'julia-old-address.service': {
        file: '/home/ubuntu/.config/systemd/user/julia-old-address.service',
        WorkingDirectory: '"/home/ubuntu/julia-dashboard"',
      },
    },
  }));

  const leftover = result.leftovers.find(item => item.kind === 'old-setup-unit');
  assert.ok(leftover, JSON.stringify(result.leftovers));
  assert.match(leftover.reason, /julia-dashboard/);
});

test('a unit whose file the system folder owns is stopped by the system, not the user session', () => {
  const name = 'julia-old-address.service';
  const result = evaluateServerState(cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name, load: 'loaded', active: 'active', sub: 'running' },
    ],
    systemUnits: [
      ...cleanSnapshot().systemUnits,
      { name, load: 'loaded', active: 'active', sub: 'running' },
    ],
    unitFiles: {
      [name]: {
        file: '/etc/systemd/system/julia-old-address.service',
        scope: 'system',
        ExecStart: '/usr/bin/node /home/ubuntu/julia-dashboard/server.js',
      },
    },
  }));

  const leftover = result.leftovers.find(item => item.kind === 'old-setup-unit');
  assert.ok(leftover, JSON.stringify(result.leftovers));
  assert.equal(leftover.scope, 'system');
  const script = buildCleanScript(result);
  assert.match(script, /sudo -n systemctl disable --now 'julia-old-address\.service'/);
});

test('a cleanup given no answer from Studio deletes nothing', () => {
  const script = buildCleanScript({
    activeCards: [],
    leftovers: [{ kind: 'scratch', name: '/home/ubuntu/.local/state/julia-scratch/ended', diskMb: 1, reason: 'Leftover scratch' }],
  });

  assert.doesNotMatch(script, /rm -rf/);
  assert.match(script, /Studio unreachable: keeping everything until Studio answers/);
});

test('while a card runs, an old-setup unit is reported but not stopped', () => {
  const result = evaluateServerState(cleanSnapshot({
    ...withOldSetupUnit(),
    activeCards: ['JUL-417'],
    runs: [{ card: 'JUL-417', status: 'running', ended: false }],
  }));

  assert.equal(result.leftovers.length, 0, JSON.stringify(result.leftovers));
  assert.ok(result.kept.some(item => item.name === 'julia-old-address.service'), 'the unit waits for the card to finish');
  assert.doesNotMatch(buildCleanScript(result), /disable --now/);
});

test('while a card runs, a Mastra Code file a session has not opened yet stays', () => {
  const result = evaluateServerState(cleanSnapshot({
    ...withStrayMastracodeFile(),
    activeCards: ['JUL-417'],
    runs: [{ card: 'JUL-417', status: 'running', ended: false }],
  }));

  assert.equal(result.leftovers.length, 0, JSON.stringify(result.leftovers));
  assert.ok(result.kept.some(item => item.name === '/home/ubuntu/.local/share/mastracode/session-store.duckdb'));
});

test('the Studio trace temp folder is named as in use, so a running Studio keeps it', () => {
  const result = evaluateServerState(cleanSnapshot({
    flowStudioEntries: [{ name: 'trace.duckdb.tmp', path: '/home/ubuntu/.artifacts/flow/studio/trace.duckdb.tmp', diskMb: 12 }],
  }));

  assert.equal(result.leftovers.length, 0, JSON.stringify(result.leftovers));
});

test('a service the machine itself needs is never listed for removal, whatever its state', () => {
  const result = evaluateServerState(cleanSnapshot({
    systemUnits: [
      { name: 'apparmor.service', load: 'loaded', active: 'active', sub: 'running' },
      { name: 'blk-availability.service', load: 'loaded', active: 'inactive', sub: 'dead' },
      { name: 'apport.service', load: 'loaded', active: 'failed', sub: 'failed' },
    ],
  }));

  const machineUnits = result.leftovers.filter(item => !item.name.startsWith('julia-') && !item.name.includes('mastra'));
  assert.deepEqual(machineUnits, [], JSON.stringify(machineUnits));
});

test('a system unit a running card started is kept, and stopped once no card runs', () => {
  const name = 'julia-card-system.service';
  const snapshot = {
    systemUnits: [
      ...cleanSnapshot().systemUnits,
      { name, load: 'loaded', active: 'active', sub: 'running' },
    ],
    unitFiles: { [name]: { file: `/etc/systemd/system/${name}`, scope: 'system', ExecStart: '/usr/bin/node scripts/x.mjs' } },
  };

  const running = evaluateServerState(cleanSnapshot({
    ...snapshot,
    activeCards: ['JUL-417'],
    runs: [{ card: 'JUL-417', status: 'running', ended: false }],
  }));
  assert.equal(running.leftovers.length, 0, JSON.stringify(running.leftovers));
  assert.ok(running.kept.some(item => item.name === name));

  const idle = evaluateServerState(cleanSnapshot(snapshot));
  const leftover = idle.leftovers.find(item => item.name === name);
  assert.ok(leftover, JSON.stringify(idle.leftovers));
  assert.equal(leftover.kind, 'system-unit');
});

test('an old setup unit whose file sits in the system user folder asks root to remove it', () => {
  const name = 'julia-old-address.service';
  const result = evaluateServerState(cleanSnapshot({
    userUnits: [
      ...cleanSnapshot().userUnits,
      { name, load: 'loaded', active: 'active', sub: 'running' },
    ],
    unitFiles: {
      [name]: {
        file: `/etc/systemd/user/${name}`,
        scope: 'user',
        WorkingDirectory: '/home/ubuntu/julia-dashboard',
      },
    },
  }));

  const leftover = result.leftovers.find(item => item.name === name);
  assert.ok(leftover, JSON.stringify(result.leftovers));
  assert.equal(leftover.scope, 'user');
  const script = buildCleanScript(result);
  assert.match(script, /systemctl --user disable --now 'julia-old-address\.service'/);
  assert.doesNotMatch(script, /sudo -n systemctl --user/);
  assert.match(script, /sudo -n rm -f '\/etc\/systemd\/user\/julia-old-address\.service'/);
});

test('a unit in the in-use list is not removable even if the scan calls it a system leftover', () => {
  const script = buildCleanScript({
    studioReachable: true,
    activeCards: [],
    leftovers: [{ kind: 'system-unit', name: 'tailscaled.service', reason: 'Not in active system unit allowlist' }],
  });

  assert.doesNotMatch(script, /disable --now 'tailscaled\.service'/);
  assert.doesNotMatch(script, /rm -f '\/etc\/systemd\/system\/tailscaled\.service'/);
  assert.match(script, /refusing to delete protected unit tailscaled\.service/);
});

test('a unit file in this account folder is removed without sudo', () => {
  const result = evaluateServerState(cleanSnapshot({
    ...withOldSetupUnit(),
  }));

  const script = buildCleanScript(result);
  assert.match(script, /(?<!sudo -n )rm -f '\/home\/ubuntu\/\.config\/systemd\/user\/julia-old-address\.service'/);
  assert.doesNotMatch(script, /sudo -n rm -f '\/home\/ubuntu\/\.config/);
});

test('a unit whose file the scan could not find is removed from this account folder', () => {
  const script = buildCleanScript({
    studioReachable: true,
    activeCards: [],
    leftovers: [{ kind: 'user-unit', name: 'julia-no-file.service', reason: 'Not in active user unit allowlist' }],
  });

  assert.match(script, /systemctl --user disable --now 'julia-no-file\.service'/);
  assert.match(script, /(?<!sudo -n )rm -f '\/home\/ubuntu\/\.config\/systemd\/user\/julia-no-file\.service'/);
});

test('a system unit named as in use is not removed through its user twin', () => {
  const script = buildCleanScript({
    studioReachable: true,
    activeCards: [],
    leftovers: [{ kind: 'user-unit', name: 'tailscaled.service', reason: 'Not in active user unit allowlist' }],
  });

  assert.doesNotMatch(script, /rm -f/);
  assert.match(script, /refusing to delete protected unit tailscaled\.service/);
});
