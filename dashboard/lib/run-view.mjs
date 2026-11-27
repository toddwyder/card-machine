// The Run view's model: the session Start opened in, one RunViewSnapshot out.
// Everything here is pure. No file reads, no clock, no network, so a test can pin every state
// and every warning without a browser or a run.
//
// The stage is the name of the playbook the session follows, and the steps are that playbook's
// steps from the session's own to-do list. pstack names every to-do id `<playbook>-<number>`,
// which is the one signal both are read from.

import { readingReason } from './reading-reasons.mjs';

// A run is in one of these at a time. The table is the only place a state becomes a word or a
// warning, so nothing downstream re-decides what "stuck" means.
export const RUN_STATES = Object.freeze({
  running: 'Running',
  waiting_for_you: 'Waiting for you',
  stuck: 'Stuck',
  stopped: 'Stopped',
  finished: 'Finished',
  ended_unknown: 'Ended, result unknown',
});

export const WARNING_TITLES = Object.freeze({
  stopped: 'Stopped',
  stuck: 'Stuck',
  ended_unknown: 'Ended without a result',
  quota_low: 'Quota low',
  burning_fast: 'Burning tokens fast',
});

export const WINDOW_LABELS = Object.freeze({ five_hour: '5-hour window', weekly: 'week' });

// A playbook's kebab-case name as a person reads it. The short words keep their own shape,
// because "Opens a PR" is not how anyone writes it.
const PLAYBOOK_NAMES = Object.freeze({
  'bug-fix': 'Bug fix',
  'figure-it-out': 'Figure it out',
  'opening-a-pr': 'Opening a PR',
  'perf-issue': 'Perf issue',
  'visual-parity': 'Visual parity',
  'worktree-cleanup': 'Worktree cleanup',
  'multi-phase-plan': 'Multi-phase plan',
  'autonomous-run': 'Autonomous run',
  'autopilot-full': 'Autopilot-full',
  'autopilot-stack': 'Autopilot-stack',
  'session-pickup': 'Session pickup',
  'pause-safely': 'Pause safely',
  'runtime-forensics': 'Runtime forensics',
  'trace-forensics': 'Trace forensics',
  'authoring-a-skill': 'Authoring a skill',
});

