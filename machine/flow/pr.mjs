import { execFileSync } from 'node:child_process';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { changedFiles } from './repo-checks.mjs';

const name = card => card.replace(/[^\w.-]+/g, '-');
const branch = card => `card/${name(card)}`;

function mentionsCard(card, text) {
  if (!card) return false;
  const escaped = card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?![0-9])`, 'i').test(String(text ?? ''));
}

export function validatePrDraft({ card, title, body } = {}) {
  const cleanTitle = String(title ?? '').trim();
  const cleanBody = String(body ?? '').trim();
  if (!cleanTitle) return { ok: false, reason: 'PR metadata: title is empty.' };
  if (!cleanBody) return { ok: false, reason: 'PR metadata: body is empty.' };
  if (card && !mentionsCard(card, `${cleanTitle}\n${cleanBody}`)) {
    return { ok: false, reason: `PR metadata: title or description must name ${card}.` };
  }
  return { ok: true, title: cleanTitle, body: cleanBody };
}

export function createWritePrTool() {
  return createTool({
    id: 'write_pr',
    description:
      'Write the pull request title and description for the machine to open after repository checks pass. Both must be non-empty, follow Opening a PR, and name the card.',
    inputSchema: z.object({
      title: z.string().min(1).describe('Pull request title, naming the card.'),
      body: z.string().min(1).describe('Pull request description following Opening a PR.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      isError: z.boolean(),
      title: z.string().optional(),
      body: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async ({ title, body }, context) => {
      const card = context?.requestContext?.get?.('flowCard') ?? '';
      const checked = validatePrDraft({ card, title, body });
      if (!checked.ok) {
        return { ok: false, isError: true, error: checked.reason };
      }
      context?.requestContext?.set?.('flowPr', { title: checked.title, body: checked.body });
      return { ok: true, isError: false, title: checked.title, body: checked.body };
    },
  });
}

const defaultRun = (file, args, cwd) =>
  execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function githubRemoteUrl({ projectRepo, githubRepo, run = defaultRun } = {}) {
  if (githubRepo) {
    return /^https?:\/\/|^git@|^\//.test(githubRepo) ? githubRepo : `https://github.com/${githubRepo}.git`;
  }
  return run('git', ['remote', 'get-url', 'origin'], projectRepo);
}

export function openCardPullRequest({
  card,
  checkout,
  base,
  projectRepo,
  githubRepo,
  title,
  body,
  run = defaultRun,
} = {}) {
  const files = changedFiles(checkout, base);
  if (files.length === 0) {
    return { ok: true, skipped: true, pr: null, reason: 'no changes to open a pull request for' };
  }
  const checked = validatePrDraft({ card, title, body });
  if (!checked.ok) return { ok: false, reason: checked.reason };

  const branchName = branch(card);
  const remoteUrl = githubRemoteUrl({ projectRepo, githubRepo, run });
  const repoArgs = githubRepo ? ['--repo', githubRepo] : [];

  try {
    run('git', ['push', '-u', remoteUrl, `HEAD:refs/heads/${branchName}`], checkout);
    const existingRaw = run('gh', ['pr', 'list', ...repoArgs, '--head', branchName, '--state', 'open', '--json', 'number,url'], checkout);
    const existing = JSON.parse(existingRaw || '[]');
    if (Array.isArray(existing) && existing.length > 0) {
      return { ok: true, skipped: false, pr: existing[0].number, url: existing[0].url ?? '', created: false };
    }
    const url = run(
      'gh',
      ['pr', 'create', ...repoArgs, '--base', 'main', '--head', branchName, '--title', checked.title, '--body', checked.body],
      checkout,
    );
    const match = url.match(/\/pull\/(\d+)/);
    const pr = match ? Number(match[1]) : null;
    return { ok: true, skipped: false, pr, url, created: true };
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim();
    return { ok: false, reason: `Failed to push or open pull request for ${card}: ${detail}` };
  }
}
