import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STAGE_LABELS, stageLabel } from './stage-labels.mjs';

const steps = readFileSync(new URL('../../machine/flow/steps.mjs', import.meta.url), 'utf8');

// The stages the machine can run, read from the workflow's own return block so a stage added
// there fails this test until the screen can name it.
function machineStageIds() {
  const block = steps.slice(steps.lastIndexOf('return {'));
  const names = [...block.matchAll(/[A-Za-z][A-Za-z0-9]*/g)].map(match => match[0]);
  const ids = [];
  for (const name of names) {
    const at = steps.indexOf(`const ${name} = `);
    if (at === -1) continue;
    const tail = steps.slice(at, at + 240);
    const id = /id: '([a-z0-9-]+)'/.exec(tail)?.[1] ?? /step\(\s*'([a-z0-9-]+)'/.exec(tail)?.[1];
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

test('every stage the machine runs has a plain-English name', () => {
  const ids = machineStageIds();
  assert.ok(ids.includes('start'), 'the stage reader found the machine stages');
  assert.ok(ids.length >= 19, `read ${ids.length} stages from machine/flow/steps.mjs`);
  const unnamed = ids.filter(id => !STAGE_LABELS[id]);
  assert.deepEqual(unnamed, [], `dashboard/lib/stage-labels.mjs is missing: ${unnamed.join(', ')}`);
});

test('a stage id with no entry still reads as words', () => {
  assert.equal(stageLabel('flow-build'), 'Build the slices');
  assert.equal(stageLabel('brand-new-stage'), 'Brand new stage');
  assert.equal(stageLabel(''), 'Unknown stage');
});
