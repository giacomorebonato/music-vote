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

| Var                          | Required     | Default                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`               | prod         | `file:./dev.db`                       | Prod is baked into the Dockerfile (`file:/data/prod.db`), not a secret.                                                                                                                                                                                                                                                                                                                                      |
| `BETTER_AUTH_SECRET`         | yes          | —                                     | `openssl rand -base64 32`. Rotating it logs out every user.                                                                                                                                                                                                                                                                                                                                                  |
| `BETTER_AUTH_URL`            | yes          | —                                     | `http://localhost:3000` dev / `https://music-vote.fly.dev` prod.                                                                                                                                                                                                                                                                                                                                             |
| `PORT`                       | no           | `3000`                                | Must match `fly.toml` `internal_port`.                                                                                                                                                                                                                                                                                                                                                                       |
| `LLM_PROVIDER`               | no           | `ollama`                              | `ollama` or `mock`. Anything else throws at first LLM call.                                                                                                                                                                                                                                                                                                                                                  |
| `OLLAMA_BASE_URL`            | no           | `http://localhost:11434`              | Local Ollama in dev; `https://ollama.com` for cloud in prod.                                                                                                                                                                                                                                                                                                                                                 |
| `OLLAMA_MODEL`               | yes (ollama) | —                                     | Model tag, e.g. `llama3.1`. Missing → `OLLAMA_MODEL is required`.                                                                                                                                                                                                                                                                                                                                            |
| `OLLAMA_API_KEY`             | no           | —                                     | Sent as `Authorization: Bearer <key>`. Ollama cloud key → Fly secret.                                                                                                                                                                                                                                                                                                                                        |
| `OLLAMA_TIMEOUT_MS`          | no           | `25000`                               | Per-request LLM deadline in ms. Slow cloud models (e.g. `glm-5.2:cloud`, 30-60s per generation) need this raised, e.g. `120000`, or evolutions and the outro time out. Unset/empty/non-positive keeps the default.                                                                                                                                                                                           |
| `LLM_MOCK_SCRIPT`            | yes (mock)   | —                                     | Path to `{ "responses": string[], "crowdResponses"?: string[], "directionResponses"?: string[], "steerResponses"?: string[] }`. Each `getLlmProvider()` call builds a fresh provider that re-reads the file from index 0 and pops responses in order (one instance throws when exhausted); crowd/direction/steer prompts fall back to `responses` when their key is absent, so tests never hit a real model. |
| `SSR_CACHE_DIR`              | no           | `mkdtemp` dir                         | Bot-prerender HTML cache — see [bot-ssr.md](bot-ssr.md).                                                                                                                                                                                                                                                                                                                                                     |
| `LIGHTPANDA_EXECUTABLE_PATH` | no           | `~/.cache/lightpanda-node/lightpanda` | Prod sets it in the Dockerfile. Unset or empty falls back to the default.                                                                                                                                                                                                                                                                                                                                    |
| `MV_TEST_POLL_OPEN_SECS`     | no           | —                                     | Dev-only: overrides the per-room poll open window (countdown after voting; create-room field `pollOpenSec`, default 45s with a 15s form floor). Positive integers only; invalid values ignored. `MV_E2E_FAST` keeps precedence (`backend/polls/scheduler.ts`).                                                                                                                                               |

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

At boot the server probes both loopback families and refuses to run on a
conflict (`Port NNNN conflict` prefix): a foreign process answering on `127.0.0.1`,
or answering or accepting-without-answering on `[::1]`. Stop the other
process or set `PORT` — Bun's bind can otherwise coexist silently with a
`127.0.0.1` squatter and browsers hit the wrong app.

## Sharing a dev branch over the tailnet

`bun run dev:net` runs the same dev server through portless with Tailscale
sharing, so phones and teammates on the tailnet can reach the branch under
test without a port number:

```sh
bun run dev:net
# -> <branch>.music-vote.localhost          (this machine)
# -> https://<node>.<tailnet>.ts.net        (tailnet; 8443, 8444, … per extra app)
```

Prerequisites (machine, one-time): `portless` ≥ 0.17 (also a devDependency),
`portless trust` if the proxy runs HTTPS, `tailscale up`, and HTTPS
certificates enabled on the tailnet (`tailscale serve` provisions the LE
cert on first request). Auth needs no configuration under `dev:net`: the
server resolves its `baseURL` from `PORTLESS_TAILSCALE_URL`, then
`PORTLESS_URL`, and trusts the `.localhost` origin (`backend/auth/base-url.ts`).

