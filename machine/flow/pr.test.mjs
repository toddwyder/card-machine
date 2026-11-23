import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { RequestContext } from '@mastra/core/request-context';
import { createWritePrTool, openCardPullRequest, validatePrDraft } from './pr.mjs';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

test('validatePrDraft requires non-empty title and body naming the card', () => {
  assert.equal(validatePrDraft({ card: 'JUL-411', title: '', body: 'JUL-411' }).ok, false);
  assert.equal(validatePrDraft({ card: 'JUL-411', title: 'feat(flow): thing', body: '## Why\nFix' }).ok, false);
  const valid = validatePrDraft({ card: 'JUL-411', title: 'feat(flow): open PR (JUL-411)', body: '## Why\nFix' });
  assert.equal(valid.ok, true);
});

test('write_pr tool validates and stores PR draft in requestContext', async () => {
  const tool = createWritePrTool();
  const requestContext = new RequestContext();
  requestContext.set('flowCard', 'JUL-411');

  const bad = await tool.execute({ title: 'no card', body: 'still no card' }, { requestContext });
  assert.equal(bad.ok, false);
  assert.equal(bad.isError, true);

  const good = await tool.execute({ title: 'feat(flow): open PR (JUL-411)', body: '## Why\nGoal' }, { requestContext });
  assert.equal(good.ok, true);
  assert.deepEqual(requestContext.get('flowPr'), {
    title: 'feat(flow): open PR (JUL-411)',
    body: '## Why\nGoal',
  });
});

test('openCardPullRequest pushes branch and creates a ready PR using the builder title and body', t => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-open-'));
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  writeFileSync(join(dir, 'README.md'), '# init\n');
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'init']);
  const base = git(dir, ['rev-parse', 'HEAD']);

  writeFileSync(join(dir, 'app.mjs'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--quiet', '-m', 'feat']);

  const calls = [];
  const result = openCardPullRequest({
    card: 'JUL-411',
    checkout: dir,
    base,
    projectRepo: dir,
    githubRepo: 'toddwyder/card-machine',
    title: 'feat(flow): open PR (JUL-411)',
    body: '## Why\nJUL-411',
    run: (file, args) => {
      calls.push([file, ...args]);
      if (file === 'gh' && args[1] === 'list') return '[]';
      if (file === 'gh' && args[1] === 'create') return 'https://github.com/toddwyder/card-machine/pull/99';
      return '';
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.pr, 99);
  assert.equal(result.created, true);
  assert.deepEqual(calls[0], ['git', 'push', '-u', 'https://github.com/toddwyder/card-machine.git', 'HEAD:refs/heads/card/JUL-411']);
  assert.equal(calls[2][0], 'gh');
  assert.equal(calls[2][1], 'pr');
  assert.equal(calls[2][2], 'create');
  assert.equal(calls[2].includes('--draft'), false);
});
