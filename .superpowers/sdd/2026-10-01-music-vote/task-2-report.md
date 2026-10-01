# Task 2 Report: Prisma models + room schemas

## Status: DONE

## What I implemented
- `prisma/schema.prisma`: added `Room`, `Poll`, `Vote`, `PatternVersion` models + `User.rooms` back-relation, matching the brief exactly:
  - `Room`: id cuid, hostId → User (onDelete Cascade), bpm Int, lengthSec Int, pollIntervalSec Int, genre, status String, currentCode String?, stateDoc Json, createdAt DateTime @default(now()).
  - `Poll`: id cuid, roomId → Room (Cascade), seq Int, kind String, question, options Json, openedAt DateTime?, closesAt DateTime?, status String, winningOption String?, `@@unique([roomId, seq])`.
  - `Vote`: id cuid, pollId → Poll (Cascade), sessionToken, choice, `@@unique([pollId, sessionToken])`.
  - `PatternVersion`: id cuid, roomId → Room (Cascade), code, source String, status String, appliedAt DateTime?.
- Migration `prisma/migrations/20261001104935_music_models/migration.sql` (Json → JSONB, uniques as `CREATE UNIQUE INDEX`).
- `shared/schemas/room.ts`: `createRoomSchema` = `{ bpm: z.int().min(60).max(200), lengthMin: z.int().min(5).max(60), pollIntervalSec: z.int().min(60).max(600), genre: z.string().min(1).max(80) }`.
- `backend/db/__tests__/models.test.ts`: vote dedup P2002 test + bpm boundary test.

## TDD Evidence

### RED
Command: `bun test backend/db`
```
backend/db/__tests__/models.test.ts:
# Unhandled error between tests
error: Cannot find module '@shared/schemas/room' from '.../backend/db/__tests__/models.test.ts'

 0 pass
 1 fail
 1 error
EXIT=1
```
Expected: models + `shared/schemas/room.ts` did not exist yet, so the test file could not even resolve its imports.

### GREEN
Command: `bun test backend/db`
```
(pass) vote dedup: second vote same token+poll throws P2002 [33.02ms]
(pass) createRoomSchema rejects bpm 59 and 201 [0.73ms]

 2 pass
 0 fail
 5 expect() calls
EXIT=0
```

Full gate: `bun run check` → `✓ all checks passed` (biome + typecheck + knip + 18 unit tests).

## Files changed
- `prisma/schema.prisma` (modified)
- `prisma/migrations/20261001104935_music_models/migration.sql` (new)
- `shared/schemas/room.ts` (new)
- `backend/db/__tests__/models.test.ts` (new)

Commit: `4164c53 feat(db): room, poll, vote, pattern-version models`

## Self-review findings
- All 5 brief steps done; both Step-1 tests present; migration created + committed; `bun run check` green; zod boundaries exact; no extra models/fields beyond the brief.
- Prisma 7 + SQLite accepts `Json` (mapped to `JSONB` in the migration) — confirmed by `prisma validate` and the passing create.
- Test cleans up via deleting the host user (FK cascade removes room → poll → vote).

## Deviations / concerns
1. **Migration command**: I ran `bunx prisma migrate dev --name music-models && bunx prisma generate` instead of the brief's literal `bun run db:migrate -- --name music-models`, because the `db:migrate` script string is `prisma migrate dev && prisma generate` and Bun appends extra args to the end (`prisma generate --name ...` is invalid). Same two commands, same migration name `music_models`.
2. **Test DB strategy**: no starter unit-test DB harness existed (starter had no `backend/db/__tests__`). CI runs `bun run check` without migrating `dev.db`, so the test applies committed migrations to `prisma/test.db` itself (`DATABASE_URL=file:./test.db bunx prisma migrate deploy`, mirroring `e2e/global-setup.ts`) and builds a dedicated `PrismaClient` against that file. Cost: ~0.5s per `bun test` run. `prisma/test.db` is gitignored.
3. `Poll` / `Vote` / `PatternVersion` have no `createdAt` — the brief field lists omit them; flag if later tasks need creation timestamps.
