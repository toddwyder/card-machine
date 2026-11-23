import { WINDOW, readingWindow } from './windows.mjs';

// GET https://api.anthropic.com/api/oauth/usage
// five_hour is the 5-hour window, seven_day the weekly one. utilization is already 0-100,
// and resets_at is an ISO timestamp with an offset.
export function parseWindows(body) {
  if (!body) return null;
  const windows = [
    windowOf(WINDOW.fiveHour, body.five_hour),
    windowOf(WINDOW.weekly, body.seven_day),
  ];
  return windows.every(Boolean) ? windows : null;
}

function windowOf(window, raw) {
  if (!raw || typeof raw.utilization !== 'number') return null;
  const resetsAt = typeof raw.resets_at === 'string' ? Date.parse(raw.resets_at) : null;
  return readingWindow(window, 100 - raw.utilization, resetsAt);
}
