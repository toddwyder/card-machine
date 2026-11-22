// The run's own storage: LibSQL keeps the workflow's saved state and snapshots,
// DuckDB keeps the trace with Mastra retention, and one span processor stamps
// the card on every span so a model call can be found by the card it served.
// A second processor writes the live file the Run view reads, because the trace
// cannot be read while the run holds it.

import { dirname } from 'node:path';

import { Mastra } from '@mastra/core';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';
import { MastraStorageExporter, Observability } from '@mastra/observability';

import { CallCostObservability } from './call-cost.mjs';
import { liveFeedForCard, setLiveDir, spanLiveProcessor } from './live.mjs';

export const DEFAULT_TRACE_MAX_AGE = '1d';

export const cardStamper = card => ({
  name: 'card-stamper',
  process(span) {
    if (!span) return span;
    if (card) span.attributes = { ...(span.attributes ?? {}), card };
    if (typeof span.resourceId === 'string') {
      const match = span.resourceId.match(/^([A-Z]+-\d+)-.+$/);
      if (match) span.resourceId = match[1];
    }
    return span;
  },
});

export async function openMastra({
  card,
  agents,
  workflow,
  stateDb,
  traceDb,
  traceMaxAge = process.env.FLOW_TRACE_MAX_AGE || DEFAULT_TRACE_MAX_AGE,
}) {
  if (workflow?.options?.autoRestartActiveRuns !== false) {
    throw new Error(`Workflow ${workflow?.id ?? '(unknown)'} must set options.autoRestartActiveRuns to false.`);
  }
  const obs = traceDb ? await new DuckDBStore({ path: traceDb }).getStore('observability') : null;
  const storage = new MastraCompositeStore({
    id: 'flow-storage',
    default: new LibSQLStore({ id: 'flow-state', url: `file:${stateDb}` }),
    ...(obs ? { domains: { observability: obs } } : {}),
    retention: {
      observability: {
        spans: { maxAge: traceMaxAge },
      },
    },
  });

  // One run at a time per process, so the run's folder is the state file's folder and
  // the live file sits in it under the card.
  const liveDir = dirname(stateDb);
  setLiveDir(liveDir);

  const registeredAgents = Object.fromEntries(
    Object.entries(agents ?? {}).filter(([, agent]) => typeof agent?.__setLogger === 'function'),
  );
  return new Mastra({
    agents: registeredAgents,
    workflows: { [workflow.id]: workflow },
    storage,
    observability: new Observability({
      configs: {
        default: new CallCostObservability({
          name: 'default',
          serviceName: 'jul-336-card-path',
          exporters: [new MastraStorageExporter({ maxBatchSize: 1 })],
          spanOutputProcessors: [cardStamper(card), spanLiveProcessor(liveFeedForCard(liveDir, card))],
          logging: { enabled: false },
        }),
      },
    }),
  });
}

export async function pruneTrace(mastra, options) {
  const storage = mastra?.getStorage?.();
  if (!storage?.prune) return [];
  const results = await storage.prune(options);
  try {
    const obs = await storage.getStore?.('observability');
    await obs?.db?.query?.('CHECKPOINT');
  } catch {
    // Checkpoint is best-effort space reclamation after pruning.
  }
  return results;
}
