# Machine run completion audit

Goal: find out how often Julia's machine runs end without a final result because the process died or stalled, so Todd can decide whether a crash-recovery test is worth running.

## Summary for Todd

Across the server and this checkout's run folders, **68** run records exist between **2026-10-15T03:43:42Z** and **2026-11-18T06:07:06Z** (plus 115 empty Mastra Code session stubs with zero steps). Only **7** of those 68 records are real card runs on the server; the other 61 are local verification harness runs (56) or 1-step server dev probes (5).

- **Real card runs seen on the server:** 7
  - **Finished:** 4 (`JUL-290`, `JUL-362` on 14 Nov, `JUL-362` on 18 Nov, `JUL-403` on 18 Nov).
  - **Stopped on purpose:** 1 (`JUL-279`, `stopped by hand`).
  - **Ended without a final status:** 2 (`JUL-319` on 2 Nov, `JUL-333` on 3 Nov).
- **Real card runs without a final status with a recorded cause:** 1 of 2 (`JUL-319` suspended on `request_access` for `/home/ubuntu/.agents` after 25.6 s, leaving its parent `agentic-loop` reading `running`; `JUL-333` has `cause not recorded` in its run file).
- **All runs combined (including verification harness runs):** 68 total, 18 ended without a final status or left incomplete (2 real card runs, 8 local `verify-machine` `JUL-232` runs still reading `running`, and 8 local `verify-machine` `.db` files that are empty or lack `mastra_workflow_snapshot`).

## What else the count could be measuring

| Hypothesis | Ruled in or out | Evidence |
| --- | --- | --- |
| Runs an operator killed | **Ruled out** of the "ended without a final status" count | `JUL-279` (`/var/lib/julia-dashboard/state/archived-runs/jul-279.json`) has `status: "stopped"` and `stoppedBecause: "stopped by hand"`, so it is counted under "stopped on purpose". None of the 8 `running` local `JUL-232` harness runs show an operator kill; 6 threw `AssertionError` or exited prematurely in `build-drive.stderr.txt`, and 2 have empty stderr. |
| Old-runner runs versus one-workflow machine (around 2 to 3 Nov) | **Split confirmed** | 3 of the 7 server card runs (`JUL-290`, `JUL-279`, `JUL-319`) are pre-3 Nov old-runner runs (1 ended without a final status). 4 of the 7 (`JUL-333`, `JUL-362` x2, `JUL-403`) are from the one-workflow era starting 3 Nov (1 ended without a final status, `JUL-333` on 3 Nov; the 3 `card-path` runs on 14 Nov and 18 Nov all finished cleanly). |
| Runs never meant to finish | **Ruled out** of the real card count, **present** in local `.artifacts` | 47 of the 56 local `.artifacts/verify-machine` runs are `JUL-225` rehearsals (`productMutation: false`, 11) or `julia-initialization` durable-suspend tests (`JUL-230` x12, `JUL-232` x16, `JUL-232` failed x1, plus 8 empty/incomplete test DBs). 5 server rows in `mastracode/mastra.db` (`spike-shipping` x4, `probe4` x1) are 1-step dev probes from 1 Nov. |

## Period covered, earliest run, and missing or incomplete records

- **Period covered:** 2026-10-15T03:43:42.608Z to 2026-11-18T06:07:06.298Z.
- **Earliest run found:** `jul-225-20261014-202056/rehearsal.json` (local `.artifacts/verify-machine`), recorded at `2026-10-15T03:43:42.608Z` (`2026-10-14T20:20:56` local). Earliest server run found: `jul-290.json` (`/var/lib/julia-dashboard/state/runs/jul-290.json`), started `2026-10-30T22:33:29.404Z`.
- **Known incidents check:**
  1. **12 Oct live review OOM:** Missing from both the server and this checkout's run folders. The OVH server was provisioned on 18 Oct (`.artifacts/verify-machine/ovh-20261018/`), and old-machine artifacts were removed on 26 Oct (`docs/plans/path-forward.md:131`).
  2. **2 Nov build ending after ~27 s (JUL-319):** Found in `/home/ubuntu/.local/share/mastracode/mastra.db` as run `3180c595-bb54-46d5-8630-b2ed74a2752e` (`2026-11-02T16:18:36.248Z` to `2026-11-02T16:19:01.854Z`, 25.6 s). `executionWorkflow` is `suspended` on `toolCallStep` (`request_access` for `/home/ubuntu/.agents`), and `agentic-loop` is `running`.
  3. **3 Nov first JUL-333 run dying ~12 min in:** Found in `/var/lib/julia-dashboard/state/machine-runs/20261103T205425Z-JUL-333.json` (`2026-11-03T20:54:25.093Z` to `2026-11-03T21:06:26.887Z`, 12 min 01.8 s). Stored `status` is `"running"` on step `build` with `endedAt: null` and `cause not recorded`.
