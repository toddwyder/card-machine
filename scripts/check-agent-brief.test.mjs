import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  CHECKS, checkCriterion, checkDraft, contextFor, findCopiedText, parseDraft, renderChecked, writeChecked,
} from './check-agent-brief.mjs';

// The draft the machine checks: line 1 is the Linear title, the rest is the card.
const GOOD = `# The draft checker names each fault in plain words

Read .agents/skills/poteto-mode/SKILL.md and follow it.

## Goal

Todd reads one short section at the end of a draft and knows what still stands between him and approval.

## Done means

- A draft that breaks one rule names that rule on one line of the Checked section.
- The Checked section sits at the end of the draft and a second run leaves it alone.
- The command that checks a draft exits nonzero while any rule fails.
- Every rule reads the draft through the card reader that \`machine/flow/task.mjs\` owns.

## Proof

- \`node --test scripts/check-agent-brief.test.mjs\` prints one case per rule, and its output names every rule.
- \`node scripts/check-agent-brief.mjs\` runs twice on a draft, and the saved section holds one heading on the second run.
- The same command on a draft with one broken rule exits with status 1, and its printed section names that rule on one line.
- \`machine/flow/task.mjs\` exports the heading table, and the test compares its part list with the list the checker prints.

## What we know

- The checker reads headings through the card reader, and the reader's table lives in \`machine/flow/task.mjs\`.
- The five writing-for-agents rules already run on every draft, as records in \`scripts/check-agent-brief.mjs\`.
- Todd judges wording at approval and the fresh review reads the same section, per \`docs/review.md\` and the [guide](https://example.com/guide).

## Constraints

- The exact words live in the checker code, and this card says what each check reads in plain words.
- No model call sits anywhere in the check.
`;

const NO_LINK = 'The card sits per `docs/review.md`.';
const COPIED = 'The draft names each rule it breaks and leaves every passing rule alone.';
const COPIED_DOC = `# Rules\n\nOne hard rule. ${COPIED}\n`;

const NAMED = ['machine/flow/task.mjs', 'scripts/check-agent-brief.test.mjs', 'scripts/check-agent-brief.mjs', 'docs/review.md'];

function project(t, { agents = '# Rules\n\nWrite the observed behavior.\n' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'card-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  for (const path of NAMED) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), '');
  }
  writeFileSync(join(directory, 'AGENTS.md'), agents);
  return directory;
}

const okLink = async () => ({ status: 'ok' });

function context(root, fetchLink = okLink) {
  return contextFor({ root, fetchLink });
}

const statuses = results => results.filter(result => result.status === 'failed').map(result => result.id);

async function check(t, text, options = {}) {
  const root = project(t, options);
  return { root, results: await checkDraft(parseDraft(text), context(root, options.fetchLink)) };
}

function offline(text) {
  return edit(text, ' per `docs/review.md` and the [guide](https://example.com/guide).', `. ${NO_LINK}`);
}

function edit(text, from, to) {
  assert.ok(text.includes(from), `the good card holds "${from}"`);
  return text.replace(from, to);
}

const DONE_LINE_ONE = '- A draft that breaks one rule names that rule on one line of the Checked section.';
const DONE_LINE_TWO = '- The Checked section sits at the end of the draft and a second run leaves it alone.';
const DONE_LINE_THREE = '- The command that checks a draft exits nonzero while any rule fails.';
const DONE_LINE_FOUR = '- Every rule reads the draft through the card reader that `machine/flow/task.mjs` owns.';
const PROOF_LINE_ONE = '- `node --test scripts/check-agent-brief.test.mjs` prints one case per rule, and its output names every rule.';
const PROOF_LINE_THREE = '- The same command on a draft with one broken rule exits with status 1, and its printed section names that rule on one line.';
const PROOF_LINE_FOUR = '- `machine/flow/task.mjs` exports the heading table, and the test compares its part list with the list the checker prints.';
const KNOWN_LINE_TWO = "- The five writing-for-agents rules already run on every draft, as records in `scripts/check-agent-brief.mjs`.";

test('the good card passes every check', async t => {
  const { results } = await check(t, GOOD);
  assert.deepEqual(statuses(results), []);
  assert.equal(results.length, 16);
  assert.deepEqual(results.map(result => result.id), CHECKS.map(check => check.id));
  assert.equal(results.filter(result => result.status !== 'passed').length, 0, renderChecked(results));
});

test('the good card under the other done-means heading gives the same results', async t => {
  const one = await check(t, GOOD);
  const other = await check(t, GOOD.replace('## Done means', '## Acceptance criteria'));
  assert.deepEqual(statuses(other.results), []);
  assert.deepEqual(other.results, one.results);
});

