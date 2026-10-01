# Final fix round — report (2 Important findings + 1 minor)

Branch `music-vote`, base `abea287`, fix commit `c869a76`
`fix(polls): end the set gracefully when outro generation fails; replenish queue on restore`

Scope: exactly the three authorized items. Nothing else touched.

---

## Fix 1 — `endRoom` no longer zombie-fies the room when outro generation fails

**Change** (`backend/rooms/service.ts`)
`endRoom` keeps its disarm → close-poll → generate-outro → `outro` → `finalizeRoomEnd`
ordering. The outro generation moved into a new private helper
`generateOutroOrWarn(roomId, room, engine)` that returns the code or `null`:

- `try { return await engine.generateOutro(getLlmProvider(), doc, currentCode ?? '') }`
- `catch` → `console.info(\`Outro generation failed for room ${roomId}: ${String(error)}\`)`
  (same style as the existing `Poll ${poll.id} no change` log) + `hub.publishHost(roomId, { type: 'warning', message: 'Outro generation failed; music unchanged' })`
  (same shape/style as the evolution-failure warning in `scheduler.ts`; `warning` already a `WsEvent` union member) → `return null`.
- `null` → no `patternVersion` row, no `code_update`; the room still goes to `outro`
  and the existing `setTimeout(finalizeRoomEnd, pollIntervalSec * 1000)` still fires.
- Success path is byte-for-byte the previous sequence (version `source:'outro'`,
  `status:'candidate'`, `appliedAt` set, same `code_update kind:'outro'` publish).

No new seam needed: `endRoom(roomId, hostId, engine = defaultEngine)` already had the
`EngineDeps` DI seam (added in Task 8 round 2), so the failing outro is injected
directly — no `mock.module`.

**RED evidence** (`backend/rooms/__tests__/service.test.ts`, unit level, real service +
real Prisma test DB + injected failing engine):

Temporary probe test `RED probe: failing outro rejects and leaves the live room unscheduled`
(removed after the RED run) asserted the zombie state and **passed against the unfixed code**:

```
(pass) RED probe: failing outro rejects and leaves the live room unscheduled [4.06ms]
  thrown instanceof MusicGenError  -> ok
  room.status === 'live'           -> ok   (no scheduler, no end timer, poll already closed)
  open poll status === 'closed'    -> ok
```

Same run, the real expectation failed:

```
MusicGenError: Failed to generate a valid outro after 2 attempts
    at endRoom (backend/rooms/service.ts:144:33)
(fail) endRoom keeps the current pattern and still ends when outro generation fails
 9 pass, 4 fail
```

**GREEN evidence**: after the fix the probe inverts and the real test passes:

```
(fail) RED probe: failing outro rejects and leaves the live room unscheduled
  Expected constructor: [class MusicGenError extends Error]; Received value: undefined
  (endRoom no longer throws)
(pass) endRoom keeps the current pattern and still ends when outro generation fails [5.85ms]
 12 pass, 0 fail
```

The GREEN test asserts: `endRoom` resolves; room `outro`; `currentCode` still
`s("bd sd cp hh")`; exactly 1 version (`initial` only, no outro version); no
`code_update kind:'outro'`; a `warning` event `{type:'warning', message:'Outro generation failed; music unchanged'}`
on the host channel; after the interval the room is `ended` and the audience got
`room_ended` (finalize path intact). Probe deleted before commit.

Level: **unit only** for the failure path (the injection is the documented DI seam).
Success path covered by the pre-existing `endRoom`/outro tests plus the real-browser
`bun run test:e2e` (host end sequence) — see gate output below.

Side effect worth knowing: `getLlmProvider()` now also runs inside the `try`, so a
misconfigured provider (unknown `LLM_PROVIDER`) also degrades to "no outro code change"
instead of rejecting. That is the same "the set must end" contract; flagging it as the
one behavior the ruling did not spell out explicitly.

## Fix 2 — `restoreSchedulers` overdue close replenishes the question queue (+ host publish)

**Change** (`backend/polls/scheduler.ts`, overdue branch)
The raw `prisma.poll.update` stays (winningOption `null` on restore is unchanged
behavior), but the publish is now one `WsEvent` object sent to **both** channels
(`publishAudience` + `publishHost`, exactly like `closePoll`), and the queue is
replenished before the scheduler is armed:

