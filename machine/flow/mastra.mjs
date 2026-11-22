// The run's own storage: LibSQL keeps the workflow's saved state and snapshots,
// DuckDB keeps the trace with Mastra retention, and one span processor stamps
// the card on every span so a model call can be found by the card it served.

import { Mastra } from '@mastra/core';
import { MastraCompositeStore } from '@mastra/core/storage';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';
import { MastraStorageExporter, Observability } from '@mastra/observability';

import { CallCostObservability } from './call-cost.mjs';

export const DEFAULT_TRACE_MAX_AGE = '1d';
export const DEFAULT_TRACE_MEMORY_LIMIT = '256MB';
export const DEFAULT_TRACE_THREADS = 1;
export const DEFAULT_SPAN_SERIALIZATION = Object.freeze({
  maxStringLength: 1024,
  maxArrayLength: 20,
  maxObjectKeys: 25,
  maxDepth: 4,
});

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
  traceMemoryLimit = process.env.FLOW_TRACE_MEMORY_LIMIT || DEFAULT_TRACE_MEMORY_LIMIT,
  traceThreads = Number(process.env.FLOW_TRACE_THREADS) || DEFAULT_TRACE_THREADS,
}) {
  if (workflow?.options?.autoRestartActiveRuns !== false) {
    throw new Error(`Workflow ${workflow?.id ?? '(unknown)'} must set options.autoRestartActiveRuns to false.`);
  }
  const obs = traceDb ? await new DuckDBStore({ path: traceDb, memoryLimit: traceMemoryLimit, threads: traceThreads }).getStore('observability') : null;
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
          spanOutputProcessors: [cardStamper(card)],
          serializationOptions: DEFAULT_SPAN_SERIALIZATION,
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
