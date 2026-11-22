---
name: Julia Machine â€” Mission Control
description: "The Larder: a bottle-green station board on sage ground with warm ivory cards, ochre amber for stalls, and madder red strictly for problems."
colors:
  bottle-forest: "#1D3B27"
  larder-leaf: "#3D6B2C"
  sprout-highlight: "#9FD06E"
  forest-edge: "#5E8A4C"
  forest-deep: "#13281A"
  ochre-amber: "#B4540A"
  sent-back-gold: "#D8A236"
  sent-back-rim: "#F2C96B"
  warm-amber-wash: "#FFF1DC"
  amber-highlight: "#F7D9B0"
  amber-ink: "#5E2904"
  madder-red: "#A3212D"
  madder-wash: "#FBE6E7"
  madder-ink: "#66101A"
  sage-ground: "#DCEBCB"
  sage-deep: "#C7D6BE"
  larder-ivory: "#F6F1E4"
  ivory-track: "#DAD4C4"
  pine-ink: "#1A2A1E"
  moss-ink: "#3E4F3A"
  forest-ivory-soft: "#D5E3CC"
  stone-unknown: "#878475"
  stone-ink: "#525144"
typography:
  display:
    fontFamily: "Zilla Slab, serif"
    fontSize: "clamp(2.5rem, 5vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Zilla Slab, serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Zilla Slab, serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.25
rounded:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "14px"
  xl: "16px"
  2xl: "20px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "22px"
  xl: "28px"
  2xl: "32px"
components:
  header-bar:
    backgroundColor: "{colors.bottle-forest}"
    textColor: "{colors.larder-ivory}"
    padding: "0 32px"
    height: "68px"
  warning-stuck:
    backgroundColor: "{colors.warm-amber-wash}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.lg}"
    padding: "14px 18px"
  warning-problem:
    backgroundColor: "{colors.madder-wash}"
    textColor: "{colors.madder-ink}"
    rounded: "{rounded.lg}"
    padding: "14px 18px"
  run-panel:
    backgroundColor: "{colors.bottle-forest}"
    textColor: "{colors.larder-ivory}"
    rounded: "{rounded.2xl}"
    padding: "28px 32px"
  stage-tile-current:
    backgroundColor: "{colors.larder-ivory}"
    textColor: "{colors.bottle-forest}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  stage-tile-passed:
    backgroundColor: "{colors.larder-leaf}"
    textColor: "{colors.larder-ivory}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  step-chip-running:
    backgroundColor: "{colors.larder-ivory}"
    textColor: "{colors.bottle-forest}"
    rounded: "{rounded.md}"
    padding: "9px 14px"
  step-chip-stuck:
    backgroundColor: "{colors.warm-amber-wash}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.md}"
    padding: "9px 14px"
  step-chip-given-up:
    backgroundColor: "{colors.madder-wash}"
    textColor: "{colors.madder-ink}"
    rounded: "{rounded.md}"
    padding: "9px 14px"
  helper-card-working:
    backgroundColor: "{colors.larder-ivory}"
    textColor: "{colors.pine-ink}"
    rounded: "{rounded.xl}"
    padding: "16px 18px"
  helper-card-stuck:
    backgroundColor: "{colors.warm-amber-wash}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.xl}"
    padding: "16px 18px"
  quota-panel:
    backgroundColor: "{colors.larder-ivory}"
    textColor: "{colors.pine-ink}"
    rounded: "{rounded.2xl}"
    padding: "24px 28px"
  quota-track:
    backgroundColor: "{colors.ivory-track}"
    rounded: "{rounded.md}"
    height: "24px"
---

# Design System: Julia Machine â€” Mission Control

## Overview

**Creative North Star: "The Larder"**

Mission Control is built around The Larder: a calm, daylight-legible station board dressed in deep bottle green, sage plaster, and warm ivory pantry cards. Rather than mimicking a dark developer terminal filled with scrolling logs and dense data tables, the interface presents an active run the way a railway departure board presents a trainâ€”four named stages in sequence, the current stage set as the largest headline on the page, and plain-English step chips moving steadily across the track.

The system is designed for a single non-programmer operator glancing at progress from a laptop while working or checking in from a phone away from the desk. Every surface earns its place through high-contrast tonal separation and crisp geometric borders instead of drop shadows, frosted glass, or decorative chrome. Motion is strictly functional: only the active step marker gliding along the row and each newly arrived helper action sliding into the top of its card ever move.

This visual world explicitly rejects the dark developer-tool aesthetic (no black interfaces, no monospace type, no glowing purple indicators) as well as the previous builder-default dashboard (light grey ground, plain white cards, mint and indigo accents). Colour never carries meaning alone: border line style, text decoration, and simple inline icons reinforce every operational state so a glance from across the room reads immediately.

