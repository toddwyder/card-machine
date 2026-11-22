// The three warning limits, read from the one file that holds them: dashboard/settings/run-view.json.

import { readFileSync } from 'node:fs';

const FILE = new URL('../settings/run-view.json', import.meta.url);

const LIMITS = {
  stuckAfterMs: ms => Number.isFinite(ms) && ms > 0,
  quotaLowPercent: percent => Number.isFinite(percent) && percent >= 0 && percent <= 100,
  burningFastTokens: tokens => Number.isFinite(tokens) && tokens > 0,
};

export function readRunViewSettings(file = FILE) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  for (const [name, ok] of Object.entries(LIMITS)) {
    if (!ok(Number(raw?.[name]))) throw new Error(`dashboard/settings/run-view.json needs a number for ${name}`);
  }
  return Object.freeze({
    stuckAfterMs: Number(raw.stuckAfterMs),
    quotaLowPercent: Number(raw.quotaLowPercent),
    burningFastTokens: Number(raw.burningFastTokens),
  });
}
