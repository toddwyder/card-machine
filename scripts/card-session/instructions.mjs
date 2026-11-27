// The words each headless session starts with. Nothing here depends on a person
// reading it: the session either reaches its end state or exits saying why.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { criteriaFromCard } from '../../machine/flow/task.mjs';
import { projectGithubRepo } from './worktree.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const POTETO_SKILL = join(REPO_ROOT, '.agents', 'skills', 'poteto-mode', 'SKILL.md');
export const WATCH_PR = join(REPO_ROOT, '.agents', 'skills', 'poteto-mode', 'scripts', 'watch-pr', 'watch-pr');
export const CARD_CHECK = join(REPO_ROOT, 'scripts', 'card-check.mjs');
export const CARD_LIVE = join(REPO_ROOT, 'scripts', 'card-live.mjs');

const OPENING = `Read ${POTETO_SKILL} in full, including its Principles section, before any work. Follow it as written.`;

export function goalObjective(description) {
  const criteria = criteriaFromCard(description);
  if (criteria.length === 0) throw new Error('the card lists no done means, so this session has no goal');
  return [
    'The card is done when all of this is true:',
    ...criteria.map(line => `- ${line}`),
    '- The pull request is merged after the checker posted PASS, and e2e passes against the live site.',
  ].join('\n');
}

export function leadInstructions({ card, worktree, branch, sessionDir }) {
  const description = String(card.description ?? '');
  const raw = description.length > 8000 ? `${description.slice(0, 8000)}\n\n(description truncated)` : description;
  const [owner, name] = projectGithubRepo().split('/');
  return [
    OPENING,
    '',
    'Use the playbook it routes this card to, then the Shipping playbook to land it.',
    '',
    `You are running alone. No person is watching and nobody will answer a question. Never end your turn to wait for anything: every wait is a command that returns when the result is in.`,
    '',
    `The card is ${card.identifier}: ${card.title}`,
    `Card address: ${card.url ?? `https://linear.app/julia-next/issue/${card.identifier}`}`,
    '',
    '## Card',
    raw.trim(),
    '',
    '## Your checkout',
    `Work only inside ${worktree}. It is a fresh worktree of the project repository's main branch with its dependencies already installed. Create your branch there, for example \`git switch -c ${branch}\`, and push it.`,
    `Session folder: ${sessionDir}`,
    '',
    '## Landing this card',
    `- Open the pull request yourself with \`gh pr create\` once the work is ready. The machine does not open one for you.`,
    `- Wait for CI with \`bun ${WATCH_PR} --owner ${owner} --repo ${name} --pr <number> --pretty --timeout 3600\`, run in your checkout. It does not return until the run is finished.`,
    `- Before you merge, run \`node ${CARD_CHECK} <number>\` and wait for it. It starts the independent checker and returns when the checker has posted its verdict. On FAIL, fix the code and run it again. On PASS, merge with \`gh pr merge <number> --squash\`.`,
    `- After the merge, read the merge commit with \`gh pr view <number> --json mergeCommit\` and run \`node ${CARD_LIVE} --commit <sha> --output ${sessionDir}/live-e2e\`. It waits for the live deployment and runs e2e against it.`,
    '',
    'Finish only when the card is done by its own done means and the merge and live e2e above have happened.',
  ].join('\n');
}

export function checkerInstructions({ pr, worktree, previewUrl, e2eOutput }) {
  const repo = projectGithubRepo();
  return [
    OPENING,
    '',
    `You are the Shipping playbook's independent verifier for pull request #${pr.number} in ${repo}, titled "${pr.title}". You did not write this code.`,
    '',
    `Your checkout is ${worktree}, a fresh worktree at the pull request head commit ${pr.headRefOid}. Read it if you need to.`,
    '',
    'Rules you must not break:',
    '- Change no code. Edit no file, commit nothing, push nothing.',
    '- Merge nothing.',
    '- Post exactly one comment on the pull request. Its first line is exactly `PASS` or exactly `FAIL`, never `PASS+NOTES`. The rest of the comment holds the e2e command output or a link to it.',
    '- Never end your turn before that comment is posted.',
    '',
    '## The check you run',
    `The preview site is ${previewUrl}`,
    `Run \`cd ${REPO_ROOT} && JULIA_PREVIEW_URL=${previewUrl} JULIA_COMMIT=${pr.headRefOid} node_modules/.bin/e2e run --config e2e.preview.config.ts --output ${e2eOutput}\` and wait for it. It is the stock e2e runner driving that address, and it prints the result.`,
    'Judge PASS only when that command exits 0 and its output shows the live checks it names. Judge FAIL when it exits non-zero, when the site does not answer, or when the served commit does not match the pull request head.',
    '',
    '## Posting the verdict',
    'Write the comment body to a file inside your session folder, then run:',
    `\`gh pr comment ${pr.number} --repo ${repo} --body-file <path>\``,
    `Then read the comment back with \`gh pr view ${pr.number} --repo ${repo} --json comments\` and confirm your first line is there.`,
  ].join('\n');
}