Frontend HMR is off under `dev:net`: Bun 1.4's dev server rejects any `Host`
that is not `localhost`, `*.localhost` or an IP literal (DNS-rebinding guard,
no `allowedHosts` option yet — oven-sh/bun#47359), so the SPA is served
bundled to tailnet clients. Use plain `bun run dev` while editing.

Verify a shared session the same way as a deploy: open a host page on the
shared URL and watch the `/ws` connection hold across at least one poll
interval; then open the same URL on a phone on the tailnet and cast a vote.

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

## Strudel dependencies

The server transpiler and browser Strudel packages use the same 1.2.6 core.
`scripts/patches/@kabelsalat%2Fweb@0.4.1.patch` fixes the synth dependency's
`main` entry to its shipped ESM build so Bun can import it on the server.
Bun applies the registered patch during install; Docker copies patches before
its frozen install. Recheck this patch when updating Strudel or Kabelsalat.

## Model latency and failed starts

Fly sets `OLLAMA_THINK=low` in `fly.toml` for the deployed MiniMax M3.1 Flash
model. `OLLAMA_THINK` is optional: empty uses the model default; `true`/`false`
become booleans, and other values are model-specific thinking levels. Check a
new model's supported levels before switching it. An existing Fly secret with
the same name overrides `fly.toml`.

Keep each Ollama request bounded by `OLLAMA_TIMEOUT_MS` (default 25 seconds;
slow cloud models raise it — the local glm-5.2:cloud demo needed 120000 for a
clean outro). Generation retries once and
logs whether each attempt failed at the provider or during pattern validation;
opening/outro errors retain the last failure in the host-visible message and
Error cause. Logs omit prompts, generated code, and API keys.

When a set cannot start, test the opening prompt from the Fly machine with the
same model and thinking level. A successful `/api/tags` request only proves the
endpoint is reachable, not that generation finishes within the deadline. In a
production probe, MiniMax's default thinking timed out at both 25 and 90 seconds;
`think: "low"` returned a validated opening pattern in about 10 seconds.

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
- **Server restart mid-set.** `backend/server.ts` awaits `bootSchedulers()`
  (`backend/boot.ts`) once the server is listening, which runs
  `PollScheduler.restoreSchedulers()`: live rooms are re-armed, overdue open
  polls close with no change, and outro rooms resume or finalize (polls are
  timestamped, not tick-based). A restore failure is logged and non-fatal — the
  server still starts, but rooms stay orphaned until the next restart.
- **LLM down / slow.** Polls keep running from the pre-generated question
  queue; music freezes at the last-good pattern and the host page surfaces a
  warning. The host is told, the show keeps going.
- **Invalid codegen** (twice) or a failed browser sandbox eval → no change is
  applied, the last-good pattern keeps playing, the poll closes normally and
  the failure is logged.
- **Boot probes run on every boot, in every env.** After `Bun.serve`,
  `backend/server.ts` probes `127.0.0.1` (must answer with our tRPC JSON) and
  `[::1]` (must be refused) and exits 1 on a conflict. The IPv6 probe
  classifies only two outcomes as occupied — an answered probe, or a
  connection accepted-but-silent (timeout): Bun's fetch wraps connect
  failures in version- and platform-drifting text (1.4.2 on Linux emits no
  errno token, 1.4.4+/canary prefix one), so never match on errno strings —
  every other connect failure resolves as free. Triage a down machine from
  its machine events: `exit_code 1` + `restart_count` climbing = boot-time
  refusal; the error line is in the machine's console via `flyctl logs`.
- **Deploy freshness.** `NODE_ENV=production` is set in the Dockerfile; without
  it the SPA shell is served unbundled from the dev server path. The build must
  produce `dist/` (`bun run build`) — `fly deploy` builds from the Dockerfile.

## Known limitations

- **Host disconnect = music stops.** The host browser _is_ the audio engine
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

## Crowd contributions and recording operations

Seven preference dimensions upgrade existing live rooms additively. Stable keys
and catalog version 1 preserve the original energy/rhythm/mood choices and votes.
Text directions default on; recorded sounds and audience moments default off.
The host enables them in Crowd contributions. Sound approval defaults on.

- `FFMPEG_PATH` defaults to `ffmpeg`. Install FFmpeg locally; Docker and CI install
  the distribution package. Bun invokes it directly without a shell. The worker
  has one concurrent decoder, a 15-second deadline, a restricted input format and
  protocol list, a maximum allocation, a three-second output cap, and mono 24 kHz WAV output.
- `RECORDINGS_DIR` defaults to `.recordings`; the production image sets it to
  `/data/recordings` on the existing Fly volume. Keep the single-machine constraint.
- `RECORDINGS_RETENTION_HOURS` defaults to 24 after the room closes. Cleanup runs
  at boot and every minute. Withdrawn, rejected, and failed files are deleted on
  the next cleanup; expired live-room assets remain inaccessible until cleanup
  after the room's retention deadline. Old orphan files are removed as well.
- Uploads are capped at 2 MiB and rejected when fewer than 32 MiB of disk remain.
  One pending upload per phone, ten queued clips per room, twenty across the server, and a 30-second phone
  interval bound processing and storage. Retries with
  the same idempotency key retrieve the existing outcome; re-recording uses a fresh key.
- After restart, interrupted uploads fail visibly and interrupted processing is
  queued again. Ready assets stay durable. Pending sample candidates recover via
  the existing version replay, with renewed asset access tickets.
- The host browser's microphone is not required. Listener microphone permission
  needs HTTPS or localhost. Host audition is audible through the browser's current
  output, including the PA. The audio layer shares Strudel's AudioContext and clock,
  and releases its buffers after playback rather than keeping a global sample cache.

Run `bun run verify` before merging. The contribution browser test uses the real
MediaRecorder with Chromium's simulated microphone. WAV, WebM/Opus, and MP4/AAC
are decoded by real FFmpeg in unit tests. These checks do not establish physical
phone capture quality or venue acoustics. Rehearse on physical iOS and Android
phones before turning on crowd sounds at a public event.
