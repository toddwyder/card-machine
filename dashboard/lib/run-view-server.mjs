// The one place server-side reads happen for the Run view: the session Start opened, its own
// to-do list, the subscriptions' readings, and the Ready cards to offer Start on. Everything it
// hands back is the snapshot the screen draws, so the page and the route can never show different
// things.

import { readFile } from 'node:fs/promises';
import { foldRunView } from './run-view.mjs';
import { readRunViewSettings } from './run-view-settings.mjs';
import { readCardSession } from './card-session.mjs';
import { listReady } from './linear.js';
import { READING_REASON } from './reading-reasons.mjs';

// The three subscriptions the machine spends against, in the order the screen shows them.
export const SUBSCRIPTIONS = Object.freeze([
  { id: 'claude', name: 'Claude' },
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'commandcode', name: 'CommandCode' },
]);

// When no reading can be had at all, every subscription says so in the same short word.
function unknownReadings() {
  const at = Date.now();
  return SUBSCRIPTIONS.map(({ id, name }) => ({ id, name, status: 'unknown', readAt: at, reason: READING_REASON.failed }));
}

// A reading that fails is a reading of "unknown"; the screen never shows a number it did not just
// read. A test or a demo can point at a saved reading instead, so every bar state can be proved.
async function readReadings() {
  const saved = process.env.RUN_VIEW_SUBSCRIPTIONS_FILE;
  if (saved) {
    try {
      const readings = JSON.parse(await readFile(saved, 'utf8'));
      if (Array.isArray(readings) && readings.length) return readings;
    } catch (error) {
      return unknownReadings();
    }
    return unknownReadings();
  }
  try {
    const quota = await import('./quota/index.mjs');
    const readings = await quota.readSubscriptions();
    return Array.isArray(readings) && readings.length ? readings : unknownReadings();
  } catch (error) {
    return unknownReadings();
  }
}

// The cards Start can begin. A list that cannot be read is not a crash and not an empty list:
// the screen says it could not read the cards, so Todd never mistakes a blind screen for an
// empty queue. A test or a demo can point at a saved list instead, so the idle screen is provable
// without reaching Linear.
async function readReadyCards() {
  const saved = process.env.RUN_VIEW_READY_FILE;
  if (saved) {
    try {
      const cards = JSON.parse(await readFile(saved, 'utf8'));
      if (Array.isArray(cards)) return { cards };
    } catch (error) {
      return { cards: [], error: 'Could not read the Ready cards.' };
    }
    return { cards: [], error: 'Could not read the Ready cards.' };
  }
  try {
    return { cards: await listReady() };
  } catch (error) {
    return { cards: [], error: 'Could not read the Ready cards.' };
  }
}

// A test pins the instant it reads the screen at, so its pictures come out the same every run.
const PINNED_NOW = Number(process.env.RUN_VIEW_NOW);

/**
 * Read the whole Run view once.
 * @param {{now?: number, subscriptions?: unknown[], session?: object|null, readyCards?: object}} options
 */
export async function readRunViewSnapshot({ now = PINNED_NOW || Date.now(), subscriptions, session, readyCards } = {}) {
  const settings = readRunViewSettings();
  const current = session === undefined ? await readCardSession() : session;
  const running = Boolean(current && !current.endedAt && current.status === 'running');
  const [readings, ready] = await Promise.all([
    subscriptions ? Promise.resolve(subscriptions) : readReadings(),
    // A run on screen has no Start, so its list is not read at all.
    running ? Promise.resolve({ cards: [] }) : readyCards ?? readReadyCards(),
  ]);
  return {
    ...foldRunView({ session: current, subscriptions: readings, settings, now }),
    readyCards: ready.error ? ready : { cards: ready.cards },
  };
}
