// What mission control reads while a card runs. The machine is the only writer:
// one JSON line per event, appended as the event happens. The trace cannot serve
// the screen (DuckDB takes a single write lock for the whole run) and state.db
// keeps the workflow snapshot as msgpack, so the machine says out loud what it is
// doing and the screen folds those lines.
//
// A write never breaks a run. If the file cannot be written, the first failure is
// logged and the run carries on without a live view.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isLiveType } from './live-schema.mjs';

export const LIVE_FILE = 'live.jsonl';

// Span types the feed reports, as the strings the trace uses. Kept as strings so
// this module depends on nothing but Node.
const AGENT_SPAN = 'agent_run';
const TOOL_SPAN = 'tool_call';
const MODEL_SPAN = 'model_inference';

// One constructor per event type. A hook names a type and its fields and every
// line is assembled here, so the file has one shape on disk. `id` is the event's
// real identity: the same event seen twice is written once.
const EVENTS = {
  run: {
    id: ({ card }) => `run:${card}`,
    body: ({ card, title }) => ({ card, title }),
  },
  stage: {
    id: ({ stage, attempt, status }) => `stage:${stage}:${attempt}:${status}`,
    body: ({ stage, attempt, status }) => ({ stage, attempt, status }),
  },
  agent: {
    id: ({ spanId, status }) => `agent:${spanId}:${status}`,
    body: ({ agent, spanId, status }) => ({ agent, spanId, status }),
  },
  tool: {
    id: ({ callId, status }) => `tool:${callId}:${status}`,
    body: ({ agent, callId, name, status }) => ({ agent, callId, name, status }),
  },
  model: {
    id: ({ spanId }) => `model:${spanId}`,
    body: ({ agent, model, spanId, inputTokens, outputTokens, cachedInputTokens }) => ({
      agent, model, spanId, inputTokens, outputTokens, cachedInputTokens,
    }),
  },
  tasks: {
    id: ({ agent, seq }) => `tasks:${agent}:${seq}`,
    body: ({ agent, seq, tasks }) => ({ agent, seq, tasks }),
  },
};

export const liveFileIn = (dir, card) => join(dir, card, LIVE_FILE);

export function createLiveFeed({ file, now = Date.now, append = appendFileSync, logger = console } = {}) {
  if (!file) throw new Error('A live feed needs the file it writes.');
  const seen = new Set();
  const stageAttempts = new Map();
  const taskSeq = new Map();
  let ready = false;
  let logged = false;

  const write = (type, fields) => {
    const shape = EVENTS[type];
    if (!isLiveType(type) || !shape) throw new Error(`live event type ${type} is not in the shared schema`);
    const id = shape.id(fields);
    if (seen.has(id)) return false;
    seen.add(id);
    const event = { id, at: now(), type, ...shape.body(fields) };
    try {
      if (!ready) {
        mkdirSync(dirname(file), { recursive: true });
        ready = true;
      }
      append(file, `${JSON.stringify(event)}\n`);
    } catch (error) {
      if (!logged) {
        logged = true;
        logger?.warn?.(`live feed could not write ${file}: ${error?.message ?? error}`);
      }
    }
    return true;
  };

  // A tool or model span belongs to the nearest agent above it, because a helper's work
  // hangs under the helper's own agent span.
  const agentOf = (span) => {
    if (!span) return 'machine';
    if (span.type === AGENT_SPAN) return span.name ?? span.entityName ?? 'machine';
    if (span.parent) return agentOf(span.parent);
    return span.entityName ?? 'machine';
  };

  // A span without an end time has started; one with an error has failed.
  const outcome = (span) => (!span.endTime ? 'started' : span.errorInfo ? 'failed' : 'done');

  const observeSpan = (span) => {
    if (!span || typeof span !== 'object') return;
    if (span.type === AGENT_SPAN) {
      write('agent', { agent: span.name ?? span.entityName ?? 'agent', spanId: span.id, status: outcome(span) });
      return;
    }
    if (span.type === TOOL_SPAN) {
      const status = span.attributes?.success === false ? 'failed' : outcome(span);
      write('tool', {
        agent: agentOf(span),
        callId: span.id,
        name: span.name ?? '',
        status,
      });
      return;
    }
    if (span.type === MODEL_SPAN && span.endTime) {
      const usage = span.attributes?.usage ?? {};
      write('model', {
        agent: agentOf(span),
        model: span.attributes?.model ?? span.model ?? '',
        spanId: span.id,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cachedInputTokens: usage.inputDetails?.cacheRead ?? 0,
      });
    }
  };

  return {
    file,
    write,
    run: (fields) => write('run', fields),
    // Stages are numbered per stage name, so a second build round is its own attempt.
    stage: ({ stage, status }) => {
      if (status === 'started') stageAttempts.set(stage, (stageAttempts.get(stage) ?? 0) + 1);
      return write('stage', { stage, attempt: Math.max(1, stageAttempts.get(stage) ?? 1), status });
    },
    agent: (fields) => write('agent', fields),
    tool: (fields) => write('tool', fields),
    model: (fields) => write('model', fields),
    // Every task event carries the whole list, so the screen never merges two lists.
    tasks: ({ agent, tasks }) => {
      const seq = (taskSeq.get(agent) ?? 0) + 1;
      taskSeq.set(agent, seq);
      return write('tasks', { agent, seq, tasks });
    },
    observeSpan,
  };
}

