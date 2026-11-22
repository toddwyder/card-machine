---
name: verify-mission-control
description: "Drive and verify Mission Control's Next.js Run view (`dashboard/`) in a real headless Chromium browser via Playwright against both deterministic fixtures and the live Studio + subscription endpoints. Use when proving Run view UI behavior, step states, warning banners, helper cards, or subscription quota bars."
---

# Verify Mission Control

Scripted end-to-end verification for the Mission Control web UI (`dashboard/`). Drives the built Next.js server with Playwright (`@playwright/test`) on an isolated loopback port so production `:4313` and `card-machine-studio.service` (`:4112`) are never disturbed.

## Launch

Build once (if `dashboard/.next` is stale or missing), then start an isolated server on `127.0.0.1:4399` and record its PID:

```bash
cd dashboard
npm run build

# Mode A: deterministic showcase fixture (all step states, warnings, helpers, quotas)
EVIDENCE_DIR="/home/ubuntu/.local/state/julia-scratch/jul-361-evidence"
mkdir -p "$EVIDENCE_DIR"
RUN_VIEW_FIXTURE_FILE="$PWD/tests/fixtures/run-view-showcase.json" \
  node ./node_modules/next/dist/bin/next start -H 127.0.0.1 -p 4399 \
  >"$EVIDENCE_DIR/server-showcase.log" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$EVIDENCE_DIR/server.pid"

# Wait for HTTP 200 and JSON payload from /api/run-view
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:4399/api/run-view | grep -q '"updatedAt"'; then
    break
  fi
  sleep 0.5
done
```

For **Mode B (live server)** talking to the real local Studio (`http://127.0.0.1:4112`) and live subscription usage endpoints, omit `RUN_VIEW_FIXTURE_FILE`:

```bash
node ./node_modules/next/dist/bin/next start -H 127.0.0.1 -p 4399 \
  >"$EVIDENCE_DIR/server-live.log" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$EVIDENCE_DIR/server.pid"
```

Never bind `:4313` during verification and never restart or stop `card-machine-studio.service` (`:4112`).

## Doctor

Run this read-only check before driving the browser:

```bash
PID=$(cat /home/ubuntu/.local/state/julia-scratch/jul-361-evidence/server.pid)
kill -0 "$PID"
curl -sf http://127.0.0.1:4399/api/run-view | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (!data.updatedAt || !Array.isArray(data.subscriptions)) process.exit(1);
  console.log({
    sourceStatus: data.sourceStatus,
    runStatus: data.run?.status ?? "idle",
    warnings: data.warnings?.map(w => w.kind) ?? [],
    subscriptions: data.subscriptions.map(s => ({ id: s.id, status: s.status, percentLeft: s.percentLeft }))
  });
'
```

Confirm:
1. The PID from `server.pid` is alive.
2. `/api/run-view` returns `200 OK` with `updatedAt` and `subscriptions`.
3. `sourceStatus` is `"fixture"` in Mode A or `"live"` in Mode B.

## Drive

Run the Playwright suite in `dashboard/` against the isolated server:

```bash
cd dashboard
BASE_URL=http://127.0.0.1:4399 \
CAPTURE_DIR=/home/ubuntu/.local/state/julia-scratch/jul-361-evidence \
  npx playwright test
```

Stable UI handles used by `dashboard/tests/run-view.spec.mjs`:
- Header status: `[role="status"]` (`Live` / `Reconnecting`)
- Warnings region: `section[aria-label="Warnings"] [role="alert"]`
- Current run panel: `section[aria-label="Current run"]` with `h1` (current stage name — must be largest font-size on the page)
- Stage board: `ol[aria-label="Stages"] li` (`aria-current="step"` marks active stage)
- Active stage steps: `ol[aria-label$="steps"] li`
- Helpers region: `section[aria-label="Helpers"]`
- Subscription bars: `section[aria-label="Left in each subscription"] [role="img"]`

See [`features/README.md`](features/README.md) for per-feature journeys and assertions.

## Evidence

Proof artifacts are written outside the temporary server process so they survive cleanup:
- Screenshots: `/home/ubuntu/.local/state/julia-scratch/jul-361-evidence/` (`desktop.png` at `1440x900`, `mobile.png` at `390x844`, `idle-desktop.png`, `live-desktop.png`) and `<repo>/.impeccable/review/` (`desktop.png`, `mobile.png`).
- Proof standards:
  1. Exercise the real Next.js SSR page (`/`) and live polling endpoint (`/api/run-view`).
  2. Assert zero `console.error` and zero uncaught `pageerror` events.
  3. Assert zero horizontal overflow (`scrollWidth <= clientWidth`) on both laptop (`1440x900`) and phone (`390x844`).
  4. When proving live subscriptions (Mode B), capture `/api/run-view`, the rendered DOM text of the three bars, and sanitized raw provider usage fields at the same moment (never log tokens, keys, or emails).

## Cleanup

Kill ONLY the exact PID recorded at launch — never `pkill next` or `killall node`:

```bash
PID_FILE="/home/ubuntu/.local/state/julia-scratch/jul-361-evidence/server.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -f "$PID_FILE"
fi
```

Verify port `4399` is closed (`! curl -sf http://127.0.0.1:4399/api/run-view`) and confirm the evidence files in `/home/ubuntu/.local/state/julia-scratch/jul-361-evidence/` remain intact.

## Helpers

- `dashboard/playwright.config.mjs`: headless Chromium config reading `BASE_URL` (default `http://127.0.0.1:4399`).
- `dashboard/tests/run-view.spec.mjs`: end-to-end assertions and screenshot capture (`CAPTURE_DIR`).
- `dashboard/tests/fixtures/run-view-showcase.json`: rich active-run fixture for Mode A.
- `dashboard/tests/fixtures/run-view-stopped-waiting.json`: idle (`lastRun`), `stopped`, `waiting_for_you`, and `running` fixtures.
