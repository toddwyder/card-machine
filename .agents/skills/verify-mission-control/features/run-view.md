# Run view

## Sub-features
- Plain-English card title, running time, token count, and dollar amount explicitly marked `estimate`.
- Current stage name rendered as `<h1>` and strictly the largest font-size on the page, paired with `step N of M`.
- Stage board (`ol[aria-label="Stages"]`) and current-stage steps (`ol[aria-label$="steps"]`) showing distinct non-colour encodings (icon shape, border style, text tags, strikethrough) across all 6 step states: `passed`, `passed_with_notes`, `running`, `sent_back` (with round number), `stuck`, and `given_up`.
- Helper cards (`section[aria-label="Helpers"]`) showing status (`Working`, `Stuck`, `Done`) and action lists ordered newest-first.
- Responsive layout with zero horizontal overflow at laptop (`1440x900`) and phone (`390x844`).

## How to get to it (user POV)
Open `http://127.0.0.1:4399/` in the browser. The page server-renders the current snapshot and polls `/api/run-view` every 3 seconds.

## Driving it with Playwright
1. Start the dashboard with `RUN_VIEW_FIXTURE_FILE=$PWD/tests/fixtures/run-view-showcase.json`.
2. Run `BASE_URL=http://127.0.0.1:4399 npx playwright test tests/run-view.spec.mjs`.
3. Confirm `section[aria-label="Current run"] h1` has the largest computed `fontSize` on the page, dollars text matches `/estimate/i`, all 6 step states have distinct SVG icon paths / border styles / tags, helper actions appear newest-first, and `document.documentElement.scrollWidth <= document.documentElement.clientWidth` at both viewports.

## Gotchas
- `run-view-showcase.json` sets `runStatus = stuck` so the `stuck` warning and `stuck` step state render alongside `passed`, `passed_with_notes`, `sent_back`, and `given_up`. The `running` step state is exercised in the same spec via the `running` scenario in `run-view-stopped-waiting.json` through `/api/run-view`.
- Dollar estimates require either priced model spans or an explicit `estimatedDollars` value on the fixture run; otherwise the UI displays `estimate unavailable` (which still contains `estimate`).
