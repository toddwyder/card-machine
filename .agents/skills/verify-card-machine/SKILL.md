---
name: verify-card-machine
description: Launch, check, drive, prove, and bug bash Mission control (dashboard/) in card-machine with e2e. Use before claiming a Mission control or Run view change works, when asked to verify or screenshot /control/, or to bug bash it.
---

# Verify card-machine (Mission control)

Read the [e2e skill](../e2e/SKILL.md) first (`npx e2e guide` prints it). This skill only says what is true of Mission control. The config is `e2e.config.ts` (target `web`, tests `tests/**/*.e2e.ts`).

## Launch

Before running `e2e`, build the dashboard with `npm --prefix dashboard run build`. The target's `app.command` runs `node dashboard/tests/start-server.mjs` with `PORT=4315` (override with `E2E_PORT`), which builds the fixture run into `dashboard/tests/test-results/flow/`, pins `TZ=UTC` and `RUN_VIEW_NOW`, and starts `next start` on `http://127.0.0.1:4315/control/`. The runner waits for that URL and stops the process after the run. No login or external database is required.

## Doctor

```bash
npx e2e list tests/smoke.e2e.ts       # loads the config without starting the app; exit 0
npx e2e run tests/smoke.e2e.ts        # starts Mission control, opens /control/, pins the banner and running-card region; exit 0
```

`list` failing points to `e2e.config.ts` or dependencies. `run` failing with `APP_ALREADY_RUNNING` means a server is already listening on port `4315`. Run Doctor first whenever anything looks off.

## Drive

Live, over an `e2e mcp` server: `open_session`, then `observe`, the verbs, and `locate` before writing any locator (see [e2e mcp](../e2e/references/mcp.md)). Scripted: tests under `tests/`, using `screen` for accessible roles and names and `browser` when asserting CSS properties (such as `borderTopStyle`, `textDecorationLine`, `fontSize`, or `scrollWidth` on 390px phone viewports) or calling `prepare(...)` from `dashboard/tests/flow-fixture.mjs`. Keep `e2e.config.ts` model-free (`--gateway none`); do not add `agent.*` steps that require a model sign-in.

## Evidence

Every run writes `.e2e/report.json`. Passing `--trace on` writes `.e2e/results/<test>/trace.md` for passing tests too, `--video` records each attempt, and `app.screenshot('<name>')` saves a named frame under the run's output directory. The next `e2e run` clears `.e2e/results/` (Doctor included), so a proof that must outlive later runs uses `--output .e2e/proof/<name>`.

Proof standards:
- Drive the built app (`next start`) at `/control/`, never `next dev` and never test-only endpoints for UI state.
- Capture both the action and the resulting state (for example, appending a model call via `createLiveFeed` and waiting for the token count on screen to update).
- Verify subscription readings on the server against `node dashboard/scripts/quota-live-check.mjs` and test failed readings showing `Reading failed, unknown`.

## Bug bash

`e2e.bugbash.config.ts` (untracked) spreads `e2e.config.ts` and adds `tests/bugbash/**` and a model when a model gateway is configured. Charters live in [features/](features/) using `slug|target|agent|charter` lines. Without a model gateway in `e2e.config.ts`, `e2e explore` cannot run and bug-bash runs are skipped. A finding is a bug only once `tests/bugbash/<slug>.e2e.ts` reproduces it.

## Cleanup

The runner stops the `start-server.mjs` process it started, and `close_session` stops any MCP session. Never kill processes by name. Keep `.e2e/proof/` evidence intact until posted; `.e2e/` is gitignored.

## Helpers

- `node dashboard/scripts/quota-live-check.mjs` prints each subscription's raw provider response beside the server reader's output (numbers and status only, no secrets).
- `dashboard/tests/flow-fixture.mjs` exports `prepare({ scene, readings })` and `appendModelCall(...)` using the machine's own `createLiveFeed` writer.
