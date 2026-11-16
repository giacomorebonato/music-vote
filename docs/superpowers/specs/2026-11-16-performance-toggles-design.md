# Host performance toggles — design

Date: 2026-11-16
Status: approved approach (A — exclusive toggle group); doc for final sign-off

## Intent

The host console's **Build up**, **Drop**, **Strip back**, and **Lock this
groove** controls must read as on/off toggles. Today the three performance
buttons show no state, cannot be switched off explicitly, and the active
layer can disappear silently (crowd evolution or an audience moment ending).
The lock swaps its label between two actions instead of reading as one
switch.

## Goals

- Each of the four controls visibly shows its current on/off state.
- Tapping an active performance layer turns it off (back to the plain groove).
- Tapping an inactive layer switches to it (existing replace semantics).
- The displayed state always matches what is actually playing.
- Lock keeps current server semantics; only presentation changes.

## Non-goals

- Stacking multiple performance layers (build + strip simultaneously).
- Changing audience-side "Ask for a moment" (phones stay one-shot requests).
- Changing when crowd evolution runs or what it generates.

## Approaches considered

- **A. Exclusive toggle group (chosen).** One layer active at most, matching
  the existing marker-replace backend. Tap active → off via a new `clear`
  action. Smallest change; musically sensible (build-up over breakdown is
  contradictory).
- **B. Independent stacking switches.** Rejected: the layer representation is
  a single marker comment; stacking needs a new multi-layer format plus
  crowd-evolution interplay rework, for a musically dubious payoff.

## Design

**Shared layer state.** Move the performance marker/transform constants from
`backend/music/performance.ts` into `@shared` (single source of truth), plus
a helper `activePerformanceAction(code)` that reads the marker line and
returns `'build' | 'drop' | 'strip' | null`. Backend imports it; frontend uses
it to derive the active toggle from the code it is playing.

**Backend `clear` action.** `performanceActionSchema` gains `'clear'`.
`performancePattern(code, 'clear')` strips the marker and returns the base
groove. `perform` with `clear` on code that has no marker is a no-op (no poll
row, no version) so a racing toggle click can't create a pointless
"change". Otherwise `clear` follows the existing candidate/confirm flow.

**Frontend toggles.** Host console (and the shared `performanceControls`
JSX used by the performance stage):

- The three layer buttons keep constant labels and testids; styling swaps
  between outline (off) and solid (on) via `aria-pressed`, derived from the
  applied pattern code. Tapping the active one sends `clear`.
- The lock button keeps label "Lock this groove" and testid `groove-lock`
  permanently; `aria-pressed` + solid styling show locked state. The
  "Release groove" label is dropped.
- Status line and disabled-while-changing behavior unchanged.

**Auto-off is truthful.** Because state derives from the playing code, a
layer removed by crowd evolution or an ended audience moment flips its
toggle off by itself.

## What's left to the builder

- Exact solid/off button classes (daisyUI variants) — builder's call.
- Unit tests: `clear` strips marker, no-op without marker, replacement
  semantics unchanged; e2e: tap-active clears layer, lock shows state with
  constant label.
