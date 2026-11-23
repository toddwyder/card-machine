import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROLE_GROUPS } from '../../dashboard/lib/model-settings.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const indexUrl = new URL('../../src/mastra/index.ts', import.meta.url).href;
const graphifyUrl = new URL('./graphify.mjs', import.meta.url).href;

const ROLE_FILE_TEXT = [
  '# budget: medium (high)',
  ...ROLE_GROUPS.flatMap(group => group.roles.map(role => `${role.name}: commandcode/deepseek/deepseek-v4.1-flash`)),
  '',
].join('\n');

test('Studio card-path gives the card copy origin as its remote and opens a PR with githubRepo without model calls', t => {
  const root = mkdtempSync(join(tmpdir(), 'studio-open-pr-'));
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

  const home = join(root, 'home');
  const flowDir = join(root, 'flow');
  const scratch = join(root, 'scratch');
  const repo = join(root, 'repo');
  const origin = join(root, 'origin.git');
  const projectRepo = join(root, 'project');
  const binDir = join(root, 'bin');
  const ghLog = join(root, 'gh-calls.jsonl');
  const ghPrs = join(root, 'gh-prs.json');
  const juliaConfig = join(home, '.config', 'julia');

  mkdirSync(juliaConfig, { recursive: true });
  mkdirSync(flowDir, { recursive: true });
  mkdirSync(scratch, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(juliaConfig, 'lead-model'), 'commandcode/deepseek/deepseek-v4.1-flash\n');
  writeFileSync(join(juliaConfig, 'lead-role-models.md'), ROLE_FILE_TEXT);

  mkdirSync(join(repo, '.agents', 'skills', 'poteto-mode', 'playbooks'), { recursive: true });
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  writeFileSync(join(repo, '.agents', 'skills', 'poteto-mode', 'SKILL.md'), '# poteto\n');
  writeFileSync(join(repo, '.agents', 'skills', 'poteto-mode', 'playbooks', 'bug-fix.md'), '1. Fix it\n');
  for (const script of [
    'check-skill-names.mjs',
    'check-skill-versions.mjs',
    'check-pstack-pin.mjs',
    'check-agent-links.mjs',
    'check-no-adr-folder.mjs',
    'check-doc-models.mjs',
    'check-graph-sources.mjs',
    'machine-programs.mjs',
    'check-no-julia-reach.mjs',
  ]) {
    writeFileSync(join(repo, 'scripts', script), 'process.exit(0);\n');
  }
  execFileSync('git', ['init', '-b', 'main', repo]);
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init']);
  execFileSync('git', ['clone', '--bare', '--quiet', repo, origin]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', origin]);
  execFileSync('git', ['clone', '--quiet', origin, projectRepo]);

  const ghScript = join(binDir, 'gh');
  writeFileSync(
    ghScript,
    `#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify({ cwd: process.cwd(), args }) + '\\n');
const hasRepo = args.includes('--repo');
if (!hasRepo) {
  let remoteUrl = '';
  try {
    remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  } catch {}
  if (remoteUrl !== ${JSON.stringify(origin)}) {
    console.error('none of the git remotes configured for this repository point to a known GitHub host.');
    process.exit(1);
  }
}
if (args[0] === 'pr' && args[1] === 'list') {
  console.log(existsSync(${JSON.stringify(ghPrs)}) ? readFileSync(${JSON.stringify(ghPrs)}, 'utf8') : '[]');
} else if (args[0] === 'pr' && args[1] === 'create') {
  writeFileSync(${JSON.stringify(ghPrs)}, JSON.stringify([{
    number: 77,
    headRefName: 'card/JUL-411-TEST',
    title: 'fix(flow): test PR (JUL-411-TEST)',
    body: '## Why\\nJUL-411-TEST',
    url: 'https://github.com/example/throwaway-studio-test/pull/77',
  }]));
  console.log('https://github.com/example/throwaway-studio-test/pull/77');
} else if (args[0] === 'pr' && args[1] === 'comment') {
  console.log('ok');
}
`,
  );
  chmodSync(ghScript, 0o755);
  writeFileSync(join(binDir, 'gh.cmd'), '@node "%~dp0\\gh" %*\r\n');

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
    FLOW_DIR: flowDir,
    FLOW_SCRATCH: scratch,
    FLOW_REPO: repo,
    FLOW_PROJECT_REPO: projectRepo,
    FLOW_PROJECT_GITHUB_REPO: 'example/throwaway-studio-test',
    FLOW_SKIP_ACCESS_CHECK: '1',
    FLOW_MIN_FREE_MEMORY_MB: '1',
    LINEAR_API_KEY: 'test-linear-key',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.${origin}.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/example/throwaway-studio-test.git',
  };
  delete env.JULIA_LEAD_MODEL_FILE;
  delete env.JULIA_LEAD_ROLE_MODELS_FILE;
  delete env.FLOW_CARD;

  const childScript = `
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { readFileSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';

    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.linear.app/graphql')) {
        return new Response(JSON.stringify({
          data: {
            viewer: { id: 'v1', name: 'Test' },
            issue: {
              id: 'i1',
              identifier: 'JUL-411-TEST',
              title: 'Test card',
              description: '## Goal\\nTest\\n\\n## Done means\\n* Works',
              url: 'https://linear.app/test/JUL-411-TEST',
              state: { name: 'Ready', type: 'unstarted' },
              labels: { nodes: [] },
              team: { states: { nodes: [{ id: 's1', name: 'Implementation' }] } },
            },
            issueUpdate: { success: true },
            commentCreate: { success: true, comment: { id: 'c1', url: 'https://linear.app/test/c1' } },
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(url, init);
    };

    const { mastra } = await import(${JSON.stringify(indexUrl)});
    const { closeGraphify } = await import(${JSON.stringify(graphifyUrl)});

    let copyOrigin = '';
    const buildAgent = mastra.getAgentById('flow-build');
    buildAgent.stream = async (_prompt, opts = {}) => {
      const rc = opts.requestContext;
      const checkout = rc.get('cardCheckout');
      copyOrigin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: checkout, encoding: 'utf8' }).trim();
      writeFileSync(join(checkout, 'note.md'), 'hello\\n');
      execFileSync('git', ['-C', checkout, 'add', 'note.md']);
      execFileSync('git', ['-C', checkout, '-c', 'commit.gpgsign=false', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'docs: note (JUL-411-TEST)'], { stdio: 'inherit' });
      rc.set('flowPlaybook', { playbook: 'bug-fix', callNumber: 1 });
      rc.set('flowPr', { title: 'fix(flow): test PR (JUL-411-TEST)', body: '## Why\\nJUL-411-TEST' });
      const store = await mastra.getStorage().getStore('threadState');
      await store.setState({
        threadId: 'JUL-411-TEST/build-1',
        type: 'task',
        value: [{ id: 'playbook_1', content: 'Fix it', status: 'completed' }],
      });
      return { text: Promise.resolve('built'), tripwire: Promise.resolve(null) };
    };
    mastra.getAgentById('flow-shipping').stream = async () => ({
      text: Promise.resolve('VERDICT: PASS\\nCRITERION 1: PASS — verified'),
      tripwire: Promise.resolve(null),
    });
    mastra.getAgentById('flow-retro').stream = async () => ({
      text: Promise.resolve('done'),
      tripwire: Promise.resolve(null),
    });

    try {
      const workflow = mastra.getWorkflow('card-path');
      const run = await workflow.createRun();
      const result = await run.start({ inputData: { card: 'JUL-411-TEST', kind: 'machine' } });
      assert.equal(result.status, 'success');
      const reportPath = join(${JSON.stringify(flowDir)}, 'JUL-411-TEST', 'reports', 'JUL-411-TEST.md');
      const reportText = result.steps.attempt.output.stopped ? readFileSync(reportPath, 'utf8') : '';
      assert.notEqual(result.steps.attempt.output.stopped, true, reportText || result.steps.attempt.output.detail);
      assert.equal(result.steps.attempt.output.pr, 77);
      assert.equal(copyOrigin, ${JSON.stringify(origin)});
    } finally {
      await mastra.shutdown();
      await mastra.getStorage()?.close();
      await closeGraphify();
    }
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], { cwd: repoRoot, env, encoding: 'utf8' });
  assert.equal(child.status, 0, `child exited ${child.status}\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`);

  const ghCalls = readFileSync(ghLog, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  const prCreate = ghCalls.find(call => call.args[0] === 'pr' && call.args[1] === 'create');
  assert.ok(prCreate, 'expected gh pr create to be called');
  assert.ok(prCreate.args.includes('--repo'), 'expected gh pr create to pass --repo');
  assert.equal(prCreate.args[prCreate.args.indexOf('--repo') + 1], 'example/throwaway-studio-test');
});
