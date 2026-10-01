### Task 2: Prisma models + room schemas

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `shared/schemas/room.ts`, `backend/db/__tests__/models.test.ts`

**Interfaces:**
- Produces: models `Room` (id, hostId→User, bpm Int, lengthSec Int, pollIntervalSec Int, genre, status `lobby|live|outro|ended` as String, currentCode String?, stateDoc Json, createdAt), `Poll` (id, roomId, kind `evolution|end`, question, options Json, openedAt?, closesAt?, status `queued|open|closed`, winningOption String?, unique(roomId, seq)), `Vote` (id, pollId, sessionToken, choice; **unique(pollId, sessionToken)**), `PatternVersion` (id, roomId, code, source String, status `candidate|applied|rejected|reverted`, appliedAt?).
- Produces: `createRoomSchema` = `{ bpm: z.int().min(60).max(200), lengthMin: z.int().min(5).max(60), pollIntervalSec: z.int().min(60).max(600), genre: z.string().min(1).max(80) }`.

- [ ] **Step 1: Write failing test** — `models.test.ts`: `test('vote dedup: second vote same token+poll throws P2002')` — create room/poll via prisma, insert two votes with same (pollId, sessionToken), expect rejection; `test('createRoomSchema rejects bpm 59 and 201')` with exact boundaries (60, 200 valid).
- [ ] **Step 2: Run** — `bun test backend/db` → FAIL (models/schema don't exist).
- [ ] **Step 3: Implement** — schema.prisma models + `shared/schemas/room.ts`. `bun run db:migrate -- --name music-models`.
- [ ] **Step 4: Run** — `bun test backend/db` → PASS; `bun run check` green.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): room, poll, vote, pattern-version models"`.