// One planted mistake per check, on the good card, fails that check and no other.
const PLANTS = [
  {
    id: 'copied-text',
    card: () => edit(GOOD, DONE_LINE_ONE, `- ${COPIED}`),
    options: { agents: COPIED_DOC },
  },
  {
    id: 'done-means',
    card: () => GOOD.replace(/## Done means[\s\S]*?(?=## What we know)/, ''),
  },
  {
    id: 'outcome-form',
    card: () => edit(GOOD, DONE_LINE_ONE, '- Add one line per broken rule to the Checked section.'),
  },
  {
    id: 'implementation-words',
    card: () => edit(GOOD, DONE_LINE_TWO, '- The Checked section sits at the end of the file and a second run leaves it alone.'),
  },
  {
    id: 'negations',
    card: () => edit(GOOD, DONE_LINE_TWO, '- The Checked section never carries a rule that passed.'),
  },
  {
    id: 'five-lines',
    card: () => edit(
      edit(GOOD, DONE_LINE_FOUR, `${DONE_LINE_FOUR}\n- Each passing rule takes one line of the section.\n- A run on a draft with every rule clear exits with status 0.`),
      PROOF_LINE_FOUR,
      `${PROOF_LINE_FOUR}\n- \`node --test scripts/check-agent-brief.test.mjs\` covers the passing-rule line, and its output shows that case.\n- \`node scripts/check-agent-brief.mjs\` on the good draft exits 0 and prints one line per rule.`,
    ),
  },
  {
    id: 'proof-count',
    card: () => GOOD.replace(`${PROOF_LINE_FOUR}\n`, ''),
  },
  {
    id: 'proof-evidence',
    card: () => edit(GOOD, PROOF_LINE_ONE, '- The build status is green.'),
  },
  {
    id: 'opener',
    card: () => edit(GOOD, 'Read .agents/skills/poteto-mode/SKILL.md and follow it.', 'Read the poteto skill before the work.'),
  },
  {
    id: 'references',
    card: () => edit(GOOD, '`node scripts/check-agent-brief.mjs` runs twice', '`node scripts/gone.mjs` runs twice'),
  },
  {
    id: 'headings',
    card: () => `${GOOD}\n## Risks\n\nThe card may grow past five lines one day.\n`,
  },
  {
    id: 'stop-and-ask',
    card: () => edit(GOOD, '- No model call sits anywhere in the check.', '- No model call sits anywhere in the check.\n- The run stops and asks Todd before the card changes.'),
  },
  {
    id: 'stop-and-ask',
    card: () => edit(GOOD, DONE_LINE_THREE, '- The card record is written before another build reads it during a race.'),
  },
  {
    id: 'todd-approval',
    card: () => edit(GOOD, '- No model call sits anywhere in the check.', '- No model call sits anywhere in the check.\n- Todd approved the wording before the build started.'),
  },
  {
    id: 'model-names',
    card: () => edit(GOOD, '- No model call sits anywhere in the check.', '- No model call sits anywhere in the check.\n- The determination runs on claude-opus-5.'),
  },
  {
    id: 'known-pointers',
    card: () => edit(GOOD, KNOWN_LINE_TWO, '- The five writing-for-agents rules already run on every draft.'),
  },
  {
    id: 'appearance',
    card: () => edit(
      edit(GOOD, DONE_LINE_THREE, '- The page looks polished after the second run.'),
      DONE_LINE_FOUR,
      '- The buttons look consistent on a narrow screen.',
    ),
  },
];

for (const plant of PLANTS) {
  test(`a card with one ${plant.id} mistake fails only that check`, async t => {
    const { results } = await check(t, plant.card(), plant.options);
    assert.deepEqual(statuses(results), [plant.id]);
  });
}

test('an event-order line with a formal verification run in its proof passes', async t => {
  const card = edit(
    edit(GOOD, DONE_LINE_THREE, '- The card record is written before another build reads it during a race.'),
    PROOF_LINE_THREE,
    '- The same command on a draft with one broken rule exits with status 1, and the TLA+ run prints the order.',
  );
  const { results } = await check(t, card);
  assert.deepEqual(statuses(results), []);
});

test('a card with several mistakes names each failed check', async t => {
  const card = edit(
    edit(GOOD, DONE_LINE_ONE, '- Add one line per broken rule to the Checked section.'),
    DONE_LINE_TWO,
    '- The Checked section never carries a rule that passed.',
  );
  const { results } = await check(t, card);
  assert.deepEqual(statuses(results), ['outcome-form', 'negations']);
  const section = renderChecked(results);
  assert.match(section, /Failed: Done-means lines describe an outcome/);
  assert.match(section, /Failed: Done-means lines carry no negation/);
  assert.match(section, /2 of 16 checks failed, so the card is not ready\./);
});

test('a slash in a backticked choice is not a missing path', async t => {
  const choices = await check(t, edit(GOOD, DONE_LINE_THREE, '- The build runs on `free/paid`, and the card says which.'));
  assert.deepEqual(statuses(choices.results), []);

  const gone = await check(t, edit(GOOD, DONE_LINE_THREE, '- The build opens `scripts/beta` at start.'));
  assert.deepEqual(statuses(gone.results), ['references']);
});

test('a made-up link fails and an unreachable one is not checked', async t => {
  const missing = await check(t, GOOD, { fetchLink: async () => ({ status: 'missing' }) });
  assert.deepEqual(statuses(missing.results), ['references']);

  const unreachable = await check(t, GOOD, { fetchLink: async () => ({ status: 'unreachable', reason: 'no answer in 5 seconds' }) });
  assert.deepEqual(statuses(unreachable.results), []);
  const row = unreachable.results.find(result => result.id === 'references');
  assert.equal(row.status, 'not checked');
  assert.match(renderChecked(unreachable.results), /Not checked: Every file, script, skill and link the card names resolves\./);
  assert.match(renderChecked(unreachable.results), /All 15 checks passed and 1 could not be checked/);
});

test('a second run leaves exactly one Checked section and the same wording', async t => {
  const { results } = await check(t, GOOD);
  const once = writeChecked(GOOD, results);
  const twice = writeChecked(once, await checkDraft(parseDraft(once), context(project(t))));
  assert.equal(twice, once);
  assert.equal(once.match(/^## Checked$/gm).length, 1);
  assert.match(once, /All 16 checks passed\./);
  assert.ok(once.trimEnd().endsWith('All 16 checks passed.'));
});

test('the section sits last and the card above it is left as it was', async t => {
  const { results } = await check(t, GOOD);
  const written = writeChecked(GOOD, results);
  assert.ok(written.startsWith(GOOD.trimEnd()));
  assert.ok(written.includes('\n\n## Checked\n\n'));
});

test('the draft file itself is not a doc the card copies from', async t => {
  const root = project(t);
  writeFileSync(join(root, 'draft.md'), GOOD);
  const results = await checkDraft(parseDraft(GOOD), contextFor({ root, fetchLink: okLink }));
  assert.deepEqual(statuses(results), []);
});

test('refuses text copied from a repository doc', () => {
  const findings = findCopiedText({ text: COPIED, docs: [{ file: 'AGENTS.md', text: `Rule: ${COPIED}` }] });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /copies text from AGENTS\.md/);
});

test('refuses a procedural criterion', () => {
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'Add a checklist to the dashboard.' }), [
    'AC1 is procedural ("add ..."); write the observed outcome instead',
  ]);
});

