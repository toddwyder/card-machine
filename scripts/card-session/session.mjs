// Boots one headless Mastra Code session from the installed program, runs it,
// and closes it in the order that keeps a notification tick off a closed store.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { programDir } from '../mastra-program.mjs';

const MODULES = {
  sdk: '@mastra/code-sdk/dist/index.js',
  processors: '@mastra/core/dist/processors/index.js',
};

export async function loadProgram() {
  const dir = programDir();
  const load = relative => import(pathToFileURL(join(dir, 'node_modules', relative)).href);
  const [sdk, processors] = await Promise.all([load(MODULES.sdk), load(MODULES.processors)]);
  return {
    dir,
    createMastraCode: sdk.createMastraCode,
    runMC: sdk.runMC,
    builtinSubagents: sdk.builtinSubagents,
    autoApprovePolicy: sdk.autoApprovePolicy,
    TokenCostControl: processors.TokenCostControl,
  };
}

export function sessionSettingsPath(sessionDir) {
  const path = join(sessionDir, 'settings.json');
  return path;
}

// One settings file per session: the lead, the three stock helper types and the
// goal judge all run on the model the machine already uses for the lead.
export function writeSessionSettings(sessionDir, { model, goalMaxTurns = 50 }) {
  const path = sessionSettingsPath(sessionDir);
  const settings = {
    models: {
      subagentModels: { explore: model, plan: model, execute: model },
      goalJudgeModel: model,
      goalMaxTurns,
    },
    preferences: { subagentsEnabled: true },
    // A card limit is read from the local observability store, so this session
    // must record traces even though the stock default is off.
    observability: { localTracing: true, resources: {} },
  };
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return path;
}

// Each session gets its own stores: the SDK's defaults are one global DuckDB and
// one global state file, which a nested checker process would collide with.
export function useSessionState(sessionDir) {
  process.env.MASTRA_DB_PATH = join(sessionDir, 'state.db');
  process.env.MASTRA_OBSERVABILITY_DB_PATH = join(sessionDir, 'observability.duckdb');
  return {
    dbPath: process.env.MASTRA_DB_PATH,
    observabilityPath: process.env.MASTRA_OBSERVABILITY_DB_PATH,
  };
}

export async function bootSession({ worktree, sessionDir, settingsPath, hostInstructions, costControl, program = null }) {
  useSessionState(sessionDir);
  const loaded = program ?? await loadProgram();
  const subagents = loaded.builtinSubagents.map(definition => ({
    ...definition,
    maxSteps: definition.maxSteps ?? 1000,
  }));
  const booted = await loaded.createMastraCode({
    cwd: worktree,
    settingsPath,
    createInitialThread: true,
    subagents,
    inputProcessors: [costControl],
    disableBuiltinTools: ['ask_user', 'submit_plan'],
    hostInstructions,
    plansDir: join(sessionDir, 'plans'),
    planApprovalStartsGoal: false,
  });
  return { ...loaded, booted, mastra: booted.controller.getMastra() };
}

export function describeEvent(event) {
  if (!event || typeof event.type !== 'string') return null;
  if (event.type === 'tool_start') return `tool ${event.toolName ?? 'unknown'}`;
  if (event.type === 'tool_end') return event.isError ? 'tool failed' : 'tool done';
  if (event.type === 'usage_update') return `tokens ${event.usage?.promptTokens ?? 0} in / ${event.usage?.completionTokens ?? 0} out`;
  if (event.type === 'tool_approval_required') return `approval needed for ${event.toolName ?? 'a tool'}`;
  if (event.type === 'agent_start' || event.type === 'agent_end' || event.type === 'goal_evaluation') {
    return event.type === 'goal_evaluation'
      ? `goal ${event.payload?.status ?? 'pending'}${event.payload?.pending ? ' (pending)' : ''}`
      : event.type;
  }
  if (event.type === 'error') return `error ${event.error?.message ?? ''}`.trim();
  return null;
}

