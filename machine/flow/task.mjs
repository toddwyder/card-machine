// The card reader. One table decides which heading is which part of the card, what the Lead's task
// says, and which lines a reviewer judges. Every other module that reads a card asks this one, so a
// heading a card may use is decided in one place.

const headingPattern = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;

const normalized = text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The card checker writes its result at the end of a draft, and no reader acts on it.
export const CHECKED_HEADING = 'Checked';

const checkedName = normalized(CHECKED_HEADING);

const parts = [
  ['Goal', ['goal', 'outcome']],
  ['Done check', ['acceptance criteria', 'criteria', 'done means', 'done check']],
  ['Proof', ['proof', 'uat steps']],
  ['What is already known', ['what we know', 'what this is', 'context', 'read first', 'before this card starts']],
  ['Constraints', ['constraints', 'out of scope']],
];

// Each part also answers to its own label, so "## Goal" and "## Done check" read the same as the
// other names a card may use for them.
export const CARD_PARTS = parts.map(([label, names]) => [label, [normalized(label), ...names]]);

const headingsOf = text => [...text.matchAll(headingPattern)]
  .map(match => ({ match, name: normalized(match[2]), level: match[1].length }));

// A section ends at the next heading of the same or a higher level, so its own sub-headings
// stay inside it.
const sectionFrom = (text, heading, level) => {
  const after = text.slice(heading.index + heading[0].length);
  const next = new RegExp(`^#{1,${level}}[ \\t]+\\S`, 'm').exec(after);
  return (next ? after.slice(0, next.index) : after).trim();
};

// The Checked section and everything after it, with the blank lines before it. Text without one
// comes back character for character.
export function withoutChecked(text) {
  const source = String(text ?? '');
  const heading = headingsOf(source).find(candidate => candidate.name === checkedName);
  if (!heading) return source;
  return source.slice(0, heading.match.index).replace(/\s+$/, '');
}

// The parts a card names, in table order, each with its body.
export function cardSections(description) {
  const text = withoutChecked(description);
  const headings = headingsOf(text);
  return CARD_PARTS.flatMap(([part, names]) => {
    const heading = names.map(name => headings.find(candidate => candidate.name === name)).find(Boolean);
    if (!heading) return [];
    const body = sectionFrom(text, heading.match, heading.level);
    return body ? [{ part, heading: heading.match[2], level: heading.level, body }] : [];
  });
}

const criterionBullet = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?(.+)$/;

// The done-check lines a reviewer judges. As before, only the text under the heading itself counts,
// so a sub-heading under it is not read as a criterion.
export function criteriaFromCard(description) {
  const done = cardSections(description).find(section => section.part === 'Done check');
  if (!done) return [];
  const sub = /^#{1,6}[ \t]+\S/m.exec(done.body);
  const text = sub ? done.body.slice(0, sub.index) : done.body;
  return text
    .split(/\r?\n/)
    .map(line => line.match(criterionBullet))
    .filter(Boolean)
    .map(match => match[1].trim())
    .filter(line => line.length > 0);
}

export function taskFromCard(card) {
  const description = withoutChecked(card?.description);
  const sections = cardSections(description);
  const named = card?.identifier && card?.title ? `Linear card ${card.identifier}: ${card.title}` : 'The card';
  if (sections.length === 0) return description.trim() ? `${named}\n\n${description.trim()}` : named;
  return [named, ...sections.map(({ part, body }) => `## ${part}\n${body}`)].join('\n\n');
}

const PLAYBOOK_NOTE = [
  '## Playbook step',
  'As your first act before any other tool call, call `choose_playbook` with the poteto-mode playbook name for this card (for example `feature`, `bug-fix`, `investigation`, `refactoring`). You have no shell or file-writing tools; delegate every command, code edit, test, git operation, Linear update, and verification to the appropriate helper. The checkout named above is the only place to work: every path written must be inside it, and card commands run with the rest of the server read only. Its dependencies are already installed, so never run an installer (npm ci, npm install, bun install, pnpm install) and never make another copy or worktree of a repository; tell a helper to report a missing dependency to you instead. Keep every `playbook_*` item\'s content word for word (only append `skip: <reason>` when leaving a step undone); use `task_complete` or `task_update` with `status` alone to mark a step done (read a named skill\'s `SKILL.md` before marking its step done), and place any step-required sub-items (such as Feature step 3\'s four throughput checkpoint items) immediately after that step rather than overwriting it. Do not push or run `gh pr create` yourself; the machine runs the repository checks and opens the pull request. For the **Opening a PR** step, call `write_pr` with the PR `title` and `body` (naming the card and following Opening a PR\'s sections) after your code is committed.',
].join('\n');

export function buildTaskPrompt(issue, checkReasons = []) {
  const backNote = checkReasons.length > 0 ? `\n\n## Previous check failure\n${checkReasons.at(-1)}` : '';
  return `${taskFromCard(issue)}${backNote}\n\n${PLAYBOOK_NOTE}`;
}
