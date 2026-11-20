#!/usr/bin/env node
// approve-card.mjs -- JUL-407: Todd approves a checked draft, and this puts it
// on the board.
//
// A draft lives in a file until then, so Linear only ever holds approved text.
// The draft's Checked section is the checker's result, not card text, so it
// comes off here and everything else goes up unchanged, character for
// character. `--card` updates a card that already exists; `--team` creates one
// in that team. Either way the card ends in Ready. The Linear calls are
// injected, so the tests never reach the network.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { withoutChecked } from '../machine/flow/task.mjs';
import { createIssue, setIssueState, updateIssue } from './linear-cli.mjs';

const headingLine = /^#{1,6}[ \t]+\S/;
const titleLine = /^#[ \t]+(.+?)[ \t]*$/;

// The Checked section's lines, or null when the draft has none. The card reader
// is the one place that decides what a draft keeps, so the section is whatever
// it left behind.
export function checkedLines(text) {
  const kept = withoutChecked(text);
  if (kept === text) return null;
  const lines = String(text).slice(kept.length).split(/\r?\n/);
  const heading = lines.findIndex(line => headingLine.test(line));
  return heading === -1 ? null : lines.slice(heading + 1);
}

// The checker writes this section, and its exact all-passed wording is not
// settled yet, so the rule is the narrow one both sides agree on today: a line
// that starts "Failed:" is a failure, and a section with no lines says nothing.
export function checkedPassed(text) {
  const lines = checkedLines(text);
  if (lines === null) return false;
  const said = lines.map(line => line.trim()).filter(Boolean);
  return said.length > 0 && !said.some(line => line.startsWith('Failed:'));
}

export function approvedCard(draftText) {
  const [first = '', ...rest] = String(draftText ?? '').split(/\r?\n/);
  const title = first.match(titleLine)?.[1] ?? '';
  const description = withoutChecked(rest.join('\n')).replace(/^(?:[ \t]*\r?\n)+/, '');
  return { title, description };
}

// The two ways a card reaches the board, keyed by the flag that names them.
const TARGETS = { '--card': 'card', '--team': 'team' };

const WRITES = {
  card: (target, body, deps) => deps.updateIssue(target.value, body),
  team: (target, body, deps) => deps.createIssue({ teamKey: target.value, ...body }),
};

export async function approve(draftText, target, deps) {
  if (!checkedPassed(draftText)) {
    throw new Error('refusing to approve: the draft has no Checked section that passed. Run scripts/check-agent-brief.mjs on it and fix what it names.');
  }
  const body = approvedCard(draftText);
  if (!body.title) throw new Error('refusing to approve: the draft has no title. Its first line should read "# <title>".');
  const issue = await WRITES[target.kind](target, body, deps);
  await deps.setIssueState(issue.identifier, 'Ready');
  return issue;
}

const usage = message => Object.assign(
  new Error(`${message}\nusage: approve-card.mjs <draft.md> (--card JUL-123 | --team JUL)`),
  { exitCode: 2 },
);

export function parseArgs(argv) {
  const [file, flag, value, ...extra] = argv;
  if (!file || file.startsWith('-')) throw usage('approve needs the draft file to approve');
  const kind = TARGETS[flag];
  if (!kind) throw usage(`approve needs ${Object.keys(TARGETS).join(' or ')} to say where the card goes`);
  if (!value || extra.length) throw usage(`${flag} needs one value and nothing after it`);
  return { file, target: { kind, value } };
}

async function main() {
  const apiKey = process.env.LINEAR_API_KEY;
  try {
    const { file, target } = parseArgs(process.argv.slice(2));
    const issue = await approve(readFileSync(file, 'utf8'), target, {
      createIssue: input => createIssue(input, { apiKey }),
      updateIssue: (identifier, body) => updateIssue(identifier, body, { apiKey }),
      setIssueState: (identifier, state) => setIssueState(identifier, state, { apiKey }),
    });
    console.log(`approved ${issue.identifier}: ${issue.url}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
