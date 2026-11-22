# Run view: finish review

Against `## Direction contract` in `.impeccable/surfaces/run-view/brief.md`, clause by clause.
Pictures are in `docs/run-view-proof/`, taken by `dashboard/tests/run-view.spec.mjs` from logs
written through the machine's own `createLiveFeed` and `stageEvents` (`dashboard/scripts/live-scenes.mjs`).

| Clause | Verdict | Evidence |
| --- | --- | --- |
| **THESIS** — the run as a trip through named stages, shown like a station board, refusing the dark console | met | `laptop.png` (1280×1493): bottle-green panel on a sage ground, a rail of past stage pills with the current stage in an ivory block; no black ground, no monospace body, no purple anywhere. The rail carries the machine's own 19 stage labels, not the contract's four named stages: the board never shows a stage the machine has not reached, so the four-stage framing in the contract is a reading of the trip, not a literal row of four. |
| **OWN-WORLD: colours** — bottle green `#1D3B27`, leaf green `#3D6B2C`, sage `#DCEBCB`, ivory `#F6F1E4`, madder red `#A3212D` for problems only | met | `app/globals.css` `:root` matches the hexes; red appears only in `stopped.png` (banner, struck title) and `quota-low.png` (low fill and ring). |
| **OWN-WORLD: faces** — Zilla Slab for headings and the stage name, Source Sans 3 for everything else | met | `app/globals.css:30,44`; visible in `laptop.png` (slab stage name, slab section titles, sans body). |
| **OWN-WORLD: state from edges as well as colour** — solid running, dashed stuck, dotted sent back, struck through given up | met | `stuck.png` (dashed amber banner, dashed helper card), `burning-fast.png` (dotted banner), `finished.png` (dotted pill for "Send it back to the builder"), `stopped.png` (solid red banner, struck title). Asserted as border-style in the spec, not as colour. |
| **STORY** — without clicking, Todd knows the stage and step, whether it is moving, what it used against each subscription, and anything wrong | met | `laptop.png` answers all four above the fold: warnings (none), stage and step in the panel, running time, tokens and an estimate, then a bar per window. `nothing-running.png` shows the quiet answer. |
| **FIRST VIEWPORT: warnings across the top when there are any** | met | `stuck.png`, `stopped.png`, `burning-fast.png`, `quota-low.png`: banner first, panel under it. The phone spec asserts warnings sit above the panel. |
| **FIRST VIEWPORT: green panel with card title, running time, tokens, dollars marked "estimate"** | met | `laptop.png`: title in slab, "Running · 6 min", "82 k tokens · about $0.18, estimate". The word "estimate" is part of the string in `app/run-view.jsx:48`. |
| **FIRST VIEWPORT: the current stage name is the largest text on the page** | met | `laptop.png`, `phone.png` (390×1688): 2.9rem stage name against a 2rem card title; the spec asserts the stage's font size is greater than the title's and above 24px. |
| **FIRST VIEWPORT: its steps in a row and "step N of M"** | met | `laptop.png`: a row of pills under the stage name, the step in hand filled in sage with a solid green edge, passed steps solid-edged with a tick, a step the run skipped dotted with a struck name, and "step 2 of 8" beside them. The row is the Lead's own task list as the machine publishes it (`machine/flow/playbook.mjs` `announceTasks`), ordered by the numeric suffix of `playbook_N`, and the same lookup that names `run.step` gives the count, so the two cannot disagree. `dashboard/lib/run-view.test.mjs` holds the count to that list and the spec compares the row to the served snapshot on a laptop and a phone. |
| **FIRST VIEWPORT: helper cards, then the three quota bars** | met | `laptop.png`: helper cards in a grid under the panel, three subscriptions beneath them, one row per subscription with a bar per window. |
| **FIRST VIEWPORT: no primary action; the UAT stop reads "waiting for you"** | met | No button, form or link on the surface; `STATE_WORDS.waiting_for_you` is "Waiting for you" in `app/run-view.jsx:11`. |
| **FIRST VIEWPORT: the marker moves along the stage's row as each step passes** | **partly met** | The marker is the filled pill in the step row: it moves one place each time a step passes, and the rail itself grows as the machine reaches a stage. It is a lit pill rather than a travelling dot, and the one authored motion stays a new helper action settling in at the top of its card (`prefers-reduced-motion` honoured). |
| **FIRST VIEWPORT: on a phone everything stacks** | met | `phone.png` (390×2204): warnings, panel, helper cards and quota windows in one column; the phone spec asserts that order and no horizontal overflow at 390px. |
| **FORM** — operate surface, code-led, composed from the A2 board | met | `chosen-design-A2-larder-bolder.html` is the source of the palette, the slab/sans pairing and the rail; `laptop.png` sits in that world rather than a new one. |
| **FINISH** — finish review, verdict, DESIGN.md, rasters carrying provenance | met | This file is the review; `dashboard/DESIGN.md` records the system; every picture is regenerated by the spec on a fresh build. |

## Where the pictures come from

`npm run build && npx playwright test` in `dashboard/`. Playwright now builds before it starts
`next start`, because a stale build once let a spec pass against CSS that no longer existed.

The scenes drive the machine's own writer (`machine/flow/live.mjs`) rather than a live card run, so
these pictures prove the screen against the real log format, not against a real run. A real-run
proof beside the trace record is still open on the card.

## Deliberately left out

- A travelling dot along the rail: the count moves instead, as the filled pill in the step row.
- A `sent back` state for a helper: the machine reports helpers as working, done, failed or stuck,
  so the dotted edge is carried by the rail's remediation pill instead.
- A design.json sidecar for the document command: `DESIGN.md` is the only consumer in this repo, and
  a second copy of the tokens would drift from the CSS that actually runs.
