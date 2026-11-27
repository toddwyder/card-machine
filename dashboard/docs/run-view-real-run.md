# What a real run showed (JUL-419)

This record is from a real Mastra Code session on the server on 27 November 2026, read through the
Run view's own server code and page. The session was started by calling `startCard()` in
`dashboard/lib/card-session.mjs` — the exact function `app/api/start/route.js` calls with the same
argument — against a scratch session folder
(`~/.local/state/julia-scratch/jul-419-proof/session`), so nothing in `.artifacts/run-view` was
disturbed.

## What was real, and what was a stand-in

Real: the session (`bootLocalAgentController` + `runMC`), Mastra's own task tools, the
`mastra_thread_state` `task` row, the record `run.json`, `readCardSession()`, `foldRunView()`,
`/control/api/run-view`, and the page itself driven in a browser.

A stand-in: the card's work. The card object was `JUL-419-PROOF`, and its order said the work was
already done, to change no file, and to copy the Feature playbook's steps, mark them off one at a
time, then copy Opening a PR's steps. Starting a real Ready card would have built that card for
real in this checkout, on this branch.

The Start button itself was not clicked. The screen was photographed idle with Start on the real
Ready cards, and then again while the session ran, when Start was gone. The click, the POST and the
route's `getCard()` were not exercised end to end for the same reason: any real card identifier
would have started a real build here.

## What the screen showed

| Scene | Seen |
| --- | --- |
| Idle | "Nothing is running right now", the Ready cards from Linear, a Start on each row. |
| Feature, step 4 of 8 | Stage **Feature** as the largest text, `Running ·`, 8 steps, the marker on step 4. |
| Feature, step 8 of 8 | The marker moved to step 8, "Run **Opening a PR**", still 8 steps. |
| Opening a PR | Stage **Opening a PR**, 3 steps, marker on step 1, no Feature steps in the row. |
| After it ended | The run panel gone, the last result read `finished`. |
| While running | No Start button anywhere on the page. |

Pictures, taken from the browser during the run:
`real-run-laptop.png` (Feature, step 4 of 8), `real-run-opening-a-pr.png` (Opening a PR, 1 of 3),
`real-run-phone.png` (the same stage at 390 px wide).

## What it cost

Three sessions, 1.71 M tokens on the last one, all on `commandcode/deepseek/deepseek-v4.1-flash`.
