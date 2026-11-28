import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sessionConfig } from './card-session.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = readFileSync(join(REPO_ROOT, '.agents', 'skills', 'poteto-mode', 'SKILL.md'), 'utf8');

test('the session carries pstack as standing instructions', () => {
  const config = sessionConfig({ settingsPath: '/tmp/settings.json', subagents: [] });
  assert.equal(
    config.hostInstructions,
    SKILL,
    'the session boot has to carry the whole poteto-mode skill, or a card session follows nothing after its first compaction',
  );
});

test('the session cannot ask a question or wait on an approval', () => {
  const config = sessionConfig({ settingsPath: '/tmp/settings.json', subagents: [] });
  assert.deepEqual(config.disableBuiltinTools, ['ask_user', 'submit_plan']);
  assert.equal(config.planApprovalStartsGoal, false);
});
