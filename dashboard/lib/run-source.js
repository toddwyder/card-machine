// Read-only Mastra Studio & fixture data source for Mission Control's Run view.
// Both live Studio data and JSON fixtures flow through the exact same pure
// buildRunViewSnapshot model so tests prove every state and warning without
// faking UI logic.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMachineStages } from './machine-stages.js';
import { loadCatalog, readCorrections } from './model-prices.js';
import {
  DEFAULT_WARNING_THRESHOLDS,
  normalizeWarningThresholds,
  buildRunViewSnapshot,
} from './run-view-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = dirname(here);
const WARNINGS_CONFIG_PATH = join(dashboardRoot, 'config', 'run-view-warnings.json');
const DEFAULT_STUDIO_URL = 'http://127.0.0.1:4112';

export function readWarningThresholds(configPath = WARNINGS_CONFIG_PATH) {
  if (!existsSync(configPath)) return DEFAULT_WARNING_THRESHOLDS;
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    return normalizeWarningThresholds(raw);
  } catch {
    return DEFAULT_WARNING_THRESHOLDS;
  }
}

function loadPricingSafe() {
  try {
    return {
      catalog: loadCatalog(),
      corrections: readCorrections(),
    };
  } catch {
    return { catalog: null, corrections: {} };
  }
}

async function resolveSubscriptions({ subscriptions, fetchImpl, now }) {
  if (Array.isArray(subscriptions)) return subscriptions;
  try {
    const mod = await import('./subscriptions.js');
    if (typeof mod?.readSubscriptions === 'function') {
      const result = await mod.readSubscriptions({ fetchImpl, now });
      if (Array.isArray(result)) return result;
      if (Array.isArray(result?.subscriptions)) return result.subscriptions;
    }
  } catch {
    // Subscriptions module may not be present yet or may fail offline.
  }
  return [];
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response || !response.ok) {
    throw new Error(`HTTP ${response?.status ?? 'error'} from ${url}`);
  }
  return response.json();
}

function selectRuns(runs) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return { current: null, previous: null };
  }
  const isActive = run => {
    const status = String(run?.status ?? run?.snapshot?.status ?? '').toLowerCase();
    return status === 'running' || status === 'suspended';
  };
  const activeIndex = runs.findIndex(isActive);
  if (activeIndex !== -1) {
    const current = runs[activeIndex];
    const previous = runs.find((run, idx) => idx !== activeIndex) ?? null;
    return { current, previous };
  }
  return {
    current: runs[0],
    previous: runs[1] ?? null,
  };
}

function filterSpansForRun(spans, runId) {
  const list = Array.isArray(spans) ? spans : [];
  if (!runId || list.length === 0) return list;
  const matchingTraceIds = new Set(
    list
      .filter(span => span?.runId === runId || span?.attributes?.workflowRunId === runId)
      .map(span => span?.traceId)
      .filter(Boolean),
  );
  if (matchingTraceIds.size > 0) {
    return list.filter(span => matchingTraceIds.has(span?.traceId) || span?.runId === runId);
  }
  const hasAnyRunIds = list.some(span => Boolean(span?.runId));
  if (hasAnyRunIds) {
    const direct = list.filter(span => span?.runId === runId);
    if (direct.length > 0) return direct;
  }
  return list;
}

export async function readRunViewSnapshot({
  studioUrl = process.env.STUDIO_URL || DEFAULT_STUDIO_URL,
  now = Date.now(),
  subscriptions,
  fixturePath = process.env.RUN_VIEW_FIXTURE_FILE || null,
  fetchImpl = globalThis.fetch,
  repoRoot,
  thresholds: explicitThresholds,
} = {}) {
  const thresholds = explicitThresholds
    ? normalizeWarningThresholds(explicitThresholds)
    : readWarningThresholds();
  const { catalog, corrections } = loadPricingSafe();
  const { stages: baseStages } = readMachineStages({ repoRoot });

  if (fixturePath) {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const fixtureSubscriptions = Array.isArray(fixture.subscriptions)
      ? fixture.subscriptions
      : await resolveSubscriptions({ subscriptions, fetchImpl, now });

    return buildRunViewSnapshot({
      now: fixture.now ?? now,
      sourceStatus: fixture.sourceStatus ?? 'fixture',
      rawRun: fixture.rawRun ?? fixture.run ?? null,
      rawLastRun: fixture.rawLastRun ?? fixture.lastRun ?? null,
      spans: fixture.spans ?? [],
      subscriptions: fixtureSubscriptions,
      baseStages,
      playbookTasks: fixture.playbookTasks ?? [],
      cardTitle: fixture.cardTitle ?? null,
      thresholds: fixture.thresholds ? normalizeWarningThresholds(fixture.thresholds) : thresholds,
      catalog: fixture.catalog ?? catalog,
      corrections: fixture.corrections ?? corrections,
    });
  }

  const resolvedSubscriptions = await resolveSubscriptions({ subscriptions, fetchImpl, now });
  const baseUrl = String(studioUrl || DEFAULT_STUDIO_URL).replace(/\/+$/, '');

  let runsPayload;
  try {
    runsPayload = await fetchJson(fetchImpl, `${baseUrl}/api/workflows/card-path/runs?perPage=5`);
  } catch {
    return buildRunViewSnapshot({
      now,
      sourceStatus: 'unavailable',
      rawRun: null,
      rawLastRun: null,
      spans: [],
      subscriptions: resolvedSubscriptions,
      baseStages,
      thresholds,
      catalog,
      corrections,
    });
  }

  const runs = Array.isArray(runsPayload?.runs) ? runsPayload.runs : (Array.isArray(runsPayload) ? runsPayload : []);
  const { current, previous } = selectRuns(runs);

  if (!current) {
    return buildRunViewSnapshot({
      now,
      sourceStatus: 'live',
      rawRun: null,
      rawLastRun: null,
      spans: [],
      subscriptions: resolvedSubscriptions,
      baseStages,
      thresholds,
      catalog,
      corrections,
    });
  }

  const runId = current.runId;
  let detailedRun = current;
  let spans = [];

  try {
    const [detailResult, tracesResult] = await Promise.all([
      runId
        ? fetchJson(fetchImpl, `${baseUrl}/api/workflows/card-path/runs/${encodeURIComponent(runId)}`).catch(() => current)
        : Promise.resolve(current),
      fetchJson(fetchImpl, `${baseUrl}/api/observability/traces?perPage=200`).catch(() => ({ spans: [] })),
    ]);
    detailedRun = detailResult ?? current;
    const rawSpans = Array.isArray(tracesResult?.spans)
      ? tracesResult.spans
      : (Array.isArray(tracesResult) ? tracesResult : []);
    spans = filterSpansForRun(rawSpans, runId);
  } catch {
    detailedRun = current;
    spans = [];
  }

  return buildRunViewSnapshot({
    now,
    sourceStatus: 'live',
    rawRun: detailedRun,
    rawLastRun: previous,
    spans,
    subscriptions: resolvedSubscriptions,
    baseStages,
    thresholds,
    catalog,
    corrections,
  });
}
