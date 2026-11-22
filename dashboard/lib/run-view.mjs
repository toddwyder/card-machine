// The Run view's model: one append-only event log in, one RunViewSnapshot out.
// Everything here is pure. No file reads, no clock, no network, so a test can pin every state
// and every warning without a browser or a run.

import { liveType } from '../../machine/flow/live-schema.mjs';
import { readingReason } from './reading-reasons.mjs';
import { stageLabel } from './stage-labels.mjs';

// A run is in one of these at a time. The table is the only place a state becomes a word or a
// warning, so nothing downstream re-decides what "stuck" means.
export const RUN_STATES = Object.freeze({
  running: 'Running',
  waiting_for_you: 'Waiting for you',
  stuck: 'Stuck',
  stopped: 'Stopped',
  finished: 'Finished',
});

export const WARNING_TITLES = Object.freeze({
  stopped: 'Stopped',
  stuck: 'Stuck',
  quota_low: 'Quota low',
  burning_fast: 'Burning tokens fast',
});

export const WINDOW_LABELS = Object.freeze({ five_hour: '5-hour window', weekly: 'week' });

// What the machine's run row means in this screen's words: null means the run has not ended.
const ENDED = Object.freeze({
  success: 'finished',
  finished: 'finished',
  completed: 'finished',
  failed: 'stopped',
  stopped: 'stopped',
  canceled: 'stopped',
  cancelled: 'stopped',
  tripwire: 'stopped',
});

const ROLE_NAMES = Object.freeze({
  'flow-build': 'Lead',
  'flow-shipping': 'Shipping',
  'flow-retro': 'Retro',
});

const TOOL_NAMES = Object.freeze({
  mastra_workspace_read_file: 'Read a file',
  mastra_workspace_write_file: 'Write a file',
  mastra_workspace_edit_file: 'Edit a file',
  mastra_workspace_execute_command: 'Run a command',
  mastra_workspace_grep: 'Search the files',
  mastra_workspace_list_files: 'List the files',
  mastra_workspace_ast_edit: 'Edit the code',
  skill: 'Read a skill',
  task_write: 'Write the task list',
  task_update: 'Update a task',
  task_complete: 'Finish a task',
  task_check: 'Check the task list',
});

const number = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const moment = event => number(event?.at);
const tokensIn = event => number(event.inputTokens) + number(event.outputTokens) + number(event.cachedInputTokens);
const tokensOut = event => number(event.outputTokens);

export function helperName(agent) {
  const id = String(agent ?? '');
  if (ROLE_NAMES[id]) return ROLE_NAMES[id];
  const role = /^pstack-(.+?)(?:-(\d+))?$/.exec(id);
  const words = (role?.[1] ?? id).split(/[-_\s]+/).filter(Boolean);
  const title = words.map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
  return role?.[2] ? `${title} ${role[2]}` : title || 'Helper';
}

