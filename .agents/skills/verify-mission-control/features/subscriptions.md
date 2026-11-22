# Subscriptions

## Sub-features
- Three horizontal quota bars in `section[aria-label="Left in each subscription"]`: CommandCode, ChatGPT, and Claude Code.
- Healthy (`> 20%`): solid bar with percentage left and reset label.
- Low (`<= 20%`): red fill, dashed outline ring around the track (`outline-style: dashed`), alert icon, and matching `Quota low` warning banner.
- Unknown: dashed neutral track, unknown icon, and literal `unknown` text — never `0%`.

## How to get to it (user POV)
Scroll to the `Left in each subscription` card at the bottom of `/`. Each row shows the provider name, a visual bar, and the percentage left + reset window (or `unknown`).

## Driving it with Playwright
1. In Mode A (fixture), assert CommandCode (`62%`), ChatGPT (`14%` with dashed outline), and the third account (`unknown`, never `0%`).
2. In Mode B (live server without `RUN_VIEW_FIXTURE_FILE`), fetch `/api/run-view`, inspect the rendered DOM text of all three rows in Playwright, and compare side-by-side against sanitized raw provider usage fields fetched at the same moment.

## Gotchas
- Never print or save raw auth tokens, API keys, or email addresses in evidence logs.
- When an account's usage endpoint returns an error or has no valid credential on the host, the UI must show `unknown` rather than `0%` and must NOT trigger a false `Quota low` warning.
