import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detachedCommand, launcherEnv, launchDetached, readCardSession, startCard } from './card-session.mjs';
import { sessionConfig, sessionSettings } from './card-run.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = readFileSync(join(REPO_ROOT, '.agents', 'skills', 'poteto-mode', 'SKILL.md'), 'utf8');

test('the session carries pstack as standing instructions', () => {
  const config = sessionConfig({ settingsPath: '/tmp/settings.json', dir: '/tmp', subagents: [] });
  assert.equal(
    config.hostInstructions,
    SKILL,
    'the session boot has to carry the whole poteto-mode skill, or a card session follows nothing after its first compaction',
  );
});

test('the session cannot ask a question or wait on an approval', () => {
  const config = sessionConfig({ settingsPath: '/tmp/settings.json', dir: '/tmp', subagents: [] });
  assert.deepEqual(config.disableBuiltinTools, ['ask_user', 'submit_plan']);
  assert.equal(config.planApprovalStartsGoal, false);
});

test('every helper call runs on the model the run itself runs on', () => {
  const model = 'commandcode/deepseek/deepseek-v4.1-flash';
  const config = sessionConfig({ settingsPath: '/tmp/settings.json', dir: '/tmp', subagents: [], model });
  assert.equal(
    config.initialState?.subagentModelId,
    model,
    'without this the built-in helpers fall back to the build mode default, which is another account and another bill',
  );
});

test('the session settings say nothing about which model to use', () => {
  assert.equal(
    sessionSettings().models,
    undefined,
    'the model belongs on the session, one value in one place, not in a settings file next to it',
  );
});

test('a card runs outside the service that started it', () => {
  const { command, args } = detachedCommand({ unit: 'card-run-jul-419-1', payload: '/tmp/payload.json' });
  assert.equal(command, 'systemd-run');
  // A transient unit of its own, or a restart of mission control kills the card with it.
  assert.ok(args.includes('--user'));
  assert.ok(args.includes('--unit=card-run-jul-419-1'));
  assert.ok(args.includes('--collect'));
  assert.ok(args.includes('--slice=card.slice'));
  // The keys the session needs, because `systemd-run --user` passes none of the caller's on.
  assert.ok(args.includes(join(REPO_ROOT, 'scripts', 'julia-agents.mjs')));
  assert.ok(args.includes(join(REPO_ROOT, 'dashboard', 'lib', 'card-run.mjs')));
  assert.deepEqual(args.slice(-2), ['--payload', '/tmp/payload.json']);
});

test('the launcher finds the user manager from the service it runs in', () => {
  const env = launcherEnv({ HOME: '/home/ubuntu', PATH: '/usr/bin' });
  assert.equal(
    env.XDG_RUNTIME_DIR,
    `/run/user/${process.getuid()}`,
    'the mission control service is started with no runtime directory, and systemd-run cannot reach the user manager without one',
  );
});

test('a launched session outlives the process that launched it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-launch-'));
  const pidFile = join(dir, 'child.pid');
  const parent = join(dir, 'parent.mjs');
  writeFileSync(parent, `
    import { existsSync } from 'node:fs';
    import { launchDetached } from ${JSON.stringify(join(REPO_ROOT, 'dashboard', 'lib', 'card-session.mjs'))};
    const pidFile = ${JSON.stringify(pidFile)};
    launchDetached({
      command: process.execPath,
      args: ['-e', 'require("node:fs").writeFileSync(' + JSON.stringify(pidFile) + ', String(process.pid)); setTimeout(() => {}, 20000)'],
      cwd: process.cwd(),
    }).catch(() => {});
    const until = Date.now() + 10000;
    const tick = () => {
      if (existsSync(pidFile)) return process.exit(0);
      if (Date.now() > until) return process.exit(2);
      setTimeout(tick, 25);
    };
    tick();
  `);
  execFileSync(process.execPath, [parent], { cwd: dir, stdio: 'ignore', timeout: 20_000 });

  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(pid > 0);
  let alive = true;
  try { process.kill(pid, 0); } catch { alive = false; }
  try { process.kill(pid, 'SIGKILL'); } catch {}
  assert.ok(alive, 'the session has to survive the process that started it, which is how mission control can restart');
});

test('Start launches the session for the card it was given, and refuses a second press', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'start-card-'));
  const card = { identifier: 'JUL-419', title: 'A card', description: 'What the card asks for.', url: 'https://linear.test/JUL-419' };
  const launches = [];
  await startCard(card, {
    model: 'commandcode/deepseek/deepseek-v4.1-flash',
    now: Date.now(),
    dir,
    launch: async ({ command, args }) => { launches.push({ command, args }); },
  });

  assert.equal(launches.length, 1, 'Start has to launch the session that runs the card');
  assert.equal(launches[0].command, 'systemd-run');
  const payload = JSON.parse(readFileSync(launches[0].args[launches[0].args.indexOf('--payload') + 1], 'utf8'));
  assert.equal(payload.card.identifier, 'JUL-419');
  assert.equal(payload.model, 'commandcode/deepseek/deepseek-v4.1-flash');
  assert.equal(payload.sessionDir, dir);

  const record = await readCardSession({ dir });
  assert.equal(record.card, 'JUL-419');
  assert.equal(record.status, 'running');
  assert.equal(record.endedAt, null);

  await assert.rejects(
    () => startCard(card, { model: 'm', dir, launch: async () => {} }),
    error => error.status === 409,
    'a second press while a card is running has to be refused, or two sessions run one card',
  );
});
