import { WINDOW, readingWindow } from './windows.mjs';

// GET https://chatgpt.com/backend-api/wham/usage
// primary_window is the 5-hour window, secondary_window the weekly one. used_percent is
// already 0-100, and reset_at is unix seconds.
export function parseWindows(body) {
  const rate = body?.rate_limit;
  if (!rate) return null;
  const windows = [
    windowOf(WINDOW.fiveHour, rate.primary_window),
    windowOf(WINDOW.weekly, rate.secondary_window),
  ];
  return windows.every(Boolean) ? windows : null;
}

function windowOf(window, raw) {
  if (!raw || typeof raw.used_percent !== 'number') return null;
  const resetsAt = typeof raw.reset_at === 'number' ? raw.reset_at * 1000 : null;
  return readingWindow(window, 100 - raw.used_percent, resetsAt);
}
