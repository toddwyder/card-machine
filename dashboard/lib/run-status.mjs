// The run's own row from the machine's SQLite state, read without touching the run's files.
// Only plain columns are read: the saved workflow snapshot beside them is msgpack, which this
// screen has no reader for and does not need.

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const WORKFLOW = 'card-path';

function toMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Read the newest `card-path` run row, or null when the file is missing or unreadable. */
export function readRunStatus(stateDb, { workflow = WORKFLOW } = {}) {
  if (!stateDb || !existsSync(stateDb)) return null;
  let db;
  try {
    db = new DatabaseSync(stateDb, { readOnly: true });
    const rows = db
      .prepare('SELECT workflow_name, run_id, status, createdAt, updatedAt FROM mastra_workflow_runs ORDER BY updatedAt DESC LIMIT 20')
      .all();
    const row = rows.find(candidate => candidate.workflow_name === workflow) ?? rows[0] ?? null;
    if (!row) return null;
    return {
      workflow: String(row.workflow_name ?? ''),
      runId: String(row.run_id ?? ''),
      status: String(row.status ?? ''),
      createdAt: toMs(row.createdAt),
      updatedAt: toMs(row.updatedAt),
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // The file was only ever read; a failed close must not fail the screen.
    }
  }
}
