# Run view: design brief, version 2 (20 Nov 2026; confirmed by Todd, 06:22 PT)

Replaces the parts of the 7 Nov brief (`.impeccable/surfaces/run-view/1-design-brief.md`, confirmed by Todd 7 Nov, 17:45) that the 17 to 20 Nov decisions changed. Anything not listed under "What changed" is unchanged from 7 Nov, including the chosen look A2 ("the larder, bolder", `chosen-design-A2-larder-bolder.html`) and the interview answers. Shape stops here: this brief writes no code.

## What changed since 7 Nov, and who said so

1. **Home.** The Run view is mission control's first screen, in the machine's own repository (`toddwyder/card-machine`), not a tab on the model picker page. Its look becomes mission control's look (Todd, 19 Nov).
2. **Stage names are pstack's.** Step names are plain English (Todd, 19 Nov).
3. **The design covers every Shipping step and every state a step can be in, up front.** Each later Shipping slice adds only its own detail pieces (Todd, 19 Nov, late).
4. **The stage shows steps** (Todd, 20 Nov, option 1, after trying a sample run). Each stage shows its steps in a row; the current stage shows "step N of M". The helper cards the earlier brief drew are gone: the session's own to-do list is the whole picture of what it is doing.
5. **Slimmed to what is needed to see a run and its problems** (Todd, 17 Nov). The Run view is where machine work is proven, so it must show a planted problem as Todd would see it.

## 1. Job and audience (unchanged)

Todd, alone, during a run; mostly laptop, sometimes phone. Not a programmer. Opens it to answer, without clicking: where is the run, what has it used, is anything wrong.

## 2. Outcome and proof

* At a glance: the stage (largest thing on the page), the step inside it, whether the run is running at all, tokens so far, each subscription against its quota, any active warning.
* Warnings say what is wrong and nothing more. Starting rules, all Todd's: stopped (status stopped or failed); stuck (7 minutes with no activity, 28 Oct); quota low (20% or less left, 7 Nov); burning tokens fast (the whole run's spend rate over 25,000 tokens a minute, measured against the run's own elapsed time; the JUL-419 run spent 492,000 tokens in 32 minutes, so the line sits well above a real run and is a starting value).
* The machine stops for Todd at only two points: his UAT and anything irreversible (19 Nov). The Run view shows the UAT stop as "waiting for you".

## 3. Selected direction (unchanged): A2

Bottle-green header and run panel on a sage ground, ivory cards, slab headings, plain sans for everything else. Warning boxes at the top (dashed for stuck, solid for quota). Quota as one bar per subscription with percentage left and reset date, the low one ringed. State reads from shape as well as colour.

## 4. Stages and steps (the new part)

The stage is the name of the playbook the session follows, and it changes as the session moves to another playbook. The steps under it are that playbook's steps, taken from the session's own to-do list, so the screen reads the run rather than a copy of it. Stage names read as a person writes them: Feature, Bug fix, Babysit, Shipping, Opening a PR.

Stock pstack steps decide the step names. Working names for Todd to correct:

* **Feature** (stock, in its order): Read the card; Plan the slices; Build the slices; Open the pull request. Opening a PR is the last step.
* **Bug fix** (stock, in its order): Reproduce; Find the cause; Plan the fix; Verify; Stage the commits; Open the pull request.
* **Babysit** (stock, in its order: conflicts, threads, CI): Check for merge conflicts; Answer review comments; Get the checks green.
* **Shipping** (stock steps 1 to 6): Verify the change independently; Pick the verified pull request to land; Re-check the verdict still fits the code; Merge and read the result back; Leave it alone while it lands; Stop at the top of the verified set.

A machine card is one pull request, so stock Shipping steps 2, 5 and 6 (which handle a stack of pull requests) will usually pass at once. They are shown as written, not removed.

## 5. The six states of a step

Each reads from shape as well as colour (Todd, 20 Nov: shapes shown in the sample run).

| State | Shape | Meaning |
| -- | -- | -- |
| Running | solid ring, "now" | the step is in progress |
| Passed | filled, tick | done |
| Passed with notes | filled, tick, "(notes)" | done; the notes go into Todd's UAT message |
| Sent back to the builder | dotted edge, return arrow | a new Build round starts; the round number shows |
| Stuck | dashed edge, pause mark, warning box | no activity for 7 minutes; one automatic recovery per card |
| Given up | struck through, solid red warning | stuck a second time; dead-end report posted on the card |

Also shown: "waiting for you" (the UAT stop) and "finished". Nothing running: the three quota bars and a one-line result of the last run.

## 6. Ranges and layout (unchanged)

Tokens into the millions per card; quota 0 to 100% left. Top to bottom: warnings, run panel with stage and steps, quota. Updates on its own. Laptop first; on a phone the stage block and its steps stack.

## 7. Open decisions and facts a builder must not invent

* Todd confirmed this brief, including the section 4 step names and showing stock steps 2, 5 and 6 as written, on 20 Nov at 06:22 PT, after trying a sample run. He may still correct a name after seeing the real screen.
* The tokens-and-quota sources, per the 10 Nov technical check in `docs/advisor-notes/run-view-technical-checks-2026-11-10.md`: live tokens come from the trace and budget records; each subscription has its own reading route and an unreadable one shows "unknown". Not re-verified in this session.
* Dollars always say "estimate".
* The model picker is not part of this screen (Todd, 19 Nov).
* Impeccable's process: shape (this brief), then the confirmed direction (A2), then build through its Start stage with finish review against the direction contract.

Impeccable new-work step 5, for the Run view's surface brief in card-machine (`.impeccable/surfaces/run-view/`), under `## Direction contract`, before any code. Built from brief version 2 and the chosen look A2 ("the larder, bolder"). Confirmed by Todd 20 Nov 2026, 23:49 PT.

## Direction contract

THESIS: The run is a trip through the playbooks the session follows (Feature, Bug fix, Babysit, Shipping), the current one named on the page like a station board's next stop. It refuses the category default: a dark console of rows and numbers.

OWN-WORLD: The larder. Bottle-green header and run panel (#1D3B27, #3D6B2C) on a sage ground (#DCEBCB), ivory cards (#F6F1E4), madder red (#A3212D) only for problems. Zilla Slab for headings and the stage name, Source Sans 3 for everything else. State reads from edges as well as colour: solid running, dashed stuck, dotted sent back, struck through given up.

STORY: Without clicking, Todd knows which stage and step the run is in, whether it is moving, what it has used against each subscription, and anything wrong, in plain words at the top.

FIRST VIEWPORT: Warnings across the top when there are any. Under them the green run panel: card title, running time, tokens, dollars marked "estimate"; the current stage name is the largest text on the page, with its steps in a row and "step N of M". Then the quota bars. Start shows when nothing is running, on the Ready cards listed there, and goes away once a card is running; the UAT stop reads "waiting for you". Signature motion: the marker moves along the stage's row as each step passes; nothing else moves. On a phone everything stacks.

FORM: Operate surface, code-led. Composition: the A2 board, chosen 7 Nov over A, A3 and B. seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
