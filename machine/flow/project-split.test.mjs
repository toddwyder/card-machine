import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createAgents, projectRepoRoot, repoRoot } from './agents.mjs';
import { closeCopy, openCopy, startedFrom } from './copy.mjs';
import { graphifyGraphPaths } from './graphify.mjs';
import { resolvePlaybook } from './playbook.mjs';
import { ROLE_GROUPS, formatSettings } from '../../dashboard/lib/model-settings.js';
import { initialChoice } from '../../dashboard/lib/roles.js';

const MODEL_IDS = [
  'openai/gpt-6.1-sol',
  'commandcode/deepseek/deepseek-v4.1-flash',
  'anthropic/claude-opus-5-5',
  'commandcode/moonshotai/Kimi-K3.1-Pro',
];

function writeRoleFiles(home) {
  const dir = join(home, '.config', 'julia');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lead-model'), `${MODEL_IDS[0]}\n`);
  const models = MODEL_IDS.map(id => ({ id, provider: id.split('/')[0] }));
  const choice = { ...initialChoice({ groups: ROLE_GROUPS, modelIds: MODEL_IDS }), lead: MODEL_IDS[0] };
  writeFileSync(join(dir, 'lead-role-models.md'), formatSettings(choice, models).pstack);
}

test('card copy reads the project main version while skills, playbooks, and graph come from the machine home', async t => {
  const root = mkdtempSync(join(tmpdir(), 'project-split-'));
  const home = join(root, 'machine-home');
  const project = join(root, 'target-project');
  const scratch = join(root, 'scratch');
  const userHome = join(root, 'user-home');

  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    FLOW_REPO: process.env.FLOW_REPO,
    FLOW_PROJECT_REPO: process.env.FLOW_PROJECT_REPO,
    FLOW_SCRATCH: process.env.FLOW_SCRATCH,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      closeCopy({ repo: project, card: 'TEST-SPLIT-1', env: { FLOW_SCRATCH: scratch } });
    } catch {
      // Ignore cleanup if openCopy did not run.
    }
    rmSync(root, { recursive: true, force: true });
  });

  // Machine home: carries pstack skills, playbooks, and knowledge graph.
  mkdirSync(join(home, '.agents', 'skills', 'poteto-mode', 'playbooks'), { recursive: true });
  mkdirSync(join(home, 'graphify-out', 'mastra'), { recursive: true });
  writeFileSync(join(home, '.agents', 'skills', 'poteto-mode', 'SKILL.md'), '# machine home poteto-mode\n');
  writeFileSync(join(home, '.agents', 'skills', 'poteto-mode', 'playbooks', 'feature.md'), '1. Verify on the matching surface.\n');
  writeFileSync(join(home, 'graphify-out', 'graph.json'), '{"nodes":[],"links":[]}\n');
  writeFileSync(join(home, 'graphify-out', 'mastra', 'graph.json'), '{"nodes":[],"links":[]}\n');

  // Target project repo: carries its own main branch and version, no machine skills or graph.
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', project]);
  execFileSync('git', ['-C', project, 'config', 'user.name', 'Test User']);
  execFileSync('git', ['-C', project, 'config', 'user.email', 'test@example.com']);
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'target-product', version: '2.7.1' }, null, 2));
  execFileSync('git', ['-C', project, 'add', 'package.json']);
  execFileSync('git', ['-C', project, 'commit', '-m', 'Initial project main']);

  writeRoleFiles(userHome);
  process.env.HOME = userHome;
  process.env.USERPROFILE = userHome;
  process.env.FLOW_REPO = home;
  process.env.FLOW_PROJECT_REPO = project;
  process.env.FLOW_SCRATCH = scratch;

  assert.equal(repoRoot(), home);
  assert.equal(projectRepoRoot(), project);

  const expectedMainSha = startedFrom(project);
  const copy = openCopy({ repo: projectRepoRoot(), card: 'TEST-SPLIT-1' });
  assert.equal(copy.base, expectedMainSha);

  const copiedPkg = JSON.parse(readFileSync(join(copy.folder, 'package.json'), 'utf8'));
  assert.equal(copiedPkg.name, 'target-product');
  assert.equal(copiedPkg.version, '2.7.1');
  assert.equal(existsSync(join(copy.folder, '.agents', 'skills', 'poteto-mode', 'SKILL.md')), false);

  const agents = createAgents({ repo: repoRoot(), model: 'openai/gpt-6.1-sol' });
  assert.equal(await agents.build.getInstructions(), '# machine home poteto-mode\n');
  const playbook = resolvePlaybook(repoRoot(), 'feature');
  assert.deepEqual(playbook?.steps, ['Verify on the matching surface.']);
  const graphs = graphifyGraphPaths(repoRoot());
  assert.equal(graphs.julia, join(home, 'graphify-out', 'graph.json'));
  assert.equal(graphs.mastra, join(home, 'graphify-out', 'mastra', 'graph.json'));
});