export async function runSession(options) {
  const { booted, runMC, model, mode, resourceId, title, timeoutMs, quiet } = options;
  const run = runMC({
    controller: booted.controller,
    session: booted.session,
    model,
    mode: mode ?? 'build',
    policy: options.policy,
    thinkingLevel: 'off',
    resourceId,
    title,
    timeoutMs,
    ...(options.goal ? { goal: options.goal } : { prompt: options.prompt }),
  });
  let last = 0;
  for await (const event of run) {
    const line = describeEvent(event);
    if (!line || quiet) continue;
    if (event.type === 'goal_evaluation' && event.payload?.pending && Date.now() - last < 30_000) continue;
    last = Date.now();
    console.error(`[${new Date().toISOString()}] ${line}`);
  }
  return run.result;
}

const TOKEN_TOTAL_METRICS = ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'];

// The card total comes from this session's own observability store, filtered by
// the resource id the run stamped on every call. `getStorage().getStore()` does
// not carry the metric methods on this program, so the domain is read directly.
export async function readCardCost(mastra, card) {
  const obs = mastra?.getStorage?.()?.stores?.observability;
  if (!card || !obs?.getMetricAggregate) return null;
  await obs.flush?.();
  const totals = await obs.getMetricAggregate({
    name: TOKEN_TOTAL_METRICS,
    aggregation: 'sum',
    filters: { resourceId: card },
  });
  const breakdown = obs.getMetricBreakdown
    ? await obs.getMetricBreakdown({
        name: TOKEN_TOTAL_METRICS,
        groupBy: ['entityId', 'provider', 'model'],
        aggregation: 'sum',
        filters: { resourceId: card },
        limit: 100,
      })
    : { groups: [] };
  return {
    card,
    totalUsd: Number((Number(totals?.estimatedCost) || 0).toFixed(6)),
    totalTokens: Number(totals?.value) || 0,
    byAgentModel: (breakdown?.groups ?? []).map(group => ({
      agent: group.dimensions?.entityId ?? 'unknown',
      provider: group.dimensions?.provider ?? 'unknown',
      model: group.dimensions?.model ?? 'unknown',
      usd: Number((Number(group.estimatedCost) || 0).toFixed(6)),
      tokens: Number(group.value) || 0,
    })),
  };
}

// Metric rows reach the store through the observability exporter, which batches
// them. A run that is still going when the session ends has its rows buffered
// until the pipeline is flushed, so a first read sees only the finished helper
// spans and reports a fraction of the session. Flush the pipeline and read until
// the token total stops growing. `minimumTokens` is the total the run itself
// counted: the store cannot hold less than that and still describe the run.
const COST_SETTLE_TIMEOUT_MS = 60_000;
const COST_SETTLE_STEP_MS = 1000;

export async function sessionCost(booted, card, { minimumTokens = 0, timeoutMs = COST_SETTLE_TIMEOUT_MS } = {}) {
  const mastra = booted.mastra ?? booted.controller.getMastra();
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  let previous = -1;
  for (;;) {
    await booted.observability?.flush?.().catch(() => {});
    const cost = await readCardCost(mastra, card).catch(() => null);
    if (cost) latest = cost;
    const tokens = latest?.totalTokens ?? 0;
    if (tokens >= minimumTokens && tokens === previous) return latest;
    if (Date.now() >= deadline) return latest;
    previous = tokens;
    await new Promise(resolve => setTimeout(resolve, COST_SETTLE_STEP_MS));
  }
}

// Same order as machine/shipping/harness.mjs: stop the notification timer, flush
// observability, shut it down, then close storage.
export async function closeSession(booted) {
  await booted.stopNotificationDispatch?.();
  await booted.observability?.flush?.();
  await new Promise(resolve => setTimeout(resolve, 2000));
  await booted.observability?.shutdown?.();
  await booted.storageMaintenance?.closeStorage?.();
  await new Promise(resolve => setTimeout(resolve, 1000));
}

export function programReady() {
  try {
    const dir = programDir();
    return existsSync(join(dir, 'node_modules', MODULES.sdk)) && existsSync(join(dir, 'node_modules', MODULES.processors));
  } catch {
    return false;
  }
}
