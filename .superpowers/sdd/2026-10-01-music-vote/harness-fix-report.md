# Harness fix report — cold-tree gate failure

Commit: `a16eea6` (worktree `music-vote`, on top of `c869a76`)
Tree: clean after the commit (`.superpowers/` and `prisma/*.db` are gitignored).

## 1. Reproduced failure (before the fix)

Unmodified worktree, `c869a6` tree state:

```
rm -f prisma/*.db prisma/*.db-journal
bun run check          # == biome, typecheck, knip, `bun run test --parallel`
```

```
backend/rooms/__tests__/service.test.ts:
# Unhandled error between tests
error: Command failed: DATABASE_URL=file:./test.db bunx prisma migrate deploy
Error: SQLite database error
database is locked
   0: sql_schema_connector::sql_migration_persistence::initialize
   1: schema_core::state::ApplyMigrations
...
 149 pass
 1 fail
 1 error
Ran 150 tests across 23 files. [6.32s]
error: script "test" exited with code 1
error: script "check" exited with code 1
```

Three further cold `bun run test --parallel` runs produced the same
`database is locked` error deterministically (159 pass / 1 fail / 1 error).
The second (warm) run passed with 161 tests, matching the reported
"first-run-only" symptom. The controller's variant error
(`PrismaClientKnownRequestError: The table 'main.Room' does not exist`) is the
same failure seen through a different interleaving; see §2.3.

## 2. Confirmed mechanism (evidence, not assumption)

### 2.1 Only ONE of the four files wipes its DB — and it is not the race

`grep -rn "rm -f\|rmSync" backend`:

```
scripts/e2e-reset-db.sh:18:rm -f prisma/test.db prisma/test.db-journal
```

No test file `rm`s anything. The four DB-backed files only run
`execSync('DATABASE_URL=file:./<db> bunx prisma migrate deploy')` at module load.
The brief's "each `rm -f` their DB" part is inaccurate; the race itself is real.

### 2.2 The race: two concurrent `migrate deploy` on one fresh SQLite file

`models.test.ts` and `rooms/service.test.ts` both targeted `prisma/test.db`
(verified: `DATABASE_URL=file:./test.db` in both). Minimal reproduction:

```
rm -f prisma/race.db
(DATABASE_URL=file:./race.db bunx prisma migrate deploy & \
 DATABASE_URL=file:./race.db bunx prisma migrate deploy & wait)
# -> BOTH processes fail with "SQLite database error / database is locked"
# tables in prisma/race.db afterwards: []      <- created, but schema-less
```

`bun test --parallel` runs test files in separate worker processes (`--parallel`
implies `--isolate`; verified with a preload probe: 23 preload executions across
12 pids), so the two module-load migrations start within milliseconds of each
other and collide on DB creation/`_prisma_migrations` initialisation. Whoever
loses gets `execSync` throwing at module load; whoever is unlucky afterwards can
connect to the file that was created but never migrated → `P2021 table
'main.Room' does not exist`.

### 2.3 Additional cause found: the services use a different client than the tests

Each file also built its **own** `PrismaClient` from an absolute path:

```ts
const prisma = new PrismaClient({
  adapter: new PrismaBunSqlite({ url: `file:${testDbPath}` }),
})
```

while the code under test (`rooms/service.ts`, `votes/service.ts`,
`polls/scheduler.ts`) uses the module singleton `@backend/db/client`, whose URL
is captured from `process.env.DATABASE_URL` at first import. Under the
non-isolated default `bun test` all files share one module registry, so the
singleton is created exactly once, by the import chain of a file that does not
set `DATABASE_URL` at all:

```
[PROBE] url=file:./dev.db main=backend/__tests__/boot.test.ts
```

(`boot.test.ts` → `@backend/boot` → `@backend/polls/scheduler` → `@backend/db/client`).
On a cold tree `bun:sqlite` creates an empty `prisma/dev.db`, every DB test then
queries it, and the whole run fails with `P2021` — while a warm developer
machine with a migrated `dev.db` passes. That is the real source of the
first-run-only behaviour and of the `main.Room does not exist` message.

### 2.4 Bare default-mode `bun test` has a second, independent defect

`bun test backend shared frontend` (non-isolated) on a *warm* tree also fails
(123 pass / 42 fail), so it is not a cold-state problem: `mock.module` is
process-global and leaks between sequentially executed files
(`SyntaxError: Export named 'MockLlmProvider' not found in module
'.../backend/llm/provider.ts'` caused by `scheduler.test.ts`'s provider mock,
`Export named 'createProdRoleResolver' not found` from a hub mock, and
`Cannot destructure property 'code' from null or undefined` because rooms'
`startRoom` picks up the stubbed engine mock). This predates this work (the
unmodified tree failed 33/161 the same way warm). Bun 1.4.2 offers no way to
isolate a bare `bun test`: `--isolate` is CLI-only and `[test] isolate = true` /
`[test] parallel = true` in `bunfig.toml` are ignored (verified empirically and
against the compiled bunfig key list in the bun binary). See §6.

## 3. The fix

Five files, no product code touched:

