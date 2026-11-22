// The machine writes one event log per card inside the run directory, with the run's state
// database beside them. Several cards can share one run directory, so the screen chooses one log
// and keeps choosing it while that run is live: picking the newest on every poll swaps the run
// under Todd the moment another card is appended to.

import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LIVE_FILE } from '../../machine/flow/live.mjs';

function modifiedAt(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** The newest live log under a run directory, or null when the machine has written none. */
export function findRunLog(flowDir) {
  if (!flowDir) return null;
  const candidates = [join(flowDir, LIVE_FILE)];
  try {
    for (const entry of readdirSync(flowDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(flowDir, entry.name, LIVE_FILE));
    }
  } catch {
    // No run directory yet. A log written straight into it is still checked below.
  }
  let newest = null;
  let newestAt = -1;
  for (const file of candidates) {
    const at = modifiedAt(file);
    if (at !== null && at > newestAt) {
      newest = file;
      newestAt = at;
    }
  }
  return newest;
}

// The log each run directory is showing, so a second card's log cannot take the screen mid-run.
const chosen = new Map();

/**
 * The log the screen shows for this run directory: the one already chosen while it is still
 * there, and otherwise the newest. A run that ends, or a log that goes away, is re-picked.
 */
export function chosenRunLog(flowDir) {
  if (!flowDir) return null;
  const held = chosen.get(flowDir);
  if (held && modifiedAt(held) !== null) return held;
  const file = findRunLog(flowDir);
  if (file) chosen.set(flowDir, file);
  else chosen.delete(flowDir);
  return file;
}

/** Let go of this run directory's choice, so the next read picks the newest log again. */
export function releaseRunLog(flowDir) {
  chosen.delete(flowDir);
}

/** Where the run's state database lives, given the directory the logs sit in. */
export const stateDbIn = flowDir => (flowDir ? join(flowDir, 'state.db') : null);
