// The machine writes one event log per card inside the run directory, with the run's state
// database beside them. The newest log is the run the screen shows, so finding it is one rule in
// one place.

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

/** Where the run's state database lives, given the directory the logs sit in. */
export const stateDbIn = flowDir => (flowDir ? join(flowDir, 'state.db') : null);
