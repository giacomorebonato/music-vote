### Task 9: PollScheduler

**Files:**
- Create: `backend/polls/scheduler.ts`, `backend/polls/__tests__/scheduler.test.ts`

**Interfaces:**
- Consumes: MusicEngine, hub, prisma, RoomService `endRoom` (Task 8).
- Produces: `armScheduler(roomId): void` (interval = room.pollIntervalSec); `restoreSchedulers(): Promise<void>` (boot: for each `live` room — close overdue open polls (no change), close due queued polls, arm); module const `POLL_OPEN_SECS = 45`; scheduler tick behavior: open queued poll (status open, openedAt, closesAt) → `publishAudience(poll_opened)`; when closesAt passes (its own timer) → close → tally → tie → seeded random (seed logged via `console.info`) → `publishAudience(poll_closed)` → if winner: `generateEvolution` → validate → `PatternVersion(candidate)` → `publishHost(code_update)` → if null/invalid: poll logged `no change`, `warning` event; then pre-generate next question → `Poll(queued)`. End handling: at 75% of lengthSec schedule queued Poll kind `end` (options wrap/continue) — winner `wrap` → `endRoom`; at lengthSec → `endRoom`.
- `endRoom` (Task 8) triggers outro: engine outro → candidate version → `publishHost(code_update kind:'outro')` → after `pollIntervalSec` → status `ended` → `publishAudience(room_ended)` + `room_status`.
- Tests use `Bun.testing` fake timers or injected `setTimeout`/clock — pick one, document in file header.

- [ ] **Step 1: Failing tests** — scheduler.test.ts: full cycle with fake clock — open at t=0, closesAt=t+45s, audience event sent, winner from 2 votes → candidate version + host code_update; **Review Focus #1**: zero votes → closed, winningOption null, NO version, next poll armed; end-poll appears at 75% of length; outro path: endRoom → outro version → after interval → status ended + `room_ended` event; **Review Focus #4**: `restoreSchedulers` with room live + overdue open poll → closed no-change, armed.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** scheduler.
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(polls): scheduler — open/close, tally, evolution, outro, restore"`.

