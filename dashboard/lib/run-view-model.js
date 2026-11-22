// Pure domain model for Mission Control's Run view (zero IO, zero framework deps).
// Uses explicit state tables for step, run, and helper states, parses Mastra
// observability spans into helper cards, evaluates the four Run view warnings,
// and prices model calls using dashboard/lib/model-prices.js.

import { PLAIN_ENGLISH_STAGES, resolveStagesForRun, humanizeId } from './machine-stages.js';
import { priceFor, costOfTokens } from './model-prices.js';

export const DEFAULT_WARNING_THRESHOLDS = Object.freeze({
  stuckMinutes: 7,
  quotaLowPercent: 20,
  burningFastCallTokens: 100_000,
});

export const STEP_STATE_TABLE = Object.freeze({
  upcoming: Object.freeze({ state: 'upcoming', label: 'Upcoming', isActive: false, isTerminal: false, isProblem: false }),
  running: Object.freeze({ state: 'running', label: 'Running', isActive: true, isTerminal: false, isProblem: false }),
  passed: Object.freeze({ state: 'passed', label: 'Passed', isActive: false, isTerminal: true, isProblem: false }),
  passed_with_notes: Object.freeze({ state: 'passed_with_notes', label: 'Passed with notes', isActive: false, isTerminal: true, isProblem: false }),
  sent_back: Object.freeze({ state: 'sent_back', label: 'Sent back', isActive: false, isTerminal: false, isProblem: true }),
  stuck: Object.freeze({ state: 'stuck', label: 'Stuck', isActive: true, isTerminal: false, isProblem: true }),
  given_up: Object.freeze({ state: 'given_up', label: 'Gave up', isActive: false, isTerminal: true, isProblem: true }),
});

export const RUN_STATE_TABLE = Object.freeze({
  running: Object.freeze({ state: 'running', label: 'Running', isActive: true, isProblem: false }),
  waiting_for_you: Object.freeze({ state: 'waiting_for_you', label: 'Waiting for you', isActive: true, isProblem: false }),
  finished: Object.freeze({ state: 'finished', label: 'Finished', isActive: false, isProblem: false }),
  stopped: Object.freeze({ state: 'stopped', label: 'Stopped', isActive: false, isProblem: true }),
  stuck: Object.freeze({ state: 'stuck', label: 'Stuck', isActive: true, isProblem: true }),
  given_up: Object.freeze({ state: 'given_up', label: 'Gave up', isActive: false, isProblem: true }),
});

export const HELPER_STATUS_TABLE = Object.freeze({
  working: Object.freeze({ status: 'working', label: 'Working' }),
  done: Object.freeze({ status: 'done', label: 'Done' }),
  stuck: Object.freeze({ status: 'stuck', label: 'Stuck' }),
  stopped: Object.freeze({ status: 'stopped', label: 'Stopped' }),
});

export function normalizeWarningThresholds(raw) {
  const toPositive = (value, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : fallback;
  };
  return Object.freeze({
    stuckMinutes: toPositive(raw?.stuckMinutes, DEFAULT_WARNING_THRESHOLDS.stuckMinutes),
    quotaLowPercent: toPositive(raw?.quotaLowPercent, DEFAULT_WARNING_THRESHOLDS.quotaLowPercent),
    burningFastCallTokens: toPositive(raw?.burningFastCallTokens, DEFAULT_WARNING_THRESHOLDS.burningFastCallTokens),
  });
}

export function formatTokens(tokens) {
  const value = Number.isFinite(Number(tokens)) ? Math.max(0, Number(tokens)) : 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} M tokens`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} k tokens`;
  return `${Math.round(value)} tokens`;
}

