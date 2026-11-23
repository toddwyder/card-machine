---
name: Mission control
description: The Run view of card-machine, in the larder look
colors:
  bottle: "#1D3B27"
  green: "#3D6B2C"
  sapling: "#5E8A4C"
  sage: "#DCEBCB"
  ivory: "#F6F1E4"
  ink: "#1D3B27"
  ink-soft: "#4A4A3E"
  ink-faint: "#5B5A50"
  madder: "#A3212D"
  madder-wash: "#FBE6E7"
  madder-ink: "#66101A"
  amber: "#B4540A"
  amber-wash: "#FFF1DC"
  amber-ink: "#5E2904"
  track: "#DAD4C4"
  lime: "#9FD06E"
typography:
  display:
    fontFamily: "Zilla Slab, Georgia, serif"
    fontSize: "clamp(1.9rem, 4.2vw, 2.9rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Zilla Slab, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0em"
  body:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "Source Sans 3, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  chip: "999px"
  panel: "20px"
  card: "16px"
  banner: "14px"
  bar: "12px"
  tag: "8px"
  tick: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "24px"
  xl: "32px"
components:
  run-panel:
    backgroundColor: "{colors.bottle}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.panel}"
    padding: "26px 30px 28px"
  stage-now:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.bottle}"
    typography: "{typography.display}"
    rounded: "{rounded.card}"
    padding: "14px 18px 16px"
  stage-past:
    backgroundColor: "{colors.bottle}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.chip}"
    padding: "6px 12px"
  helper-card:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 18px"
  warning-banner:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.banner}"
    padding: "14px 18px"
  quota-row:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.ink}"
    rounded: "{rounded.bar}"
    padding: "0px"
---

# Design System: Mission control

## Overview

**Creative North Star: "The larder"**

Mission control is a station board in a pantry. Bottle green carries the header and the run panel, sage is the ground everything sits on, and ivory cards hold the detail, so the screen reads like a chalked board in a well-stocked kitchen rather than a developer console. The current stage of the run is the largest thing on the page, set in a slab face; everything else steps down in one plain humanist sans.

The system reports, it does not sell. There is no primary action, no chart, no table. Numbers carry units and tabular figures so they do not jitter as they grow, money always says "estimate", and anything the server could not read says "unknown" in words rather than borrowing an old value.

Problems are the only place madder red appears, and every problem has a shape as well as a colour, so the screen still tells the truth in grey print or to a colour-blind eye: a solid border means alive, a dashed border means stuck, a dotted border means sent back, a struck-through name means given up, a ring means a low window.

**Key Characteristics:**

- Green ground and panels, ivory cards, red kept for problems alone.
- One oversized slab heading per screen, the stage, at every width.
- State carried by border shape first, colour second.
- Numbers in tabular figures with their unit attached; dollars labelled "estimate".
- No primary action on the screen; the machine's turn or Todd's turn is stated, never offered as a button.

## Colors

The palette is a larder: two greens, one warm paper, one red for trouble, one amber for caution.

### Primary

