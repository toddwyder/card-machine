import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BoundedLocalSandbox } from './bounded-sandbox.mjs';

const systemctl = (...args) => execFileSync('systemctl', ['--user', ...args], { encoding: 'utf8' }).trim();
const bestEffort = (...args) => {
  try {
    systemctl(...args);
  } catch {
    // The unit from a previous run may already be gone.
  }
};
const sliceMemory = 192 * 1024 * 1024;
const commandMemory = 64 * 1024 * 1024;
const slice = `jul361test${process.pid}.slice`;
const owner = `jul361test${process.pid}.service`;

async function sandboxOn({ sliceMemoryMax = sliceMemory, workingDirectory = process.cwd(), jail, lock } = {}) {
  return new BoundedLocalSandbox({
    workingDirectory,
    env: { CHECK_VALUE: "a 'quoted' value" },
    slice,
    sliceMemoryMax,
    commandMemoryMax: commandMemory,
    ownerUnit: owner,
    jail,
    lock,
  });
}

test('a command runs inside the builder slice under its own memory ceiling', { timeout: 60000 }, async () => {
  let sandbox;
  try {
    bestEffort('stop', owner);
    bestEffort('reset-failed', owner);
    execFileSync('systemd-run', [
      '--user', '--quiet', `--unit=${owner}`, `--slice=${slice}`,
      '--property=MemoryMax=64M', '--property=MemorySwapMax=0', '--property=Restart=always', '--property=RestartSec=1s',
      '/usr/bin/sleep', '120',
    ]);
    systemctl('set-property', '--runtime', slice, `MemoryMax=${sliceMemory}`, 'MemorySwapMax=0');
    sandbox = await sandboxOn();
    const result = await sandbox.executeCommand('python3', ['-c',
      'import json,os; c=open("/proc/self/cgroup").read().strip(); print(json.dumps([os.environ["CHECK_VALUE"],os.getcwd(),c,open("/sys/fs/cgroup"+c.split(":")[-1]+"/memory.max").read().strip()]))']);
    assert.equal(result.exitCode, 0, result.stderr);
    const [env, cwd, cgroup, max] = JSON.parse(result.stdout);
    assert.equal(env, "a 'quoted' value");
    assert.equal(cwd, process.cwd());
    assert.match(cgroup, new RegExp(`/${slice.replaceAll('.', '\\.')}/.+\\.scope$`));
    assert.equal(max, String(commandMemory));
  } finally {
    await sandbox?.stop().catch(() => {});
  }
});

test('a command over the ceiling dies and the sandbox keeps working after it', { timeout: 60000 }, async () => {
  let sandbox;
  try {
    sandbox = await sandboxOn();
    const killed = await sandbox.executeCommand('python3', ['-c', 'bytearray(200 * 1024 * 1024)']);
    assert.notEqual(killed.exitCode, 0);
    const after = await sandbox.executeCommand('printf', ['still-alive']);
    assert.equal(after.stdout, 'still-alive');
  } finally {
    await sandbox?.stop().catch(() => {});
  }
});

test('a command refuses to run from a slice with a different ceiling', { timeout: 60000 }, async () => {
  let sandbox;
  try {
    systemctl('set-property', '--runtime', slice, `MemoryMax=${sliceMemory}`, 'MemorySwapMax=0');
    sandbox = await sandboxOn();
    systemctl('set-property', '--runtime', slice, 'MemoryMax=infinity');
    const refused = await sandbox.executeCommand('printf', ['must-not-run']);
    assert.notEqual(refused.exitCode, 0);
    assert.notEqual(refused.stdout, 'must-not-run');
    // A new sandbox is refused at construction, so a raised slice cannot even be
    // handed to an agent's workspace.
    const raised = await sandboxOn().catch(error => error);
    assert.match(String(raised.message), /before card commands can run/);
    systemctl('set-property', '--runtime', slice, `MemoryMax=${sliceMemory}`);
  } finally {
    await sandbox?.stop().catch(() => {});
  }
});

test('a command stops when the Studio unit it belongs to is killed', { timeout: 60000 }, async () => {
  let sandbox;
  try {
    systemctl('set-property', '--runtime', slice, `MemoryMax=${sliceMemory}`, 'MemorySwapMax=0');
    sandbox = await sandboxOn();
    let markReady;
    const ready = new Promise(resolve => { markReady = resolve; });
    const background = await sandbox.processes.spawn('printf ready; exec sleep 90', { onStdout: () => markReady() });
    await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('command did not start')), 8000))]);
    const ownerPid = systemctl('show', owner, '-p', 'MainPID', '--value');
    execFileSync('kill', ['-9', ownerPid]);
    const stopped = await Promise.race([
      background.wait(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('command survived its owner')), 15000)),
    ]);
    assert.notEqual(stopped.exitCode, 0);
  } finally {
    await sandbox?.stop().catch(() => {});
  }
});

test('a command writes inside the card copy and nowhere else', { timeout: 60000 }, async () => {
  const scratch = path.join(os.homedir(), '.local', 'state', 'julia-scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const copy = fs.mkdtempSync(path.join(scratch, 'jail-'));
  const escape = path.join(os.homedir(), `jail-escape-${process.pid}.txt`);
  let sandbox;
  try {
    sandbox = await sandboxOn({ workingDirectory: copy, jail: copy });
    const inside = await sandbox.executeCommand('sh', ['-c', 'echo kept > note.txt; cat note.txt']);
    assert.equal(inside.exitCode, 0, inside.stderr);
    assert.equal(inside.stdout.trim(), 'kept');
    assert.ok(fs.existsSync(path.join(copy, 'note.txt')));

    const outside = await sandbox.executeCommand('sh', ['-c', `echo nope > ${escape}`]);
    assert.notEqual(outside.exitCode, 0);
    assert.equal(fs.existsSync(escape), false);
  } finally {
    await sandbox?.stop().catch(() => {});
    fs.rmSync(copy, { recursive: true, force: true });
    fs.rmSync(escape, { force: true });
  }
});

test('an install or build takes the shared lock and a read does not', { timeout: 60000 }, async () => {
  const sandbox = await sandboxOn({ lock: '/run/user/1000/card-builder.lock' });
  try {
    assert.match(sandbox.wrapCommandForIsolation('npm ci').command, /flock --timeout 1800 .*card-builder\.lock/);
    assert.match(sandbox.wrapCommandForIsolation('node --test machine/flow').command, /flock --timeout 1800/);
    assert.doesNotMatch(sandbox.wrapCommandForIsolation('cat package.json').command, /flock --timeout/);
  } finally {
    await sandbox?.stop().catch(() => {});
  }
});

test.after(() => {
  for (const [command, ...args] of [['stop', owner], ['reset-failed', owner], ['revert', slice]]) {
    try { systemctl(command, ...args); } catch {}
  }
});
