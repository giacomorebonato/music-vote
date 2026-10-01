# Task 9 Report: PollScheduler

## What was implemented

Filled `backend/polls/scheduler.ts` and added `backend/polls/__tests__/scheduler.test.ts`.

Core behavior:
- `POLL_OPEN_SECS = 45` (shrinks to `5` when `MV_E2E_FAST=1`). Minimum interval also clamps to `10s` in fast mode so e2e can run a real cycle quickly.
- `armScheduler(roomId)` is synchronous and idempotent: it disarms any existing timers for the room and schedules a bootstrap tick.
- Live-room loop:
  - opens the next queued poll immediately on arm.
  - publishes `poll_opened` to the audience with `id`, `question`, label `options`, and ISO `closesAt`.
  - each poll closes after `POLL_OPEN_SECS` via its own timer.
  - on close, tallies votes from the DB, resolves ties with a seeded random picker (seed logged via `console.info`), publishes `poll_closed`.
  - if the winner is an `evolution` poll: `generateEvolution` → candidate `PatternVersion` → host `code_update kind:'evolution'`. On null/invalid, logs `no change` and publishes a host `warning`.
  - then pre-generates the next question and creates the next queued `evolution` poll.
  - at `75%` of `lengthSec`, inserts a queued `end` poll with `wrap`/`continue` options and opens it when possible. If `wrap` wins, `endRoom(roomId, room.hostId)` is called.
  - at `lengthSec`, `endRoom` is called.
- Outro handling:
  - `endRoom` now records `appliedAt` on the outro candidate version.
  - `restoreSchedulers()` re-arms outro rooms and finalizes them once `now - appliedAt >= pollIntervalSec`, publishing `room_ended` + `room_status ended`.
- Restart recovery:
  - `restoreSchedulers()` iterates `live` rooms, closes overdue open polls as `winningOption: null` with no change/version, publishes `poll_closed`, and re-arms.
  - `outro` rooms are either finalized immediately or re-armed for the remainder.

Timer/clock approach:
- An injected `SchedulerClock` (`now`, `setTimeout`, `clearTimeout`) is used throughout the scheduler. Production uses real timers; tests replace the clock with a deterministic fake that runs timer callbacks synchronously on `tick(ms)` and awaits async callbacks.
- `disarmScheduler(roomId)` clears every active handle and removes the room from the active map.
- `endRoom` now calls `disarmScheduler(roomId)` to avoid leaked intervals after a host ends the room.

## TDD Evidence

1. Wrote failing tests first covering full cycle, zero votes, end poll, outro, restore live, restore outro, and tie determinism.
2. Ran tests: RED.
3. Implemented scheduler logic iteratively until tests passed: GREEN.
4. Ran `bun run check` — green.

Test output:
```
bun test backend/polls/__tests__/scheduler.test.ts
SUMMARY: 7 pass, 0 fail

bun run check
✓ all checks passed
```

## Files changed

- `backend/polls/scheduler.ts` — scheduler implementation.
- `backend/polls/__tests__/scheduler.test.ts` — scheduler tests.
- `backend/rooms/service.ts` — set `appliedAt` on outro version; call `disarmScheduler` in `endRoom`.
- `backend/rooms/__tests__/service.test.ts` — add `disarmScheduler` to scheduler mock.
- `.gitignore` — ignore `prisma/scheduler-test.db`.

## Self-review findings

- Timers cleaned up on room end via `disarmScheduler`.
- `armScheduler` is idempotent (disarms before re-arming).
- Zero-vote polls close with `winningOption: null` and create no `PatternVersion`.
- `restoreSchedulers()` handles both `live` and `outro` rooms.
- `MV_E2E_FAST` is documented at the constant.
- Tally reads votes from Prisma, not memory.
- `endRoom` is always invoked with `room.hostId`.
- `compileCheck` guards the evolution result; invalid code falls back to no-change + warning.

## Concerns

- `closePoll` has a Biome cognitive-complexity warning (12). It remains a single responsibility (close + dispatch) and is within the same-file helper guideline. Could be split later if it grows.
- The scheduler depends on `Date.now()` indirectly through `applyChange` for state-doc history timestamps; not asserted and not a functional issue.
- Test file has Biome warnings for missing explicit return types and two tests slightly over the 50-line function limit. These are warnings only and `bun run check` passes.

---

## Fix round 1

