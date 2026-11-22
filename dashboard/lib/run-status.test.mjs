import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRunStatus } from './run-status.mjs';

function withRunDb(fill) {
  const dir = mkdtempSync(join(tmpdir(), 'run-status-'));
  const file = join(dir, 'state.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE mastra_workflow_runs (workflow_name TEXT, run_id TEXT, status TEXT, createdAt TEXT, updatedAt TEXT)');
  fill(db);
  db.close();
  return { file, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('the newest card-path run is the one the screen shows', () => {
  const { file, clean } = withRunDb(db => {
    db.prepare('INSERT INTO mastra_workflow_runs VALUES (?, ?, ?, ?, ?)').run('some-other-flow', 'r0', 'success', '2026-11-22T08:00:00Z', '2026-11-22T08:05:00Z');
    db.prepare('INSERT INTO mastra_workflow_runs VALUES (?, ?, ?, ?, ?)').run('card-path', 'r1', 'running', '2026-11-22T09:00:00Z', '2026-11-22T09:04:00Z');
  });
  assert.deepEqual(readRunStatus(file), {
    workflow: 'card-path',
    runId: 'r1',
    status: 'running',
    createdAt: Date.parse('2026-11-22T09:00:00Z'),
    updatedAt: Date.parse('2026-11-22T09:04:00Z'),
  });
  clean();
});

test('a missing file or a foreign schema is no run, not a crash', () => {
  assert.equal(readRunStatus(join(tmpdir(), 'run-status-absent', 'state.db')), null);
  const dir = mkdtempSync(join(tmpdir(), 'run-status-empty-'));
  const db = new DatabaseSync(join(dir, 'state.db'));
  db.exec('CREATE TABLE something_else (id TEXT)');
  db.close();
  assert.equal(readRunStatus(join(dir, 'state.db')), null);
  rmSync(dir, { recursive: true, force: true });
});
