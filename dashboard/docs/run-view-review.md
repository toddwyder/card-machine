# Run view: finish review (Impeccable)

Ran as Impeccable's own dual-agent finish review (Assessment A design review + Assessment B detector and browser evidence + `impeccable detect --json dashboard/app/run-view.jsx` returning `[]`) against `## Direction contract` in `.impeccable/surfaces/run-view/brief.md` and the e2e proof run `01a208f5-0c67-7904-b8c5-04642f4ceb55` (`tests/run-view.e2e.ts`, 6/6 passing, `--trace on --output .e2e/proof/run-view`).

| Clause | Verdict | Evidence |
| --- | --- | --- |
| **THESIS** — the run as a trip through named stages, shown like a station board, refusing the dark console | **partly met** | Bottle-green `#1D3B27` panel on sage `#DCEBCB` ground with ivory `#F6F1E4` cards, Zilla Slab + Source Sans 3, zero monospace or data tables (`001-laptop-running.png`). Gap: the rail renders the machine's granular stage labels rather than the brief's four coarse stage names (`Build`, `Babysit`, `Shipping`, `After merge`), per the card constraint to read stages from the machine itself. |
| **OWN-WORLD** — bottle green, leaf green, sage, ivory, madder red for problems only; Zilla Slab + Source Sans 3; state from edges + colour | **met** | `globals.css` and `run-view.module.css` match the larder tokens; `layout.jsx` loads Zilla Slab and Source Sans 3; madder red appears only on `quota_low`, `stopped`, failed helpers, low bars, and unknown readings; every state pairs a distinct SVG `<Mark>` with `solid`, `dashed`, `dotted`, or `line-through` (`002-stuck.png`, `001-quota-low.png`, `004-stopped.png`). |
| **STORY** — without clicking, Todd knows the stage and step, whether it is moving, what it used against each subscription, and anything wrong | **met** | Zero clicks required; polls `/control/api/run-view` every 2s. Warnings sit at the top; status + duration, display-size stage, step + `STEP N OF M`, token/dollar estimate, helper cards, and subscription bars with reset dates are scannable at a glance (`001-laptop-running.png`, `002-nothing-running.png`). |
| **FIRST VIEWPORT** — warnings first, green panel, largest stage text, step row `step N of M`, helper cards, quota bars, no primary action, UAT "Waiting for you", phone stacking | **partly met** | Warnings sit above the panel; stage name (`clamp(1.9rem, 4.2vw, 2.9rem)`) is larger than card title; `STEP 2 OF 8` and skipped dotted/struck pill render; UAT shows `Waiting for you`; phone (`390px`) stacks with zero horizontal overflow (`002-phone-running.png`). Gaps: `.action:first-child` has `settleIn` motion (`prefers-reduced-motion` honoured), but the step-row marker has no transition; on laptop, helper cards push subscription bars below the initial 720px fold. |
| **FORM** — operate surface, code-led, composed from the A2 board | **met** | Read-only operate-mode Next.js surface following `chosen-design-A2-larder-bolder.html`. |
| **FINISH** — finish review, `DESIGN.md`, mechanical detector clean | **met** | `dashboard/DESIGN.md` matches CSS tokens; `impeccable detect --json dashboard/app/run-view.jsx` returned `[]` (0 findings); all 6 tests in `tests/run-view.e2e.ts` passed. |

## Priority observations from Assessment A

1. `.rail` uses `flex-wrap: wrap; align-items: flex-end`, leaving empty bottle-green space to the left of `.now` when past stage pills wrap (`001-laptop-running.png`).
2. `.spend` renders `82 k tokens·about $0.18, estimate` without spacing around the middot (`run-view.jsx:325-329`).
3. Step-row marker has no motion transition when advancing (`brief.md` FIRST VIEWPORT).

## Proof provenance

- `npx e2e run tests/run-view.e2e.ts --trace on --output .e2e/proof/run-view` (run `01a208f5-0c67-7904-b8c5-04642f4ceb55`, 6/6 passed in 16.90s against `next start` with fixture logs written via `machine/flow/live.mjs`).
- `node dashboard/scripts/quota-live-check.mjs` (local check without OVH server credentials: all 3 providers failed/401 and reader returned `unknown`).
- Real-run proof beside the trace record remains open by Todd's decision for the next real card.
