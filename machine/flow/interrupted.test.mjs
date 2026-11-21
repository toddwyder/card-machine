import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mastra } from '@mastra/core';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';
import { interruptionCause, reconcileInterruptedRuns, runOwner, studioUnit } from './interrupted.mjs';

const runId = '22222222-2222-4222-8222-222222222222';
const childProgram = `
  import { Mastra } from '@mastra/core';
  import { createStep, createWorkflow } from '@mastra/core/workflows';
  import { LibSQLStore } from '@mastra/libsql';
  import { z } from 'zod';
  const schema = z.object({ card: z.string() });
  const config = { inputSchema: schema, outputSchema: schema, options: { autoRestartActiveRuns: false } };
  const busy = createStep({ id: 'busy', inputSchema: schema, outputSchema: schema, execute: async () => { console.log('READY'); await new Promise(() => {}); } });
  const nested = createWorkflow({ ...config, id: 'build-round' }).then(busy).commit();
  const workflow = createWorkflow({ ...config, id: 'card-path' }).then(nested).commit();
  const mastra = new Mastra({ workflows: { 'card-path': workflow }, storage: new LibSQLStore({ id: 'state', url: 'file:' + process.env.TEST_DB }) });
  await mastra.getStorage().init();
  setInterval(() => {}, 10000);
  const run = await mastra.getWorkflow('card-path').createRun({ runId: '${runId}' });
  await run.start({ inputData: { card: 'JUL-361' } });
`;

function killRunningChild(db) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childProgram], { env: { ...process.env, TEST_DB: db }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!killed && stdout.includes('READY')) { killed = true; child.kill('SIGKILL'); }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (_, signal) => killed && signal === 'SIGKILL' ? resolve() : reject(new Error(`Child exited before kill: ${stdout} ${stderr}`)));
  });
}

const schema = z.object({});
const config = { inputSchema: schema, outputSchema: schema, options: { autoRestartActiveRuns: false } };

async function stranded(t) {
  const root = mkdtempSync(join(tmpdir(), 'interrupted-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const db = join(root, 'state.db');
  await killRunningChild(db);
  const step = createStep({ id: 'busy', inputSchema: schema, outputSchema: schema, execute: async () => ({}) });
  const nested = createWorkflow({ ...config, id: 'build-round' }).then(step).commit();
  const workflow = createWorkflow({ ...config, id: 'card-path' }).then(nested).commit();
  const mastra = new Mastra({ workflows: { 'card-path': workflow }, storage: new LibSQLStore({ id: 'state', url: `file:${db}` }) });
  await mastra.getStorage().init();
  t.after(() => mastra.shutdown());
  const store = await mastra.getStorage().getStore('workflows');
  return { dir: join(root, 'flow'), workflow: mastra.getWorkflow('card-path'), store };
}

const oomJournal = '2026-11-21T08:34:23+0000 vps systemd[924]: card-machine-studio.service: A process of this unit has been killed by the OOM killer.\n2026-11-21T08:34:30+0000 vps systemd[924]: card-machine-studio.service: Failed with result \'oom-kill\'.';

test('the cause comes from the line the user manager wrote, in Pacific time', () => {
  assert.equal(interruptionCause(oomJournal), 'the out-of-memory kill at 00:34 Pacific');
  assert.equal(
    interruptionCause('2026-11-21T16:20:05+0000 vps systemd[924]: card-machine-studio.service: Failed with result \'signal\'.'),
    'Studio stopped (signal) at 08:20 Pacific',
  );
  assert.equal(interruptionCause(''), 'Studio was stopped before the run finished');
  assert.equal(studioUnit('0::/user.slice/user-1000.slice/user@1000.service/app.slice/card-machine-studio.service'), 'card-machine-studio.service');
  assert.equal(studioUnit('0::/user.slice/user-1000.slice/session-7564.scope'), null);
});

test('a run left running by a killed Studio is canceled and its card is told why', async t => {
  const { dir, workflow, store } = await stranded(t);
  const comments = [];
  const result = await reconcileInterruptedRuns({
    dir,
    workflow,
    store,
    readJournal: () => oomJournal,
    readComments: async () => comments,
    postComment: async (_, body) => { comments.push(body); },
  });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.stopped.map(item => [item.runId, item.card, item.cause]), [[runId, 'JUL-361', 'the out-of-memory kill at 00:34 Pacific']]);
  assert.equal((await store.loadWorkflowSnapshot({ workflowName: 'card-path', runId })).status, 'canceled');
  assert.equal((await store.loadWorkflowSnapshot({ workflowName: 'build-round', runId })).status, 'canceled');
  assert.equal(comments.length, 1);
  assert.match(comments[0], /Run 22222222-2222-4222-8222-222222222222 stopped because the out-of-memory kill at 00:34 Pacific\. The interrupted work was not replayed\./);
  assert.deepEqual((await store.listWorkflowRuns({ workflowName: 'card-path', status: 'running', perPage: false })).runs, []);
});

test('a run another process is still driving is left alone', async t => {
  const { dir, workflow, store } = await stranded(t);
  mkdirSync(join(dir, 'heartbeat'), { recursive: true });
  writeFileSync(join(dir, 'heartbeat', `${runId}.json`), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const comments = [];
  const result = await reconcileInterruptedRuns({
    dir,
    workflow,
    store,
    readJournal: () => oomJournal,
    readComments: async () => comments,
    postComment: async (_, body) => { comments.push(body); },
  });
  assert.deepEqual(result.stopped, []);
  assert.equal((await store.loadWorkflowSnapshot({ workflowName: 'card-path', runId })).status, 'running');
  assert.deepEqual(comments, []);
  assert.equal(runOwner(dir, runId), process.pid);
});

test('a heartbeat whose process is gone does not save the run', async t => {
  const { dir, workflow, store } = await stranded(t);
  mkdirSync(join(dir, 'heartbeat'), { recursive: true });
  writeFileSync(join(dir, 'heartbeat', `${runId}.json`), JSON.stringify({ pid: 999999, at: new Date().toISOString() }));
  assert.equal(runOwner(dir, runId), null);
  const comments = [];
  const result = await reconcileInterruptedRuns({
    dir,
    workflow,
    store,
    readJournal: () => oomJournal,
    readComments: async () => comments,
    postComment: async (_, body) => { comments.push(body); },
  });
  assert.equal(result.stopped.length, 1);
  assert.equal((await store.loadWorkflowSnapshot({ workflowName: 'card-path', runId })).status, 'canceled');
});

test('a comment whose response was lost is posted on the next boot, not twice', async t => {
  const { dir, workflow, store } = await stranded(t);
  const comments = [];
  let lose = true;
  const options = {
    dir,
    workflow,
    store,
    readJournal: () => oomJournal,
    readComments: async () => comments,
    postComment: async (_, body) => { comments.push(body); if (lose) { lose = false; throw new Error('response lost'); } },
  };
  await reconcileInterruptedRuns(options);
  assert.equal((await store.loadWorkflowSnapshot({ workflowName: 'card-path', runId })).status, 'canceled');
  assert.equal(comments.length, 1);
  const second = await reconcileInterruptedRuns({ ...options, postComment: async (_, body) => { comments.push(body); } });
  // The comment did reach the card even though its response was lost, so the
  // retry reads it back and does not post a second copy.
  assert.deepEqual(second.failed, []);
  assert.equal(comments.length, 1);
  const third = await reconcileInterruptedRuns({ ...options, postComment: async (_, body) => { comments.push(body); } });
  assert.deepEqual(third.stopped, []);
  assert.equal(comments.length, 1);
});
