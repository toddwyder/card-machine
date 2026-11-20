import { test } from 'node:test';
import assert from 'node:assert/strict';

import { approve, approvedCard, checkedPassed, parseArgs } from './approve-card.mjs';

// Trailing spaces are written as a constant so the character-for-character
// comparison below can see them.
const trail = '   ';
const body = [
  'Read .agents/skills/poteto-mode/SKILL.md and follow it.',
  '',
  '## Goal',
  '',
  `A draft card is checked by one script.${trail}`,
  '',
  '### A sub-heading inside Goal',
  '',
  '```js',
  `const kept = 'fenced';${trail}`,
  '```',
  '',
  '## Done means',
  '',
  '- One line.',
  '- Another line.',
];
const checked = ['', '## Checked', '', 'Passed: the done means are read', 'Passed: one proof per line', 'All checks passed.'];
const draft = ['# The card checker writes its result on the card', ...body, ...checked, ''].join('\n');
const description = body.join('\n');

test('approvedCard returns the draft minus its Checked section, character for character', () => {
  const card = approvedCard(draft);
  assert.equal(card.title, 'The card checker writes its result on the card');
  assert.equal(card.description, description);
  assert.ok(card.description.includes(`const kept = 'fenced';${trail}`), 'trailing spaces inside the body survive');
  assert.ok(!card.description.includes('## Checked'));
});

test('approvedCard drops the blank lines between the title and the description', () => {
  assert.equal(approvedCard('# A title\n\n\n## Goal\n- one\n').description, '## Goal\n- one\n');
});

test('a Checked section that passed lets the card through', () => {
  assert.equal(checkedPassed(draft), true);
});

test('a draft with no Checked section or an empty one is refused, and Linear is untouched', async () => {
  const calls = [];
  const deps = {
    updateIssue: async () => { calls.push('updateIssue'); return { identifier: 'JUL-407', url: 'u' }; },
    createIssue: async () => { calls.push('createIssue'); return { identifier: 'JUL-501', url: 'u' }; },
    setIssueState: async () => { calls.push('setIssueState'); },
  };
  const unchecked = ['# A title', ...body].join('\n');
  assert.equal(checkedPassed(unchecked), false);
  assert.equal(checkedPassed(`${unchecked}\n\n## Checked\n`), false);
  await assert.rejects(approve(unchecked, { kind: 'card', value: 'JUL-407' }, deps), /no Checked section that passed/);
  await assert.rejects(approve(`${unchecked}\n\n## Checked\n`, { kind: 'team', value: 'JUL' }, deps), /no Checked section that passed/);
  assert.deepEqual(calls, []);
});

test('a Checked section with a failed line is refused, and Linear is untouched', async () => {
  const calls = [];
  const deps = {
    updateIssue: async () => { calls.push('updateIssue'); return { identifier: 'JUL-407', url: 'u' }; },
    createIssue: async () => { calls.push('createIssue'); return { identifier: 'JUL-501', url: 'u' }; },
    setIssueState: async () => { calls.push('setIssueState'); },
  };
  const failed = `${draft}Failed: one proof per done-means line`;
  assert.equal(checkedPassed(failed), false);
  await assert.rejects(approve(failed, { kind: 'card', value: 'JUL-407' }, deps), /no Checked section that passed/);
  assert.deepEqual(calls, []);
});

function recorder(identifier) {
  const calls = [];
  const deps = {
    updateIssue: async (id, written) => { calls.push({ write: 'updateIssue', id, written }); return { identifier: id, url: `https://linear.app/jul/issue/${id}` }; },
    createIssue: async (input) => { calls.push({ write: 'createIssue', input }); return { identifier, url: `https://linear.app/jul/issue/${identifier}` }; },
    setIssueState: async (id, state) => { calls.push({ write: 'setIssueState', id, state }); return {}; },
  };
  return { calls, deps };
}

test('approving an existing card updates it, then moves it to Ready', async () => {
  const { calls, deps } = recorder('JUL-407');
  const issue = await approve(draft, { kind: 'card', value: 'JUL-407' }, deps);
  assert.deepEqual(calls.map(call => call.write), ['updateIssue', 'setIssueState']);
  assert.deepEqual(calls[0], { write: 'updateIssue', id: 'JUL-407', written: { title: 'The card checker writes its result on the card', description } });
  assert.deepEqual(calls[1], { write: 'setIssueState', id: 'JUL-407', state: 'Ready' });
  assert.equal(issue.url, 'https://linear.app/jul/issue/JUL-407');
});

test('approving a new card creates it in the named team, then moves the new card to Ready', async () => {
  const { calls, deps } = recorder('JUL-501');
  const issue = await approve(draft, { kind: 'team', value: 'JUL' }, deps);
  assert.deepEqual(calls.map(call => call.write), ['createIssue', 'setIssueState']);
  assert.deepEqual(calls[0].input, { teamKey: 'JUL', title: 'The card checker writes its result on the card', description });
  assert.deepEqual(calls[1], { write: 'setIssueState', id: 'JUL-501', state: 'Ready' });
  assert.equal(issue.identifier, 'JUL-501');
});

test('parseArgs reads one target flag and refuses anything else', () => {
  assert.deepEqual(parseArgs(['draft.md', '--card', 'JUL-407']), { file: 'draft.md', target: { kind: 'card', value: 'JUL-407' } });
  assert.deepEqual(parseArgs(['draft.md', '--team', 'JUL']), { file: 'draft.md', target: { kind: 'team', value: 'JUL' } });
  assert.throws(() => parseArgs(['draft.md']), /approve needs --card or --team/);
  assert.throws(() => parseArgs(['draft.md', '--card']), /--card needs one value/);
  assert.throws(() => parseArgs(['draft.md', '--card', 'JUL-407', '--team', 'JUL']), /nothing after it/);
});
