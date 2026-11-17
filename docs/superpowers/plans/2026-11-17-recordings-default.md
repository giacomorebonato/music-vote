# Recordings Enabled by Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crowd audio recordings are enabled by default for all rooms (new and existing), and the vote page states when the host has paused them.

**Architecture:** Flip the `Room.recordingsEnabled` Prisma default to `true` and ship a migration that rebuilds the `Room` table (SQLite cannot alter a column default) and updates existing rows to `true`. Add a paused notice to the vote page's contributions block when the host disables recordings, mirroring the existing text-directions notice. No pipeline (upload/approval/scheduling/playback) changes.

**Tech Stack:** Prisma v7 + SQLite (table-rebuild migration), Bun test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-recordings-default-design.md`

## Global Constraints

- Bun everywhere — runtime, package manager, test runner. Never npm/pnpm/yarn.
- Every DB-backed test file migrates its own SQLite file at module load; never point two test
  files at one DB path.
- `bun run verify` must pass before the work is claimed done.
- Conventional commits (`feat:`, `fix:`), matching `git log`.

## Review Focus

- Existing rooms in an already-deployed DB flip to `true` only via the migration's `UPDATE`;
  a rebuild-only migration would leave prod rooms paused — Task 1 pins it.
- A host who disables recordings mid-session must see the recorder disappear and a paused
  notice appear on the vote page (not a blank gap) — Task 2 pins it.
- New rooms created through `createRoom` (which omits the field) inherit the new default at
  the database level — Task 1 pins it.
- `momentsEnabled` stays `false` and `sampleApproval` stays `true` after the rebuild — the
  migration SQL must not disturb them; Task 1's test asserts `momentsEnabled` remains `false`.
- E2E's pre-checked "Recorded sounds" checkbox: `check()` is idempotent, but the later
  `uncheck()` + visibility assertions must still hold — Task 2 runs the spec.

---

### Task 1: `recordingsEnabled` defaults to `true`

**Files:**
- Modify: `prisma/schema.prisma:42`
- Create: `prisma/migrations/<generated>_recordings_default_on/migration.sql`
- Test: `backend/db/__tests__/models.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Room.recordingsEnabled` default `true` at schema and database level; migration
  name `<timestamp>_recordings_default_on`. Task 2 depends only on the DB default.

- [ ] **Step 1: Write the failing test**

In `backend/db/__tests__/models.test.ts`: at module scope, next to the existing
`hostEmail` constant, add
`const defaultsEmail = `defaults-${crypto.randomUUID()}@example.com``; extend the
existing `afterAll` cleanup `deleteMany({ where: { email: hostEmail } })` to
`where: { email: { in: [hostEmail, defaultsEmail] } }`. Then append:

```ts
test('createRoom defaults: recordings on, moments off', async () => {
	const host = await prisma.user.create({
		data: { name: 'Defaults', email: defaultsEmail },
	})
	const room = await prisma.room.create({
		data: {
			hostId: host.id,
			bpm: 120,
			lengthSec: 600,
			pollIntervalSec: 120,
			genre: 'techno',
			status: 'lobby',
			stateDoc: {},
		},
	})
	expect(room.recordingsEnabled).toBe(true)
	expect(room.momentsEnabled).toBe(false)
})
```

The cleanup lives in the extended `afterAll`; the test body has no cleanup of its own.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test backend/db/__tests__/models.test.ts`
Expected: FAIL — `expected false to be true` (current default is `false`)

- [ ] **Step 3: Flip the schema default**

In `prisma/schema.prisma`, change:

```
recordingsEnabled Boolean @default(false)
```
to
```
recordingsEnabled Boolean @default(true)
```

- [ ] **Step 4: Generate, edit, and apply the migration**

Run `bun run bootstrap` first (idempotent; guarantees `.env` and `prisma/dev.db` exist in
this worktree).

Run: `bunx prisma migrate dev --create-only --name recordings_default_on`

Prisma generates `prisma/migrations/<timestamp>_recordings_default_on/migration.sql` — a
`new_Room` rebuild that copies the old table (SQLite cannot `ALTER COLUMN SET DEFAULT`).
Open the generated SQL and append one line after the final `ALTER TABLE "new_Room" RENAME TO
"Room";` (and any index recreation), before any `PRAGMA foreign_keys=ON`:

```sql
-- Existing rooms were created under the accidental false default; flip them.
UPDATE "Room" SET "recordingsEnabled" = 1;
```

Then apply and regenerate the client:

Run: `bunx prisma migrate dev && bunx prisma generate`

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test backend/db/__tests__/models.test.ts`
Expected: PASS (both tests)

- [ ] **Step 6: Run the full unit suite for migration fallout**

Run: `bun run test --parallel`
Expected: PASS — no other test asserts `recordingsEnabled: false`. If any does, it was
relying on the accidental default: update it to set the field explicitly.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations backend/db/__tests__/models.test.ts
git commit -m "feat: enable crowd recordings by default"
```

### Task 2: Paused notice on the vote page

**Files:**
- Modify: `frontend/components/crowd-contributions.tsx:69-72`
- Test: `e2e/contributions.spec.ts` (existing spec, one added assertion)

**Interfaces:**
- Consumes: Task 1's default (`recordingsEnabled: true` at room creation, so the E2E host's
  `.check()` call is a no-op and the later `.uncheck()` drives the paused state).
- Produces: vote-page copy string `Recorded sounds are paused by the host.`

- [ ] **Step 1: Add the failing e2e assertion**

In `e2e/contributions.spec.ts`, immediately after the existing
`await expect(phone.getByRole('button', { name: 'Record a sound', exact: true })).toHaveCount(0, { timeout: 10_000 })`
(the one following the host's `.uncheck()`), add:

```ts
await expect(
	phone.getByText('Recorded sounds are paused by the host.', { exact: true }),
).toBeVisible({ timeout: 10_000 })
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `PORT=3100 CI=1 bun run test:e2e -- --grep contributions`
Expected: FAIL — text `Recorded sounds are paused by the host.` not found (current UI shows
nothing when recordings are disabled)

- [ ] **Step 3: Implement the notice**

In `frontend/components/crowd-contributions.tsx`, change:

```tsx
{data.settings.recordingsEnabled ? (
	<RecordingInput ... />
) : null}
```
to
```tsx
{data.settings.recordingsEnabled ? (
	<RecordingInput ... />
) : (
	<p className="text-sm opacity-70">
		Recorded sounds are paused by the host.
	</p>
)}
```

Copy mirrors the existing `Text directions are paused by the host.` message in the same file;
keep the same classes.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `PORT=3100 CI=1 bun run test:e2e -- --grep contributions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/crowd-contributions.tsx e2e/contributions.spec.ts
git commit -m "fix: show paused notice for recordings on the vote page"
```

### Task 3: Full verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: verified branch.

- [ ] **Step 1: Run the full verify gate**

Run: `bun run verify`
Expected: `bun check`, `bun lint`, `bun fmt --check`, knip, `bun run test --parallel`, and
both Playwright suites pass. The migration applies cleanly inside every per-file test DB and
`scripts/e2e-reset-db.sh`.

- [ ] **Step 2: Report**

Report the verify output summary and the migration filename to the human partner. No commit
(step 1's commits already cover the work; `verify` produces no artifacts).