// A stage's start and how it ended, wrapped around one workflow step's work. The feed
// is looked up per step, because the card a step serves is only known when it runs.
//
// A step that asks to wait returns as if it had finished, so the wrapper counts the
// request itself: the context's suspend is wrapped, and a stage that suspends is
// waiting on Todd rather than done. Without that, a run stopped at the acceptance gate
// reads as still running.
export const stageEvents = (id, execute, feedOf = () => null) => async (context) => {
  const feed = feedOf(context);
  feed?.stage({ stage: id, status: 'started' });
  let waiting = false;
  const held = feed && typeof context?.suspend === 'function'
    ? Object.create(context, {
      suspend: {
        value: async (...args) => {
          const output = await context.suspend(...args);
          waiting = true;
          feed.stage({ stage: id, status: 'waiting' });
          return output;
        },
      },
    })
    : context;
  try {
    const output = await execute(held);
    feed?.stage({ stage: id, status: waiting ? 'waiting' : 'done' });
    return output;
  } catch (error) {
    feed?.stage({ stage: id, status: 'failed' });
    throw error;
  }
};

export function spanLiveProcessor(feed) {
  return {
    name: 'live-run-events',
    process(span) {
      try {
        feed?.observeSpan(span);
      } catch {
        // The view is never worth a failed run.
      }
      return span;
    },
    async shutdown() {},
  };
}

// One feed per run file, so the stages, the task tools and the span processor all
// append through the same instance and the same set of written ids.
const feeds = new Map();
let liveDir = null;

export function setLiveDir(dir) {
  liveDir = dir || null;
}

export function liveFeedForCard(dir, card) {
  if (!dir || !card) return null;
  const file = liveFileIn(dir, card);
  if (!feeds.has(file)) feeds.set(file, createLiveFeed({ file }));
  return feeds.get(file);
}

export function liveFeedForRun(card) {
  return liveFeedForCard(liveDir, card);
}

// The feed a stage serves, looked up when the stage runs: the flow folder holds one
// folder per card and the card is only known once the workflow has it.
export const flowFeed = (dir) => (context) => {
  const card = context?.state?.card || context?.inputData?.card;
  return card ? liveFeedForCard(dir, card) : null;
};

// What the stages take from the live file: the run's name once and how each stage ended.
export function stageHooks(dir) {
  const feedOf = flowFeed(dir);
  return {
    run: (context, card, title) => feedOf(context)?.run({ card, title: title ?? '' }),
    staged: (id, execute) => stageEvents(id, execute, feedOf),
  };
}

// Where a tool call learns which card it serves: the stages put it on the request
// context, and an agent carries it as the resource it is remembering against.
export function cardOfContext(context) {
  const requestContext = context?.requestContext;
  const card = requestContext?.get?.('flowCard')
    ?? requestContext?.get?.('mastra__resourceId')
    ?? context?.agent?.resourceId;
  return typeof card === 'string' ? card : '';
}