- **Other missing or incomplete records:**
  - `/home/ubuntu/julia-builder/.artifacts/` is empty; historical `start-machine` and early `machine` run folders (such as `JUL-334` and `JUL-355` seen in `/home/ubuntu/.local/state/julia/stops.jsonl`) are no longer on disk.
  - `/home/ubuntu/julia-flow-repo/.artifacts/flow/studio/trace.duckdb` is locked by the running Studio process (`PID 2311901`) and was not queried.
  - `/home/ubuntu/.local/share/mastracode/mastra.db` holds 115 `agentic-loop` and `executionWorkflow` rows with `status: "pending"` and 0 steps (Mastra Code session stubs, excluded from the 68-row table).
  - Local `.artifacts/verify-machine/` contains 8 incomplete `.db` files (3 empty `mastra_workflow_snapshot` tables, 5 missing `mastra_workflow_snapshot`).

## Machine runs table

### Server runs (12 rows)

| Card | Start time (UTC) | Last recorded step | Final status as stored | Verdict | Cause / source |
| --- | --- | --- | --- | --- | --- |
| JUL-290 | 2026-10-30T22:33:29.404Z | uat | failed | finished | `runs/jul-290.json` (`stoppedBecause`: Linear API 400 ApiKey) |
| JUL-279 | 2026-10-31T00:05:12.652Z | shipping | stopped | stopped on purpose | `archived-runs/jul-279.json` (`stoppedBecause`: stopped by hand) |
| spike-shipping (1) | 2026-11-01T04:16:19.126Z | review | success | finished | `mastra.db` (`59584571`, dev probe) |
| spike-shipping (2) | 2026-11-01T04:18:29.993Z | review | success | finished | `mastra.db` (`28c56ec7`, dev probe) |
| spike-shipping (3) | 2026-11-01T04:20:53.134Z | review | success | finished | `mastra.db` (`212afb8b`, dev probe) |
| spike-shipping (4) | 2026-11-01T04:21:27.377Z | review | success | finished | `mastra.db` (`79fcbd91`, dev probe) |
| probe4 | 2026-11-01T04:25:30.317Z | review | success | finished | `mastra.db` (`58f59955`, dev probe) |
| JUL-319 | 2026-11-02T16:18:36.248Z | toolCallStep | running / suspended | ended without a final status | `mastra.db` (`3180c595`, suspended on `request_access` for `/home/ubuntu/.agents` after 25.6 s) |
| JUL-333 | 2026-11-03T20:54:25.093Z | build | running | ended without a final status | `machine-runs/20261103T205425Z-JUL-333.json` (cause not recorded; last heartbeat +12m01s) |
| JUL-362 | 2026-11-14T13:51:57.218Z | cleanup | success | finished | `jul-362-evidence/run-340d3f49...json` (`card-path`, stopped on Spending cap) |
| JUL-362 | 2026-11-18T01:19:32.770Z | cleanup | success | finished | `studio/state.db` (`8662fa7b`, `card-path`, stopped on Spending cap) |
| JUL-403 | 2026-11-18T06:07:06.298Z | cleanup | success | finished | `studio/state.db` (`64c54e1c`, `card-path`, stopped on Shipping FAIL x2) |

### Local checkout `.artifacts/verify-machine/` runs (56 rows)

