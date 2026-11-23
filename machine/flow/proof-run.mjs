// Drives one card down the machine's real workflow so the Run view can be read beside a real run.
// The model, the review, the check and the shipping step are the only stand-ins: everything the
// screen shows is written by the machine's own stages, live writer, state.db and trace.
//
//   node machine/flow/proof-run.mjs
//   FLOW_DIR=$PWD/.artifacts/flow/proof-JUL-361/run npx next start --port 4314   # in dashboard/

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = new URL('../..', import.meta.url).pathname;
process.chdir(repoRoot);
process.env.CMD_API_KEY ??= 'unused-in-proof';

const { Agent } = await import('@mastra/core/agent');
const { MastraLanguageModelV2Mock, simulateReadableStream } = await import('@mastra/core/test-utils/llm-mock');
const { createWorkflowStateReader } = await import('@mastra/core/workflows');
const machine = name => import(join(repoRoot, 'machine/flow', name));
const { buildCardPath } = await machine('workflow.mjs');
const { openMastra } = await machine('mastra.mjs');
const { openScratch } = await machine('scratch.mjs');
const { createChoosePlaybookTool, createGuardedTaskTools } = await machine('playbook.mjs');
const { TaskSignalProvider } = await import('@mastra/core/signals');
const { Memory } = await import('@mastra/memory');

const CARD = process.env.PROOF_CARD ?? 'JUL-361-PROOF';
const dir = join(repoRoot, '.artifacts/flow/proof-JUL-361/run');
mkdirSync(dir, { recursive: true });

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const repo = join(dir, 'studio');
mkdirSync(repo, { recursive: true });
writeFileSync(join(repo, 'README.md'), 'studio\n');
if (!existsSync(join(repo, '.git'))) {
  git(repo, ['init', '--quiet', '--initial-branch=main']);
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.email=flow@proof', '-c', 'user.name=flow', 'commit', '--quiet', '-m', 'main']);
}

process.env.FLOW_SCRATCH = join(dir, 'scratch');
openScratch(dir);
mkdirSync(join(dir, CARD), { recursive: true });
writeFileSync(join(dir, CARD, 'verdicts.json'), JSON.stringify({ smoke: ['PASS'] }));
writeFileSync(join(dir, CARD, 'cursors.json'), '{}');

const usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
const call = (toolCallId, toolName, input) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) },
      { type: 'finish', finishReason: 'tool-calls', usage },
    ],
  }),
});
const text = delta => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop', usage },
    ],
  }),
});

// The Lead's model answers in three turns: name the playbook, tick the first step, then reply.
// The first two are real tool calls, so the run leaves real tool spans and real task lists behind.
let turn = 0;
const leadModel = new MastraLanguageModelV2Mock({
  modelId: 'mock-model-id',
  doStream: async () => {
    turn += 1;
    if (turn === 1) return call('call-playbook', 'choose_playbook', { playbook: 'feature' });
    if (turn === 2) return call('call-task', 'task_update', { id: 'playbook_1', status: 'completed' });
    return text('built line');
  },
});

const build = new Agent({
  id: 'flow-build',
  name: 'Flow build',
  instructions: 'Reply with one line.',
  model: leadModel,
  // The real Lead carries memory, and the task tools refuse to record without it.
  memory: new Memory(),
  tools: {
    ...new TaskSignalProvider().getTools(),
    ...createGuardedTaskTools(),
    choose_playbook: createChoosePlaybookTool({ repo: repoRoot }),
  },
});

const stub = value => ({
  generate: async () => {
    throw new Error('Bad Request: Stream must be set to true');
  },
  stream: async () => ({ text: Promise.resolve(value) }),
});

const answer = verdict => `VERDICT: ${verdict}\nCRITERION 1: ${verdict} — ran the command\nNOTES: none`;
const review = {
  findPr: () => ({ pr: 498 }),
  readCard: async identifier => ({
    identifier,
    title: 'Prove the Run view against a real run',
    description: '## Acceptance criteria\n- it works',
  }),
  moveCard: async () => {},
  headCommit: () => 'abc123',
  postPrComment: () => {},
};

const workflow = buildCardPath({
  agents: {
    build,
    shipping: { stream: async () => ({ text: Promise.resolve(answer('PASS')) }) },
    remediation: stub(answer('PASS')),
    retro: stub('retro line'),
  },
  dir,
  repo,
  review,
  check: { run: async () => ({ ok: true }) },
  preflight: async () => ({ ok: true }),
});

const mastra = await openMastra({
  card: CARD,
  agents: { build },
  stateDb: join(dir, 'state.db'),
  traceDb: join(dir, 'trace.duckdb'),
  workflow,
});
const wf = mastra.getWorkflow(workflow.id);
const run = await wf.createRun();
let result = await run.start({ inputData: { card: CARD, kind: 'product' } });

while (result.status === 'suspended') {
  const state = await wf.getWorkflowRunById(run.runId);
  const open = createWorkflowStateReader(state).getSuspendedStep();
  result = await run.resume({ step: open.stepId, resumeData: { request: open.suspendPayload.request, answer: 'yes' } });
}

const live = join(dir, CARD, 'live.jsonl');
const lines = readFileSync(live, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const byType = lines.reduce((all, line) => ({ ...all, [line.type]: (all[line.type] ?? 0) + 1 }), {});
console.log(JSON.stringify({ status: result.status, runId: run.runId, live, lines: lines.length, byType }, null, 2));
