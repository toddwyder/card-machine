// The Run view's model: the session Start opened in, one RunViewSnapshot out.
// Everything here is pure except reading the playbooks once at import. No clock, no network, so a
// test can pin every state and every warning without a browser or a run.
//
// The stage is the playbook the session is following, and the steps are the session's own to-do
// list. The stage is read from the words of the items: pstack writes the steps in its own words,
// so the id it gives them says nothing reliable. Each item votes for the playbook whose step it
// matches best; the step in hand decides, and failing that the last step written, which is how a
// session's list reads when it appends the next playbook instead of rewriting.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Playbooks live in the skill, one file each, and are read once when this module loads. A stage
// word and a step's words must be compared the same way every time, so the reading is a constant.
// The folder is joined by hand rather than written as `new URL(..., import.meta.url)`: the build
// reads that form as an asset to bundle, and a folder of markdown is not one.
export const PLAYBOOKS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.agents', 'skills', 'poteto-mode', 'playbooks');

// Words that carry no meaning on their own. Dropping them lets an item written as "Plan the
// slices" meet a playbook step that says "Plan the slices before building".
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those',
  'as', 'if', 'then', 'than', 'so', 'but', 'not', 'no', 'do', 'does', 'did', 'can', 'will', 'must',
  'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she', 'his', 'her', 'them', 'us', 'me', 'my',
  'each', 'every', 'any', 'all', 'own', 'use', 'uses', 'via', 'per',
]);

const words = text => new Set(
  String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1 && !STOP_WORDS.has(word)),
);

const HEADING = /^#{1,6}\s/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NOT_A_STEP = /^\*\*Reply:\*\*/;