| Card | Start time (UTC) | Last recorded step | Final status as stored | Verdict | Cause / source |
| --- | --- | --- | --- | --- | --- |
| JUL-225 (rehearsal) | 2026-10-15T03:43:42.608Z | rehearsal | success | finished | `jul-225-20261014-202056/rehearsal.json` |
| JUL-225 (rehearsal) | 2026-10-15T03:54:05.796Z | rehearsal | success | finished | `jul-225-final-20261014-204844/rehearsal.json` |
| JUL-225 (rehearsal) | 2026-10-15T04:21:33.011Z | rehearsal | success | finished | `jul-225-final-20261014-211520/rehearsal.json` |
| JUL-225 (rehearsal) | 2026-10-15T04:49:36.559Z | rehearsal | success | finished | `jul-225-final-20261014-213054/rehearsal.json` |
| JUL-225 (rehearsal) | 2026-10-15T05:06:58.313Z | rehearsal | success | finished | `jul-225-final-20261014-215415/rehearsal.json` |
| JUL-225 (rehearsal) | 2026-10-15T05:40:01.246Z | rehearsal | success | finished | `jul-225-final-20261014-224015/rehearsal.json` |
| JUL-225 (rehearsal) | 2026-10-15T06:22:57.818Z | rehearsal | success | finished | `adversarial-review-1/rehearsal.json` |
| JUL-225 (rehearsal) | 2026-10-15T07:33:31.121Z | rehearsal | success | finished | `jul-225-fix-round-1-final/rehearsal.json` |
| JUL-225 (rehearsal) | 2026-10-15T07:33:31.121Z | rehearsal | success | finished | `jul-225-round-2-final/rehearsal.json` |
| JUL-225 (rehearsal) | 2026-10-15T08:10:19.138Z | rehearsal | success | finished | `jul-225-fix-round-2-final/rehearsal.json` |
| JUL-225 (rehearsal) | 2026-10-15T13:46:58.495Z | rehearsal | success | finished | `adversarial-review-run/rehearsal.json` |
| - | (missing) | - | no snapshot table | ended without a final status | `maintain-20261015T230102879-32248/.../initialization.db` (cause not recorded) |
| - | (missing) | - | no snapshot table | ended without a final status | `maintain-20261015T230457665-46560/.../initialization.db` (cause not recorded) |
| JUL-230 | 2026-10-16T06:15:58.351Z | suspend-ready-for-build | suspended | stopped on purpose | `maintain-20261015T231307764-41224/.../initialization.db` |
| JUL-230 | 2026-10-16T06:20:08.849Z | suspend-ready-for-build | suspended | stopped on purpose | `20261015T231722383-43684/initialization.db` |
| JUL-230 | 2026-10-16T13:02:24.189Z | suspend-ready-for-build | suspended | stopped on purpose | `maintain-20261016T055741842-39208/.../initialization.db` |
| JUL-230 | 2026-10-16T13:12:27.195Z | suspend-ready-for-build | suspended | stopped on purpose | `20261016T060752154-36896/initialization.db` |
| JUL-230 | 2026-10-16T14:00:22.674Z | suspend-ready-for-build | suspended | stopped on purpose | `maintain-20261016T065220096-33592/.../initialization.db` |
| JUL-230 | 2026-10-16T14:07:47.857Z | suspend-ready-for-build | suspended | stopped on purpose | `20261016T070330561-31332/initialization.db` |
| JUL-230 | 2026-10-16T14:18:02.972Z | suspend-ready-for-build | suspended | stopped on purpose | `20261016T071321434-44632/initialization.db` |
| - | (missing) | - | empty table | ended without a final status | `maintain-20261016T073555055-39208/.../initialization.db` (cause not recorded) |
| JUL-230 | 2026-10-16T14:43:35.613Z | suspend-ready-for-build | suspended | stopped on purpose | `maintain-20261016T073947531-40044/.../initialization.db` |
| JUL-230 | 2026-10-16T14:49:39.986Z | suspend-ready-for-build | suspended | stopped on purpose | `20261016T074607671-31316/initialization.db` |
| JUL-230 | 2026-10-16T15:01:01.551Z | suspend-ready-for-build | suspended | stopped on purpose | `maintain-reproof-20261016T075725249-11212/initialization.db` |
| JUL-230 | 2026-10-16T15:07:10.910Z | suspend-ready-for-build | suspended | stopped on purpose | `20261016T080338951-36788/initialization.db` |
| JUL-230 | 2026-10-16T15:40:08.276Z | suspend-ready-for-build | suspended | stopped on purpose | `20261016T083454921-44564-maintenance/initialization.db` |
| - | (missing) | - | no snapshot table | ended without a final status | `20261016T142911565-45524-jul231/build-initialization.db` (cause not recorded) |
| JUL-232 | 2026-10-16T21:35:30.814Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T143159232-41992-jul231-retry/build-initialization.db` |
| JUL-232 | 2026-10-16T21:43:00.501Z | run-builder-and-suspend-for-review | failed | finished | `20261016T143956082-23236-jul231-final/build-initialization.db` (exit code -1) |
| JUL-232 | 2026-10-16T21:50:55.527Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T144752516-29608-jul231-proof/build-initialization.db` |
| JUL-232 | 2026-10-16T21:58:58.364Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T145416942-36420-jul231-proof/build-initialization.db` |
| - | (missing) | - | empty table | ended without a final status | `20261016T150204783-13124-jul231-proof/build-initialization.db` (cause not recorded) |
| - | (missing) | - | no snapshot table | ended without a final status | `20261016T150941382-3632-jul231-proof/build-initialization.db` (cause not recorded) |
| JUL-232 | 2026-10-16T22:19:26.255Z | suspend-ready-for-build | suspended | stopped on purpose | `20261016T151316485-46612-jul231-proof/build-initialization.db` |
| - | (missing) | - | empty table | ended without a final status | `20261016T152735742-30964-jul231-proof/build-initialization.db` (cause not recorded) |
| JUL-232 | 2026-10-16T22:38:04.939Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T153537692-12108-jul231-proof/build-initialization.db` |
| JUL-232 | 2026-10-16T22:44:58.671Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T154120448-37520-jul231-proof/build-initialization.db` |
| JUL-232 | 2026-10-16T23:03:23.402Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T155804983-40868/build-initialization.db` |
| - | (missing) | - | no snapshot table | ended without a final status | `20261016T162937160-29740/debug.db` (cause not recorded) |
| JUL-232 | 2026-10-16T23:34:28.977Z | run-builder-and-suspend-for-review | running | ended without a final status | `20261016T163138986-30096` (`AssertionError`: read boundary HTTP 400) |
| JUL-232 | 2026-10-16T23:41:03.999Z | run-builder-and-suspend-for-review | running | ended without a final status | `20261016T163636190-1796` (launcher exited prematurely) |
| JUL-232 | 2026-10-16T23:47:25.212Z | run-builder-and-suspend-for-review | running | ended without a final status | `20261016T164448501-36524` (`AssertionError`: read boundary HTTP 400) |
| JUL-232 | 2026-10-16T23:51:51.738Z | run-builder-and-suspend-for-review | running | ended without a final status | `20261016T164935374-28044` (launcher exited prematurely) |
| JUL-232 | 2026-10-16T23:57:15.515Z | run-builder-and-suspend-for-review | running | ended without a final status | `20261016T165336784-7352` (cause not recorded; empty stderr) |
| JUL-232 | 2026-10-17T00:04:17.169Z | run-builder-and-suspend-for-review | running | ended without a final status | `20261016T170052024-35508` (`AssertionError`: deepStrictEqual in `drive-build.mjs`) |
| JUL-232 | 2026-10-17T00:11:32.008Z | run-builder-and-suspend-for-review | running | ended without a final status | `20261016T170828462-35236` (cause not recorded; empty stderr) |
| JUL-232 | 2026-10-17T00:25:31.712Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T172326952-47760/build-initialization.db` |
| JUL-232 | 2026-10-17T00:37:36.331Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T173450254-6896/build-initialization.db` |
| JUL-232 | 2026-10-17T00:57:35.599Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T175532352-45960/build-initialization.db` |
| JUL-232 | 2026-10-17T01:07:13.508Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T180450929-25520/build-initialization.db` |
| JUL-232 | 2026-10-17T01:28:02.441Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T182551341-28044/build-initialization.db` |
| JUL-232 | 2026-10-17T01:48:17.530Z | run-builder-and-suspend-for-review | running | ended without a final status | `20261016T184612689-48052` (`AssertionError`: deepStrictEqual in `drive-build.mjs`) |
| JUL-232 | 2026-10-17T01:55:30.091Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T185327365-46900/build-initialization.db` |
| JUL-232 | 2026-10-17T02:01:48.613Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T185939590-18196/build-initialization.db` |
| JUL-232 | 2026-10-17T02:20:29.874Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T191815649-38744/build-initialization.db` |
| JUL-232 | 2026-10-17T04:31:45.734Z | run-builder-and-suspend-for-review | suspended | stopped on purpose | `20261016T212517698-1676/build-initialization.db` |

## Independent verification

A second agent (`12de61c6-cd6b-416d-b1b7-1403da6aa73e`) re-read the raw OVH run records for one run from each verdict group and confirmed all three verdicts:

1. **JUL-403 (`64c54e1c-61e5-4353-b224-7205733cdf01`) — `finished` (confirmed).** `studio/state.db` (`card-path`) shows `status: "success"` with last step `cleanup` (`status: "success"`, `updatedAt: 2026-11-18T06:30:36.534Z`), and `JUL-403/reports/JUL-403.md` records the planned stop after two Shipping `FAIL`s.
2. **JUL-279 (`jul-279`) — `stopped on purpose` (confirmed).** `archived-runs/jul-279.json` shows `status: "stopped"`, `stoppedBecause: "stopped by hand"`, last step `shipping` (`status: "running"`).
3. **JUL-333 (`20261103T205425Z-JUL-333`) — `ended without a final status` with `cause not recorded` (confirmed).** `machine-runs/20261103T205425Z-JUL-333.json` shows `status: "running"`, `endedAt: null`, last step `build` (`status: "running"`), last heartbeat at `2026-11-03T21:06:26.887Z` (+12m01s), and no stop reason field.

