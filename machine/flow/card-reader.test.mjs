// One card, read four ways. The heading a card uses for its done check and the Checked section the
// checker leaves behind must not change what any reader sees.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CHECKED_HEADING, CARD_PARTS, cardSections, criteriaFromCard, taskFromCard, withoutChecked } from './task.mjs';
import { reviewTask as flowReviewTask } from './review.mjs';

const CARD = { identifier: 'JUL-950', title: 'The card reader reads one shape' };

const LINES = [
  'The reader takes its lines from the done check: `node --test machine/flow/card-reader.test.mjs` prints its pass count.',
  'The reader skips the Checked section: `node --test machine/flow/card-reader.test.mjs` exits 0.',
];

const CHECKED = ['## Checked', '', 'Passed. The done check reads under both names.', 'Failed. None.', ''];

const description = ({ heading, checked }) => [
  '## Goal',
  'One reader reads every card the same way.',
  '',
  heading,
  ...LINES.map(line => `- ${line}`),
  '',
  '## Proof',
  'A test drives one card four ways.',
  '',
  '## What we know',
  'The reader had two criteria copies: `machine/flow/review.mjs`.',
  '',
  '## Constraints',
  'No new dependency.',
  '',
  ...(checked ? CHECKED : []),
].join('\n');

const FORMS = [
  { name: 'done means, no Checked', heading: '## Done means', checked: false },
  { name: 'done means, with Checked', heading: '## Done means', checked: true },
  { name: 'acceptance criteria, no Checked', heading: '## Acceptance criteria', checked: false },
  { name: 'acceptance criteria, with Checked', heading: '## Acceptance criteria', checked: true },
];

test('one card in four forms gives every reader the same criteria', () => {
  const seen = FORMS.map(form => {
    const text = description(form);
    return {
      name: form.name,
      criteria: criteriaFromCard(text),
      task: taskFromCard({ ...CARD, description: text }),
      parts: cardSections(text).map(section => section.part),
    };
  });

  for (const form of seen) {
    assert.deepEqual(form.criteria, LINES, `${form.name}: every done-check line is a criterion`);
    assert.deepEqual(form.parts, ['Goal', 'Done check', 'Proof', 'What is already known', 'Constraints'], `${form.name}: the same parts are read`);
    assert.ok(!JSON.stringify(form).includes('Passed.'), `${form.name}: nothing from the Checked section reaches a reader`);
  }
  assert.equal(new Set(seen.map(form => form.task)).size, 1, 'the Lead gets the same task from all four forms');
  assert.equal(new Set(seen.map(form => JSON.stringify(form.criteria))).size, 1, 'the reviewers get the same criteria from all four forms');
  assert.match(seen[0].task, /Done check\n- The reader takes its lines/);
});

test('the Checked section comes off, and text without one is left alone', () => {
  const plain = '## Goal\nIt works.\n';
  assert.equal(withoutChecked(plain), plain, 'text with no Checked section is unchanged character for character');

  const withChecked = `## Goal\nIt works.\n\n${CHECKED.join('\n')}`;
  assert.equal(withoutChecked(withChecked), '## Goal\nIt works.');
  assert.equal(withoutChecked(withoutChecked(withChecked)), withoutChecked(withChecked), 'a second pass changes nothing');
  assert.equal(withoutChecked('## Checked\n\nPassed.'), '', 'a card that is only its Checked section reads as nothing');
  assert.equal(withoutChecked('## Goal\nIt is Checked by hand.\n'), '## Goal\nIt is Checked by hand.\n', 'the word in a line is not a heading');
  assert.equal(withoutChecked('### checked:\n\nPassed.'), '', 'any level and a trailing colon still name it');
  assert.equal(CHECKED_HEADING, 'Checked');
});

test('the heading table names the parts it reads', () => {
  assert.deepEqual(CARD_PARTS.map(([label]) => label), ['Goal', 'Done check', 'Proof', 'What is already known', 'Constraints']);
  assert.ok(CARD_PARTS.every(([label, names]) => names.includes(label.toLowerCase())), 'each part answers to its own label');
  assert.ok(CARD_PARTS.find(([label]) => label === 'Done check')[1].includes('done means'));
});

test('the Shipping prompt quotes the card without its Checked section', () => {
  const card = { ...CARD, description: description(FORMS[1]) };
  const prompt = flowReviewTask({ pr: 1, sha: 'abc1234', checkout: '/tmp', card, criteria: LINES });
  assert.match(prompt, /The reader takes its lines from the done check/);
  assert.doesNotMatch(prompt, /## Checked|Passed\. The done check/);
});

test('the readers that used to hold their own copy take the one reader instead', () => {
  for (const path of ['machine/flow/review.mjs', 'machine/shipping/determination.mjs']) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /function criteriaFromCard/, `${path} keeps no copy`);
  }
  for (const path of ['machine/flow/steps.mjs', 'machine/shipping/workflow.mjs', 'machine/remediation/workflow.mjs']) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    assert.match(source, /criteriaFromCard[^}]*\} from '\.\.?\/(?:\.\.\/)?(?:flow\/)?task\.mjs'/, `${path} asks the card reader for its criteria`);
  }
});