// A markdown line with its emphasis and code marks taken out, so matching compares words.
const plain = line => line.replace(/[`*_]/g, '').trim();

const firstSentence = text => String(text ?? '').split(/(?<=[.!?])\s/)[0];

/**
 * The steps of one playbook file, as a person reads them: its numbered list if it has one, else
 * its top-level bullets, else the sentences of its prose. Continuation lines belong to the step
 * above them, because a step's detail follows its first line.
 */
export function playbookSteps(text) {
  const raw = String(text ?? '').split('\n');
  const numbered = [];
  const bullets = [];
  const paragraphs = [];
  let paragraph = [];

  for (const line of raw) {
    if (HEADING.test(line) || NOT_A_STEP.test(line.trim())) continue;
    if (!line.trim()) {
      if (paragraph.length) paragraphs.push(paragraph);
      paragraph = [];
      continue;
    }
    const numberedMatch = NUMBERED.exec(line);
    if (numberedMatch) {
      numbered.push([plain(numberedMatch[1])]);
      continue;
    }
    const bulletMatch = BULLET.exec(line);
    if (bulletMatch) {
      bullets.push([plain(bulletMatch[1])]);
      continue;
    }
    // An indented line is detail for the step above it; a flush-left line is prose.
    if ((numbered.length || bullets.length) && /^\s+\S/.test(line)) {
      const holder = numbered.length ? numbered : bullets;
      holder.at(-1)?.push(plain(line));
      continue;
    }
    paragraph.push(line);
  }
  if (paragraph.length) paragraphs.push(paragraph);

  const joinSteps = list => list.map(parts => parts.join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (numbered.length) return joinSteps(numbered);
  if (bullets.length) return joinSteps(bullets);
  return paragraphs
    .flatMap(block => block.join(' ').split(/(?<=[.!?])\s+/))
    .map(plain)
    .filter(sentence => sentence.split(/\s+/).filter(Boolean).length >= 2);
}

export function readPlaybooks(dir = PLAYBOOKS_DIR) {
  return readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .map(name => name.slice(0, -3))
    .sort()
    .map(id => ({
      id,
      steps: playbookSteps(readFileSync(join(dir, `${id}.md`), 'utf8')).map((text, index) => ({
        text,
        index,
        // A step's name is its first sentence. The detail after it is advice about the step, and
        // a to-do item that names the step must still match it.
        nameWords: words(firstSentence(text)),
        words: words(text),
      })),
    }));
}

const PLAYBOOKS = readPlaybooks();

// A match scores on both readings at once: how much of the step's name the item carries, plus how
// much of the item the step carries. An item that is a step's whole name scores 2; an item with a
// session's own detail after it scores around 1. Half of one reading alone does not make a match.
const MATCH_SCORE = 1;
const MATCH_WORDS = 2;
const EPSILON = 1e-9;

const sharedWords = (a, b) => {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared;
};

// A word in a to-do item that only one playbook writes says which playbook the item is about.
function wordOwners(playbooks) {
  const owners = new Map();
  for (const playbook of playbooks) {
    for (const step of playbook.steps) {
      for (const word of step.words) {
        const set = owners.get(word) ?? new Set();
        set.add(playbook.id);
        owners.set(word, set);
      }
    }
  }
  return owners;
}

/**
 * The playbooks whose step this item is about, best first. Two readings of the same pair of texts
 * are both allowed to win, because a to-do item is written either as the step's name or as that
 * name plus the session's own detail:
 *  - the item as a whole sitting inside one step ("Delegate the slice to a subagent" in a step
 *    that says the same and then keeps going), and
 *  - a step's name, its first sentence, sitting whole inside the item ("Verify on the matching
 *    surface: a real run showing…").
 * A step that several playbooks carry ("Run Opening a PR") gives its vote to each of them, so it
 * can never take a vote away from the playbook the rest of the list points at.
 */
function bestSteps(itemWords, playbooks) {
  const matches = [];
  let bestScore = 0;
  for (const playbook of playbooks) {
    let best = null;
    for (const step of playbook.steps) {
      const inName = sharedWords(itemWords, step.nameWords);
      const inWhole = sharedWords(itemWords, step.words);
      if (inWhole < MATCH_WORDS) continue;
      const score = inName / step.nameWords.size + inWhole / itemWords.size;
      if (!best || score > best.score) best = { step, score };
    }
    if (!best) continue;
    matches.push({ playbook: playbook.id, score: best.score });
    bestScore = Math.max(bestScore, best.score);
  }
  return matches.filter(match => match.score >= MATCH_SCORE && match.score >= bestScore - EPSILON);
}

// A one-word item ("Do it less.") is matched only by a word no other playbook writes.
function thinMatches(itemWords, playbooks, owners) {
  const word = [...itemWords][0];
  if (!word || owners.get(word)?.size !== 1) return [];
  return [{ playbook: [...owners.get(word)][0], score: 1 }];
}

// A pill holds the first sentence of the step, cut at a word boundary when that is still long.
function pillText(text) {
  const sentence = text.split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
  if (sentence.length <= STEP_PILL_CHARS) return sentence;
  const head = sentence.slice(0, STEP_PILL_CHARS);
  return `${head.slice(0, head.lastIndexOf(' ')).trim()}…`;
}

/**
 * The run's steps: the current playbook's steps from the session's own to-do list, in playbook
 * order, with the step the run is on. This is the only place a step becomes a number, a word or
 * a pill, so the stage's name, the step's name and "step N of M" can never disagree.
 *
 * Each to-do item votes for the playbook whose step it matches best; the winner is the stage. The
 * list is the winning playbook's items in the winning playbook's order, so an item the session
 * appended (rather than replaced) cannot drag its old playbook's steps back onto the screen.
 */
export function runSteps(tasks, playbooks = PLAYBOOKS) {
  const owners = wordOwners(playbooks);
  const items = (tasks ?? []).map((task, position) => {
    const title = String(task.content ?? '').trim();
    return {
      position,
      title,
      status: STEP_STATUS[task.status] ?? 'pending',
      itemWords: words(title),
    };
  }).filter(item => item.title && item.itemWords.size > 0);

  const votes = new Map();
  for (const item of items) {
    const matches = item.itemWords.size < MATCH_WORDS
      ? thinMatches(item.itemWords, playbooks, owners)
      : bestSteps(item.itemWords, playbooks);
    if (matches.length === 0) continue;
    item.playbooks = new Set(matches.map(match => match.playbook));
    for (const match of matches) {
      const vote = votes.get(match.playbook) ?? { playbook: match.playbook, count: 0, lastPosition: -1 };
      vote.count += 1;
      vote.lastPosition = Math.max(vote.lastPosition, item.position);
      votes.set(match.playbook, vote);
    }
  }

  const mostVotes = (a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    if (a.lastPosition !== b.lastPosition) return b.lastPosition - a.lastPosition;
    return a.playbook.localeCompare(b.playbook);
  };
  // The step in hand says which playbook the run is in. With nothing in hand, the last step the
  // session wrote does, because a session appends the next playbook to its list rather than
  // rewriting it. Only when neither is written does the count of votes decide.
  const inHand = items.findLast(item => item.status === 'in_progress' && item.playbooks?.size);
  const written = items.findLast(item => item.playbooks?.size);
  const focus = inHand ?? written;
  const winner = focus
    ? [...focus.playbooks].map(id => votes.get(id)).toSorted(mostVotes)[0]
    : [...votes.values()].toSorted(mostVotes)[0];

  // The list is the session's own order, which is the order it wrote the steps in. A step it wrote
  // in words no playbook uses still belongs to the run, so it stays; a step that points at another
  // playbook is one it has moved on from, so it goes.
  const list = winner
    ? items.filter(item => !item.playbooks || item.playbooks.has(winner.playbook)).map(item => ({
      id: String(tasks[item.position]?.id ?? ''),
      title: item.title,
      short: pillText(item.title),
      status: item.status,
      playbook: winner.playbook,
    }))
    : [];
  const runningIndex = list.findIndex(step => step.status === 'in_progress');
  const passed = list.filter(step => step.status === 'completed').length;
  // With nothing in hand, the run is on the next step it has not passed, so a fresh run reads
  // "step 1 of 8" and a finished one reads its last step rather than none.
  const index = list.length === 0 ? null : runningIndex >= 0 ? runningIndex + 1 : Math.min(list.length, passed + 1);
  const current = list[index - 1] ?? null;
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

// The warning measures what the whole run spends, not one call: a run's cost is the sum of many
// calls, and one large call on a long run is not the thing to catch.
function tokensPerMinute(tokens, runMs) {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  const minutes = Math.max(1, (Number.isFinite(runMs) ? runMs : 0) / 60000);
  return Math.round(tokens / minutes);
}

function deriveWarnings({ state, steps, tokens = 0, runMs = 0, idleMs, subscriptions, settings }) {
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
  const burning = tokensPerMinute(tokens, runMs);
  if (burning > settings.burningFastTokensPerMinute) {
    warnings.push({
      kind: 'burning_fast',
      title: WARNING_TITLES.burning_fast,
      text: `The run is using ${burning.toLocaleString('en-GB')} tokens a minute.`,
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
    return { observedAt: now, run: null, lastResult: null, subscriptions: foldedSubscriptions, warnings: deriveWarnings({ state: null, steps: { current: null }, tokens: 0, runMs: 0, idleMs: null, subscriptions: foldedSubscriptions, settings }) };
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
  // The rate covers the run's whole life so far, which is what the screen's token count shows.
  const tokens = number(session.tokens);
  const runMs = startedAt === null ? 0 : Math.max(0, now - startedAt);
  const warnings = deriveWarnings({ state, steps, tokens, runMs, idleMs, subscriptions: foldedSubscriptions, settings });
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
