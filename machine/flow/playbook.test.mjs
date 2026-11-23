import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { liveFileIn, setLiveDir } from './live.mjs';

import {
  createChoosePlaybookTool,
  createGuardedTaskTools,
  listPlaybooks,
  normalizePlaybookName,
  parsePlaybookSteps,
  resolvePlaybook,
  seedPlaybookTasks,
} from './playbook.mjs';

const repo = resolve(import.meta.dirname, '..', '..');

test('normalizePlaybookName normalizes paths, extensions, spaces, and aliases', () => {
  assert.equal(normalizePlaybookName('Feature'), 'feature');
  assert.equal(normalizePlaybookName('playbooks/bug-fix.md'), 'bug-fix');
  assert.equal(normalizePlaybookName('Multi-phase or multi-PR plan'), 'multi-phase-plan');
  assert.equal(normalizePlaybookName('`investigation`'), 'investigation');
});

test('parsePlaybookSteps extracts numbered steps and indented continuations word for word', () => {
  const featureMd = readFileSync(resolve(repo, '.agents/skills/poteto-mode/playbooks/feature.md'), 'utf8');
  const steps = parsePlaybookSteps(featureMd);
  assert.equal(steps.length, 8);
  assert.equal(steps[0], 'Trace the affected subsystem.');
  assert.match(steps[2], /^Write the throughput checkpoint as four todo items\./);
  assert.match(steps[2], /- \*\*Blocking first steps\.\*\* Gates run before fan-out\./);
  assert.equal(steps[7], 'Run **Opening a PR**.');
});

test('resolvePlaybook finds valid playbooks and returns null for unknown ones', () => {
  assert.ok(listPlaybooks(repo).has('investigation'));
  const inv = resolvePlaybook(repo, 'investigation');
  assert.equal(inv.slug, 'investigation');
  assert.equal(inv.steps.length, 4);
  assert.equal(resolvePlaybook(repo, 'not-a-playbook'), null);
});

test('seedPlaybookTasks puts playbook steps ahead of existing custom tasks', () => {
  const seeded = seedPlaybookTasks(
    [{ id: 'custom_1', content: 'Custom item', status: 'pending', activeForm: 'Custom' }],
    ['Step one', 'Step two'],
  );
  assert.deepEqual(seeded.map(t => [t.id, t.content]), [
    ['playbook_1', 'Step one'],
    ['playbook_2', 'Step two'],
    ['custom_1', 'Custom item'],
  ]);
});

test('createChoosePlaybookTool writes playbook steps to threadState and rejects unknown playbooks', async () => {
  let stored = [];
  let chosen = null;
  let invalid = null;
  const store = {
    getState: async () => stored,
    setState: async ({ value }) => { stored = value; },
  };
  const tool = createChoosePlaybookTool({
    repo,
    onChosen: (info) => { chosen = info; },
    onInvalid: (info) => { invalid = info; },
  });
  const ctx = {
    mastra: { getStorage: () => ({ getStore: async () => store }) },
    agent: { threadId: 't-1' },
    requestContext: new Map(),
  };

  const bad = await tool.execute({ playbook: 'no-such-playbook' }, ctx);
  assert.equal(bad.ok, false);
  assert.equal(bad.isError, true);
  assert.equal(invalid.playbook, 'no-such-playbook');
  assert.equal(chosen, null);

  const ok = await tool.execute({ playbook: 'investigation' }, ctx);
  assert.equal(ok.ok, true);
  assert.equal(ok.playbook, 'investigation');
  assert.equal(ok.steps.length, 4);
  assert.equal(stored.length, 4);
  assert.equal(chosen.playbook, 'investigation');
  assert.equal(ctx.requestContext.get('mastra:tasks').length, 4);
});

test('a task list is published under the agent id the tool ran as', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'playbook-live-'));
  setLiveDir(dir);
  const ctx = {
    mastra: { getStorage: () => ({ getStore: async () => ({ getState: async () => [], setState: async () => {} }) }) },
    // The shape Mastra hands a tool: the agent's id is `agentId`, and `id` is not set.
    agent: { agentId: 'flow-build', threadId: 't-1' },
    requestContext: new Map([['mastra__resourceId', 'JUL-1']]),
  };
  try {
    await createChoosePlaybookTool({ repo }).execute({ playbook: 'feature' }, ctx);
    const written = readFileSync(liveFileIn(dir, 'JUL-1'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const tasks = written.filter((event) => event.type === 'tasks');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].agent, 'flow-build');
    assert.equal(tasks[0].tasks.length, 8);
    assert.deepEqual(tasks[0].tasks.map((task) => task.id).slice(0, 2), ['playbook_1', 'playbook_2']);
  } finally {
    setLiveDir(null);
  }
});

test('createGuardedTaskTools refuses task_write and task_complete on flagged tasks', async () => {
  const storeTasks = [
    { id: 'playbook_1', content: 'Step one. flag: not verified', status: 'in_progress', activeForm: 'Step one' },
  ];
  const ctx = {
    mastra: {
      getStorage: () => ({
        getStore: async () => ({ getState: async () => storeTasks, setState: async () => {} }),
      }),
    },
    agent: { threadId: 't-1' },
    requestContext: new Map(),
  };
  const guarded = createGuardedTaskTools();
  const written = await guarded.task_write.execute({
    tasks: [{ id: 'playbook_1', content: 'Step one. flag: skipped', status: 'completed', activeForm: 'Step one' }],
  }, ctx);
  assert.equal(written.isError, true);
  assert.match(written.content, /flag:/i);

  const completed = await guarded.task_complete.execute({ id: 'playbook_1' }, ctx);
  assert.equal(completed.isError, true);
  assert.match(completed.content, /flag:/i);
});