- **Bottle green** (#1D3B27): the header bar, the run panel, the focus ring, and body ink. It is the darkest and most used colour in the system.
- **Leaf green** (#3D6B2C): helper card borders, quota bar fills, the tiny state marks inside lists, and the edge of the current-stage block.
- **Sapling** (#5E8A4C): quieter green for finished stage chips' edges and the scrollbar thumb.

### Secondary

- **Madder red** (#A3212D): used only for problems. A stopped run's banner border and struck title, a failed helper's edge, a low window's fill and ring.

### Neutral

- **Sage** (#DCEBCB): the page ground, and the highlight behind an in-progress task.
- **Ivory** (#F6F1E4): cards, the current-stage block, the header's text.
- **Soft ink** (#4A4A3E): the step line, the helper's running time and action times.
- **Faint ink** (#5B5A50): window names, refused reasons, quiet notes.
- **Track** (#DAD4C4): the empty part of a quota bar.
- **Lime** (#9FD06E): the 3px border on the current-stage block, the one edge that marks the stage happening now.

### Named Rules

**The Red For Trouble Rule.** Madder red marks a problem and nothing else. It never decorates a heading, a link, or a bar that is healthy.

**The Estimate Rule.** A dollar figure never appears without the word "estimate" beside it. A percentage appears with the window it belongs to and that window's own reset date.

## Typography

**Display Font:** Zilla Slab (with Georgia, serif)
**Body Font:** Source Sans 3 (with system-ui, sans-serif)

**Character:** A slab face for the few things that are borders and titles, and an open humanist sans for the report underneath. The slab gives the stage name weight without a chart, and the sans keeps long tool names readable at 0.9rem.

### Hierarchy

- **Display** (600, `clamp(1.9rem, 4.2vw, 2.9rem)`, 1.05): the current stage's plain-English name, once per screen and the largest text on the page.
- **Headline** (600, 1.5rem, 1.2): the card title in the run panel, the wordmark in the header, and the "Helpers" and "Against your subscriptions" section titles.
- **Title** (600, 1.25rem, 1.3): each helper's name, and a warning's title in slab.
- **Body** (400, 1rem, 1.5, 70ch max): the step line, warning text, and anything read as a sentence.
- **Label** (700, 0.85rem, 0.04em, uppercase): the "5-hour window" and "week" names above a bar. It is the only uppercase in the system; no eyebrow sits above a heading.

### Named Rules

**The One Display Rule.** Exactly one thing on the screen is display size: the stage the run is in. Card titles and section titles never compete with it.

## Layout

A single column, `min-height: 100vh`, sage ground. The content column is capped at 1200px and padded `28px 32px 44px`, stacking warnings, then the run panel, then helper cards, then quota, with `24px` between sections.

Inside the run panel: the card title on the left and the token and dollar line on the right, wrapping at narrow widths; under them the stage rail, which wraps as a row of small chips each side of the current stage's ivory block, that block taking `flex: 1 1 320px` so it dominates the rail.

Helper cards sit in a grid of `repeat(auto-fill, minmax(260px, 1fr))` with a `14px` gap, so a laptop shows two or three across and a phone shows one.

The quota block is a grid of two columns, a `9rem` name column and a fluid rest. Each window inside is `8.5rem | 1fr | 15rem`: name, bar, and percentage plus reset date.

Below 640px every one of those grids collapses to one column, the page padding drops to `18px 16px 32px`, and the warnings stay above the panel, which stays above the helpers. Nothing scrolls sideways at 390px wide.

## Elevation & Depth

Depth is tonal, not shadowed. The sage ground is the floor, ivory cards sit on it as paper, and the bottle-green panel reads as a board laid on top. Only two shadows exist, both tight and green-tinted, and both are contact shadows that stop a card from floating rather than lifting it: `0 10px 22px -18px rgb(29 59 39 / 55%)` under a helper card and `0 14px 30px -18px rgb(29 59 39 / 60%)` under the run panel.

The current-stage block carries a 3px lime border rather than a halo, so its highlight is an edge like every other state and never a zero-offset shadow.

### Named Rules

**The Flat Papers Rule.** Cards do not hover, lift, or gain shadow on interaction, because nothing on this screen is interactive. Depth comes from colour and edge, never from motion.

## Shapes

Two radii families. Panels and cards are generously round (20px for the run panel and quota block, 16px for helper cards and the current-stage block, 14px for a warning banner); bars and chips are rounder still (12px on a quota bar, 999px on a past-stage pill, a 6px tick behind an in-progress task, 8px on the unknown-reading tag).

Borders do the talking. Every card and banner has a 3px border whose style is a state: **solid** on a live helper or a stopped run's banner, **dashed** on the stuck banner, the ended-without-a-result banner, a stuck helper, a low-quota bar's ring, and the unknown-reading tag, **dotted** on a sent-back stage pill and on the burning-tokens banner. A given-up run's card title is struck through. No state is carried by colour alone.

## Components

### Run panel

- **Shape:** 20px corners, `26px 30px 28px` padding, bottle-green fill with ivory text, no border.
- **Contents:** card title in headline slab on the left, running time and "824 k tokens" and "about $1.24, estimate" in tabular figures on the right; then the stage rail; then the current stage in an ivory block, its state mark set beside the display-size stage name rather than above it, then the step row, and the current step's full name under that.
- **States:** with no run, the panel is replaced by a quiet card that says nothing is running and how the last run ended.

### Stage rail

- **Past stages:** 999px pills, transparent fill, 2px solid sapling border, ivory text at 92%. A stage the run was sent back through (`remediation`) takes a 2px dotted amber border instead.
- **Current stage:** the ivory block above, described in Run panel.
- **Future stages:** not drawn. The rail grows as the machine reaches each stage, so the rail is a record, not a plan.

### Step row

- **Shape:** under the stage name, a wrapped row of 999px pills, each a 15px state mark and a short label; "step N of M" sits to their right in 0.8rem uppercase with tabular figures, and wraps to its own line on a phone.
- **Contents:** the Lead's own task list as the machine publishes it, ordered by the number in the step's id. Labels are cut to their first sentence and 42 characters so the row stays a row; the full name stays on the step line below.
- **States:** done is a sapling edge with a tick; the step in hand is sage fill, a 2px solid green edge and 600 weight, marked with a ring and centre dot; pending is a track edge with a faint ring; a step carrying `skip:` in its title takes a dotted edge with its name struck through and a slashed ring. No state relies on colour alone.

### Warning banner

- **Shape:** 14px corners, `14px 18px` padding, 3px border, mono-free text; the title in 1.2rem slab sits above one or two sentences of what is wrong.
- **Stuck and ended-without-a-result:** amber wash and text, dashed amber border. **Burning tokens fast:** the same wash, dotted border. **Stopped** and **Quota low:** madder wash and text, solid border. A stopped run's banner strikes its title through.
- **Wording:** a banner says what is wrong and never suggests a fix; the numbers in it come from the settings file (7 minutes quiet, 20% left, 100,000 tokens in one call).

### Helper card

- **Shape:** 16px corners, 3px solid green border, ivory fill, `16px 18px` padding, contact shadow.
- **Contents:** helper name as a 1.25rem title, a state line with running time and token count, then the actions newest first (15px mark, name, time right-aligned in tabular figures), then the helper's own task list; the action list scrolls inside `15rem` rather than growing the page.
- **States:** live is solid green; stuck is amber wash with a dashed amber border; failed is a madder border; a quiet helper reads "No actions yet." in faint ink.

### Quota row

- **Shape:** two-column grid, `9rem` name in 1.1rem slab, then one block per window.
- **Window:** uppercase 0.85rem label, a 24px bar with a 12px radius on a `--track` ground filled in leaf green, then "N% left · refills DATE" in tabular figures.
- **Low window (20% or less):** the fill turns madder and the bar gains a 3px dashed madder outline, so it is ringed as well as coloured.
- **Unknown reading:** a dashed madder tag that says "Reading failed, unknown" over a small caption naming the reason (no stored sign-in, sign-in expired, reading failed, timed out). No number, no stale value, and no warning.

## Do's and Don'ts

### Do:

- **Do** keep the stage name the largest text on the page at every width, via `clamp(1.9rem, 4.2vw, 2.9rem)`.
- **Do** give every state a border shape: solid alive, dashed stuck or ended without a result, or unknown or low, dotted sent back, struck through given up.
- **Do** write numbers in tabular figures with their unit ("12 minutes", "824 k tokens", "about $0.18, estimate").
- **Do** let the stage rail grow as stages are reached, so it shows where the run has been.
- **Do** put warnings above everything, in the order stopped, stuck, quota low, burning fast, and read them out of `dashboard/settings/run-view.json`, and read them out of `dashboard/settings/run-view.json`.
- **Do** say "unknown" with its reason when a reading fails, and drop the number entirely.

### Don't:

- **Don't** add a primary action, button, form, or link on the Run view; it reports and nothing else.
- **Don't** use madder red for anything healthy, and don't rely on colour without a shape.
- **Don't** show a dollar figure without "estimate" beside it, or a percentage without its window and reset date ("Claude: 11% of this 5-hour window left").
- **Don't** reach for a dark console look, a monospace body face, or purple; the look is bottle green on sage with ivory paper.
- **Don't** draw a data table, a chart, or a wall of text where a card, a bar, or one sentence will do.
- **Don't** show card numbers, IDs, or agent slugs where a plain-English name exists; the stage table in `dashboard/lib/stage-labels.mjs` supplies those names.
