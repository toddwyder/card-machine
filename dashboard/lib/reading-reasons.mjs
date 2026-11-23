// Why a subscription reading is unknown. This is the whole set: the screen gives each one a
// caption, and nothing a provider sent (a token, a cookie, a response body) can reach the
// browser through here.
export const READING_REASON = Object.freeze({
  noSignIn: 'no stored sign-in',
  expired: 'sign-in expired',
  failed: 'reading failed',
  timedOut: 'timed out',
});

const KNOWN = new Set(Object.values(READING_REASON));

/** The reading's reason when it is one of the four, and "reading failed" for anything else. */
export function readingReason(value) {
  return KNOWN.has(value) ? value : READING_REASON.failed;
}