- **One DB per DB-backed test file.** `models.test.ts` → `prisma/models-test.db`,
  `rooms/service.test.ts` → `prisma/rooms-test.db` (both used to share
  `prisma/test.db`), `scheduler.test.ts` → `prisma/scheduler-test.db`,
  `votes/service.test.ts` → `prisma/votes-test.db`. `prisma/test.db` now belongs
  to the Playwright suites alone (`scripts/e2e-reset-db.sh` untouched).
- **Unique paths make the module-load migration provably race-free.** Each file
  still applies the committed migrations to its own file (idempotent), so a bare
  `bun test`, a single-file run and `bun run check` all work on a cold tree
  without a separate prepare step. No two processes can touch the same SQLite
  file, so `database is locked` cannot be produced.
- **Tests and services now share one client** (`await import('@backend/db/client')`
  after the file sets `DATABASE_URL`), so assertions and writes can no longer
  land on different database files, and no test depends on a pre-migrated
  `dev.db`.
- `$disconnect()` removed from the four `afterAll` hooks (with a comment): the
  client is process-wide, so closing it would break test files that run later in
  the same process.
- `.gitignore`: ignore the two new test DBs.

Deliberate deviation from the brief: **no `scripts/test-db-prepare.sh` and no
`package.json` wiring.** With one DB per file the module-load migrations cannot
race, so a serial prepare script would be pure duplication; and a
prepare-only design would have to be re-run per file to cover a bare `bun test`,
which is exactly the concurrent-migrate shape that caused the bug (`bunfig`
preload runs once per file execution, verified). `scripts/check.sh` is
unchanged: biome → typecheck → knip → `bun run test --parallel`.

## 4. Cold-run evidence (after the fix)

| # | command (after `rm -f prisma/*.db prisma/*.db-journal`) | result |
|---|---|---|
| 1 | `bun run check` | **161 pass / 0 fail**, `✓ all checks passed`, exit 0 |
| 1 | `bun run check` (same wipe again, second cold run) | **161 pass / 0 fail**, exit 0 |
| 2 | `bun run check:full` | unit gate green + **5 passed (3.2m)** Playwright, exit 0 |
| 3 | `bun test backend/polls/__tests__/scheduler.test.ts` (cold) | 14 pass / 0 fail |
| 3 | `bun test backend/votes/__tests__/service.test.ts` (cold) | 13 pass / 0 fail |
| 3 | `bun test backend/db/__tests__/models.test.ts` (cold) | 2 pass / 0 fail |
| 3 | `bun test backend/rooms/__tests__/service.test.ts` (cold) | 12 pass / 0 fail |
| 3 | `bun run test:e2e:ssr` | 1 passed (3.1s), exit 0 |
| 3 | `bun test backend shared frontend` (cold and warm) | **123 pass / 42 fail** — see §6, not caused by this defect |

After a cold `bun run check`, `prisma/` contains only the four gitignored test
DBs; the gate no longer creates `dev.db`.

`git status` after the gates showed only the five intended files.

## 5. Files changed (final content)

