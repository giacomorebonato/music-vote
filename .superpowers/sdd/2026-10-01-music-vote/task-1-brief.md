### Task 1: Bootstrap repo from mino-starter

**Files:**
- Create: everything from `~/Code/mino-starter` except `.git/`, `dev.db`, `test.db`, `.env`, `node_modules/`
- Modify: `package.json` (name → `music-vote`), `frontend/router.tsx` + `frontend/routes/notes.tsx` + `frontend/components/note-*.tsx` + `backend/trpc/root.ts` + `backend/trpc/notes.ts` + `shared/schemas/note.ts` + prisma `Note` model + any `e2e/` note references → **deleted**
- Keep: starter's `AGENTS.md`, `.agents/skills/project-structure/`, `docs/agents/`, scripts, hooks (they document conventions this plan follows)

**Interfaces:**
- Produces: working starter skeleton — auth, `appRouter` with only `public` router, clean `bun run check`.

- [ ] **Step 1: Copy starter** — `rsync -a --exclude .git --exclude node_modules --exclude 'dev.db' --exclude 'test.db' --exclude .env ~/Code/mino-starter/ ./` then `bun install && cp .env.example .env` and set `BETTER_AUTH_SECRET`.
- [ ] **Step 2: Strip notes demo** — delete files above; remove `Note` model + its `notes` relation on `User`; delete the note migration (re-baseline: `rm -rf prisma/migrations/* && bun run db:migrate -- --name init`); remove notes route from `router.tsx`.
- [ ] **Step 3: Verify** — `bun run check` (biome + typecheck + knip + unit) — must pass with zero unused-export errors; `bun run dev` serves login + home.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore: bootstrap from mino-starter (notes demo stripped)"`.