export function toolName(name) {
  const id = String(name ?? '');
  if (TOOL_NAMES[id]) return TOOL_NAMES[id];
  const words = id.replaceAll(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'An action';
}

// One JSON object per line, written while the run works. A line the writer had not finished, or
// one a crash left half-written, is skipped rather than failing the screen. A repeated id is the
// same event written twice, so the first one stands.
export function readLiveEvents(text) {
  const events = [];
  const seen = new Set();
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  return events;
}

// A stage is not started, running, done or failed; a failed stage stays failed even if a later
// line claims otherwise, because that is what happened. A stage that waits stays waiting until
// the machine resumes it, which starts it again.
function nextStageStatus(current, next) {
  if (current === 'failed') return 'failed';
  if (next === 'failed' || next === 'done') return next;
  if (next === 'started') return 'started';
  if (next === 'waiting') return current === 'done' ? current : 'waiting';
  return current ?? 'started';
}

function foldStages(events) {
  const order = [];
  const byId = new Map();
  for (const event of events) {
    if (liveType(event) !== 'stage' || !event.stage) continue;
    let row = byId.get(event.stage);
    if (!row) {
      row = { id: event.stage, label: stageLabel(event.stage), status: 'started' };
      byId.set(event.stage, row);
      order.push(row);
    }
    row.status = nextStageStatus(row.status, event.status);
  }
  return order;
}

function foldHelpers(events, { settings, now }) {
  const helpers = new Map();
  const helper = (agent, when) => {
    let row = helpers.get(agent);
    if (!row) {
      row = { id: agent, name: helperName(agent), status: 'working', actions: [], tasks: [], tokens: 0, lastActivityAt: when };
      helpers.set(agent, row);
    }
    row.lastActivityAt = Math.max(row.lastActivityAt ?? 0, when);
    return row;
  };
  const calls = new Map();

  for (const event of events) {
    if (!event.agent) continue;
    const row = helper(event.agent, moment(event));
    if (liveType(event) === 'agent') {
      if (event.status === 'done') row.status = 'done';
      else if (event.status === 'failed') row.status = 'failed';
      else if (event.status === 'started') row.status = 'working';
    }
    if (liveType(event) === 'model') row.tokens += tokensIn(event);
    if (liveType(event) === 'tasks' && Array.isArray(event.tasks)) {
      row.tasks = event.tasks.map(task => ({
        id: String(task?.id ?? ''),
        title: String(task?.title ?? ''),
        status: ['pending', 'in_progress', 'completed'].includes(task?.status) ? task.status : 'pending',
      }));
    }
    if (liveType(event) === 'tool') {
      const key = `${event.agent}\u0000${event.callId ?? event.id}`;
      const action = calls.get(key) ?? { id: String(event.callId ?? event.id), name: toolName(event.name), status: 'started', at: moment(event) };
      action.at = Math.min(action.at, moment(event));
      action.status = event.status === 'done' || event.status === 'failed' ? event.status : action.status;
      calls.set(key, action);
    }
  }

  for (const [key, action] of calls) {
    const agent = key.slice(0, key.indexOf('\u0000'));
    helpers.get(agent)?.actions.push(action);
  }

  const list = [...helpers.values()];
  for (const row of list) {
    row.actions.sort((a, b) => b.at - a.at);
    if (row.status === 'working' && now - row.lastActivityAt > settings.stuckAfterMs) row.status = 'stuck';
  }
  return list;
}

// The machine appends its own note to a step it was told to skip, as `skip: <reason>`. The note
// is a caption for the operator, not part of the step's name.
const SKIP_NOTE = /\s*skip:\s*/i;
const STEP_PILL_CHARS = 42;

const STEP_STATUS = Object.freeze({ pending: 'pending', in_progress: 'in_progress', completed: 'completed' });

const stepText = title => String(title ?? '').split(SKIP_NOTE)[0].trim();

// A pill holds the first sentence of the step, cut at a word boundary when that is still long.
function pillText(text) {
  const sentence = text.split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
  if (sentence.length <= STEP_PILL_CHARS) return sentence;
  const head = sentence.slice(0, STEP_PILL_CHARS);
  return `${head.slice(0, head.lastIndexOf(' ')).trim()}…`;
}

// The machine numbers its steps in the id (`playbook_7`), so that suffix is the run's order.
const stepOrder = id => {
  const match = /(\d+)$/.exec(String(id ?? ''));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

/**
 * The run's steps: the Lead's own task list, in the order the machine numbered them, with the
 * step the run is on. This is the only place a step becomes a number, a word or a pill, so the
 * step's name and the "step N of M" count can never disagree.
 */
export function runSteps(helpers) {
  const lead = helpers.find(row => row.id === 'flow-build' && row.tasks.length > 0) ?? helpers.find(row => row.tasks.length > 0);
  const ordered = (lead?.tasks ?? [])
    .map((task, position) => ({ task, position }))
    .sort((a, b) => stepOrder(a.task.id) - stepOrder(b.task.id) || a.position - b.position);
  const list = ordered.map(({ task }) => {
    const title = stepText(task.title);
    const skipped = SKIP_NOTE.test(String(task.title ?? '')) && task.status !== 'completed';
    return {
      id: String(task.id ?? ''),
      title,
      short: pillText(title),
      status: skipped ? 'skipped' : STEP_STATUS[task.status] ?? 'pending',
    };
  });
  const running = list.findIndex(step => step.status === 'in_progress');
  const passed = list.filter(step => step.status === 'completed' || step.status === 'skipped').length;
  // With nothing in hand, the run is on the next step it has not passed, so a fresh run reads
  // "step 1 of 8" and a finished one reads its last step rather than none.
  const index = list.length === 0 ? null : running >= 0 ? running + 1 : Math.min(list.length, passed + 1);
  return { list, index, total: list.length, current: running >= 0 ? list[running] : null };
}


function foldSubscriptions(subscriptions, settings) {
  return (subscriptions ?? []).map(subscription => {
    const base = { id: String(subscription.id ?? ''), name: String(subscription.name ?? subscription.id ?? 'Subscription'), status: subscription.status === 'fresh' ? 'fresh' : 'unknown', readAt: number(subscription.readAt) || null };
    // An unknown reading says why, in one of the four short reasons. Anything else a caller
    // offers (an error message, a status code) becomes "reading failed", so no provider text
    // can reach the browser through this field.
    if (base.status === 'unknown') return { ...base, reason: readingReason(subscription.reason) };
    return {
      ...base,
      windows: (subscription.windows ?? []).map(window => ({
        window: window.window === 'weekly' ? 'weekly' : 'five_hour',
        percentLeft: Math.round(number(window.percentLeft)),
        resetsAt: Number.isFinite(Number(window.resetsAt)) ? Number(window.resetsAt) : null,
        low: number(window.percentLeft) <= settings.quotaLowPercent,
      })),
    };
  });
}

function deriveWarnings({ state, stages, helpers, subscriptions, modelEvents, idleMs, settings }) {
  const warnings = [];
  const failedStage = stages.find(stage => stage.status === 'failed');
  if (state === 'stopped') {
    warnings.push({
      kind: 'stopped',
      title: WARNING_TITLES.stopped,
      text: failedStage ? `The run stopped at “${failedStage.label}”.` : 'The run stopped before it finished.',
    });
  }
  if (state === 'stuck') {
    const minutes = Math.max(1, Math.round((idleMs ?? settings.stuckAfterMs) / 60000));
    warnings.push({ kind: 'stuck', title: WARNING_TITLES.stuck, text: `Nothing has happened in the run for ${minutes} minutes.` });
  }
  for (const subscription of subscriptions) {
    if (subscription.status !== 'fresh') continue;
    for (const window of subscription.windows) {
      if (!window.low) continue;
      warnings.push({
        kind: 'quota_low',
        title: WARNING_TITLES.quota_low,
        subscription: subscription.name,
        text: `${subscription.name}: ${window.percentLeft}% of this ${WINDOW_LABELS[window.window]} left.`,
      });
    }
  }
  for (const event of modelEvents) {
    const used = tokensIn(event);
    if (used <= settings.burningFastTokens) continue;
    const name = helperName(event.agent);
    warnings.push({ kind: 'burning_fast', title: WARNING_TITLES.burning_fast, agent: name, text: `${name} used ${used.toLocaleString('en-GB')} tokens in one model call.` });
  }
  return warnings;
}

// The log's own verdict on whether the run has ended, used when the machine has no row to ask:
// the last stage it reached either failed or was the last one the machine has.
function endedFromLog(stages) {
  const last = stages.at(-1);
  if (!last) return null;
  if (last.status === 'failed') return 'stopped';
  if (last.id === 'hold' && last.status === 'done') return 'finished';
  return null;
}

export function runState({ ended = null, currentStage = null, idleMs = null, settings }) {
  if (ended) return ended;
  // A stage that is waiting is waiting on Todd, whatever the stage is; nothing is wrong.
  if (currentStage?.status === 'waiting') return 'waiting_for_you';
  if (idleMs !== null && settings && idleMs > settings.stuckAfterMs) return 'stuck';
  return 'running';
}

/**
 * Fold the run's event log and its stored run row into one snapshot for the screen.
 * `runStatus` is the machine's own row: { status, createdAt, updatedAt } or null when nothing ran.
 */
export function foldRunView({ events = [], runStatus = null, subscriptions = [], settings, now = Date.now(), estimateUsd = null }) {
  const stages = foldStages(events);
  const helpers = foldHelpers(events, { settings, now });
  const modelEvents = events.filter(event => liveType(event) === 'model');
  const started = events.find(event => liveType(event) === 'run');
  const createdAt = number(runStatus?.createdAt) || moment(started) || null;
  // The stored row decides when it has an answer; the log speaks for itself when it does not.
  const ended = ENDED[String(runStatus?.status ?? '').toLowerCase()] ?? (runStatus ? null : endedFromLog(stages));
  const lastActivityAt = events.reduce((last, event) => Math.max(last, moment(event)), createdAt ?? 0) || null;
  const idleMs = lastActivityAt === null ? null : Math.max(0, now - lastActivityAt);
  const currentStage = stages.at(-1) ?? null;
  const state = runState({ ended, currentStage, idleMs, settings });
  const foldedSubscriptions = foldSubscriptions(subscriptions, settings);
  const tokens = modelEvents.reduce((total, event) => total + tokensIn(event), 0);
  // Dollars only add up the calls whose model has a published price. When none does, the screen
  // says it has no price rather than a confident zero.
  const prices = estimateUsd
    ? modelEvents.map(event => estimateUsd({ provider: event.provider, model: event.model, inputTokens: number(event.inputTokens), outputTokens: tokensOut(event), cachedInputTokens: number(event.cachedInputTokens) })).filter(price => Number.isFinite(price))
    : [];
  const dollars = prices.length ? prices.reduce((total, price) => total + price, 0) : null;
  const card = started?.card ?? null;
  const steps = runSteps(helpers);

  // A run exists because its own log says so. The stored row only says how it ended, so an
  // old row with no log is a result to report, never a run to draw.
  const run = started
    ? {
      card,
      title: String(started.title || card || 'A card'),
      status: state,
      startedAt: createdAt,
      runningMs: createdAt === null ? null : Math.max(0, (ended ? (lastActivityAt ?? now) : now) - createdAt),
      stage: currentStage,
      // The step's name and the count come from the same lookup, so they cannot disagree.
      step: steps.current?.title ?? null,
      steps,
      stages,
      usage: { tokens, dollarsEstimate: dollars === null ? null : Number(dollars.toFixed(4)) },
      helpers,
    }
    : null;

  return {
    observedAt: now,
    run,
    lastResult: run || !runStatus ? null : { status: ENDED[String(runStatus.status).toLowerCase()] ?? String(runStatus.status), at: number(runStatus.updatedAt) || null },
    subscriptions: foldedSubscriptions,
    warnings: deriveWarnings({ state: run ? state : null, stages, helpers, subscriptions: foldedSubscriptions, modelEvents, idleMs, settings }),
  };
}
