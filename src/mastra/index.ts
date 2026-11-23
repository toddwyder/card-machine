// The Studio entry. Registering the card-path workflow here is what puts it on
// Studio's run form, and that form is the one place a card is started.
//
// FLOW_DIR overrides the durable Studio run folder under .artifacts/flow.

process.env.CMD_API_KEY ??= process.env.COMMANDCODE_API_KEY;

import { join, resolve } from 'node:path';

import { createAgents, projectGithubRepo, projectRepoRoot, repoRoot } from '../../machine/flow/agents.mjs';
import { graphifyTools } from '../../machine/flow/graphify.mjs';
import { reconcileInterruptedRuns } from '../../machine/flow/interrupted.mjs';
import { openMastra } from '../../machine/flow/mastra.mjs';
import { CARD_PATH } from '../../machine/flow/schema.mjs';
import { openScratch } from '../../machine/flow/scratch.mjs';
import { buildCardPath } from '../../machine/flow/workflow.mjs';

const repo = repoRoot();
const projectRepo = projectRepoRoot();
const githubRepo = projectGithubRepo();
const dir = resolve(repo, process.env.FLOW_DIR ?? '.artifacts/flow/studio');

openScratch(dir);
const agents = createAgents({ tools: await graphifyTools(), dir, repo });
const preflight = process.env.FLOW_SKIP_ACCESS_CHECK === '1'
  ? async () => ({ ok: true, failures: [], reason: '' })
  : undefined;
const workflow = buildCardPath({ agents, dir, repo, projectRepo, githubRepo, preflight });

// Storage and observability come from the same place a resumed run uses, so the
// model calls a Studio run makes are written to this run folder's trace file.
export const mastra = await openMastra({
  card: process.env.FLOW_CARD ?? '',
  agents,
  workflow,
  stateDb: resolve(dir, 'state.db'),
  traceDb: resolve(dir, 'trace.duckdb'),
});

// A run is finished by the process that started it, and the workflow never
// restarts one on its own, so a run whose Studio was killed still says
// "running". Before this Studio serves anything, every such run is stopped and
// its card is told why. A run another process is still driving has a live
// heartbeat and is left alone. Failing to reconcile must not keep Studio down:
// the record it leaves behind is retried on the next boot.
await reconcileInterruptedRuns({
  dir: join(dir, 'interrupted'),
  store: await mastra.getStorage().getStore('workflows'),
  workflow,
}).catch((error: unknown) => {
  console.error(`Could not reconcile interrupted runs: ${error instanceof Error ? error.message : String(error)}`);
});
