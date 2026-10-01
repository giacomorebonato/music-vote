# Task 13 Report: Vote page (poll UI, states, summary)

Commit: `ce7e6b0` — `feat(vote): anonymous vote page — poll, countdown, ended summary`

## What I implemented

- `frontend/components/poll-card.tsx` (new)
  - `PollCard` — the single open poll on the phone. Renders the question plus
    **one button per entry of `poll.options`** (key + label), a `m:ss` closesAt
    countdown, and a "Vote counted" state. Fully prop-driven (`question`,
    `options`, `selectedKey`, `voted`, `countdownSeconds`, `pending`, `onVote`)
    so both pre-vote and voted states render directly from props.
  - `PollTimeline` — the ended screen: renders only polls with
    `winningOption !== null` (winner badge + "music changed" when applied).
  - `formatCountdown(seconds)` — `m:ss`, clamped at zero.
  - `PollCardPoll` / `SummaryPoll` / `PollOption` types.
- `frontend/routes/vote.tsx` (new)
  - `VoteRoute({ roomId })` — the anonymous page. On mount claims
    `voting.claimSession()` once; reads `voting.currentPoll`; drives
    transitions from `useRoomChannel(roomId)` (`poll_opened`, `poll_closed`,
    `room_ended`) plus a 1s ticker; `voting.summary` is enabled only when the
    room is `ended`.
  - `VoteView` — presentational page body (loading / lobby / live-poll /
    live-waiting / outro / ended), kept prop-driven and exported for tests.
- `frontend/router.tsx` (modified) — registered `/r/$id` with a
  `VoteRouteContainer` that reads `$id` from route params (same pattern as the
  host route, avoiding a router↔route import cycle).
- Tests: `frontend/components/__tests__/poll-card.test.tsx`,
  `frontend/routes/__tests__/vote-view.test.tsx`.

The page is anonymous (no auth guard, no host-only APIs; only `voting.*`).

## Carried rulings

1. **Generic option buttons (no yes/no hardcoding).** `PollCard` maps
   `poll.options` and sends `option.key` as `choice`. The test renders
   wrap/continue and asserts both option testids; the live dev run rendered
   yes/no for the evolution poll. No `yes`/`no` literal exists in the card or
   page.
2. **Summary filters to decided polls.** `PollTimeline` filters
   `winningOption !== null` before rendering. Unit test feeds a null-winner
   poll and asserts it is absent; the live run produced a skipped poll
   (`winningOption: null`) that was correctly omitted from a 1-item timeline.
3. **Reconcile, do not trust a stale poll.** Implemented three ways:
   - **WS reconnect** → `onReconnect: reconcile` refetches `currentPoll`
     unconditionally (may have missed lifecycle while the socket was down).
   - **`closesAt` elapsing / stale open poll** → an expired poll is treated as
     gone (`activePoll = null` → waiting) and `currentPoll` is refetched once
     per poll id. This covers a host `skip` (which publishes **no** audience
     `poll_closed`) and a `currentPoll` that returns an open poll already past
     `closesAt` (Task 10 minor).
   - **`castVote` rejection** → `ALREADY_VOTED` shows the counted state
     (server keeps no per-phone choice to re-highlight); any other error
     (`POLL_CLOSED`, stale poll) is surfaced and triggers a `currentPoll`
     refetch.
   `poll_opened` / `poll_closed` / `room_ended` also refetch (event payloads
   carry option labels only — no keys — and no tally, so `currentPoll` is the
   source of truth).

   **Skip case verdict: fully handled.** The dev run clicked host "Skip poll"
   during poll 2; the phone showed **no** WS event, kept the now-dead poll
   until its `closesAt` elapsed, then reconciled itself to the wait state
   within the 15s assertion window. No backend change was needed.

## TDD evidence

RED (before implementation):

```
$ bun test frontend/components/__tests__/poll-card.test.tsx frontend/routes/__tests__/vote-view.test.tsx
error: Cannot find module '@frontend/components/poll-card' ...
error: Cannot find module '@frontend/routes/vote' ...
 0 pass, 2 fail, 2 errors
```

GREEN:

