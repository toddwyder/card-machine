import { WINDOW, readingWindow } from './windows.mjs';

// GET https://api.commandcode.ai/alpha/billing/credits
// windowLimits.fiveHour is the 5-hour window, windowLimits.weekly the weekly one. There is
// no percent field: percent comes from used/cap. resetAt is unix milliseconds, where 0 means
// no window has opened yet. windowLimits.limited is ignored: it reads true with no usage.
export function parseWindows(body) {
  const limits = body?.windowLimits;
  if (!limits) return null;
  const windows = [
    windowOf(WINDOW.fiveHour, limits.fiveHour),
    windowOf(WINDOW.weekly, limits.weekly),
  ];
  return windows.every(Boolean) ? windows : null;
}

function windowOf(window, raw) {
  if (!raw || typeof raw.used !== 'number' || typeof raw.cap !== 'number' || raw.cap < 0) return null;
  if (raw.cap === 0) return readingWindow(window, 100, null);
  return readingWindow(window, 100 - (raw.used / raw.cap) * 100, raw.resetAt);
}