export function playbookName(playbook) {
  const id = String(playbook ?? '');
  if (!id) return '';
  if (PLAYBOOK_NAMES[id]) return PLAYBOOK_NAMES[id];
  return id.split('-').filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

const number = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

const STEP_PILL_CHARS = 42;

const STEP_STATUS = Object.freeze({ pending: 'pending', in_progress: 'in_progress', completed: 'completed' });

// pstack's to-do ids carry the playbook name and the step number (`feature-3`).
const STEP_ID = /^(.+)-(\d+)$/;

// A pill holds the first sentence of the step, cut at a word boundary when that is still long.
function pillText(text) {
  const sentence = text.split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
  if (sentence.length <= STEP_PILL_CHARS) return sentence;
  const head = sentence.slice(0, STEP_PILL_CHARS);
  return `${head.slice(0, head.lastIndexOf(' ')).trim()}…`;
}

/**
 * The run's steps: the session's own to-do list in playbook order, with the step the run is on
 * and the playbook that step belongs to. This is the only place a step becomes a number, a word
 * or a pill, so the stage's name, the step's name and "step N of M" can never disagree.
 */
export function runSteps(tasks) {
  const ordered = (tasks ?? [])
    .map((task, position) => ({ task, position, match: STEP_ID.exec(String(task?.id ?? '')) }))
    .filter(row => row.match)
    .sort((a, b) => Number(a.match[2]) - Number(b.match[2]) || a.position - b.position);
  const list = ordered.map(({ task, match }) => {
    const title = String(task.content ?? '').trim();
    return {
      id: String(task.id ?? ''),
      title,
      short: pillText(title),
      status: STEP_STATUS[task.status] ?? 'pending',
      playbook: match[1],
      order: Number(match[2]),
    };
  });
  const running = list.findIndex(step => step.status === 'in_progress');
  const passed = list.filter(step => step.status === 'completed').length;
  // With nothing in hand, the run is on the next step it has not passed, so a fresh run reads
  // "step 1 of 8" and a finished one reads its last step rather than none.
  const index = list.length === 0 ? null : running >= 0 ? running + 1 : Math.min(list.length, passed + 1);
  const current = running >= 0 ? list[running] : list[index - 1] ?? null;
  // The stage is the playbook of the step the run is on, so it changes when the session moves on
  // to another playbook's steps.
  const stage = current ? playbookName(current.playbook) : '';
  return { list, index, total: list.length, current, stage };
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

function deriveWarnings({ state, steps, largestStepTokens, idleMs, subscriptions, settings }) {
  const warnings = [];
  if (state === 'stopped') {
    warnings.push({
      kind: 'stopped',
      title: WARNING_TITLES.stopped,
      text: steps.current ? `The run stopped at “${steps.current.short}”.` : 'The run stopped before it finished.',
    });
  }
  if (state === 'ended_unknown') {
    warnings.push({
      kind: 'ended_unknown',
      title: WARNING_TITLES.ended_unknown,
      text: 'The run ended without saying whether it finished or stopped.',
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
  if (largestStepTokens > settings.burningFastTokens) {
    warnings.push({
      kind: 'burning_fast',
      title: WARNING_TITLES.burning_fast,
      text: `One model call used ${largestStepTokens.toLocaleString('en-GB')} tokens.`,
    });
  }
  return warnings;
}

export function runState({ status = 'running', idleMs = null, settings }) {
  if (status === 'finished') return 'finished';
  if (status === 'stopped') return 'stopped';
  if (status === 'unknown') return 'ended_unknown';
  if (idleMs !== null && settings && idleMs > settings.stuckAfterMs) return 'stuck';
  return 'running';
}

/**
 * Fold the session Start opened and the subscriptions' readings into one snapshot for the screen.
 * `session` is null when no card has been started, and the record of the last run otherwise.
 * Its `status` is 'running' while the run is live, then 'finished', 'stopped' or 'unknown'.
 */
export function foldRunView({ session = null, subscriptions = [], settings, now = Date.now() }) {
  const foldedSubscriptions = foldSubscriptions(subscriptions, settings);
  if (!session) {
    return { observedAt: now, run: null, lastResult: null, subscriptions: foldedSubscriptions, warnings: deriveWarnings({ state: null, steps: { current: null }, largestStepTokens: 0, idleMs: null, subscriptions: foldedSubscriptions, settings }) };
  }

  const startedAt = number(session.startedAt) || null;
  // The session's own last activity is when it last did something; the start is the fallback for
  // a record written before the first step.
  const lastActivityAt = Number.isFinite(Number(session.lastActivityAt)) && session.lastActivityAt !== null
    ? number(session.lastActivityAt)
    : startedAt;
  const idleMs = lastActivityAt === null ? null : Math.max(0, now - lastActivityAt);
  const steps = runSteps(session.tasks);
  const live = !session.endedAt && session.status === 'running';
  const state = runState({ status: live ? 'running' : session.status, idleMs, settings });
  const largestStepTokens = number(session.largestStepTokens);
  const warnings = deriveWarnings({ state, steps, largestStepTokens, idleMs, subscriptions: foldedSubscriptions, settings });
  const endedAt = number(session.endedAt) || null;

  if (!live) {
    return {
      observedAt: now,
      run: null,
      lastResult: { status: state, at: endedAt },
      subscriptions: foldedSubscriptions,
      warnings,
    };
  }

  return {
    observedAt: now,
    run: {
      card: session.card,
      title: String(session.title || session.card || 'A card'),
      status: state,
      ended: null,
      startedAt,
      runningMs: startedAt === null ? null : Math.max(0, now - startedAt),
      stage: steps.stage,
      // The step's name and the count come from the same lookup, so they cannot disagree.
      step: steps.current ? steps.current.short : null,
      steps,
      usage: { tokens: number(session.tokens), dollarsEstimate: null },
    },
    lastResult: null,
    subscriptions: foldedSubscriptions,
    warnings,
  };
}