export function formatElapsed(ms) {
  const value = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
  if (value < 60_000) return '< 1 min';
  const totalMinutes = Math.floor(value / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

export function formatEstimatedDollars(usd) {
  if (usd === null || usd === undefined || !Number.isFinite(Number(usd))) {
    return 'estimate unavailable';
  }
  return `about $${Math.max(0, Number(usd)).toFixed(2)}, estimate`;
}

function toMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeJsonParse(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function pathBasename(filePath) {
  const text = String(filePath ?? '').trim();
  if (!text) return '';
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? '';
}

function extractPathFromInput(input) {
  return pathBasename(
    input?.path
    ?? input?.filePath
    ?? input?.file
    ?? input?.target
    ?? input?.filename
    ?? '',
  );
}

export function describeSpanAction(span) {
  const input = safeJsonParse(span?.input);
  const attrs = safeJsonParse(span?.attributes);
  const rawName = String(attrs?.toolName ?? attrs?.toolId ?? span?.name ?? '').trim();
  const normalized = rawName.toLowerCase();

  if (span?.spanType === 'skill_action' || normalized === 'skill' || normalized.includes('load_skill') || normalized.includes('skill_action')) {
    const skillName = String(input?.name ?? input?.skill ?? input?.skillName ?? attrs?.skillName ?? '').trim();
    return skillName ? `Loaded skill ${skillName}` : 'Loaded skill';
  }

  if (normalized.includes('read_file') || normalized === 'read') {
    const base = extractPathFromInput(input);
    return base ? `Read ${base}` : 'Read file';
  }
  if (normalized.includes('write_file') || normalized === 'write') {
    const base = extractPathFromInput(input);
    return base ? `Wrote ${base}` : 'Wrote file';
  }
  if (normalized.includes('edit_file') || normalized.includes('patch_file') || normalized === 'edit') {
    const base = extractPathFromInput(input);
    return base ? `Edited ${base}` : 'Edited file';
  }
  if (normalized.includes('delete_file') || normalized.includes('remove_file')) {
    const base = extractPathFromInput(input);
    return base ? `Deleted ${base}` : 'Deleted file';
  }
  if (normalized.includes('list_files') || normalized.includes('list_dir') || normalized.includes('ls')) {
    return 'Listed files';
  }
  if (normalized.includes('grep') || normalized.includes('search')) {
    return 'Searched files';
  }
  if (normalized.includes('execute_command') || normalized.includes('run_command') || normalized === 'bash' || normalized === 'shell') {
    return 'Ran command';
  }
  if (normalized.includes('choose_playbook')) {
    const playbook = String(input?.playbook ?? '').trim();
    return playbook ? `Picked playbook ${playbook}` : 'Picked playbook';
  }
  if (normalized.includes('task_complete')) return 'Completed task';
  if (normalized.includes('task_write') || normalized.includes('task_update')) return 'Updated task list';

  if (span?.spanType === 'workspace_action') {
    const base = extractPathFromInput(input);
    return base ? `Worked on ${base}` : 'Workspace action';
  }

  const cleaned = rawName.replace(/^tool call:\s*/i, '').replace(/^['"]|['"]$/g, '');
  return humanizeId(cleaned || 'action');
}

function formatAgentName(span) {
  const attrs = safeJsonParse(span?.attributes);
  const raw = String(attrs?.agentId ?? attrs?.agentName ?? span?.name ?? '')
    .replace(/^agent run:\s*/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
  const known = {
    'flow-build': 'Build helper',
    'build-agent': 'Build helper',
    'shipping': 'Shipping helper',
    'subagent-execute': 'Execute helper',
    'remediation': 'Fix helper',
    'retro': 'Retro helper',
  };
  if (known[raw.toLowerCase()]) return known[raw.toLowerCase()];
  return raw ? humanizeId(raw) : 'Helper';
}

function extractUsageTokens(span) {
  const attrs = safeJsonParse(span?.attributes);
  const usage = attrs?.usage ?? span?.usage ?? {};
  const inputText = Number(usage.inputText ?? usage.inputTokens ?? usage.promptTokens ?? 0) || 0;
  const outputText = Number(usage.outputText ?? usage.outputTokens ?? usage.completionTokens ?? 0) || 0;
  const cacheRead = Number(usage.cacheRead ?? usage.cachedInputTokens ?? usage.cacheReadInputTokens ?? 0) || 0;
  const cacheWrite = Number(usage.cacheWrite ?? usage.cacheCreationInputTokens ?? 0) || 0;
  const outputReasoning = Number(usage.outputReasoning ?? usage.reasoningTokens ?? 0) || 0;
  const explicitTotal = Number(usage.totalTokens ?? 0) || 0;
  const summed = inputText + outputText + cacheRead + cacheWrite + outputReasoning;
  const total = explicitTotal > summed ? explicitTotal : summed;

  return {
    total,
    tokens: {
      inputText,
      outputText,
      cacheRead,
      cacheWrite,
      outputReasoning,
      totalInput: inputText + cacheRead + cacheWrite,
      totalOutput: outputText + outputReasoning,
    },
    provider: attrs?.provider ?? span?.provider ?? null,
    model: attrs?.model ?? span?.model ?? null,
  };
}

export function parseHelpersFromSpans(spans = [], {
  now = Date.now(),
  thresholds = DEFAULT_WARNING_THRESHOLDS,
  runStatus = 'running',
  catalog = null,
  corrections = {},
} = {}) {
  const list = Array.isArray(spans) ? spans : [];
  const byId = new Map();
  for (const span of list) {
    if (span?.spanId) byId.set(span.spanId, span);
  }

  const findOwningAgent = span => {
    let cursor = span;
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (cursor.spanType === 'agent_run') return cursor;
      cursor = cursor.parentSpanId ? byId.get(cursor.parentSpanId) : null;
    }
    return null;
  };

  const agentBuckets = new Map();
  for (const span of list) {
    if (span?.spanType !== 'agent_run') continue;
    const id = String(span.spanId ?? span.runId ?? `agent-${agentBuckets.size + 1}`);
    agentBuckets.set(id, {
      id,
      span,
      name: formatAgentName(span),
      tokens: 0,
      actions: [],
      lastActivityMs: toMs(span.endedAt) ?? toMs(span.startedAt ?? span.timestamp) ?? 0,
    });
  }

  let totalTokens = 0;
  let totalUsd = 0;
  let pricedCalls = 0;
  let unpricedCalls = 0;
  const burningFastCalls = [];
  const stuckMs = thresholds.stuckMinutes * 60_000;

  for (const span of list) {
    const ownerSpan = findOwningAgent(span);
    const ownerId = ownerSpan ? String(ownerSpan.spanId ?? ownerSpan.runId) : null;
    const bucket = ownerId ? agentBuckets.get(ownerId) : null;
    const startedMs = toMs(span?.startedAt ?? span?.timestamp) ?? 0;
    const endedMs = toMs(span?.endedAt);

    if (bucket) {
      bucket.lastActivityMs = Math.max(bucket.lastActivityMs, endedMs ?? startedMs);
    }

    if (span?.spanType === 'model_inference') {
      const usage = extractUsageTokens(span);
      totalTokens += usage.total;
      if (bucket) bucket.tokens += usage.total;

      if (usage.total > thresholds.burningFastCallTokens) {
        burningFastCalls.push({
          agentName: bucket?.name ?? 'Helper',
          tokens: usage.total,
          spanId: span.spanId ?? null,
        });
      }

      if (catalog && usage.model) {
        const price = priceFor({
          catalog,
          corrections,
          provider: usage.provider,
          model: usage.model,
          at: new Date(endedMs ?? startedMs ?? now),
        });
        if (price) {
          pricedCalls += 1;
          totalUsd += costOfTokens({ price, tokens: usage.tokens }).usd;
        } else {
          unpricedCalls += 1;
        }
      }
      continue;
    }

    if (
      bucket
      && (span?.spanType === 'tool_call' || span?.spanType === 'workspace_action' || span?.spanType === 'skill_action')
    ) {
      const isDone = endedMs !== null;
      const isStuck = !isDone && runStatus !== 'waiting_for_you' && runStatus !== 'stopped' && runStatus !== 'given_up' && (now - startedMs) >= stuckMs;
      bucket.actions.push({
        id: String(span.spanId ?? `${bucket.id}-action-${bucket.actions.length + 1}`),
        label: describeSpanAction(span),
        state: isDone ? 'done' : isStuck ? 'stuck' : 'now',
        startedAt: startedMs ? new Date(startedMs).toISOString() : null,
        _startedMs: startedMs,
      });
    }
  }

  const helpers = [];
  for (const bucket of agentBuckets.values()) {
    const agentEndedMs = toMs(bucket.span?.endedAt);
    const hasError = Boolean(bucket.span?.error);
    let status = 'working';
    if (agentEndedMs !== null) {
      status = hasError ? 'stopped' : 'done';
    } else if (runStatus === 'stopped' || runStatus === 'given_up') {
      status = 'stopped';
    } else if (runStatus !== 'waiting_for_you' && bucket.lastActivityMs > 0 && (now - bucket.lastActivityMs) >= stuckMs) {
      status = 'stuck';
    }

    const actions = bucket.actions
      .sort((a, b) => b._startedMs - a._startedMs)
      .map(({ _startedMs, ...action }) => action);

    helpers.push({
      id: bucket.id,
      name: bucket.name,
      status,
      statusLabel: HELPER_STATUS_TABLE[status].label,
      tokens: bucket.tokens,
      tokensLabel: formatTokens(bucket.tokens),
      actions,
      _lastActivityMs: bucket.lastActivityMs,
    });
  }

  const estimatedDollars = pricedCalls > 0 && unpricedCalls === 0 ? totalUsd : null;

  return {
    helpers,
    totalTokens,
    estimatedDollars,
    burningFastCalls,
  };
}

function getSubscriptionRemainingPercent(sub) {
  if (sub === null || sub === undefined || typeof sub !== 'object') return null;
  if (sub.status === 'unknown') return null;
  if (sub.percentLeft !== null && sub.percentLeft !== undefined && Number.isFinite(Number(sub.percentLeft))) {
    return Number(sub.percentLeft);
  }
  if (sub.remainingPercent !== null && sub.remainingPercent !== undefined && Number.isFinite(Number(sub.remainingPercent))) {
    return Number(sub.remainingPercent);
  }
  if (sub.usedPercent !== null && sub.usedPercent !== undefined && Number.isFinite(Number(sub.usedPercent))) {
    return Math.max(0, 100 - Number(sub.usedPercent));
  }
  return null;
}

export function evaluateWarnings({
  runStatus = null,
  stopWhy = '',
  stuckInfo = null,
  burningFastCalls = [],
  subscriptions = [],
  thresholds = DEFAULT_WARNING_THRESHOLDS,
} = {}) {
  const warnings = [];

  if (runStatus === 'stopped' || runStatus === 'given_up') {
    const title = runStatus === 'given_up' ? 'Run gave up' : 'Run stopped';
    const message = String(stopWhy || '').trim() || (
      runStatus === 'given_up'
        ? 'The machine gave up on this card after repeated failures.'
        : 'The machine stopped this run.'
    );
    warnings.push({
      id: `warning-${runStatus}`,
      kind: 'stopped',
      title,
      message,
      borderStyle: 'solid',
      severity: 'danger',
    });
  }

  if (stuckInfo && Number.isFinite(stuckInfo.minutes) && stuckInfo.minutes >= thresholds.stuckMinutes) {
    const mins = Math.floor(stuckInfo.minutes);
    const target = stuckInfo.targetName ? ` on ${stuckInfo.targetName}` : '';
    warnings.push({
      id: 'warning-stuck',
      kind: 'stuck',
      title: 'Run looks stuck',
      message: `No progress${target} for ${mins} min.`,
      borderStyle: 'dashed',
      severity: 'warning',
    });
  }

  for (const sub of subscriptions ?? []) {
    const remaining = getSubscriptionRemainingPercent(sub);
    if (remaining === null || remaining > thresholds.quotaLowPercent) continue;
    const name = String(sub.name ?? sub.label ?? sub.provider ?? sub.id ?? 'Subscription');
    warnings.push({
      id: `warning-quota-${String(sub.id ?? name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      kind: 'quota_low',
      title: 'Quota low',
      message: `${name} has ${Math.round(remaining)}% left.`,
      borderStyle: 'solid',
      severity: 'danger',
    });
  }

  if (Array.isArray(burningFastCalls) && burningFastCalls.length > 0) {
    const worst = [...burningFastCalls].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))[0];
    warnings.push({
      id: 'warning-burning-fast',
      kind: 'burning_fast',
      title: 'Burning tokens fast',
      message: `${worst.agentName} used ${formatTokens(worst.tokens)} in one call.`,
      borderStyle: 'solid',
      severity: 'danger',
    });
  }

  return warnings;
}

function normalizeRawRun(rawRun) {
  if (!rawRun) return null;
  const snapshot = rawRun.snapshot ?? null;
  const state = rawRun.initialState ?? snapshot?.value ?? rawRun.state ?? {};
  const steps = rawRun.steps ?? snapshot?.context ?? {};
  const result = rawRun.result ?? {};
  const status = String(rawRun.status ?? snapshot?.status ?? 'running').toLowerCase();
  return { rawRun, state, steps, result, status };
}

function extractCardTitle({ rawRun, state, steps, cardTitle }) {
  if (cardTitle && String(cardTitle).trim()) return String(cardTitle).trim();
  if (rawRun?.title && String(rawRun.title).trim()) return String(rawRun.title).trim();
  if (state?.title && String(state.title).trim()) return String(state.title).trim();

  for (const [key, entry] of Object.entries(steps ?? {})) {
    if (!key.endsWith('start-build')) continue;
    const prompt = String(entry?.output?.prompt ?? '');
    const match = prompt.match(/^Linear card [A-Z]+-\d+:\s*(.+)$/m);
    if (match && match[1].trim()) return match[1].trim();
  }

  return String(state?.card ?? rawRun?.payload?.card ?? rawRun?.runId ?? 'Untitled card');
}

function findMatchingStepEntries(steps, machineStepIds) {
  const matched = [];
  for (const [key, entry] of Object.entries(steps ?? {})) {
    const leaf = key.split('.').at(-1);
    if (machineStepIds.includes(key) || machineStepIds.includes(leaf)) {
      matched.push({ key, leaf, entry });
    }
  }
  return matched;
}

function deriveRunStatus({ status, state, steps, result, lastActivityMs, now, thresholds }) {
  const isSuspended = status === 'suspended'
    || Object.values(steps ?? {}).some(entry => entry?.status === 'suspended');
  if (isSuspended) return 'waiting_for_you';

  const failCount = Number(state?.failCount ?? result?.failCount ?? 0) || 0;
  const unreviewed = Boolean(state?.unreviewed || result?.unreviewed);
  const stopped = Boolean(state?.stopped || result?.stopped || status === 'canceled' || status === 'failed');

  if ((failCount >= 2 || unreviewed) && (stopped || status === 'success' || status === 'failed')) {
    return 'given_up';
  }
  if (stopped) return 'stopped';
  if (status === 'success' || Boolean(result?.finished)) return 'finished';

  const stuckMs = thresholds.stuckMinutes * 60_000;
  if (lastActivityMs > 0 && (now - lastActivityMs) >= stuckMs) {
    return 'stuck';
  }
  return 'running';
}

function deriveStepState({ stepDef, steps, state, runStatus }) {
  if (stepDef.taskStatus) {
    if (stepDef.taskStatus === 'completed') return { state: 'passed' };
    if (stepDef.taskStatus === 'in_progress') {
      return { state: runStatus === 'stuck' ? 'stuck' : 'running' };
    }
    return { state: 'upcoming' };
  }

  const matches = findMatchingStepEntries(steps, stepDef.machineStepIds ?? [stepDef.id]);
  if (matches.length === 0) return { state: 'upcoming' };

  const hasSuspended = matches.some(m => m.entry?.status === 'suspended');
  if (hasSuspended) return { state: 'running', note: 'Waiting for you' };

  const hasStuck = matches.some(m => m.entry?.status === 'stuck');
  if (hasStuck) {
    return { state: 'stuck' };
  }

  const hasRunning = matches.some(m => m.entry?.status === 'running');
  if (hasRunning) {
    return { state: runStatus === 'stuck' ? 'stuck' : 'running' };
  }

  for (const m of matches) {
    const out = m.entry?.output ?? {};
    if (out.verdict === 'PASS+NOTES') {
      return { state: 'passed_with_notes', note: out.detail || 'Passed with notes' };
    }
    if (out.verdict === 'FAIL') {
      if ((Number(out.failCount ?? state?.failCount ?? 0) || 0) >= 2) {
        return { state: 'given_up', note: out.detail || 'Failed verification twice' };
      }
      return {
        state: 'sent_back',
        note: out.detail || 'Sent back for fixes',
        roundNumber: Number(state?.reviewRound ?? 1) || 1,
      };
    }
    if (out.checkPassed === false) {
      return {
        state: 'sent_back',
        note: out.checkReason || out.detail || 'Sent back by check',
        roundNumber: Number(state?.buildRounds ?? 1) || 1,
      };
    }
    if (m.entry?.status === 'failed') {
      return { state: runStatus === 'given_up' ? 'given_up' : 'sent_back' };
    }
  }

  return { state: 'passed' };
}

function deriveStageState(stepStates) {
  if (stepStates.includes('stuck')) return 'stuck';
  if (stepStates.includes('running')) return 'running';
  if (stepStates.includes('given_up')) return 'given_up';
  if (stepStates.includes('sent_back')) return 'sent_back';
  if (stepStates.every(s => s === 'passed' || s === 'passed_with_notes')) {
    return stepStates.includes('passed_with_notes') ? 'passed_with_notes' : 'passed';
  }
  if (stepStates.some(s => s === 'passed' || s === 'passed_with_notes')) return 'running';
  return 'upcoming';
}

function formatLastRun(rawLastRun) {
  if (!rawLastRun) return null;
  if (rawLastRun.outcome && rawLastRun.tokensLabel) {
    return {
      title: String(rawLastRun.title ?? 'Previous card'),
      outcome: String(rawLastRun.outcome),
      tokensLabel: String(rawLastRun.tokensLabel),
      estimatedDollarsLabel: String(rawLastRun.estimatedDollarsLabel ?? formatEstimatedDollars(null)),
      endedAt: rawLastRun.endedAt ?? null,
    };
  }
  const normalized = normalizeRawRun(rawLastRun);
  if (!normalized) return null;
  const { state, steps, result, status } = normalized;
  const title = extractCardTitle({ rawRun: rawLastRun, state, steps });
  const failCount = Number(state?.failCount ?? result?.failCount ?? 0) || 0;
  const outcome = failCount >= 2
    ? 'Gave up'
    : (state?.stopped || result?.stopped || status === 'canceled' || status === 'failed')
      ? 'Stopped'
      : 'Finished';
  const tokens = Number(rawLastRun.tokens ?? 0) || 0;
  const usd = rawLastRun.estimatedDollars ?? null;
  return {
    title,
    outcome,
    tokensLabel: formatTokens(tokens),
    estimatedDollarsLabel: formatEstimatedDollars(usd),
    endedAt: rawLastRun.updatedAt ?? null,
  };
}

export function buildRunViewSnapshot({
  now = Date.now(),
  sourceStatus = 'live',
  rawRun = null,
  rawLastRun = null,
  spans = [],
  subscriptions = [],
  baseStages = PLAIN_ENGLISH_STAGES,
  playbookTasks = [],
  cardTitle = null,
  thresholds: rawThresholds = DEFAULT_WARNING_THRESHOLDS,
  catalog = null,
  corrections = {},
} = {}) {
  const nowMs = toMs(now) ?? Date.now();
  const thresholds = normalizeWarningThresholds(rawThresholds);
  const safeSubscriptions = Array.isArray(subscriptions) ? subscriptions : [];
  const lastRun = formatLastRun(rawLastRun);

  if (!rawRun || sourceStatus === 'unavailable') {
    const warnings = evaluateWarnings({
      subscriptions: safeSubscriptions,
      thresholds,
    });
    return {
      updatedAt: new Date(nowMs).toISOString(),
      sourceStatus,
      warnings,
      run: null,
      lastRun,
      subscriptions: safeSubscriptions,
    };
  }

  const normalized = normalizeRawRun(rawRun);
  const { state, steps, result, status } = normalized;
  const title = extractCardTitle({ rawRun, state, steps, cardTitle });

  const startedAtMs = toMs(rawRun.startedAt ?? rawRun.createdAt)
    ?? Math.min(...Object.values(steps).map(s => toMs(s?.startedAt)).filter(Boolean), nowMs);

  const stepActivityTimes = Object.values(steps ?? {})
    .flatMap(entry => [toMs(entry?.startedAt), toMs(entry?.endedAt)])
    .filter(Boolean);
  const spanActivityTimes = (spans ?? [])
    .flatMap(span => [toMs(span?.startedAt ?? span?.timestamp), toMs(span?.endedAt)])
    .filter(Boolean);
  const lastActivityMs = Math.max(
    toMs(rawRun.updatedAt) ?? 0,
    ...stepActivityTimes,
    ...spanActivityTimes,
    startedAtMs,
  );

  const runStatus = deriveRunStatus({ status, state, steps, result, lastActivityMs, now: nowMs, thresholds });
  const parsedSpans = parseHelpersFromSpans(spans, {
    now: nowMs,
    thresholds,
    runStatus,
    catalog,
    corrections,
  });

  const resolvedBase = resolveStagesForRun({
    baseStages,
    runSteps: steps,
    playbookTasks: playbookTasks.length > 0 ? playbookTasks : (state?.playbookTasks ?? rawRun?.playbookTasks ?? []),
  });

  const stages = resolvedBase.map(stageDef => {
    const mappedSteps = stageDef.steps.map(stepDef => {
      const outcome = deriveStepState({ stepDef, steps, state, runStatus });
      const stepObj = {
        id: stepDef.id,
        name: stepDef.name,
        state: outcome.state,
      };
      if (outcome.note) stepObj.note = outcome.note;
      if (outcome.roundNumber) stepObj.roundNumber = outcome.roundNumber;
      return stepObj;
    });

    const stageState = deriveStageState(mappedSteps.map(s => s.state));
    const stageObj = {
      id: stageDef.id,
      name: stageDef.name,
      state: stageState,
      steps: mappedSteps,
    };
    if (stageDef.id === 'build' && Number(state?.buildRounds ?? 0) > 1) {
      stageObj.roundNumber = Number(state.buildRounds);
    }
    if (stageDef.id === 'shipping' && Number(state?.reviewRound ?? 0) > 1) {
      stageObj.roundNumber = Number(state.reviewRound);
    }
    return stageObj;
  });

  const activeStage = [...stages].reverse().find(s => s.steps.some(st => st.state === 'running' || st.state === 'stuck'))
    ?? [...stages].reverse().find(s => s.state === 'running' || s.state === 'stuck')
    ?? [...stages].reverse().find(s => s.state !== 'upcoming')
    ?? stages[0];
  const activeStepIndex = activeStage
    ? Math.max(
        0,
        activeStage.steps.findIndex(s => s.state === 'running' || s.state === 'stuck') !== -1
          ? activeStage.steps.findIndex(s => s.state === 'running' || s.state === 'stuck')
          : activeStage.steps.findLastIndex(s => s.state !== 'upcoming'),
      )
    : 0;
  const activeStep = activeStage?.steps[activeStepIndex] ?? activeStage?.steps[0] ?? null;

  const isTerminalRun = runStatus === 'finished' || runStatus === 'stopped' || runStatus === 'given_up';
  const elapsedEndMs = isTerminalRun ? (toMs(rawRun.endedAt ?? rawRun.updatedAt) ?? nowMs) : nowMs;
  const elapsedLabel = formatElapsed(Math.max(0, elapsedEndMs - startedAtMs));

  const tokens = rawRun.tokens !== undefined ? Number(rawRun.tokens) : parsedSpans.totalTokens;
  const estimatedDollars = rawRun.estimatedDollars !== undefined
    ? rawRun.estimatedDollars
    : parsedSpans.estimatedDollars;

  const stuckHelper = parsedSpans.helpers
    .filter(h => h.status === 'stuck' && h._lastActivityMs > 0)
    .sort((a, b) => a._lastActivityMs - b._lastActivityMs)[0] ?? null;

  const stuckInfo = runStatus === 'stuck'
    ? { minutes: (nowMs - lastActivityMs) / 60_000, targetName: activeStep?.name ?? activeStage?.name ?? null }
    : stuckHelper
      ? { minutes: (nowMs - stuckHelper._lastActivityMs) / 60_000, targetName: stuckHelper.name }
      : null;

  const warnings = evaluateWarnings({
    runStatus,
    stopWhy: state?.stopWhy ?? result?.detail ?? '',
    stuckInfo,
    burningFastCalls: parsedSpans.burningFastCalls,
    subscriptions: safeSubscriptions,
    thresholds,
  });

  const roundNumber = Math.max(
    1,
    Number(activeStage?.roundNumber ?? state?.reviewRound ?? state?.buildRounds ?? 1) || 1,
  );

  const helpers = parsedSpans.helpers.map(({ _lastActivityMs, ...helper }) => helper);

  return {
    updatedAt: new Date(nowMs).toISOString(),
    sourceStatus,
    warnings,
    run: {
      runId: String(rawRun.runId ?? 'unknown'),
      title,
      status: runStatus,
      statusLabel: RUN_STATE_TABLE[runStatus].label,
      startedAt: new Date(startedAtMs).toISOString(),
      elapsedLabel,
      tokens,
      tokensLabel: formatTokens(tokens),
      estimatedDollars,
      estimatedDollarsLabel: formatEstimatedDollars(estimatedDollars),
      currentStageId: activeStage?.id ?? 'build',
      currentStageName: activeStage?.name ?? 'Build',
      currentStepIndex: activeStepIndex + 1,
      currentStepTotal: activeStage?.steps.length ?? 0,
      currentStepName: activeStep?.name ?? '',
      roundNumber,
      stages,
      helpers,
    },
    lastRun,
    subscriptions: safeSubscriptions,
  };
}
