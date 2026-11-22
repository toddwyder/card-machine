// The screen must find the log the machine actually writes: one per card, inside the run
// directory. These tests write logs with the machine's own writer and then look for them.

import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLiveFeed, liveFileIn } from '../../machine/flow/live.mjs';
import { findRunLog, stateDbIn } from './run-log.mjs';

const feed = file => createLiveFeed({ file, append: appendFileSync, logger: { warn() {} } });
const scratch = () => mkdtempSync(join(tmpdir(), 'run-log-'));

test('finds the log a run wrote inside its card folder', t => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'JUL-361'), { recursive: true });
  feed(liveFileIn(dir, 'JUL-361')).run({ card: 'JUL-361', title: 'A card' });
  assert.equal(findRunLog(dir), liveFileIn(dir, 'JUL-361'));
  assert.equal(stateDbIn(dir), join(dir, 'state.db'));
});

test('picks the newest card when two runs left a log', t => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const card of ['JUL-1', 'JUL-2']) mkdirSync(join(dir, card), { recursive: true });
  feed(liveFileIn(dir, 'JUL-1')).run({ card: 'JUL-1' });
  feed(liveFileIn(dir, 'JUL-2')).run({ card: 'JUL-2' });
  const older = new Date(Date.now() - 60000);
  utimesSync(liveFileIn(dir, 'JUL-2'), older, older);
  assert.equal(findRunLog(dir), liveFileIn(dir, 'JUL-1'));
});

test('reads a log written straight into the run directory', t => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'live.jsonl'), '');
  assert.equal(findRunLog(dir), join(dir, 'live.jsonl'));
});

test('answers null when the machine has written no log', t => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(findRunLog(dir), null);
  assert.equal(findRunLog(null), null);
});