Changes made:
- `armLive` now calls `armExistingPollClose` after `openNextQueuedPoll`. If a restart left a non-overdue poll open, the scheduler arms its close timer for `closesAt - now` (or closes immediately if time already expired).
- `restoreSchedulers` + `armScheduler` now recover mid-window open polls; added test with future `closesAt` asserting close, tally, and evolution candidate.
- `tallyVotes` only counts votes whose `choice` is in the poll's option keys; off-option votes are ignored, preventing `tied = []` crash. Added test covering an invalid vote.
- `closePoll` now handles end-poll `continue`: it queues the next evolution poll (using a new `afterContinue` flag that bypasses the 75% insertion guard while an active end poll is absent) and opens it. Added test showing room stays live, next evolution queued/open, and no outro.

Files changed in fix:
- `backend/polls/scheduler.ts`
- `backend/polls/__tests__/scheduler.test.ts`

Commands run:
```
bun run typecheck
bun test backend/polls/__tests__/scheduler.test.ts
bun run check
```

Outputs:
- `bun test backend/polls/__tests__/scheduler.test.ts`: 10 pass, 0 fail
- `bun run check`: ✓ all checks passed (103 pass, 0 fail)

Commit: `8a497b2 fix(polls): restore mid-window close timer, in-option tally, continue resumes polling`

---

## Fix round 2

Changes made:
- Added an in-memory `continuing` flag on `RoomScheduler`. When an end poll winner is `continue`, the flag is set to `true`. `queueNextEvolution` now bypasses the 75% insertion guard while the room is continuing and there is no active/queued end poll, allowing evolution polls every interval until `lengthSec`. The end-poll dedupe (single `end` poll per room) remains in place, so no second end poll is created.
- Fixed the off-option vote test to the crashing shape: two invalid votes vs one `yes` vote. Verified the pre-fix failure by temporarily stashing the new filter: the old unfiltered tally produced the same winner because the invalid vote was outnumbered, so the test did not guard against the crash. Reverted stash and confirmed post-fix passes.
- Hardened `pickWinner`: when all valid vote counts are zero (`max === 0`), it returns `null` so the poll closes with no winner and no phantom evolution. Added test for all-off-option votes.

Files changed in fix:
- `backend/polls/scheduler.ts`
- `backend/polls/__tests__/scheduler.test.ts`

Commands run:
```
bun run typecheck
bun test backend/polls/__tests__/scheduler.test.ts
bun run check
```

Outputs:
- `bun test backend/polls/__tests__/scheduler.test.ts`: 12 pass, 0 fail
- `bun run check`: ✓ all checks passed (105 pass, 0 fail)

Commit: `cac87b7 fix(polls): sustain polling after continue, harden tally guards`

---

## Fix round 3

Changes made:
- Moved the `continuing` relaxation in `queueNextEvolution` ABOVE the normal 75% insertion guards. When `scheduler?.continuing` is true, the only stop condition is `now + intervalMs >= endAt`; the insertAt guards are skipped entirely. This makes post-continue evolution queueing reachable after `insertAt`.
- Hardened `pickWinner` to use `if (max <= 0) return null` so unparseable options (empty options list) do not crash with `tied[0].key`.
- Rewrote the sustained-polling test so it genuinely discriminates: `lengthSec=120`, `pollIntervalSec=5`, clock advances past `insertAt=90s` to `95s` and then to `100s`, asserting a queued/open evolution poll exists after each post-insertAt close cycle, room stays `live`, no outro, and only one end poll ever exists.

Files changed in fix:
- `backend/polls/scheduler.ts`
- `backend/polls/__tests__/scheduler.test.ts`

Commands run:
```
bun run typecheck
bun test backend/polls/__tests__/scheduler.test.ts
bun run check
```

Outputs:
- `bun test backend/polls/__tests__/scheduler.test.ts`: 12 pass, 0 fail
- `bun run check`: ✓ all checks passed (105 pass, 0 fail)

Commit: `e365aa8 fix(polls): make continuing relaxation reachable, discriminating sustain test`

### Finding A verification (RED + GREEN)

RED (relaxation below guards): temporarily moved the `continuing` branch below the `!opts?.afterContinue` insertAt guards. The new test failed:
```
error: expect(received).toHaveLength(expected)
Expected length: 1
Received length: 0
at backend/polls/__tests__/scheduler.test.ts:776:17
(fail) end poll continue sustains polling past insertAt [8.64ms]
11 pass, 1 fail
```

GREEN (relaxation above guards): restored the fix so the `continuing` branch executes first; test passes and `bun run check` is green.

```
bun test backend/polls/__tests__/scheduler.test.ts
12 pass, 0 fail
```