test('refuses an implementation word in a criterion', () => {
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'The dashboard renders the JSON payload.' }), [
    'AC1 uses the implementation word "JSON"; describe what Todd sees instead',
  ]);
});

test('refuses a negation in a criterion', () => {
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'The dashboard does not show pending steps.' }), [
    'AC1 uses the negation "not"; state the positive behavior instead',
  ]);
});

test('accepts an outcome criterion with no implementation words or negations', () => {
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'Each skipped step shows its own count.' }), []);
});

test('accepts a PR, which Todd reads on GitHub', () => {
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'The PR carries the title the building agent wrote.' }), []);
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'Shipping runs the pull request itself.' }), []);
});

test('refuses a criterion that names a specific model', () => {
  const findings = checkCriterion({ id: 'AC1', text: 'The determination names commandcode/reflection/beam:free.' });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /AC1 names the model "commandcode\//);
});

test('accepts a criterion that names a kind of model', () => {
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'The Shipping review runs on a free model.' }), []);
  assert.deepEqual(checkCriterion({ id: 'AC1', text: 'The build runs on a paid model.' }), []);
});

test('refuses a criterion naming a model family only', () => {
  const findings = checkCriterion({ id: 'AC1', text: 'The build runs on DeepSeek.' });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /names the model "deepseek"/i);
});

test('the required poteto-mode opener is not reported as copied text', () => {
  const opener = 'Read .agents/skills/poteto-mode/SKILL.md and follow it.';
  const docs = [{ file: 'handoff.md', text: `Prompt: ${opener} Then the work.` }];
  assert.deepEqual(findCopiedText({ text: `${opener}\n\n## Goal\n\nSomething new.`, docs }), []);
  const copied = 'The dashboard shows every finished step together with the time each step took to finish.';
  assert.equal(findCopiedText({ text: `${opener}\n\n${copied}`, docs: [{ file: 'AGENTS.md', text: `Rule: ${copied}` }] }).length, 1);
});

test('the command rewrites the draft, prints the section and exits nonzero on a failure', t => {
  const root = project(t);
  const file = join(root, 'draft.md');
  writeFileSync(file, edit(offline(GOOD), DONE_LINE_ONE, '- Add one line per broken rule to the Checked section.'));
  const command = [join(import.meta.dirname, 'check-agent-brief.mjs'), file, '--root', root];

  const first = spawnSync(process.execPath, command, { encoding: 'utf8' });
  assert.equal(first.status, 1);
  assert.match(first.stdout, /Failed: Done-means lines describe an outcome/);
  assert.match(readFileSync(file, 'utf8'), /## Checked/);

  const second = spawnSync(process.execPath, command, { encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.equal(readFileSync(file, 'utf8').match(/^## Checked$/gm).length, 1);
  assert.equal(second.stdout, first.stdout);
});

test('the command exits zero and leaves one section when every check passes', t => {
  const root = project(t);
  const file = join(root, 'draft.md');
  writeFileSync(file, offline(GOOD));
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'check-agent-brief.mjs'), file, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /All 16 checks passed\./);
  assert.equal(readFileSync(file, 'utf8').match(/^## Checked$/gm).length, 1);
});
