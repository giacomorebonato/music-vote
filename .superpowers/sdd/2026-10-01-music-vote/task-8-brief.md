### Task 8: RoomService + rooms tRPC router

**Files:**
- Create: `backend/rooms/service.ts`, `backend/trpc/rooms.ts`, `backend/rooms/__tests__/service.test.ts`
- Modify: `backend/trpc/root.ts` (compose `rooms:`)

**Interfaces:**
- Consumes: `getLlmProvider`, MusicEngine (Task 6), hub (Task 7), prisma models (Task 2), `createRoomSchema` (Task 2).
- Produces service: `createRoom(hostId, input): Promise<Room>` (lengthSec = lengthMin*60, status lobby); `startRoom(roomId, hostId): Promise<void>` — engine initial pattern → `PatternVersion(initial, applied)` → `room.currentCode` → status `live` → `publishHost(code_update kind:'initial')` → pre-generate first poll question (queued Poll) → arms scheduler (Task 9); `undoLastChange(roomId, hostId)` — mark current applied version `reverted`, revert `room.currentCode` to previous applied, push `code_update kind:'undo'`; `skipPoll(roomId, hostId)`; `endRoom(roomId, hostId)` (used by both host button and scheduler); `reportApplyResult(roomId, versionId, ok, error)` — `candidate→applied` or `→rejected` (+`pattern_rejected` host event).
- Produces router `roomsRouter`: `create`, `get` (host view: room + versions + open poll + counts), `start`, `undo`, `skip`, `end`, `reportApplyResult` — all `protectedProcedure`, ownership-checked.

- [ ] **Step 1: Failing tests** — service.test.ts (mock provider + real prisma test db, scheduler stubbed): create→lobby with lengthSec computed; start→live, initial version applied, currentCode set; undo reverts code + marks reverted; **Review Focus #2**: `endRoom` while poll open → poll closed, winningOption null, no new version; `reportApplyResult(false)` → version rejected. Router: non-owner gets FORBIDDEN on get.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** service + router + root composition.
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(rooms): lifecycle service + host tRPC router"`.

