# music-vote — Env, Deploy, Ops

Product-level runbook for the deployed app. Design + failure behavior live in
[the spec](../superpowers/specs/2026-10-01-music-vote-design.md); generic Fly
plumbing (Dockerfile, VM sizing, migrations-on-boot) lives in
[deployment.md](deployment.md).

## Process shape

One Bun process (`backend/server.ts`) serves everything on one port: the SPA
shell + hashed assets, tRPC (`/api/trpc`), better-auth (`/api/auth`), the
WebSocket upgrade (`/ws`), and prod-only bot prerender. The server is the
conductor and single source of truth for room state (Prisma/SQLite); the **host
browser is the audio engine** (`@strudel/web`); phones are vote buttons with no
login. LLM calls happen server-side only — API keys never reach a browser.

## Env vars

`.env.example` mirrors this list; the code is the source of truth.

| Var | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | prod | `file:./dev.db` | Prod is baked into the Dockerfile (`file:/data/prod.db`), not a secret. |
| `BETTER_AUTH_SECRET` | yes | — | `openssl rand -base64 32`. Rotating it logs out every user. |
| `BETTER_AUTH_URL` | yes | — | `http://localhost:3000` dev / `https://music-vote.fly.dev` prod. |
| `PORT` | no | `3000` | Must match `fly.toml` `internal_port`. |
| `LLM_PROVIDER` | no | `ollama` | `ollama` or `mock`. Anything else throws at first LLM call. |
| `OLLAMA_BASE_URL` | no | `http://localhost:11434` | Local Ollama in dev; `https://ollama.com` for cloud in prod. |
| `OLLAMA_MODEL` | yes (ollama) | — | Model tag, e.g. `llama3.1`. Missing → `OLLAMA_MODEL is required`. |
| `OLLAMA_API_KEY` | no | — | Sent as `Authorization: Bearer <key>`. Ollama cloud key → Fly secret. |
| `LLM_MOCK_SCRIPT` | yes (mock) | — | Path to `{ "responses": string[] }`; responses are popped in order and the provider throws when exhausted, so tests never hit a real model. |
| `SSR_CACHE_DIR` | no | `mkdtemp` dir | Bot-prerender HTML cache — see [bot-ssr.md](bot-ssr.md). |
| `LIGHTPANDA_EXECUTABLE_PATH` | no | `~/.cache/lightpanda-node/lightpanda` | Prod sets it in the Dockerfile. Leave it unset rather than empty — an empty assignment is passed through as an empty path and silently disables bot prerender. |
| `MV_E2E_FAST` | test-only | — | `1` shrinks the poll open window to 5s and clamps the interval minimum to 10s (`backend/polls/scheduler.ts`). Set by `playwright.config.ts` only. |

## Local run with the mock LLM

```sh
bun run bootstrap                 # deps + skills/MCP + prisma generate + migrate + hooks
cp .env.example .env              # set BETTER_AUTH_SECRET
# in .env:
#   LLM_PROVIDER=mock
#   LLM_MOCK_SCRIPT=e2e/fixtures/llm-script.json
bun run dev                       # http://localhost:3000
```

Real musicality needs a real provider: point `OLLAMA_BASE_URL` at a local Ollama
(`ollama serve`, `OLLAMA_MODEL=llama3.1`) or at `https://ollama.com` with
`OLLAMA_API_KEY`. Nothing in CI tests that — the model choice is not
automatable, so it stays a manual check.

## Deploy (Fly.io)

App `music-vote`, volume `music_vote_data` mounted at `/data` (see `fly.toml`).

```sh
fly auth login
fly apps create music-vote
fly volumes create music_vote_data --size 1        # one region; omit --region for nearest
fly secrets set \
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  BETTER_AUTH_URL=https://music-vote.fly.dev \
  OLLAMA_BASE_URL=https://ollama.com \
  OLLAMA_API_KEY=<ollama-cloud-key> \
  OLLAMA_MODEL=llama3.1
fly deploy
fly apps open
```

`fly.toml` carries non-secret config only, so the Ollama endpoint and model are
set as Fly env/secrets at deploy time (`LLM_PROVIDER` defaults to `ollama`).
Redeploy after code changes: `fly deploy`. Migrations run on every boot
(`migrate deploy`, idempotent).

## Ops notes

- **One machine, forever.** SQLite lives on a local Fly volume — there is no
  shared filesystem. Never `fly scale count >1` and never add a second region:
  two machines would each see a different partial DB. Scaling out later means
  room→machine assignment, which is explicitly out of scope.
- **WebSockets over `[http_service]`.** `/ws` is upgraded inside `Bun.serve`
  (a `routes` entry in dev, the `fetch` handler in prod) and rides the same
  `internal_port = 3000` as HTTP; no extra Fly flag or second service is
  needed. The app sends no application-level ping, and a host channel can sit
  idle for a whole poll interval, so do not add proxy settings that close idle
  sockets aggressively — a dropped socket means the host's music stops until
  the client reconnects (it retries with capped backoff and re-applies
  `currentCode`). Verify a deploy by opening a host page and watching it hold
  the connection across at least one poll interval.
- **Scale-to-zero is safe for data, not for a live set.** `auto_stop_machines`
  with `min_machines_running = 0` sleeps the app when idle; `/data` survives
  stop/start and wake-on-request adds a cold-start delay before the first vote
  lands. An open room holds WebSocket connections, which keeps the machine
  awake.
- **Server restart mid-set.** `PollScheduler` rebuilds timers from the DB
  (polls are timestamped, not tick-based): an overdue poll closes with no
  change, and the host browser reconnects and re-applies `currentCode`.
- **LLM down / slow.** Polls keep running from the pre-generated question
  queue; music freezes at the last-good pattern and the host page surfaces a
  warning. The host is told, the show keeps going.
- **Invalid codegen** (twice) or a failed browser sandbox eval → no change is
  applied, the last-good pattern keeps playing, the poll closes normally and
  the failure is logged.
- **Deploy freshness.** `NODE_ENV=production` is set in the Dockerfile; without
  it the SPA shell is served unbundled from the dev server path. The build must
  produce `dist/` (`bun run build`) — `fly deploy` builds from the Dockerfile.

## Known limitations

- **Host disconnect = music stops.** The host browser *is* the audio engine
  (`@strudel/web`); if it closes or loses its socket, the venue goes silent.
  The room state survives on the server and the host can reconnect, but
  playback is not restored to the exact phase — the current pattern restarts.
- **Venue wifi and samples.** `@strudel/web` ships no offline sound bank. Init
  registers `github:tidalcycles/dirt-samples` and the browser lazily fetches
  each sample file on first use; only a core drum set (`bd`, `sd`, `cp`, `hh`)
  is warmed at startup. On bad venue wifi a freshly voted pattern that
  introduces new sounds can be silent for its first cycle. No fix short of
  bundling samples (not viable at ~170 MB).
- **Audio needs a gesture.** The AudioContext resumes on the first
  click/touch; keyboard-only activation will leave the host page silent.
- **One player per page.** Strudel is a single global engine, so exactly one
  host player may be mounted at a time — unmounting calls `hush()`.
- **Phones never hear audio.** Voting only; the sound comes from the host
  machine into the PA.
