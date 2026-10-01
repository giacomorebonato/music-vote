# Task 1 Report: Bootstrap repo from mino-starter

Status: DONE_WITH_CONCERNS
Commit: `140e021 chore: bootstrap from mino-starter (notes demo stripped)`
Worktree: `/Users/giacomorebonato/Code/music-vote.music-vote` (branch `music-vote`)

## What I implemented

Copied the mino-starter kit from `~/Code/mino-starter` into the worktree root,
stripped the notes demo, renamed the package, and verified the quality gate.

### Step 1 — Copy starter
Used `git -C ~/Code/mino-starter archive HEAD | tar -x -C <worktree>` instead of
the brief's raw `rsync`. Rationale: this copies exactly the **tracked** starter
kit and therefore naturally excludes `.git`, `node_modules`, `.env`, `dev.db`,
`test.db`, `dist/`, `apm_modules/`, `test-results/`, `.pi-subagents/`,
`.superpowers/`, `prisma/generated/` — i.e. all of the brief's excludes plus
build/agent artifacts. `rsync` with only the brief's excludes would have copied
those artifacts. Result: 88 tracked files (87 starter files + the re-baselined
migration).

Then:
- `bun install` (postinstall runs `prisma generate`)
- `cp .env.example .env` + fresh `BETTER_AUTH_SECRET=$(openssl rand -hex 32)`
  (`.env` is gitignored — not committed)

### Step 2 — Strip notes demo
Deleted:
- `frontend/routes/notes.tsx`
- `frontend/components/note-form.tsx`, `frontend/components/note-list.tsx`
- `backend/trpc/notes.ts`, `backend/trpc/__tests__/notes.test.ts` (dir removed)
- `shared/schemas/note.ts`
- `e2e/notes.spec.ts`

Modified (required for `bun run check` to stay green):
- `backend/trpc/root.ts` — dropped `notesRouter` import + `notes` mount; `appRouter` now only `public`.
- `frontend/router.tsx` — dropped `NotesRoute`, `authClient`/`redirect` imports and the `notesRoute`; `routeTree = home + login`.
- `frontend/components/sidebar.tsx` — removed the `/notes` `Link` (typed-route check would otherwise fail).
- `frontend/components/auth-form.tsx` — post-auth redirect `/notes` → `/`.
- `e2e/auth.spec.ts` — retargeted the signup e2e (see Concern 3).
- `biome.json` — removed the now-dangling `frontend/components/note-form.tsx` from the per-file override.
- `prisma/schema.prisma` — removed the `Note` model and `User.notes` relation.
- `package.json` — `"name": "mino-starter"` → `"name": "music-vote"` (only change; verbatim per brief).

Re-baselined migrations: `rm -rf prisma/migrations/*` →
`bunx prisma migrate dev --name init` → `prisma/generated/models/Note.ts`
regenerated away. Single fresh migration:
`prisma/migrations/20261001103923_init/migration.sql` (User/Session/Account/
Verification only, no `Note` table).

> Note on the brief's `bun run db:migrate -- --name init`: that form is wrong
> here. `bun run db:migrate` = `prisma migrate dev && prisma generate`, and bun
> appends `--name init` to the whole compound line, so it lands on
> `prisma generate` (which rejects it) while `prisma migrate dev` runs
> interactively and hangs. I ran `bunx prisma migrate dev --name init` directly,
> then `bunx prisma generate`.

### Step 3 — Verify
- `bun run check` → **all green**: biome (44 files, 19 warnings, exit 0),
  typecheck, knip (no dead exports), `bun test` → **16 pass / 0 fail**.
- `bun run dev` (`bun --hot backend/server.ts`) probe:
  - `GET /` → 200 `text/html;charset=utf-8`, SPA shell contains `<div id="root">`
  - `GET /login` → 200 `text/html;charset=utf-8`
  - `GET /api/trpc/public.siteInfo` → 200 `{"result":{"data":{"name":"mino-starter","tagline":"A Bun + React fullstack starter with bot-friendly SSR."}}}`
  - login shell does not reference notes
- Dev server stopped afterwards (no lingering process).

### Step 4 — Commit
`git add -A` then `git commit -m "chore: bootstrap from mino-starter (notes demo stripped)"`. Working tree clean after commit.

## Verification commands + outputs

