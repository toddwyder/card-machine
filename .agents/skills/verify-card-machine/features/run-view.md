# Run view

## Sub-features

- Top warning banner for `stuck`, `burning_fast`, `stopped`, `ended_unknown`, and `quota_low`
- Running card panel with card title, current stage (largest text), step rail (`step N of M`), running time, tokens, and labelled dollar estimate
- Helper cards with newest-first actions and state shapes (`working`, `done`, `failed`, `stuck`)
- Subscription quota bars showing percent left, reset date, low-quota ring, or `Reading failed, unknown` with failure reason
- Live updates without refresh when new model calls arrive, plus quiet state when nothing is running
- Responsive stacking on a 390px phone viewport with zero horizontal overflow

## How to get to it (user POV)

Open `/control/` on Mission control (`http://127.0.0.1:4315/control/` in local e2e runs). No sign-in is required.

## Driving it with e2e

- Test file: `tests/run-view.e2e.ts`
- Key landmarks and locators:
  - `screen.getByRole('banner')` containing `Mission control`
  - `screen.getByRole('region', { name: 'The running card' })` (or `'Nothing running'` when idle)
  - `screen.getByRole('heading', { name: 'Subscriptions' })`
  - `[data-kind="<warning>"]` for warning banners
  - `article[data-state]` for helper cards
  - `li[data-subscription="<id>"]` for subscription rows

## Proof

- Every stage/step state (`done`, `in_progress`, `skipped`) and warning (`stuck`, `burning_fast`, `stopped`, `ended_unknown`, `quota_low`) renders with its distinct border style and icon shape on laptop (`1280×720`) and phone (`390×844`) viewports.
- Live token updates appear without page reload after `appendModelCall(...)`.
- Subscription bars match `/control/api/run-view` and failed readings render `Reading failed, unknown` with the failure reason.

## Charters

run-view-shapes|web|skeptic|Verify every Run view step pill, helper card, warning banner, and subscription bar reads clearly on laptop and 390px phone viewports with no overflow or clipped text.

## Gotchas

- Fixture scenes pin `TZ=UTC` and `RUN_VIEW_NOW` in `dashboard/tests/start-server.mjs` so durations and reset dates are deterministic.
- `dashboard/tests/flow-fixture.mjs` writes to `dashboard/tests/test-results/flow/`, so `tests/run-view.e2e.ts` must run with a single worker.
