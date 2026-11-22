# Warnings and states

## Sub-features
- Four warning banners in `section[aria-label="Warnings"]`:
  - `stuck`: dashed amber box (`Run looks stuck`) with pause icon.
  - `quota_low`: dashed amber box (`Quota low`) naming the low account.
  - `burning_fast`: dashed amber box (`Burning tokens fast`) naming the helper.
  - `stopped`: solid red box (`Run stopped` or `Run gave up`) with alert icon.
- `waiting_for_you` run state when a workflow step is suspended.
- `idle` state (`No card running right now`) with one-line `Last run:` summary when no run is active.

## How to get to it (user POV)
Warnings appear automatically above the Run panel whenever thresholds are crossed or a run stops. When no card is running, the Run panel switches to the idle panel with the last completed run summary.

## Driving it with Playwright
1. Verify `stuck`, `quota_low`, and `burning_fast` alerts directly on the showcase fixture (`RUN_VIEW_FIXTURE_FILE=.../run-view-showcase.json`).
2. Verify `stopped`, `waiting_for_you`, and `idle` (`lastRun`) using `dashboard/tests/fixtures/run-view-stopped-waiting.json` (both directly as `RUN_VIEW_FIXTURE_FILE` for SSR `idle` capture and via `/api/run-view` polling in `run-view.spec.mjs`).

## Gotchas
- `stuck` and `stopped` are mutually exclusive run statuses in `buildRunViewSnapshot`, so they cannot appear on the same single-run snapshot; both are verified across the two fixtures.
- Client polling runs every 3 seconds, so tests that swap `/api/run-view` responses wait for the updated `[role="alert"]` or `h1` text rather than assuming instant synchronous DOM replacement.