```ts
const closed: WsEvent = { type: 'poll_closed', pollId: overdue.id, winningOption: null }
hub.publishAudience(room.id, closed)
hub.publishHost(room.id, closed)
if (overdue.kind === 'evolution') {
    await queueNextEvolution(room.id, room)
}
```

`queueNextEvolution` is called only for `kind === 'evolution'`, mirroring `closePoll`
(an overdue end poll closing with a null winner queues nothing there either — kept
faithful rather than inventing new semantics).

**RED evidence** (`backend/polls/__tests__/scheduler.test.ts`, unit level, fake clock,
overdue open evolution poll + `restoreSchedulers()`):

```
expect(queued).toHaveLength(1)
Expected length: 1 / Received length: 0
(fail) restoreSchedulers overdue close replenishes the queue and the next poll opens
13 pass, 1 fail
```

**GREEN evidence**: same run after the fix, `14 pass, 0 fail`, and the test asserts
more than "closed + armed":

- exactly 1 queued evolution poll with `seq > closed.seq` right after `restoreSchedulers()`;
- the host channel receives the same `poll_closed` object as the audience;
- the queued poll **actually opens** on the next bootstrap `tick(0)` (`poll_opened` for
  that poll id on the audience channel, question from the mocked question generator) —
  i.e. the evolution loop survives a crash mid-poll.

Level: unit (fake clock) — that is how all existing restore tests verify behavior. Not
re-verified through a real process restart.

## Fix 3 — ownership check on `reportApplyResult`

**Change** (`backend/rooms/service.ts` + `backend/trpc/rooms.ts`)
Signature is now `reportApplyResult(roomId, hostId, versionId, ok, error?)` (`hostId`
second, matching `startRoom`/`endRoom`/`undoLastChange`/`skipPoll`) and the function
starts with the same `room.hostId !== hostId` → `throw new Error('Room not found or access denied')`
guard. Router call site passes `ctx.userId`. Grep confirms the only callers are
`backend/trpc/rooms.ts`, `backend/rooms/service.ts` and `backend/rooms/__tests__/service.test.ts`
(2 existing tests updated for the new signature — minimal, mechanical).

**RED / GREEN** (`service.test.ts`, unit, real DB):

```
RED:  service.reportApplyResult(room.id, other.id, candidate.id, true)
      Expected substring: "Room not found or access denied"
      Received message: "Version not found or not a candidate"        (fail)

GREEN: (pass) reportApplyResult rejects a non-owner and leaves the version untouched
       - rejects with 'Room not found or access denied'
       - version still 'candidate', room.currentCode not set to the candidate code
```

---

## Gates (all four, actual output)

| Gate | Result |
|---|---|
| `bun run check` | green — `161 pass, 0 fail, 467 expect() calls`, `✓ all checks passed` (biome verify + `tsc --noEmit` + knip + `bun test --parallel`) |
| `bun run build` | green — `build done` (Tailwind + daisyUI chunk compiled) |
| `bun run test:e2e` | green — `5 passed (3.2m)`, incl. `e2e/music-vote.spec.ts:109 › host runs a set that the audience votes through, undoes, and ends (3.2m)` (real end sequence) |
| `bun run test:e2e:ssr` | green — `1 passed (2.2s)` |

Targeted runs: `bun test backend/rooms/__tests__/service.test.ts` → `12 pass, 0 fail`;
`bun test backend/polls/__tests__/scheduler.test.ts` → `14 pass, 0 fail`.

No existing test was weakened or deleted. Two `service.test.ts` calls were updated only
for the new `reportApplyResult` arity; every pre-existing assertion is intact, including
`endRoom while poll open …` and the three `restoreSchedulers` tests.

`git status --porcelain` is empty after the commit (no staged/leftover files). The
temporary RED probe test was deleted before committing.

## Residual risks / notes

- The pre-existing `bun test` (bare) cross-file interference and the `bun test backend shared frontend`
  sequential failure are untouched (documented carry from Task 12); the AGENTS.md gate
  `bun run check` is green.
- `getLlmProvider()` throwing now also degrades gracefully (see Fix 1 note) — intended,
  but not explicitly ruled.
- Deferred items from the review (updateRoomDoc timing, untracked outro `setTimeout`,
  `versions` payload, anonymous dedup, `skipPoll` audience publish gap, mock-LLM
  per-instance semantics) were **not** touched.
