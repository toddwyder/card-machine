// A run directory the Run view can be pointed at, built from committed fixtures so the screen
// has something real to fold while no card is running. Both the server under test and the spec
// use the same paths, so the spec can grow the event log and watch the page keep up.

import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const here = new URL('.', import.meta.url);
export const FLOW_DIR = new URL('./test-results/flow', here).pathname;
export const LIVE_FILE = join(FLOW_DIR, 'live.jsonl');
export const SUBSCRIPTIONS_FILE = join(FLOW_DIR, 'subscriptions.json');

const SOURCE_EVENTS = new URL('../lib/fixtures/live/running.jsonl', here).pathname;
// The fixture's own clock, so a card built months ago still reads as running now.
const SOURCE_NOW = 1763700050000;

export function buildFixture(now = Date.now()) {
  rmSync(FLOW_DIR, { recursive: true, force: true });
  mkdirSync(FLOW_DIR, { recursive: true });

  const shift = now - SOURCE_NOW;
  const lines = readFileSync(SOURCE_EVENTS, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const event = JSON.parse(line);
      event.at += shift;
      return JSON.stringify(event);
    });
  writeFileSync(LIVE_FILE, `${lines.join('\n')}\n`);

  const resetsSoon = now + 3 * 60 * 60 * 1000;
  const resetsLater = now + 4 * 24 * 60 * 60 * 1000;
  writeFileSync(
    SUBSCRIPTIONS_FILE,
    JSON.stringify(
      [
        {
          id: 'claude',
          name: 'Claude',
          status: 'fresh',
          readAt: now,
          windows: [
            { window: 'five_hour', percentLeft: 11, resetsAt: resetsSoon },
            { window: 'weekly', percentLeft: 98, resetsAt: resetsLater },
          ],
        },
        {
          id: 'chatgpt',
          name: 'ChatGPT',
          status: 'fresh',
          readAt: now,
          windows: [
            { window: 'five_hour', percentLeft: 64, resetsAt: resetsSoon },
            { window: 'weekly', percentLeft: 88, resetsAt: resetsLater },
          ],
        },
        { id: 'commandcode', name: 'CommandCode', status: 'unknown', readAt: now, reason: 'the reading failed' },
      ],
      null,
      2,
    ),
  );

  const db = new DatabaseSync(join(FLOW_DIR, 'state.db'));
  db.exec('CREATE TABLE mastra_workflow_runs (workflow_name text, run_id text, status text, createdAt integer, updatedAt integer)');
  db.prepare('INSERT INTO mastra_workflow_runs VALUES (?, ?, ?, ?, ?)').run('card-path', 'fixture-run', 'running', now - 50 * 60 * 1000, now - 1000);
  db.close();
  return FLOW_DIR;
}

export function appendEvent(event) {
  appendFileSync(LIVE_FILE, `${JSON.stringify(event)}\n`);
}
