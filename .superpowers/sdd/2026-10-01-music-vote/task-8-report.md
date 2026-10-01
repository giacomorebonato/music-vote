# Task 8 Report: RoomService + rooms tRPC router

## What was implemented

- `backend/polls/scheduler.ts` — scheduler stub exporting exactly `export function armScheduler(roomId: string): void {}`.
- `backend/rooms/service.ts` — room lifecycle service:
  - `createRoom(hostId, input)` — creates a `lobby` room, `lengthSec = lengthMin * 60`.
  - `startRoom(roomId, hostId)` — generates initial pattern via `generateInitialPattern`, stores an `applied` `PatternVersion(source: 'initial')`, updates `room.currentCode` + `stateDoc`, marks room `live`, publishes `code_update kind: 'initial'`, pre-generates first queued `Poll` with yes/no options, and calls `armScheduler`.
  - `endRoom(roomId, hostId)` — closes any open poll with `winningOption: null`; from `lobby` ends immediately; from `live` generates an outro candidate, publishes `code_update kind: 'outro'`, marks room `outro`, then after `pollIntervalSec` marks room `ended` and publishes `room_ended` / `room_status ended`.
  - `undoLastChange(roomId, hostId)` — marks current applied version `reverted`, restores `currentCode` to the previous applied version, publishes `code_update kind: 'undo'`; no-op if none.
  - `skipPoll(roomId, hostId)` — closes any open poll with `winningOption: null`.
  - `reportApplyResult(roomId, versionId, ok, error?)` — candidate → `applied` (and updates `currentCode`) or candidate → `rejected`, publishing `pattern_rejected`.
- `backend/trpc/rooms.ts` — `roomsRouter` with all procedures as `protectedProcedure`:
  - `create`, `get`, `start`, `undo`, `skip`, `end`, `reportApplyResult`.
  - All room-scoped procedures ownership-check via `requireRoomOwner` (`FORBIDDEN` if not owner or missing).
- `backend/trpc/root.ts` — composed `rooms: roomsRouter`.
- `backend/rooms/__tests__/service.test.ts` — TDD test suite against real Prisma test DB with `MockLlmProvider` and scheduler stubbed.

## TDD evidence: RED + GREEN

- Initial failing test run before implementation showed missing modules (`service.ts`, `rooms.ts`, scheduler stub).
- After implementation, targeted test run: `9 pass, 0 fail`.
- Full backend test suite: `83 pass, 0 fail`.
- Full `bun run check`: `92 pass, 0 fail` — green.
- Commit: `4146172 feat(rooms): lifecycle service + host tRPC router`.

## Files changed

- `backend/polls/scheduler.ts` (new)
- `backend/rooms/service.ts` (new)
- `backend/rooms/__tests__/service.test.ts` (new)
- `backend/trpc/rooms.ts` (new)
- `backend/trpc/root.ts` (modified)

## Self-review findings

- Ownership check covers all seven router procedures:
  - `create`: host is `session.user.id`.
  - `get`, `start`, `undo`, `skip`, `end`, `reportApplyResult`: `requireRoomOwner` enforces `FORBIDDEN`.
- Outro timing asserted with `jest.useFakeTimers()`; room transitions `live → outro → ended`.
- Lobby-end path tested: room goes straight to `ended` with no outro version.
- Undo no-op path tested: room with no applied version stays unchanged.
- Scheduler stub committed and mocked in tests; `startRoom` asserts `armScheduler(roomId)` called.
- No schema changes or scope creep.

## Fix round 1

### Changes
- `backend/rooms/__tests__/service.test.ts` — added `mock.module('@backend/realtime/hub', ...)` with `publishHost`/`publishAudience` spies and asserted exact event payloads:
  - `startRoom` → `code_update kind: 'initial'` with matching `versionId`.
  - `undoLastChange` → `code_update kind: 'undo'` with previous version id.
  - `endRoom` (live) → `code_update kind: 'outro'` with outro version id.
  - `endRoom` (lobby) → `room_ended` on audience, `room_status ended` on host.
  - `reportApplyResult(false)` → `pattern_rejected` with version id and error.
- `backend/rooms/service.ts` — hoisted `generateNextQuestion(provider, doc)` before any DB writes in `startRoom` so a question-gen failure leaves zero DB state (room stays `lobby`, no versions/polls).
- Added atomicity test: question-gen throw leaves room `lobby` with zero versions/polls.

### Commands
```bash
bun test backend/rooms/__tests__/service.test.ts
bun run check
```

### Outputs
- Targeted room tests: `10 pass, 0 fail, 48 expect() calls`
- Full `bun run check`: `93 pass, 0 fail` — green.
- Commit: `6d48b88 fix(rooms): assert hub events, atomic startRoom`.

## Concerns

- `reportApplyResult` service function does not take `hostId`; ownership is enforced only in the router. This follows the exact service signature in the brief but means the service is not self-protecting for direct imports.
- `endRoom` finalization is in-memory `setTimeout`. A server restart will lose pending finalizations; Task 9's scheduler is expected to own persistent scheduling.
- The outro `PatternVersion` is created as `candidate` and never auto-applied; the host/scheduler is responsible for applying or rejecting it.

## Fix round 2

### Changes
- `backend/rooms/service.ts` — added an `EngineDeps` dependency-injection seam and `defaultEngine`, then threaded it through `startRoom` as an optional third parameter. `endRoom` received the same optional parameter because it was trivial (single `generateOutro` call); existing 2-arg router call sites remain unchanged.
- `backend/rooms/__tests__/service.test.ts` — replaced the vacuous atomicity test with a real regression guard that builds the throwing engine from the *real* imported engine functions:
  - `generateInitialPattern` and `generateOutro` imported directly from `@backend/music/engine` (no `mock.module` for the engine in this file).
  - `generateNextQuestion` overridden to throw `new Error('question generation failed')`.
  - Asserts the call rejects with that message and that the room stays `lobby` with `currentCode` null, zero `patternVersion` rows, and zero `poll` rows.

### Commands
```bash
bun test backend/rooms/__tests__/service.test.ts -t "startRoom is atomic"
bun test backend/rooms
bun run check
```

### Outputs
- Targeted atomicity test with correct question-gen-first order (GREEN): `1 pass, 0 fail`.
- `bun test backend/rooms`: `10 pass, 0 fail`.
- `bun run check`: `93 pass, 0 fail — green`.

### RED / GREEN regression-guard proof

**RED — reverted order (version.create before question-gen):**
```
[FAIL] FAILURES:
  (fail) startRoom is atomic: question-gen throw leaves room lobby with zero versions [39.82ms]
  error: expect(received).toHaveLength(expected)
  Expected length: 0
  Received length: 1
  at <anonymous> (.../backend/rooms/__tests__/service.test.ts:129:19)

SUMMARY:
   0 pass
   1 fail
  Ran 1 test across 1 file. [471.00ms]
```

**GREEN — correct order (question-gen before version.create):**
```
SUMMARY:
   1 pass
   0 fail
  Ran 1 test across 1 file. [459.00ms]
```

- Commit: `93591ad test(rooms): DI seam + real question-gen atomicity guard`.
