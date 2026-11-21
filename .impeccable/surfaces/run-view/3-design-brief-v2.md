# Run view: design brief, version 2 (20 Nov 2026; confirmed by Todd, 06:22 PT)

Replaces the parts of the 7 Nov brief (`.impeccable/surfaces/run-view/1-design-brief.md`, confirmed by Todd 7 Nov, 17:45) that the 17 to 20 Nov decisions changed. Anything not listed under "What changed" is unchanged from 7 Nov, including the chosen look A2 ("the larder, bolder", `chosen-design-A2-larder-bolder.html`) and the interview answers. Shape stops here: this brief writes no code.

## What changed since 7 Nov, and who said so

1. **Home.** The Run view is mission control's first screen, in the machine's own repository (`toddwyder/card-machine`), not a tab on the model picker page. Its look becomes mission control's look (Todd, 19 Nov).
2. **Stage names are pstack's.** Step names are plain English (Todd, 19 Nov).
3. **The design covers every Shipping step and every state a step can be in, up front.** Each later Shipping slice adds only its own detail pieces (Todd, 19 Nov, late).
4. **Helpers show actions; the stage shows steps** (Todd, 20 Nov, option 1, after trying a sample run). The 10 Nov choice of actions for helpers stands. Each stage shows its steps in a row; the current stage shows "step N of M".
5. **Slimmed to what is needed to see a run and its problems** (Todd, 17 Nov). The Run view is where machine work is proven, so it must show a planted problem as Todd would see it.

## 1. Job and audience (unchanged)

Todd, alone, during a run; mostly laptop, sometimes phone. Not a programmer. Opens it to answer, without clicking: where is the run, what has it used, is anything wrong.

## 2. Outcome and proof

* At a glance: the stage (largest thing on the page), the step inside it, whether the run is running at all, tokens so far, each subscription against its quota, any active warning.
* Each helper on its own card: what it is doing now and the actions it has taken, newest first, each marked done, now or stuck.
* Warnings say what is wrong and nothing more. Starting rules, all Todd's: stopped (status stopped or failed); stuck (7 minutes with no activity, 28 Oct); quota low (20% or less left, 7 Nov); burning tokens fast (any one agent's model call over 100,000 tokens, naming the agent; starting value, to be reset from measured data).
* The machine stops for Todd at only two points: his UAT and anything irreversible (19 Nov). The Run view shows the UAT stop as "waiting for you".

## 3. Selected direction (unchanged): A2

Bottle-green header and run panel on a sage ground, ivory cards, slab headings, plain sans for everything else. Warning boxes at the top (dashed for stuck, solid for quota). Quota as one bar per subscription with percentage left and reset date, the low one ringed. State reads from shape as well as colour.

## 4. Stages and steps (the new part)

Stage and step names follow pstack's playbooks as written (read 20 Nov: `.agents/skills/poteto-mode/playbooks/babysit.md` and `shipping.md`), in plain English. The machine's own additions sit on top, as Todd said on 19 Nov. Working names for Todd to correct.

* **Build** (outside the Shipping plan): Read the card; Plan the slices; Build the slices; Open the pull request.
* **Babysit** (stock, in its own order: conflicts, threads, CI): Check for merge conflicts; Answer review comments; Get the checks green.
* **Shipping** (stock steps 1 to 6): Verify the change independently; Pick the verified pull request to land; Re-check the verdict still fits the code; Merge and read the result back; Leave it alone while it lands; Stop at the top of the verified set.
* **After merge** (the machine's additions, Todd's decisions 6, 14 and 5): Wait for main's checks; Smoke test the live site; Your UAT on the live site.

A machine card is one pull request, so stock steps 2, 5 and 6 (which handle a stack of pull requests) will usually pass at once. They are shown as written, not removed.

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

Helpers at once 1 to 5 or more; tokens into the millions per card; quota 0 to 100% left. Top to bottom: warnings, run panel with stage and steps, helpers, quota. Updates on its own. Laptop first; on a phone stages and helper cards stack.

## 7. Open decisions and facts a builder must not invent

* Todd confirmed this brief, including the section 4 step names and showing stock steps 2, 5 and 6 as written, on 20 Nov at 06:22 PT, after trying a sample run. He may still correct a name after seeing the real screen.
* The tokens-and-quota sources, per the 10 Nov technical check in `docs/advisor-notes/run-view-technical-checks-2026-11-10.md`: live tokens come from the trace and budget records; helper actions from the trace; each subscription has its own reading route and an unreadable one shows "unknown". Not re-verified in this session.
* Dollars always say "estimate".
* The model picker is not part of this screen (Todd, 19 Nov).
* Impeccable's process: shape (this brief), then the confirmed direction (A2), then build through its Start stage with finish review against the direction contract.