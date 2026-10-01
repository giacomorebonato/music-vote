# Deployment (Fly.io)

Target: app `mino-starter` on Fly.io. Infra files live in repo: `Dockerfile` (multi-stage Bun build) + `fly.toml` (app, volume mount, http_service).

- **Image**: `Dockerfile` — build stage installs deps, runs `prisma generate`, bundles frontend to `dist/`, compiles CSS; runtime stage copies `node_modules`/`dist`/`backend`/`shared`/`prisma`/`prisma.config.ts`, sets `DATABASE_URL=file:/data/prod.db` + `PORT=3000`, and runs `./node_modules/.bin/prisma migrate deploy && bun run backend/server.ts` on boot (migrations are idempotent, safe to run every start). Prisma CLI runs under Bun in the `oven/bun` image.
- **SQLite persistence**: Fly volume `mino_starter_data` mounted at `/data` (see `fly.toml` `[mount]`). `prod.db` lives there and survives deploys and scale-to-zero. Lost only if the volume is deleted. SQLite volume is local to one machine — do **not** scale `>1` machine (no shared FS).
- **VM**: `shared-cpu-1x` with 512MB RAM (see `fly.toml` `[[vm]]`). Fits because Prisma's Rust query engine is gone — the `prisma-adapter-bun-sqlite` driver uses Bun's native `bun:sqlite`.
- **Auto-stop**: `auto_stop_machines = true`, `min_machines_running = 0` → app sleeps when idle, wakes on request. Volume persists across stop/start.
- **Secrets** (set via `flyctl secrets set`): `BETTER_AUTH_SECRET` (random, `openssl rand -base64 32`), `BETTER_AUTH_URL=https://mino-starter.fly.dev`, `NODE_ENV=production`. `DATABASE_URL` is baked into the Dockerfile env, not a secret.
- **First deploy** (new app):
  ```sh
  flyctl auth login
  flyctl apps create mino-starter
  flyctl volumes create mino_starter_data --size 1   # pick region or omit for nearest
  flyctl secrets set BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
    BETTER_AUTH_URL=https://mino-starter.fly.dev NODE_ENV=production
  flyctl deploy
  ```
- **Redeploy** (update code, keep data): `flyctl deploy`.
- **Replace an existing app** (fresh state, wipes data): `flyctl apps destroy mino-starter` then run the first-deploy steps. The volume must be recreated.
- **Open**: `flyctl apps open` → `https://mino-starter.fly.dev`.
- **Caveats**: single-machine only (SQLite volume). `better-auth` sessions rely on `BETTER_AUTH_SECRET` — rotating it logs out all users. Devtools are dev-only and excluded from the prod bundle via the `scripts/build.ts` stub plugin.