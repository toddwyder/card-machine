// A run directory the Run view can be pointed at. Every log here is written by the machine's
// own live writer, so the screen under test reads exactly the file a real run produces.

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLiveFeed, liveFileIn } from '../../machine/flow/live.mjs';
import { writeScene } from '../scripts/live-scenes.mjs';

const here = new URL('.', import.meta.url);
export const FLOW_DIR = new URL('./test-results/flow', here).pathname;
export const LIVE_FILE = liveFileIn(FLOW_DIR, 'JUL-361');
export const SUBSCRIPTIONS_FILE = join(FLOW_DIR, 'subscriptions.json');

const hours = 60 * 60 * 1000;

// What the three subscriptions read: two fresh, one that failed to read, and a set whose
// five-hour window is nearly gone.
const READINGS = {
  normal: now => [
    { id: 'claude', name: 'Claude', status: 'fresh', readAt: now, windows: [
      { window: 'five_hour', percentLeft: 64, resetsAt: now + 3 * hours },
      { window: 'weekly', percentLeft: 88, resetsAt: now + 4 * 24 * hours },
    ] },
    { id: 'chatgpt', name: 'ChatGPT', status: 'fresh', readAt: now, windows: [
      { window: 'five_hour', percentLeft: 51, resetsAt: now + 3 * hours },
      { window: 'weekly', percentLeft: 72, resetsAt: now + 4 * 24 * hours },
    ] },
    { id: 'commandcode', name: 'CommandCode', status: 'unknown', readAt: now, reason: 'the reading failed' },
  ],
  low: now => [
    { id: 'claude', name: 'Claude', status: 'fresh', readAt: now, windows: [
      { window: 'five_hour', percentLeft: 11, resetsAt: now + 2 * hours },
      { window: 'weekly', percentLeft: 98, resetsAt: now + 4 * 24 * hours },
    ] },
    { id: 'chatgpt', name: 'ChatGPT', status: 'fresh', readAt: now, windows: [
      { window: 'five_hour', percentLeft: 64, resetsAt: now + 3 * hours },
      { window: 'weekly', percentLeft: 88, resetsAt: now + 4 * 24 * hours },
    ] },
    { id: 'commandcode', name: 'CommandCode', status: 'unknown', readAt: now, reason: 'the reading failed' },
  ],
};

/** Rebuild the run directory as one scene with one set of readings, and return its path. */
export function prepare({ scene = 'running', readings = 'normal', now = Date.now() } = {}) {
  rmSync(FLOW_DIR, { recursive: true, force: true });
  mkdirSync(FLOW_DIR, { recursive: true });
  writeScene(FLOW_DIR, scene, { now });
  writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(READINGS[readings](now), null, 2));
  return FLOW_DIR;
}

export const buildFixture = (now = Date.now()) => prepare({ now });

/** Append one model call through the machine's own writer, the way a real run's tokens grow. */
export function appendModelCall({ agent = 'pstack-feature-refactoring-1', inputTokens = 240000, outputTokens = 1200 } = {}) {
  const feed = createLiveFeed({ file: LIVE_FILE, append: appendFileSync, logger: { warn() {} } });
  feed.model({ agent, model: 'commandcode/moonshotai/Kimi-K3.1-Pro', spanId: `spec-${Date.now()}`, inputTokens, outputTokens });
}