**Key Characteristics:**
- Daylight-first palette: bottle green (#1D3B27) and leaf green (#3D6B2C) anchored on a soft sage ground (#DCEBCB) with warm ivory (#F6F1E4) cards.
- Editorial slab-and-sans pairing: Zilla Slab for station-board headings and titles paired with Source Sans 3 (with tabular numerals) for all body copy, labels, and figuresâ€”never monospace.
- Flat, matte surface hierarchy: zero drop shadows on panels or cards; depth is created strictly through tonal contrast and 2pxâ€“3px semantic borders.
- Redundant state encoding: solid edges for active or passed, dashed edges for stuck or low quota, dotted edges for sent-back loops, and solid madder with strikethrough for given-up states.
- Restrained, purposeful motion: only the active step marker glide (420ms) and top-of-card helper action entrance (360ms) animate, both disabled under reduced-motion preferences.

## Colors

A daylight-first botanical palette grounded in sage plaster and deep bottle green, warmed by ivory pantry cards, with ochre-amber reserved for stalls and madder red strictly gated to problems.

### Primary
- **Bottle Forest** (`bottle-forest`): Primary dark surface for the top header bar and the main run and idle panels, plus high-contrast ink inside active ivory tiles and focus outlines.
- **Larder Leaf** (`larder-leaf`): Completed-state fill for passed stage tiles, passed step chips, healthy subscription quota bars (>40%), working helper card borders, and scrollbar thumbs.
- **Sprout Highlight** (`sprout-highlight`): High-visibility active accent used for the live indicator dot, the step counter readout, the current stage tile border, and the gliding active step marker.
- **Forest Edge** (`forest-edge`): Muted structural border for upcoming stage tiles, pending step chips, and finished status pills on bottle-green surfaces.
- **Forest Deep** (`forest-deep`): Grounding 2px bottom rule beneath the header bar.

### Secondary
- **Ochre Amber** (`ochre-amber`): Dashed border and icon accent for stuck warnings, stuck stage tiles, stuck step chips, stuck helper cards, and medium subscription quota fills (21â€“40%).
- **Sent-Back Gold** (`sent-back-gold`): Border accent for waiting-for-you status pills and sent-back semantic indicators.
- **Sent-Back Rim** (`sent-back-rim`): Dotted border highlight for round-counter badges, sent-back stage tiles, and sent-back step chips on dark bottle-green panels.
- **Warm Amber Wash** (`warm-amber-wash`): Soft cream-amber surface for stuck warning boxes, stuck helper cards, stuck chips/tiles, and waiting-for-you status pills.
- **Amber Highlight** (`amber-highlight`): Emphasised row fill for the active stuck action inside a stuck helper card.
- **Amber Ink** (`amber-ink`): High-contrast dark brown-amber text paired with warm amber surfaces.

### Tertiary
- **Madder Red** (`madder-red`): Solid 3px border, low-quota bar fill (â‰¤20%), dashed low-quota track outline, and problem accent strictly reserved for dead-end failures and critical quota exhaustion.
- **Madder Wash** (`madder-wash`): Pale rose surface for solid problem warning banners, given-up tiles and chips, and stopped helper cards.
- **Madder Ink** (`madder-ink`): Deep crimson-brown ink paired with madder wash surfaces for legibility.

### Neutral
- **Sage Ground** (`sage-ground`): Full-viewport matte canvas background and subtle highlight fill for the current action inside a working helper card.
- **Sage Deep** (`sage-deep`): Subtle structural border around the ivory quota panel and scrollbar track background.
- **Larder Ivory** (`larder-ivory`): Warm off-white card surface for working helper cards, the subscription quota panel, the active stage tile, the running step chip, and primary ink on bottle-green panels.
- **Ivory Track** (`ivory-track`): Unfilled bar track inside the subscription quota panel.
- **Pine Ink** (`pine-ink`): Primary dark-green-charcoal body and heading ink on sage and ivory surfaces.
- **Moss Ink** (`moss-ink`): Secondary muted ink for helper metadata, legends, and healthy quota reset captions.
- **Forest Ivory Soft** (`forest-ivory-soft`): Softened sage-ivory text for secondary metadata, live connection status, and upcoming tiles inside bottle-green panels.
- **Stone Unknown** (`stone-unknown`): Dashed border stroke for subscription tracks whose quota cannot currently be read.
- **Stone Ink** (`stone-ink`): Muted olive-stone ink paired with unknown quota readouts.

### Named Rules
**The Problem-Only Madder Rule.** Madder red (#A3212D on #FBE6E7 wash) appears exclusively for genuine problems: a stopped or given-up run or helper, a solid problem warning banner, or a subscription at or below 20% remaining. Never use red for routine emphasis, decorative badges, or recoverable stalls.

**The Warm-Amber Stall Rule.** Recoverable stalls and waiting-for-you states use warm ochre-amber (#B4540A on #FFF1DC), never madder red, so a pause that can self-recover stays unmistakably separate from a dead-end failure.

## Typography

**Display Font:** Zilla Slab (with `serif` fallback; weights 600, 700)
**Body Font:** Source Sans 3 (with `sans-serif` fallback; weights 400, 600, 700)
**Label/Mono Font:** None (Source Sans 3 with `tabular-nums` handles all labels and numeric readouts; monospace is prohibited)

**Character:** Sturdy, warm, and legible at a glance. Zilla Slab brings printed station-board authority to stage names and card headers, while Source Sans 3 keeps plain-English steps, helper actions, and usage estimates crisp and human.

### Hierarchy
- **Display** (`display` â€” 700, `clamp(2.5rem, 5vw, 3.5rem)`, line-height 1.04, tracking -0.02em): Reserved exclusively for the current stage heading inside the run panel so it dominates the first viewport.
- **Headline** (`headline` â€” 700, 26px / 1.625rem, line-height 1.15, tracking -0.01em): Used for the top-bar brand mark, the idle panel heading (scaling up to `clamp(2rem, 4vw, 2.75rem)`), and section titles ("Helpers working", "Left in each subscription").
- **Title** (`title` â€” 600â€“700, 20pxâ€“28px / 1.25remâ€“1.75rem, line-height 1.15): Used for the active card title (`clamp(1.375rem, 2.2vw, 1.75rem)`), station-board stage tile names (22px), token counts (22px), and helper card names (20px).
- **Body** (`body` â€” 400â€“600, 15pxâ€“18px, line-height 1.35â€“1.45): Used for warning copy (17pxâ€“18px), usage summaries (16px), step chip labels (15px), and helper action rows (15px).
- **Label** (`label` â€” 600â€“700, 12pxâ€“14px, line-height 1.25): Used for live connection status, stage tile status/step counts, helper timestamps, legends (14px), and inline step tags such as "now" or round counters (12pxâ€“13px).

### Named Rules
**The No-Monospace Rule.** Never use monospace type anywhere in Mission Control. Numeric figuresâ€”token counts, elapsed durations, step counters, and quota percentagesâ€”use Source Sans 3 or Zilla Slab with tabular numerals so numbers align cleanly without turning the board into a terminal.

**The Stage-Is-Headline Rule.** The current stage name is always the largest text on the page (clamp(2.5rem, 5vw, 3.5rem)), ensuring a three-foot glance answers where the run stands before any secondary metric.

## Layout

Mission Control uses a centered single-column vertical flow capped at `1200px` (`28px 32px 48px` desktop main padding, `28px` vertical gap between bands) beneath a full-bleed `68px` bottle-green header bar. Reading priority flows strictly top to bottom:

1. **Warnings strip** (rendered only when warnings exist): wrapping flex row of alert banners (`flex: 1 1 340px`, `12px` gap).
2. **Bottle-green run panel** (`28px 32px` padding, `22px` internal vertical gap): top metadata row (card title, status pill, right-aligned usage summary), current stage hero row, 4-column responsive station-board stage grid (`repeat(auto-fit, minmax(175px, 1fr))`, `10px` gap), and a top-ruled (`1px solid #35583D`) wrapping row of step chips (`10px` gap).
3. **Helpers section**: auto-filling card grid (`repeat(auto-fill, minmax(240px, 1fr))`, `16px` gap) followed by a compact inline legend.
4. **Subscription quota panel**: ivory container (`24px 28px` padding) holding three-column rows (`150px / minmax(0, 1fr) / 230px`, `16px` vertical gap) for name, bar track, and percentage/reset readout.

**Responsive adaptation:**
- Below `859px`, the station-board stage grid collapses to a single vertical column.
- Below `720px` (phone viewport), horizontal padding tightens (`18px` header, `16px` main), vertical band gap tightens to `20px`, panel radii step down from `20px` to `16px`, usage summary wraps full-width, step chips stack full-width, and helper cards and quota rows collapse to single-column stacks.

## Elevation & Depth

Mission Control is an intentionally flat, matte board. Panels, warning boxes, stage tiles, step chips, and helper cards cast no drop shadows and use no backdrop blur. Visual depth comes from strong figure-ground contrastâ€”deep bottle-green (`bottle-forest`) and warm ivory (`larder-ivory`) resting on the calm sage (`sage-ground`) canvasâ€”paired with decisive `2px`â€“`3px` borders.

### Shadow Vocabulary
- **Running Dot Ring** (`box-shadow: 0 0 0 3px #3D6B2C`): A crisp, unblurred 3px solid halo around the 11px sprout-green running dot inside the dark running status pill. This is the sole `box-shadow` in the system.

### Named Rules
**The Flat-Matte Larder Rule.** Surfaces rest flat on the sage ground with zero drop shadows or ambient glows. Hierarchy is created solely through bottle-green versus ivory tonal contrast and crisp 2pxâ€“3px borders.

## Shapes

Corners follow a deliberate scale tied to container mass:
- **Top-level panels** (run panel, idle panel, quota panel): generously rounded `20px` on desktop, tightening to `16px` on phones (`â‰¤720px`).
- **Helper cards**: rounded `16px`.
- **Stage tiles & warning banners**: rounded `14px`.
- **Step chips, gliding active marker, & quota tracks**: rounded `12px` (quota fill rounds `12px 0 0 12px` on the left edge).
- **Highlighted action rows**: softly rounded `8px`.
- **Focus rings**: `6px` radius with a `3px solid` bottle-forest outline offset by `3px`.
- **Status pills, round badges, step tags, & live dots**: full pills (`999px`) or circles (`50%`).

Edge geometry is a primary carrier of state across every component:
- **Solid (`2px`â€“`3px`)**: active, working, passed, upcoming, or given-up/stopped (paired with madder and strikethrough).
- **Dashed (`2px`â€“`3px`)**: stuck warnings, stuck tiles/chips/cards, low-quota track outline (`3px dashed` offset `3px`), and unknown quota tracks (`2px dashed`).
- **Dotted (`2px`)**: sent-back stages, sent-back steps, and round-counter badges.
- **Line-through (`2px` thickness)**: applied to step names and helper titles in given-up or stopped states.

### Named Rules
**The Shape-Plus-Colour Rule.** Every operational state must read from border geometry, text decoration, and an inline SVG icon as well as colour: solid edge for running or passed, dashed edge plus pause mark for stuck, dotted edge plus return arrow for sent back, and solid madder edge plus cross and strikethrough for given up.

## Components

Mission Control's Run view is an ambient operate surface with no primary action buttons or text inputs. Documented components reflect only the live primitives built into the board.

### Header Bar
Full-bleed bottle-green anchor carrying the brand wordmark and live polling indicator.
- **Surface & Border:** Bottle Forest (`bottle-forest`) background with a `2px solid` Forest Deep (`forest-deep`) bottom rule; `68px` min-height (`60px` on phone), `0 32px` desktop inner padding.
- **Content:** Zilla Slab 700 brand heading (`26px`) on the left; inline live status (`14px` Source Sans 3 600, `forest-ivory-soft`) with a `9px` circular dot (`sprout-highlight` when live, `#E8944A` when reconnecting) on the right.

### Warning Boxes
High-visibility plain-English alerts pinned above the run panel whenever a stall or failure occurs.
- **Shape & Padding:** Rounded `14px` (`lg`), `14px 18px` padding, flex row with `12px` gap and leading inline SVG icon.
- **Stuck Variant:** Warm Amber Wash (`warm-amber-wash`) background, `3px dashed` Ochre Amber (`ochre-amber`) border, Amber Ink (`amber-ink`) text, Pause icon.
- **Problem Variant:** Madder Wash (`madder-wash`) background, `3px solid` Madder Red (`madder-red`) border, Madder Ink (`madder-ink`) text, Alert triangle icon.

### Run Panel & Station-Board Stage Tiles
The dark bottle-green focal board showing the active card, current stage hero, four-stage track, and step chips.
- **Container:** Bottle Forest (`bottle-forest`), `20px` radius (`16px` on phone), `28px 32px` padding.
- **Status Pills:** Full pill (`999px`), `5px 14px` padding, `16px` bold text, `2px` border matching state (dark leaf green for running, amber solid for waiting for you, leaf green for finished, amber dashed for stuck, madder solid for problem/stopped).
- **Stage Tiles:** Rounded `14px`, `14px 16px` padding, stacked status label + Zilla Slab `22px` stage name + step count. Six states: Passed (`larder-leaf` solid), Current (`larder-ivory` fill with `3px solid` `sprout-highlight`), Upcoming (transparent with `2px solid` `forest-edge`), Sent Back (`#27442E` with `2px dotted` `sent-back-rim`), Stuck (`warm-amber-wash` with `3px dashed` `ochre-amber`), Given Up (`madder-wash` with `3px solid` `madder-red` and struck-through name).

### Step Chips & Gliding Marker
Plain-English step chips inside the current stage with the system's primary signature motion.
- **Shape & Padding:** Rounded `12px` (`md`), `9px 14px` padding, `15px` Source Sans 3 600, inline state icon + label + optional pill tag (`now`, notes, or `round N`).
- **States:** Running (`larder-ivory` fill, `bottle-forest` ink), Passed / Passed with Notes (`larder-leaf` fill), Sent Back (`#2A4630` fill, `2px dotted` `sent-back-rim`), Stuck (`warm-amber-wash`, `2px dashed` `ochre-amber`), Given Up (`madder-wash`, `2px solid` `madder-red`, `2px` line-through), Pending (transparent, `2px solid` `forest-edge`).
- **Signature Motion:** An absolute `3px solid` `sprout-highlight` frame (`12px` radius) glides smoothly between active chips (`transform`, `width`, `height` over `420ms cubic-bezier(0.22, 1, 0.36, 1)`), disabled under `prefers-reduced-motion`.

### Helper Cards
Warm ivory pantry cards showing each active helper and its chronological action list.
- **Corner Style & Padding:** Rounded `16px` (`xl`), `16px 18px` padding, `12px` internal gap.
- **State Variants:** Working (`larder-ivory` fill, `3px solid` `larder-leaf`), Stuck (`warm-amber-wash` fill, `3px dashed` `ochre-amber`), Stopped (`madder-wash` fill, `3px solid` `madder-red`, struck-through title).
- **Action Rows & Signature Motion:** Vertical list (`6px` gap) with leading state icons (tick, play, pause, circle-dot). The active row receives a full-bleed `8px`-rounded highlight (`sage-ground` when working, `amber-highlight` when stuck). Newly arrived actions enter at the top with a `360ms cubic-bezier(0.22, 1, 0.36, 1)` slide-and-focus reveal (`translateY(-8px)` and `blur(2px)` to rest), disabled under `prefers-reduced-motion`.

### Subscription Quota Bars
At-a-glance headroom gauges inside an ivory panel at the base of the board.
- **Container:** Larder Ivory (`larder-ivory`), `2px solid` Sage Deep (`sage-deep`), `20px` radius, `24px 28px` padding.
- **Tracks & Fills:** `24px` tall, `12px` radius on Ivory Track (`ivory-track`). Fill colour steps by headroom: Healthy (`>40%`, `larder-leaf`), Medium (`21â€“40%`, `ochre-amber`), Low (`â‰¤20%`, `madder-red` fill plus `3px dashed` `madder-red` track outline offset `3px` and Alert icon), Unknown (`#EAE5D6` fill with `2px dashed` `stone-unknown` border and Unknown icon).

## Do's and Don'ts

### Do:
- **Do** follow The Problem-Only Madder Rule: reserve #A3212D and #FBE6E7 strictly for stopped/given-up states, solid problem warnings, and subscriptions at or below 20% remaining.
- **Do** follow The Shape-Plus-Colour Rule: pair every state colour with its matching border pattern (solid, dashed, or dotted), inline SVG icon, and strikethrough on given-up labels.
- **Do** keep the current stage heading as the largest text on the page (clamp(2.5rem, 5vw, 3.5rem)) in Zilla Slab 700, with Source Sans 3 and tabular-nums for all metrics.
- **Do** label every dollar figure explicitly as an estimate and name work by its plain-English title rather than card numbers or internal IDs.
- **Do** stack stage tiles, step chips, helper cards, and quota rows into clean single columns below 720px (and collapse the stage board below 859px) so phone check-ins stay effortless.
- **Do** honor prefers-reduced-motion by disabling both the 420ms step-marker glide and the 360ms helper action slide-in.

### Don't:
- **Don't** introduce a dark developer-tool aesthetic: no black backgrounds, no monospace typography, and no purple indicator dots.
- **Don't** revert to the retired builder-default look of light grey backgrounds, plain white cards, or mint and indigo accents.
- **Don't** add drop shadows, ambient glows, or glassmorphism to panels, cards, stage tiles, or chipsâ€”follow The Flat-Matte Larder Rule.
- **Don't** render dense data tables; communicate progress, helper activity, and subscription headroom with visual tiles, action rows, and quota bars.
- **Don't** animate ambient chrome, progress fills, or pulsing status dots; only the gliding active step marker and incoming helper action rows may move.
- **Don't** name specific AI models in documentation or static design copy; refer to subscriptions or kinds of model (free or paid) instead.
