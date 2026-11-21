import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ATTEMPT, BUILD_ROUND, FIX_AND_LAND, REVIEW_PHASE, REVIEW_ROUND, SMOKE_LOOP, SMOKE_ROUND } from './schema.mjs';

const nestedWorkflows = [ATTEMPT, BUILD_ROUND, FIX_AND_LAND, REVIEW_PHASE, REVIEW_ROUND, SMOKE_LOOP, SMOKE_ROUND];
const marker = runId => `<!-- interrupted-run:${runId} -->`;

function recordPath(dir, runId) {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error('Invalid run ID');
  return join(dir, `${runId}.json`);
}

function save(path, record) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
  renameSync(temporary, path);
}

// Call only after the process that owned the run and its children have stopped.
// The record comes first so a crash between cancellation and commenting retries.
export async function stopInterruptedRun({ dir, workflow, store, runId, card, cause, readComments, postComment }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = recordPath(dir, runId);
  let record;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    record = { runId, card, cause, notified: false };
    save(path, record);
  }
  if (record.runId !== runId || record.card !== card || record.cause !== cause) throw new Error('Conflicting interrupted run record');
  if (record.notified) return record;

  const run = await workflow.createRun({ runId });
  await run.cancel();
  const root = await store.loadWorkflowSnapshot({ workflowName: workflow.id, runId });
  if (root?.status !== 'canceled') throw new Error(`Run ${runId} was not canceled in storage`);

  for (const workflowName of nestedWorkflows) {
    const snapshot = await store.loadWorkflowSnapshot({ workflowName, runId });
    if (snapshot?.status !== 'running') continue;
    if (!store.supportsGuardedSnapshotWrites()) throw new Error('Storage cannot safely cancel nested snapshots');
    await store.persistWorkflowSnapshot({ workflowName, runId, snapshot: { ...snapshot, status: 'canceled' }, expectedStatus: 'running' });
    const after = await store.loadWorkflowSnapshot({ workflowName, runId });
    if (after?.status === 'running') throw new Error(`Nested run ${workflowName}/${runId} was not canceled`);
  }

  const comments = await readComments(card);
  if (!comments.some(body => body.includes(marker(runId)))) {
    await postComment(card, `${marker(runId)}\nRun ${runId} stopped because ${cause}. The interrupted work was not replayed.`);
  }
  save(path, { ...record, notified: true });
  return { ...record, notified: true };
}

export function pendingInterruptedRuns(dir) {
  try {
    return readdirSync(dir).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(dir, name), 'utf8'))).filter(record => !record.notified);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
