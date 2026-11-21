import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mastra } from '@mastra/core';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { LibSQLStore } from '@mastra/libsql';
import { z } from 'zod';
import { pendingInterruptedRuns, stopInterruptedRun } from './crash-stop.mjs';

const runId = '11111111-1111-4111-8111-111111111111';
const childProgram = `
  import { Mastra } from '@mastra/core';
  import { createStep, createWorkflow } from '@mastra/core/workflows';
  import { LibSQLStore } from '@mastra/libsql';
  import { z } from 'zod';
  const schema = z.object({});
  const config = { inputSchema: schema, outputSchema: schema, options: { autoRestartActiveRuns: false } };
  const step = createStep({ id: 'busy', inputSchema: schema, outputSchema: schema, execute: async () => { console.log('READY'); await new Promise(() => {}); } });
  const nested = createWorkflow({ ...config, id: 'build-round' }).then(step).commit();
  const workflow = createWorkflow({ ...config, id: 'card-path' }).then(nested).commit();
  const mastra = new Mastra({ workflows: { 'card-path': workflow }, storage: new LibSQLStore({ id: 'state', url: 'file:' + process.env.TEST_DB }) });
  await mastra.getStorage().init();
  setInterval(() => {}, 10000);
  const run = await mastra.getWorkflow('card-path').createRun({ runId: '${runId}' });
  await run.start({ inputData: {} });
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

test('interrupted nested run is canceled and a lost comment response is reconciled once', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'crash-stop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = join(dir, 'state.db');
  await killRunningChild(db);
  const schema = z.object({});
  const config = { inputSchema: schema, outputSchema: schema, options: { autoRestartActiveRuns: false } };
  const step = createStep({ id: 'busy', inputSchema: schema, outputSchema: schema, execute: async () => ({}) });
  const nested = createWorkflow({ ...config, id: 'build-round' }).then(step).commit();
  const workflow = createWorkflow({ ...config, id: 'card-path' }).then(nested).commit();
  const mastra = new Mastra({ workflows: { 'card-path': workflow }, storage: new LibSQLStore({ id: 'state', url: `file:${db}` }) });
  await mastra.getStorage().init();
  t.after(() => mastra.shutdown());
  const store = await mastra.getStorage().getStore('workflows');
  const comments = [];
  let loseResponse = true;
  const options = {
    dir: join(dir, 'outbox'), workflow: mastra.getWorkflow('card-path'), store, runId, card: 'JUL-361', cause: 'Studio was interrupted',
    readComments: async () => comments,
    postComment: async (_, body) => { comments.push(body); if (loseResponse) { loseResponse = false; throw new Error('response lost'); } },
  };
  assert.equal((await store.loadWorkflowSnapshot({ workflowName: 'card-path', runId })).status, 'running');
  assert.equal((await store.loadWorkflowSnapshot({ workflowName: 'build-round', runId })).status, 'running');
  await assert.rejects(stopInterruptedRun(options), /response lost/);
  assert.equal((await store.loadWorkflowSnapshot({ workflowName: 'card-path', runId })).status, 'canceled');
  assert.equal((await store.loadWorkflowSnapshot({ workflowName: 'build-round', runId })).status, 'canceled');
  assert.equal(pendingInterruptedRuns(options.dir).length, 1);
  await assert.rejects(stopInterruptedRun({
    ...options,
    readComments: async () => { throw new Error('comment lookup unavailable'); },
  }), /comment lookup unavailable/);
  assert.equal(comments.length, 1);
  assert.equal(pendingInterruptedRuns(options.dir).length, 1);
  await assert.rejects(stopInterruptedRun({ ...options, cause: 'a different cause' }), /Conflicting interrupted run record/);
  await stopInterruptedRun(options);
  assert.equal(comments.length, 1);
  assert.match(comments[0], /Studio was interrupted/);
  assert.equal(pendingInterruptedRuns(options.dir).length, 0);
});