```
$ bun test frontend/components/__tests__/poll-card.test.tsx frontend/routes/__tests__/vote-view.test.tsx
8 pass, 0 fail, 31 expect() calls

$ bun run check
biome: 0 errors (warnings only, matching the repo baseline)
typecheck: clean   knip: clean
142 pass / 0 fail (was 134) — ✓ all checks passed

$ bun run build
build done
```

Note on page-state tests: the repo renders components statically
(`react-dom/server`), which runs no effects and no query fetching, so a live
React Query hook cannot resolve in a test. I therefore split the page into
`VoteRoute` (data wiring) + `VoteView` (pure props) and tested `VoteView`
directly for the lobby → waiting copy, live-with-poll, live-no-poll and ended
summary states. This is the same honest boundary Task 12 documented.

## Dev-server verification (no real LLM)

Steps:

1. Scratch fixture `/tmp/mv-llm-mock.json` (uncommitted):
   `{ "responses": ["s(\"bd*4, hh*8\")"] }`.
2. `LLM_PROVIDER=mock LLM_MOCK_SCRIPT=/tmp/mv-llm-mock.json MV_E2E_FAST=1
   NODE_ENV=development bun run backend/server.ts` (uses `dev.db` from `.env`;
   fast mode = 5s poll window).
3. Scratch Playwright spec + `playwright.scratch.config.ts` (both deleted
   before commit): host signs up via the UI → `/create` (interval 60) → Start;
   audience opens `/r/<id>` in a second browser context and the whole cycle is
   driven against the real HTTP/WS surface.

Observed transitions (test passed, 2.1 min):

```
- lobby: waiting-for-DJ shown
- host started; room live
- poll 1 card with yes/no buttons + countdown
- voted yes → "Vote counted", both buttons disabled
- poll 1 closed → card left the phone
- poll 2 opened → card back
- host skipped poll 2 → audience reconciled to waiting (no WS event)
- host ended the set (audience stays on wait until room_ended)
- room ended → summary timeline with 1 decided poll (skip filtered out)
```

Dev-server log had no errors/exceptions. All scratch artifacts removed;
`git status` clean.

Two observations from the run (not bugs, behaviour):
- The audience gets **no** `outro` signal — `rooms.end` only publishes
  `room_ended` at finalize, so the phone stays on the wait state for the outro
  window. The `outro` branch in `VoteView` only appears if a refetch/reload
  happens during outro.
- The audience receives **no** `vote_count` frame: `castVote` publishes
  vote_count to the host channel only. The phone shows "Vote counted" from the
  mutation result, which is sufficient for the phone. The task context sentence
  listing `vote_count` on the audience channel does not match the shipped
  backend; the code does not depend on it.

## Files changed

- `frontend/components/poll-card.tsx` (new)
- `frontend/routes/vote.tsx` (new)
- `frontend/router.tsx` (modified — `/r/$id`)
- `frontend/components/__tests__/poll-card.test.tsx` (new)
- `frontend/routes/__tests__/vote-view.test.tsx` (new)

No scratch fixtures or verification files committed.

## Self-review findings

- Anonymous: no auth guard, no host-only API; only `voting.*`.
- Generic buttons from `poll.options`; no yes/no literal.
- Summary filtered to `winningOption !== null`.
- Reconnect refetch, `closesAt` reconciliation, vote-rejection reconciliation —
  all present; skip case verified live.
- Countdown derived from the current poll's `closesAt` and a single ticker, so
  it re-keys correctly when the poll changes; timer cleared on unmount
  (`clearInterval`), and `useRoomChannel` owns its own socket cleanup.
- `ALREADY_VOTED` maps to the counted state instead of an error.
- Lobby / live-no-poll / outro / ended all render without crashing.

## Concerns

1. **Audience `outro` state is not pushed** (host `endRoom` publishes only
   `room_ended`). The page degrades gracefully (keeps the wait state), so this
   is cosmetic; fixing it would need a backend event the binding rules told me
   not to add. Flagged, not changed.
2. **Audience gets no `vote_count`** — backend publishes it to host only. The
   phone does not need live tallies, but if a later task wants per-option bars
   on the phone, the backend publication scope must change.
