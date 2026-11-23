// The one place server-side reads happen for the Run view: the run's event log, the run's own
// row from the machine's state, and the subscriptions' readings. Everything it hands back is the
// snapshot the screen draws, so the page and the route can never show different things.

import { readFile } from 'node:fs/promises';
import { foldRunView, readLiveEvents } from './run-view.mjs';
import { chosenRunLog, releaseRunLog, stateDbIn } from './run-log.mjs';
import { readRunStatus } from './run-status.mjs';
import { readRunViewSettings } from './run-view-settings.mjs';
import { createUsdEstimator } from './run-estimate.mjs';
import { READING_REASON } from './reading-reasons.mjs';

// The three subscriptions the machine spends against, in the order the screen shows them.
export const SUBSCRIPTIONS = Object.freeze([
  { id: 'claude', name: 'Claude' },
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'commandcode', name: 'CommandCode' },
]);

async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return '';
  }
}

// When no reading can be had at all, every subscription says so in the same short word.
function unknownReadings() {
  const at = Date.now();
  return SUBSCRIPTIONS.map(({ id, name }) => ({ id, name, status: 'unknown', readAt: at, reason: READING_REASON.failed }));
}

// A reading that fails is a reading of "unknown"; the screen never shows a number it did not just
// read. The reader lives behind its own import so this screen works before that module lands.
// A test or a demo can point at a saved reading instead, so every bar state can be proved.
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

// A test pins the instant it reads the screen at, so its pictures come out the same every run.
const PINNED_NOW = Number(process.env.RUN_VIEW_NOW);

/**
 * Read the whole Run view once.
 * @param {{flowDir?: string|null, now?: number, subscriptions?: unknown[], estimateUsd?: Function}} options
 */
export async function readRunViewSnapshot({ flowDir = process.env.FLOW_DIR ?? null, now = PINNED_NOW || Date.now(), subscriptions, estimateUsd } = {}) {
  const settings = readRunViewSettings();
  const logFile = chosenRunLog(flowDir);
  const [events, readings] = await Promise.all([
    logFile ? readText(logFile) : Promise.resolve(''),
    subscriptions ? Promise.resolve(subscriptions) : readReadings(),
  ]);
  const runStatus = flowDir ? readRunStatus(stateDbIn(flowDir)) : null;
  const snapshot = foldRunView({
    events: readLiveEvents(events),
    runStatus,
    subscriptions: readings,
    settings,
    now,
    estimateUsd: estimateUsd ?? createUsdEstimator(),
  });
  // Once the run on screen has ended, the next read is free to pick up a newer card.
  if (snapshot.run?.ended) releaseRunLog(flowDir);
  return snapshot;
}
