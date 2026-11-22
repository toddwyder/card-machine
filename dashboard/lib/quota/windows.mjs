// The two windows every subscription reports on. Each one keeps its own percentage and
// its own reset time; a bar never borrows one window's number for the other's date.
export const WINDOW = { fiveHour: 'five_hour', weekly: 'weekly' };

// One window of a reading, or null when the provider's number is not usable. The boundary
// turns each provider's own percent semantics into "percent left" here, so the screen only
// ever receives a 0-100 number and an epoch-millisecond reset time.
export function readingWindow(window, percentLeft, resetsAt) {
  if (typeof percentLeft !== 'number' || !Number.isFinite(percentLeft)) return null;
  const clamped = Math.min(100, Math.max(0, percentLeft));
  return {
    window,
    percentLeft: Math.round(clamped * 10) / 10,
    resetsAt: Number.isFinite(resetsAt) && resetsAt > 0 ? Math.round(resetsAt) : null,
  };
}
