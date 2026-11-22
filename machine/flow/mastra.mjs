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
export const DEFAULT_SPAN_MAX_BYTES = 64 * 1024;

const SPAN_PAYLOAD_FIELDS = ['attributes', 'errorInfo', 'metadata', 'input', 'output'];

const safeJson = value => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return JSON.stringify(String(value));
  }
};

const fitTruncated = (text, originalBytes, budget, limit) => {
  const candidate = { truncated: true, originalBytes, preview: text.slice(0, limit) };
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= budget) return candidate;
  if (limit <= 0) return { truncated: true, originalBytes };
  return fitTruncated(text, originalBytes, budget, Math.floor(limit * 0.75));
};

const truncateField = (serialized, originalBytes, budget) => {
  if (budget < 64) return { truncated: true, originalBytes };
  return fitTruncated(serialized, originalBytes, budget, Math.max(0, budget - 96));
};

const allocateBudgets = (entries, budget) => {
  if (entries.length === 0) return [];
  const fairShare = Math.floor(budget / entries.length);
  const fits = entries.filter(entry => entry.bytes <= fairShare);
  if (fits.length === 0) {
    return entries.map(entry => ({ ...entry, budget: fairShare }));
  }
  const used = fits.reduce((sum, entry) => sum + entry.bytes, 0);
  const oversized = entries.filter(entry => entry.bytes > fairShare);
  return [
    ...fits.map(entry => ({ ...entry, budget: entry.bytes })),
    ...allocateBudgets(oversized, Math.max(0, budget - used)),
  ];
};

export const spanSizeCap = (maxBytes = DEFAULT_SPAN_MAX_BYTES) => ({
  name: 'span-size-cap',
  process(span) {
    if (!span) return span;
    const entries = SPAN_PAYLOAD_FIELDS
      .filter(field => span[field] !== undefined)
      .map(field => {
        const serialized = safeJson(span[field]);
        return { field, serialized, bytes: Buffer.byteLength(serialized, 'utf8') };
      });
    const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    if (total <= maxBytes) return span;

    const attrEntry = entries.find(entry => entry.field === 'attributes');
    const attrCap = Math.floor(maxBytes / 4);
    let remaining = maxBytes;
    if (attrEntry) {
      if (attrEntry.bytes <= attrCap) {
        remaining -= attrEntry.bytes;
      } else {
        const preserved = {};
        if (span.attributes?.card !== undefined) preserved.card = span.attributes.card;
        if (span.attributes?.usage !== undefined) preserved.usage = span.attributes.usage;
        span.attributes = { ...preserved, truncated: true, originalBytes: attrEntry.bytes };
        remaining -= Buffer.byteLength(safeJson(span.attributes), 'utf8');
      }
    }

    const payloadEntries = entries.filter(entry => entry.field !== 'attributes');
    for (const entry of allocateBudgets(payloadEntries, Math.max(0, remaining))) {
      if (entry.bytes > entry.budget) {
        span[entry.field] = truncateField(entry.serialized, entry.bytes, entry.budget);
      }
    }
    return span;
  },
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
          spanOutputProcessors: [cardStamper(card), spanSizeCap()],
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
