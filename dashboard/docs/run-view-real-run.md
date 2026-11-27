# What a real run showed (JUL-419)

Two sessions on the server, both on 27 November 2026. The first was started the way a card really
starts: Todd's Start on the deployed mission control. The second was started by calling `startCard()`
directly, with a stand-in order, to watch the stage change to another playbook. Each section says
which one it is.

## 1. Start on the real card, from the real Run view

Mission control (`card-machine-run-view.service`, `https://ovh.tail91f394.ts.net/control`) running the
code in this branch, with `scripts/julia-agents.mjs` supplying the Linear and model keys.

| Step | Seen |
| --- | --- |
| Idle | The Run view said "Nothing is running right now" and listed the Ready cards it read from Linear — JUL-420, JUL-419, JUL-417, JUL-416, JUL-415, JUL-414, JUL-413 — each with a Start. |
| Pressing Start | `POST /control/api/start` with `{"identifier":"JUL-419"}` answered `202` with `{"card":"JUL-419","title":"Todd presses Start on a card in mission control and watches its playbook steps on the Run view","startedAt":1795798981748,"threadId":"b38c44e2-4d2c-4108-bff3-ce633fd78110"}`. |
| 45 s later | The run panel was drawn for JUL-419, `Running`, and the page had no Start button on it at all. |
| Stage and steps | Stage **Feature**, 8 steps, read from the session's own to-do list: `feature-1` through `feature-8`, the last one "Run **Opening a PR**". |
| The marker moving | Step 1 of 8 at 45 s, step 4 of 8 at 248 s (current `feature-4`), step 5 of 8 at 508 s, step 8 of 8 at 1,942 s. Every reading came from `GET /control/api/run-view`, the same data the page renders. |
| Tokens | Climbed with the run; the dollars read "not priced yet", because Mastra reports tokens per step and no per-call price. |
| How it ended | At 17:54 the session restarted mission control as part of its own shipping work, which killed the process hosting it. The record then read ended with no result. |

Pictures, from a browser on the same page: `real-run-start-idle.png` (nothing running, a Start on each
real Ready card) and `real-run-start-feature.png` (the same page during the run: stage **Feature**, the
step row, `Running ·`, and no Start button). `real-run-start-later.png` is the marker on step 4.

This run did the card's work for real. It found one defect: the record named the thread the boot
created rather than the thread `runMC` works in, so the step list read empty while the session had a
to-do list all along. Fixed in `d6e6aa1`, and a second Start read the steps on the page within 30 s.

## 2. The stage changing to another playbook

The stage change was recorded from a second real session — real `bootLocalAgentController` + `runMC`,
real Mastra task tools, the real `mastra_thread_state` `task` row, the real `run.json`,
`readCardSession()`, `foldRunView()`, `/control/api/run-view` and the page in a browser.

A stand-in in that one: the card's work. The card object was `JUL-419-PROOF`, and the order said the
work was already done, to change no file, and to copy the Feature playbook's steps, mark them off one
at a time, then copy Opening a PR's steps. It ran in a scratch folder
(`~/.local/state/julia-scratch/jul-419-proof/session`) so nothing in `.artifacts/run-view` was
disturbed. What the screen did:

| Scene | Seen |
| --- | --- |
| Feature, step 4 of 8 | Stage **Feature** as the largest text, `Running ·`, 8 steps, the marker on step 4. |
| Feature, step 8 of 8 | The marker moved to step 8, "Run **Opening a PR**", still 8 steps. |
| Opening a PR | Stage **Opening a PR**, 3 steps, the marker on step 1, and no Feature steps in the row. |
| After it ended | The run panel gone, the last result read `finished`. |
| While running | No Start button anywhere on the page. |

Pictures: `real-run-laptop.png` (Feature, step 4 of 8), `real-run-opening-a-pr.png` (Opening a PR, 1 of 3),
`real-run-phone.png` (the same stage at 390 px wide).

## Not seen

The stage changing inside a Start run. The real card ran its Feature steps to the end and then went to
the work rather than naming another playbook's steps, and the run ended when the session restarted
mission control. Section 2 is where the change itself was recorded.

## What it cost

Three sessions and about 2.3 M tokens on the Start run, all on
`commandcode/deepseek/deepseek-v4.1-flash`.
