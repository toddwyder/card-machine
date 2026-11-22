// The one place server-side reads happen for the Run view: the run's event log, the run's own
// row from the machine's state, and the subscriptions' readings. Everything it hands back is the
// snapshot the screen draws, so the page and the route can never show different things.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { foldRunView, readLiveEvents } from './run-view.mjs';
import { readRunStatus } from './run-status.mjs';
import { readRunViewSettings } from './run-view-settings.mjs';
import { createUsdEstimator } from './run-estimate.mjs';

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

function unknownReadings(reason) {
  const at = Date.now();
  return SUBSCRIPTIONS.map(({ id, name }) => ({ id, name, status: 'unknown', readAt: at, reason }));
}

// A reading that fails is a reading of "unknown"; the screen never shows a number it did not just
// read. The reader lives behind its own import so this screen works before that module lands.
async function readReadings() {
  try {
    const quota = await import('./quota/index.mjs');
    const readings = await quota.readSubscriptions();
    return Array.isArray(readings) && readings.length ? readings : unknownReadings('no reading returned');
  } catch (error) {
    return unknownReadings(error?.message ?? 'no reader');
  }
}

/**
 * Read the whole Run view once.
 * @param {{flowDir?: string|null, now?: number, subscriptions?: unknown[], estimateUsd?: Function}} options
 */
export async function readRunViewSnapshot({ flowDir = process.env.FLOW_DIR ?? null, now = Date.now(), subscriptions, estimateUsd } = {}) {
  const settings = readRunViewSettings();
  const [events, readings] = await Promise.all([
    flowDir ? readText(join(flowDir, 'live.jsonl')) : Promise.resolve(''),
    subscriptions ? Promise.resolve(subscriptions) : readReadings(),
  ]);
  const runStatus = flowDir ? readRunStatus(join(flowDir, 'state.db')) : null;
  return foldRunView({
    events: readLiveEvents(events),
    runStatus,
    subscriptions: readings,
    settings,
    now,
    estimateUsd: estimateUsd ?? createUsdEstimator(),
  });
}