3. **Idle "countdown to next poll" — static waiting copy (deviation accepted by controller).**
   SHIPPED BEHAVIOR: the live-no-poll state shows the static
   "Waiting for the next poll" copy with no countdown. The poll-open countdown
   (`m:ss`) *is* implemented and tested. Rationale recorded by the controller:
   the design doc (lines 99–100) lists the poll countdown and the idle waiting
   state as separate requirements and both are satisfied; a *correct* next-poll
   countdown would need a server-computed next-open time because polls open on
   the room's interval grid (not `lastClosesAt + interval`), so any client-side
   estimate would be fabricated — and that would mean exposing scheduler timing
   from verified Task 9 code. Accepted as a documented plan deviation for the
   final review rather than risk a late scheduler change. **Do not touch the
   backend for this.**
4. Page body has no shared `AppLayout` (phone-first, no sidebar / sign-in CTA).
   Intentional; noted in case visual consistency with other routes is required.

## Note for Task 14 (no code change)

The phone's idle state is **static copy with no countdown**. The E2E must not
assert a next-poll countdown; assert only the "Waiting for the next poll" state
and the poll-open `m:ss` countdown.

## Deferred (do NOT change)

- Session re-mint on reload letting a second vote through (Task 10 backend gap).
- `applied` flag counts rejected/candidate versions (`voting.ts:41-48` backend gap).
- `PollTimeline` composite key collision (summary exposes no poll id).
- Forward clock skew suppressing an otherwise-live poll.
- VoteRoute wiring rests on a single manual dev run; Task 14's E2E will cover
  the real cycle.

---

# Fix round 1 (review: Approved — 1 Important + 2 bundled minors)

Commit: `fix(vote): resilient claim retry, no stale alerts or empty-summary flash`

## Important #1 — failed claim bricked voting until reload (fixed)

`frontend/routes/vote.tsx` now wraps the one-time session claim in an exported
`createClaimController(claim)`:

- Happy path: the first `ensure()` starts the claim; every later `ensure()`
  awaits the same settled promise (claim runs once).
- Failure path: the stored promise gets a `.catch` that flips an internal
  `failed` flag (so there is **no unhandled rejection**), and the next
  `ensure()` sees `failed === true` and **re-claims** instead of re-awaiting the
  dead promise. `ensure()` still rejects on the failed attempt so `handleVote`
  can surface the error; the mount call swallows its own rejection.
- `VoteRoute` builds the controller once via lazy `useState` and calls
  `claimController.ensure()` both on mount (fire-and-forget) and at the top of
  `handleVote`, so a phone that lost one HTTP request can still vote.

**RED → GREEN:**

```
RED   bun test frontend/routes/__tests__/vote-view.test.tsx
      SyntaxError: Export named 'createClaimController' not found in module
      '.../frontend/routes/vote.tsx'   → 0 pass, 1 fail, 1 error

GREEN bun test frontend/routes/__tests__/vote-view.test.tsx frontend/components/__tests__/poll-card.test.tsx
      11 pass, 0 fail, 37 expect() calls
```

New tests in `frontend/routes/__tests__/vote-view.test.tsx`:
`re-claims a failed session claim so a lost request does not brick voting`
(first `ensure()` rejects and calls `claim` once; the second `ensure()` calls
`claim` again and resolves) and `a successful claim is reused across votes`
(two `ensure()` calls → one `claim`).

## Bundled minor #5 — empty-summary flash (fixed)

`VoteRoute` now passes `summaryPolls = null` while `summaryQuery.isPending`, and
`VoteView` renders a `data-testid="summary-loading"` spinner for the `ended`
state when `summaryPolls === null` instead of `PollTimeline` (which would flash
"No polls were decided."). Test: `ended shows a summary spinner before the
summary resolves`.

## Bundled minor #6 — stale vote alert (fixed)

`VoteRoute` clears the vote `error` in an effect keyed on the active poll id, so
a "Poll is closed" alert cannot ride into the next poll's card. (Two-line
effect; no static-render test can exercise it — covered by inspection + the live
dev cycle.)

## Concern 3 ruling folded in

See the reworded Concerns item 3: the static idle copy is the shipped behavior,
recorded as a controller-accepted deviation; backend untouched.

## Fix-round validation

```
bun test frontend/routes/__tests__/vote-view.test.tsx frontend/components/__tests__/poll-card.test.tsx
  → 11 pass, 0 fail
bun run check  → biome 0 errors, typecheck clean, knip clean, 145 pass / 0 fail
bun run build  → build done
```
