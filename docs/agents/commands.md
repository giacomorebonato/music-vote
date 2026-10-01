# Scripts, Env Vars, Git Hooks, Tooling

## Scripts

`package.json` is the source of truth. The non-obvious ones:

- `bun run dev` — dev server with HMR (`bun --hot backend/server.ts`)
- `bun run build` — production bundle via `scripts/build.ts` (`Bun.build`), React Compiler enabled — see [react-compiler.md](react-compiler.md) and [conventions.md](conventions.md#build-internals)
- `bun run start` — production server (`NODE_ENV=production bun backend/server.ts`)
- `bun run test` — unit tests (`bun test backend shared frontend`; co-located `__tests__/` next to each source)
- `bun run test:e2e` — Playwright E2E
- `bun run test:e2e:ssr` — SSR E2E against the prod server (separate `playwright.ssr.config.ts`; clears its cache in `e2e/global-setup.ts`). The default `playwright.config.ts` ignores `ssr.spec.ts`
- `bun run check` — pre-merge gate (`scripts/check.sh`): Biome check + typecheck + knip + unit tests. Shared with CI. Run **before claiming any work done**
- `bun run check:full` — `check` + Playwright E2E. Run before claiming UI/auth/route work done (E2E is intentionally excluded from `check` for speed)
- `bun run format` — Biome check + format, **writes fixes** (`biome check --write .`); `check` verifies without writing
- `bun run bootstrap` — fresh-clone setup (deps + APM skills/MCP + Prisma client + migrate dev DB + git hooks); idempotent
- `bun run premerge` — `check`, then fast-forward current branch → main and push
- `bun run db:migrate` — `prisma migrate dev && prisma generate` (v7: `migrate dev` no longer auto-generates the client) — see [prisma.md](prisma.md)
- `bun run db:reset` — `prisma migrate reset`

`postinstall` runs `prisma generate`.

### Test databases

Each DB-backed unit test file owns and migrates its own SQLite file at module load — `prisma/models-test.db`, `prisma/rooms-test.db`, `prisma/scheduler-test.db`, `prisma/votes-test.db`. They must never share one: `bun test --parallel` runs the files in separate worker processes, and two `prisma migrate deploy` runs against the same fresh SQLite file deadlock (`database is locked`) and leave it schema-less, so a cold checkout fails the gate. `prisma/test.db` belongs to the Playwright suites alone (`scripts/e2e-reset-db.sh`); the unit tests never touch it.

Run the gate (`bun run check`) — or `bun run test --parallel` — for unit tests. A **bare** `bun test` (Bun 1.4.2's default, non-isolated mode) fails ~42 DB/mock tests for pre-existing reasons unrelated to product code: `mock.module` is process-global and leaks between files, and the shared Prisma client gets built against `.env`'s `dev.db`. Those failures are a harness artifact — do not "fix" them by weakening tests. `--isolate` is CLI-only in 1.4.2; `[test] isolate` / `[test] parallel` in `bunfig.toml` are ignored.

## Env vars

`.env.example` is the source of truth. Highlights:

- `DATABASE_URL` — `file:./dev.db` (dev), `file:./test.db` (E2E test DB), `file:/data/prod.db` (prod); unit tests override it per file (see [Test databases](#test-databases))
- `BETTER_AUTH_SECRET` — random, e.g. `openssl rand -base64 32`
- `BETTER_AUTH_URL` — e.g. `http://localhost:3000` (dev) / `https://music-vote.fly.dev` (prod)
- `LLM_PROVIDER` / `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `OLLAMA_API_KEY` / `LLM_MOCK_SCRIPT` — LLM provider config; prod deploy + ops notes in [music-vote.md](music-vote.md)
- SSR prerender (optional, prod-only): `SSR_CACHE_DIR`, `LIGHTPANDA_EXECUTABLE_PATH` — see [bot-ssr.md](bot-ssr.md)

`NODE_ENV` and `REACT_COMPILER` come from the scripts/Dockerfile rather than `.env`; `MV_E2E_FAST` is test-only (set by `playwright.config.ts`).

## Git hooks

`.githooks/pre-commit` runs Biome check + typecheck. `.githooks/pre-push` runs the full `scripts/check.sh` gate. `bun run bootstrap` sets `core.hooksPath = .githooks`. Bypass with `--no-verify` only when intentionally breaking the gate.

## Knip

Knip runs in CI and inside `bun run check`; it **fails** on unused dependencies, files, or exports. Run it after any file add/move.

## Skills / MCP

`apm.yml` is the canonical list of skills + MCP servers (frontend-design, TanStack, daisyUI skills; Playwright, GitHub, Prisma, Context7 MCP). `bun run bootstrap` (or `apm install`) installs them.

`.mcp.json` is a minimal hand-maintained fallback (Context7 only) for agents that read `.mcp.json` directly and do not understand APM; it is intentionally **not** kept in lockstep with `apm.yml` because some APM-managed servers need tokens/secrets that should not be committed to the repository. Do not hand-add token-gated servers to `.mcp.json`.