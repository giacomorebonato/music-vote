# mino-starter

Reusable full-stack starter built **AI-first**: Bun + React + tRPC + better-auth + Prisma + daisyUI. The repo is wired so a coding agent can take a spec and ship a feature with minimal hand-holding — prescriptive `AGENTS.md`, committed placement skill, APM-managed skills + MCP, strict lint, and a one-command bootstrap.

## Quick start (fresh clone)

```sh
bun run bootstrap   # deps + APM skills/MCP + prisma generate + migrate + git hooks
cp .env.example .env # then fill BETTER_AUTH_SECRET etc.
bun run dev          # http://localhost:3000
```

Requires Bun 1.4.2+ (see `.bun-version`).

## Working with an agent

- **Read first:** `AGENTS.md` — stack, conventions, scripts, deploy. It opens with a TL;DR for the first commands and the "add a feature" vertical-slice recipe.
- **Placement rules:** `.agents/skills/project-structure/SKILL.md` — where every file goes and the move verification gate.
- **Prior decisions:** `docs/superpowers/README.md` — index of specs + plans (brainstorm → spec → plan → implement). New work should follow the same flow.
- **Stack constraints:** `requirements.txt` — what to use and what **not** to use (no Vite, no Express/Hono, no npm/pnpm, no `CLAUDE.md`).

## Verification

- `bun run check` — biome + typecheck + knip + unit tests. Run before claiming work done.
- `bun run check:full` — adds Playwright E2E. Run for UI/auth/route changes.
- `bun run premerge` — `check` then fast-forward merge → main → push.

Git hooks (`.githooks/`, wired by `bootstrap`) run biome+typecheck at commit and the full gate at push.

## Scripts

- `bun run dev` — dev server with HMR
- `bun run build` — production bundle
- `bun run start` — production server
- `bun test` — unit tests (backend + shared + frontend)
- `bun run test:e2e` — Playwright E2E
- `bun run check:full` — `check` + `test:e2e`
- `bun run format` — Biome check + format (writes fixes)
- `bun run check` — pre-merge gate (biome + typecheck + knip + test), shared by `premerge` and CI
- `bun run premerge` — run `check`, then fast-forward merge current branch → main and push
- `bun run bootstrap` — one-command fresh-clone setup (idempotent)
- `bun run typecheck` — tsc --noEmit
- `bun run db:migrate` — prisma migrate dev
- `bun run db:reset` — prisma migrate reset

See `AGENTS.md` for agent context and `apm.yml` for the skills/MCP manifest.