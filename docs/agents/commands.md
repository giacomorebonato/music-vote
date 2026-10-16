# Scripts, Env Vars, Git Hooks, Tooling

## Scripts

`bun check`, `bun lint`, and `bun fmt` are native Bun commands. There are no package scripts with those names, and no `format` or `typecheck` aliases. Development and CI use Bun canary from `.bun-version`: Bun 1.4.3 has native type checking but does not yet ship the formatter/linter used here. Production keeps the stable runtime pinned in `Dockerfile`. `[run].bun = true` keeps nested scripts on the invoking Bun rather than the older Bun binary installed as a Tailwind plugin peer dependency. Knip lists native subcommands in `ignoreBinaries` because its shell parser otherwise treats them as external packages.

- `bun check` — typecheck the project using `tsconfig.json`; never writes files. Bun does not support `check --staged`.
- `bun lint` — lint the project; `--fix` applies fixes and `--staged` limits the selected files.
- `bun fmt` — format files using `[fmt]` in `bunfig.toml`. `--check` verifies without writing. `--staged` selects staged files; without `--check` it writes and re-stages them, refusing partially staged files.
- `bun run verify` — native type/lint/format checks, knip, isolated unit tests, then both Playwright suites (development and production SSR) on a fresh server at port 3100 (`PLAYWRIGHT_PORT` overrides it). This is the complete merge/CI gate.
- `bun run dev` — dev server with HMR (`bun --hot backend/server.ts`).
- `bun run build` — production bundle via `scripts/build.ts`, React Compiler enabled; see [react-compiler.md](react-compiler.md).
- `bun run start` — production server.
- `bun run test` — unit tests (`bun test backend shared frontend`); pass `--parallel` for isolation.
- `bun run test:e2e` — development Playwright suite.
- `bun run test:e2e:ssr` — production SSR Playwright suite.
- `bun x --no-install knip` — unused dependencies, files, and exports. Set `DATABASE_URL=file:./dev.db` when no `.env` exists so Knip can load the Prisma config.
- `bun run bootstrap` — dependencies, APM skills/MCP, Prisma client, development DB migration, and Git hook installation.
- `bun run premerge` — `verify`, then fast-forward current branch → main and push.
- `bun run db:migrate` — Prisma development migration and client generation.
- `bun run db:reset` — Prisma migration reset.

`postinstall` runs `prisma generate`.

### Test databases

Each DB-backed unit test file owns and migrates its own SQLite file at module load — `prisma/models-test.db`, `prisma/rooms-test.db`, `prisma/scheduler-test.db`, `prisma/votes-test.db`. They must never share one: `bun test --parallel` runs the files in separate worker processes, and two `prisma migrate deploy` runs against the same fresh SQLite file deadlock (`database is locked`) and leave it schema-less, so a cold checkout fails the gate. `prisma/test.db` belongs to the Playwright suites alone (`scripts/e2e-reset-db.sh`); the unit tests never touch it.

Run the gate (`bun run verify`) — or `bun run test --parallel` — for unit tests. A **bare** `bun test` (Bun 1.4.2's default, non-isolated mode) fails ~42 DB/mock tests for pre-existing reasons unrelated to product code: `mock.module` is process-global and leaks between files, and the shared Prisma client gets built against `.env`'s `dev.db`. Those failures are a harness artifact — do not "fix" them by weakening tests. `--isolate` is CLI-only in 1.4.2; `[test] isolate` / `[test] parallel` in `bunfig.toml` are ignored.

## Env vars

`.env.example` is the source of truth. Highlights:

- `DATABASE_URL` — `file:./dev.db` (dev), `file:./test.db` (E2E test DB), `file:/data/prod.db` (prod); unit tests override it per file (see [Test databases](#test-databases))
- `BETTER_AUTH_SECRET` — random, e.g. `openssl rand -base64 32`
- `BETTER_AUTH_URL` — e.g. `http://localhost:3000` (dev) / `https://music-vote.fly.dev` (prod)
- `LLM_PROVIDER` / `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `OLLAMA_API_KEY` / `LLM_MOCK_SCRIPT` — LLM provider config; prod deploy + ops notes in [music-vote.md](music-vote.md)
- SSR prerender (optional, prod-only): `SSR_CACHE_DIR`, `LIGHTPANDA_EXECUTABLE_PATH` — see [bot-ssr.md](bot-ssr.md)

`NODE_ENV` and `REACT_COMPILER` come from the scripts/Dockerfile rather than `.env`; `MV_E2E_FAST` is test-only (set by `playwright.config.ts`); `MV_TEST_INTERVAL_SECS` (compresses room poll intervals down) and `MV_TEST_POLL_OPEN_SECS` (overrides the per-room poll open window) are dev-only global escape hatches — the normal way to test with fast timings is the create-room form (`pollIntervalSec` floor 5s, `pollOpenSec` floor 15s, see `backend/polls/scheduler.ts`).

## Git hooks

`.githooks/pre-commit` runs native `bun check`, `bun lint --staged`, and `bun fmt --check --staged`. Type checking covers the project; lint and formatting use Bun's native staged-file selection. Hooks do not apply fixes or stage files. There is no custom index snapshot or hidden wrapper.

`.githooks/pre-push` runs native checks, knip, and unit tests; pushes to main run `bun run verify` and require a clean tree at the commit being pushed. `.githooks/pre-merge-commit` runs `verify` for merge commits on main, including manually completed merges via pre-commit. Git has no merge hook for fast-forwards: use `bun run premerge` for a tested fast-forward. CI runs `verify` for main and its pull requests; require its `check` job in branch protection to prevent remote bypasses. `bun run bootstrap` sets `core.hooksPath = .githooks`.

## Knip

Knip runs in CI and inside `bun run verify`; it **fails** on unused dependencies, files, or exports. Run it after any file add/move.

## Skills / MCP

`apm.yml` is the canonical list of skills + MCP servers (frontend-design, TanStack, daisyUI skills; Playwright, GitHub, Prisma, Context7 MCP). `bun run bootstrap` (or `apm install`) installs them.

`.mcp.json` is a minimal hand-maintained fallback (Context7 only) for agents that read `.mcp.json` directly and do not understand APM; it is intentionally **not** kept in lockstep with `apm.yml` because some APM-managed servers need tokens/secrets that should not be committed to the repository. Do not hand-add token-gated servers to `.mcp.json`.