| Command | Result |
|---|---|
| `bun install` | 291 packages installed |
| `bunx prisma migrate dev --name init` | applied `20261001103923_init`, DB in sync |
| `bunx prisma generate` | Prisma Client 7.10.0 generated (no Note model) |
| `bun run check` | `✓ all checks passed` (biome + typecheck + knip + 16 tests) |
| `bun run dev` + fetch probes | `/` 200 html, `/login` 200 html, `public.siteInfo` 200 JSON |
| `grep -ri note` over source | only generic path-normalization fixtures/comments + generated prisma docs; no notes demo |
| starter-vs-worktree checksum drift scan | only the intended deleted/modified files |

`git diff` vs starter for every modified file: `root.ts`, `router.tsx`,
`sidebar.tsx`, `auth-form.tsx`, `auth.spec.ts`, `biome.json`, `package.json`,
`prisma/schema.prisma` — each diff is exactly the notes-strip/rename, nothing else.

## Files changed (summary)

- **Added (87):** full starter kit — `AGENTS.md`, `.agents/skills/project-structure/SKILL.md`,
  `docs/agents/*` (7), `docs/superpowers/*` (11 — starter's own specs/plans),
  `scripts/*`, `.githooks/*`, `.github/*`, all `backend/ frontend/ shared/ e2e/`
  sources, configs (`biome.json`, `knip.json`, `tsconfig.json`, `bunfig.toml`,
  `playwright*.config.ts`, `prisma.config.ts`, `Dockerfile`, `fly.toml`,
  `.mcp.json`, `apm.yml`, `apm.lock.yaml`, `.gitignore`, `.bun-version`,
  `.dockerignore`, `bun.lock`, `README.md`, `requirements.txt`, `.env.example`).
- **Added:** `prisma/migrations/20261001103923_init/migration.sql` (re-baselined).
- **Modified:** the 8 files listed in Step 2.
- **Not committed:** `.env` (gitignored).
- **Already present, untouched:** `requirements.md`, `docs/superpowers/plans/2026-10-01-music-vote.md`, `docs/superpowers/specs/2026-10-01-music-vote-design.md`.

## Self-review findings

- Every brief step done; notes demo fully removed (no leftover references in
  tracked source; only unrelated path-normalization test strings remain, which
  do not depend on the notes router).
- Starter conventions preserved: tabs, no semicolons, single quotes — biome
  verify passes unchanged.
- No new scaffolding, stubs, TODOs, or files added beyond the copied kit.
- Followed `.agents/skills/project-structure/SKILL.md`: no new top-level dirs,
  deletions removed their co-located `__tests__`.

## Concerns

1. **`bun run check` initially failed on a fresh install (environment quirk, not
   code).** After `bun install`, `node_modules/.bin/bun` was the placeholder
   shim from the npm `bun@1.4.0` package (a peer dep of `bun-plugin-tailwind`),
   because Bun did not run that package's postinstall. `bun run test` resolves
   `bun` through `node_modules/.bin` and hit the shim with
   `Error: Bun's postinstall script was not run.` I fixed it locally with
   `cd node_modules/bun && node install.js` (now the real 63 MB binary), after
   which the gate is green. This lives in gitignored `node_modules/` and is not
   part of the commit. **Impact:** any fresh `bun install` / CI run may hit the
   same thing. Possible durable fix (out of Task 1 scope): add `"bun"` to
   `package.json#trustedDependencies`. Recommend the controller decide whether
   later tasks/CI need this.
2. **Starter's own `docs/superpowers/*` (11 files) were copied** because the
   brief says "everything from `~/Code/mino-starter`". They are mino-starter's
   design history and now sit alongside music-vote's own SDD specs/plans under
   the same path (no filename collisions). Easy to `git rm` if unwanted.
3. **`e2e/auth.spec.ts` adapted.** The old test did "signup → assert `/notes` →
   Sign out". The only Sign out button lived on the (now deleted) notes route;
   home/AppLayout have no sign-out affordance, so I retargeted the test to
   "signup lands on home" (assert URL `/`). No sign-out UI remains anywhere —
   auth sign-in/sign-up still works, sign-out UI is gone until a later task adds
   it. Adding sign-out to the sidebar would have been an unapproved product
   change, so I did not.
4. **Branding not renamed beyond `package.json`.** Per the brief's exact values,
   only `package.json#name` became `music-vote`. Leftover `mino-starter` strings
   remain in `shared`/frontend (sidebar wordmark, `backend/trpc/public.ts`
   `siteInfo`, `home.tsx` fallback, README, AGENTS.md title). `e2e/ssr.spec.ts`
   asserts the starter tagline, which is unchanged. Tell me if the intent was a
   full user-facing rename; that would be a follow-up edit.
5. **`requirements.txt` (starter stack spec) + `requirements.md` (music-vote's
   own, pre-existing) now co-exist.** Both copied/kept verbatim per "copy
   everything". Flag if one should be dropped.
6. **`.githooks` copied but not activated** — `core.hooksPath` was not set (the
   brief doesn't ask; `bun run bootstrap` normally does it). Commits/pushes
   won't run the hooks until set.

---

## Follow-up fix (controller ruling)

Commit: `c380087 fix: trust bun postinstall, prune starter-era planning docs`

1. **Fresh-clone fix (Concern 1 resolved).** Added `"bun"` to
   `package.json#trustedDependencies` (alongside `"@lightpanda/browser"`);
   `bun.lock` picked up the matching `trustedDependencies` entry.
   Verified by forcing a clean re-install of the package:
   `rm -rf node_modules/bun && bun install` →
   `node_modules/bun/bin/bun.exe` is now the real **60.6 MB** binary
   (Mach-O `cffaedfe`) instead of the 450 B placeholder shim, so
   `bun run test` no longer hits `Error: Bun's postinstall script was not run.`
   `bun run check` re-run after the change: **all green** (biome + typecheck +
   knip + 16 tests). A fresh clone / CI `bun install` should now produce a
   working `node_modules/.bin/bun` without the manual `node install.js` step.
2. **Starter-docs prune.** Deleted `docs/superpowers/specs/2026-07-*.md` (5),
   `docs/superpowers/plans/2026-07-*.md` (4) and
   `docs/superpowers/brainstorming-tasks.md` (1) — 10 files. Kept
   `docs/superpowers/README.md` and the two `2026-10-01` music-vote files, plus
   `requirements.txt` and `docs/agents/` as before.
3. **Branding strings:** no action — deferred to Task 15.
4. Diff: 12 files (`package.json` + `bun.lock` modified, 10 docs deleted),
   +3 / -3789. Working tree clean.

### Open flag on the prune

The ruling's globs were `specs/2026-07-*` / `plans/2026-07-*`, so I did **not**
touch the also-starter-era `2026-08-28` pair, per "Do not touch anything else":

- `docs/superpowers/specs/2026-08-28-prod-only-e2e-gate-design.md`
- `docs/superpowers/plans/2026-08-28-prod-only-e2e-gate.md`

They are mino-starter files that rode along (not music-vote docs). If the
intent was "keep only README.md + the two 2026-10-01 files", these two should be
deleted too — say the word and I'll add them to a follow-up.

Also noted: the kept `docs/superpowers/README.md` still lists the deleted
2026-07 specs/plans in its tables (stale links). And `AGENTS.md` does **not**
actually reference `docs/superpowers/README.md` (verified via grep); the README
was kept per the ruling anyway.

**Final prune (commit b00cbd0):** deleted the 2026-08-28 starter-era pair and docs/superpowers/README.md; docs/superpowers/ now holds exactly the two 2026-10-01 music-vote files, and `bun run check` is green.

---

## Review fix round 1 — stale `bun.lock` workspace name

Finding (Important): `bun.lock` `workspaces[""].name` was `"mino-starter"`,
contradicting `package.json` `"music-vote"`.

- Reproduced the frozen path **before** fixing: `bun install --frozen-lockfile`
  actually succeeded (exit 0, "no changes") even with the mismatch — bun 1.4.2
  does not compare the workspace name. No hard break here, but the stale name is
  a real contradiction and is fixed regardless.
- How bun stores it: a plain field at `bun.lock` → `workspaces[""].name`.
  Tried a full regen (`rm bun.lock && bun install`): it corrected the name but
  also churned the lock (124+/78−, bumped caret deps — knip 6.32.3→6.39.0,
  `@types/node` 26.4.0→26.6.3, isbot 5.2.1→5.2.2, react-query-devtools
  5.102.7→5.104.0, added transitive packages). That is out-of-scope drift, so I
  restored the lock and hand-edited only that one field.
- Command: `sed -i '' 's/^      "name": "mino-starter",$/      "name": "music-vote",/' bun.lock`
- `bun install --frozen-lockfile` → exit 0, 38 packages reinstalled
  (node_modules reconciled back to the locked versions).
- Plain `bun install` → "no changes", name stays `music-vote` (idempotent).
- `bun run check` → `✓ all checks passed` (16 tests).
- Diff: `bun.lock` 1 line (+1/−1). Commit `6f31436`.
