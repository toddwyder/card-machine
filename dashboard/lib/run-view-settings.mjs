// The three warning limits, read from the one file that holds them: dashboard/settings/run-view.json.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The screen is started from the dashboard folder and the tests are started from the repository
// root, so the settings file is looked for from either place rather than from the module's own
// address, which a bundled server does not keep.
const CANDIDATES = ['settings/run-view.json', join('dashboard', 'settings', 'run-view.json')];

const LIMITS = {
  stuckAfterMs: ms => Number.isFinite(ms) && ms > 0,
  quotaLowPercent: percent => Number.isFinite(percent) && percent >= 0 && percent <= 100,
  burningFastTokensPerMinute: tokens => Number.isFinite(tokens) && tokens > 0,
};

function defaultFile() {
  for (const candidate of CANDIDATES) {
    const full = join(process.cwd(), candidate);
    if (existsSync(full)) return full;
  }
  throw new Error('dashboard/settings/run-view.json is missing');
}

export function readRunViewSettings(file = defaultFile()) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  for (const [name, ok] of Object.entries(LIMITS)) {
    if (!ok(Number(raw?.[name]))) throw new Error(`dashboard/settings/run-view.json needs a number for ${name}`);
  }
  return Object.freeze({
    stuckAfterMs: Number(raw.stuckAfterMs),
    quotaLowPercent: Number(raw.quotaLowPercent),
    burningFastTokensPerMinute: Number(raw.burningFastTokensPerMinute),
  });
}
