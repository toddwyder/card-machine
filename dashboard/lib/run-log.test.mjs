// The screen must find the log the machine actually writes: one per card, inside the run
// directory. These tests write logs with the machine's own writer and then look for them.

import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLiveFeed, liveFileIn } from '../../machine/flow/live.mjs';
import { chosenRunLog, findRunLog, releaseRunLog, stateDbIn } from './run-log.mjs';

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

// Two cards can run into one run directory (`.artifacts/flow/studio` beside `self-studio`), and
// the one that is not Todd's card gets appended to as well. The screen must not swap under him.
test('keeps showing the chosen run while another card is written beside it', t => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mine = join(dir, 'mine', 'live.jsonl');
  const other = join(dir, 'other', 'live.jsonl');
  mkdirSync(join(dir, 'mine'), { recursive: true });
  mkdirSync(join(dir, 'other'), { recursive: true });
  writeFileSync(mine, '');
  writeFileSync(other, '');
  const now = Date.now();
  utimesSync(mine, new Date(now), new Date(now));
  utimesSync(other, new Date(now - 1000), new Date(now - 1000));

  assert.equal(chosenRunLog(dir), mine);
  // The other card's log becomes the newest one, exactly as the machine's second run does.
  utimesSync(other, new Date(now + 5000), new Date(now + 5000));
  assert.equal(findRunLog(dir), other, 'the newest log really did change');
  assert.equal(chosenRunLog(dir), mine, 'the screen keeps the run it is showing');

  // Ending the run or losing its log frees the choice, so a newer card can take the screen.
  releaseRunLog(dir);
  assert.equal(chosenRunLog(dir), other);
  rmSync(other);
  assert.equal(chosenRunLog(dir), mine);
});