```diff
--- a/.gitignore
+++ b/.gitignore
@@ -4,6 +4,8 @@ node_modules/
 dist/
 prisma/dev.db
 prisma/test.db
+prisma/models-test.db
+prisma/rooms-test.db
 prisma/scheduler-test.db
 prisma/votes-test.db
 prisma/*.db-journal

--- a/backend/db/__tests__/models.test.ts
+++ b/backend/db/__tests__/models.test.ts
+process.env.DATABASE_URL = 'file:./models-test.db'
+
 import { afterAll, expect, test } from 'bun:test'
 import { execSync } from 'node:child_process'
-import { resolve } from 'node:path'
 import { createRoomSchema } from '@shared/schemas/room'
-import { PrismaBunSqlite } from 'prisma-adapter-bun-sqlite'
-import { PrismaClient } from '../../../prisma/generated/client'
-
-// Unit tests run against a real, migrated SQLite file (prisma/test.db) instead of
-// the dev DB: CI runs `bun run check` without applying migrations to dev.db, so
-// the test applies the committed migrations to test.db itself before connecting.
-const testDbPath = resolve(import.meta.dir, '..', '..', '..', 'prisma', 'test.db')
+// Unit tests run against a real, migrated SQLite file (prisma/models-test.db)
+// instead of the dev DB: CI runs `bun run check` without applying migrations to
+// dev.db, and a cold checkout has no DB at all.
+//
+// Every DB-backed test file owns its own `prisma/<name>-test.db` and migrates it
+// itself before connecting. Unique paths are what make these module-load
+// migrations race-free: `bun test --parallel` runs the files in separate worker
+// processes, and two `prisma migrate deploy` runs against the same fresh SQLite
+// file deadlock (`database is locked`) and leave it schema-less. The migrate is
+// idempotent, so it is also what makes a bare `bun test` work on a cold tree.
+//
+// The client comes from the shared singleton the services use, so writes and
+// assertions can never diverge onto two different files.
+execSync('DATABASE_URL=file:./models-test.db bunx prisma migrate deploy', { stdio: 'pipe' })
+
+const { prisma } = await import('@backend/db/client')
 
 afterAll(async () => {
-	await prisma.user.deleteMany({ where: { email: hostEmail } })
-	await prisma.$disconnect()
+	// No $disconnect here: `prisma` is the process-wide client every service
+	// shares, so closing it would break test files that run later in this process.
+	await prisma.user.deleteMany({ where: { email: hostEmail } })
 })

--- a/backend/rooms/__tests__/service.test.ts
+++ b/backend/rooms/__tests__/service.test.ts
+process.env.DATABASE_URL = 'file:./rooms-test.db'      // was set in beforeAll as file:./test.db
 import { execSync } from 'node:child_process'
-import { resolve } from 'node:path'
-import { PrismaBunSqlite } from 'prisma-adapter-bun-sqlite'
-import { PrismaClient } from '../../../prisma/generated/client'
-const testDbPath = resolve(import.meta.dir, '..', '..', '..', 'prisma', 'test.db')
-execSync('DATABASE_URL=file:./test.db bunx prisma migrate deploy', { stdio: 'pipe' })
-const prisma = new PrismaClient({ adapter: new PrismaBunSqlite({ url: `file:${testDbPath}` }) })
+// Own the DB: prisma/rooms-test.db, migrated before connecting. Unique per
+// DB-backed test file so the module-load `migrate deploy` runs cannot collide
+// under `bun test --parallel` (and the shared client below is the same one the
+// services use, so assertions and writes never diverge).
+execSync('DATABASE_URL=file:./rooms-test.db bunx prisma migrate deploy', { stdio: 'pipe' })
+const { prisma } = await import('@backend/db/client')

--- a/backend/votes/__tests__/service.test.ts
+++ b/backend/votes/__tests__/service.test.ts
-import { resolve } from 'node:path'
-import { PrismaBunSqlite } from 'prisma-adapter-bun-sqlite'
-import { PrismaClient } from '../../../prisma/generated/client'
-const testDbPath = resolve(import.meta.dir, '..', '..', '..', 'prisma', 'votes-test.db')
+// Own the DB: prisma/votes-test.db, ... (same comment as rooms)
 execSync('DATABASE_URL=file:./votes-test.db bunx prisma migrate deploy', { stdio: 'pipe' })
-const prisma = new PrismaClient({ adapter: new PrismaBunSqlite({ url: `file:${testDbPath}` }) })
+const { prisma } = await import('@backend/db/client')

--- a/backend/polls/__tests__/scheduler.test.ts
+++ b/backend/polls/__tests__/scheduler.test.ts
-import { resolve } from 'node:path'
-import { PrismaBunSqlite } from 'prisma-adapter-bun-sqlite'
-import { type Prisma, PrismaClient } from '../../../prisma/generated/client'
-const testDbPath = resolve(import.meta.dir, '..', '..', '..', 'prisma', 'scheduler-test.db')
+import type { Prisma } from '../../../prisma/generated/client'
 execSync('DATABASE_URL=file:./scheduler-test.db bunx prisma migrate deploy', { stdio: 'pipe' })
-const prisma = new PrismaClient({ adapter: new PrismaBunSqlite({ url: `file:${testDbPath}` }) })
+const { prisma } = await import('@backend/db/client')
```

(The full diff is `git show a16eea6`; the quoted hunks above are abbreviated for
the comment blocks that repeat verbatim across the three service/scheduler files.)

## 6. Not verified / open decision

1. **`bun test backend shared frontend` (bare, non-isolated) still fails**
   (123 pass / 42 fail, cold *and* warm). Causes are the pre-existing
   process-global state described in §2.3/§2.4, not the migration race:
   the process-wide Prisma client created from `.env`'s `dev.db`, and leaking
   `mock.module` registrations. Bun 1.4.2 has no bunfig key to force isolation:
   `--isolate` is CLI-only, and `[test] isolate = true` / `[test] parallel =
   true` in `bunfig.toml` are ignored (verified empirically and against the
   bunfig key list compiled into the bun binary) — do not retry that.
   **Ruling: this required-outcome clause was dropped by the decision-maker.**
   The contractual gate is `bun run check` (`scripts/check.sh` →
   `bun run test --parallel`), which is deterministic-cold-green. The 42
   failures are documented in `docs/agents/commands.md` so nobody later
   mistakes them for broken product code.
   A partially proven recipe (experiment, then reverted, **not** shipped) got
   this from 42 fails to 7 fails: make `backend/boot.ts` import
   `restoreSchedulers` lazily in the default argument (so a non-DB test file
   cannot create the client with `dev.db`) and make the provider/hub/engine
   mocks spread the real module's exports. The remaining 7 are exactly the mock
   leaks that the spread targets. Rejected for now: it means late-cycle edits to
   reviewed product code for a mode no documented workflow uses.
2. The four "one DB per file" migrations still spawn `bunx prisma migrate deploy`
   (~0.42s each, in parallel) per gate run. Measured, accepted: it is what keeps
   a bare `bun test` and a single-file run self-sufficient on a cold tree.
3. `bun test <whole repo>` (no path arguments) additionally picks up Playwright
   specs — pre-existing, unrelated to this fix; `package.json`'s `test` script
   and `check.sh` pass explicit paths.
