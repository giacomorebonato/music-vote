# Bot-triggered SSR via Lightpanda — Design

Date: 2026-07-30
Status: Approved (pending plan)

## Goal

Add SEO-friendly server-rendered HTML to the existing React SPA **without adopting a full SSR framework**. Only search-engine bots receive rendered HTML; real users keep getting the raw SPA shell. Rendering is done by running the SPA's own JS in a headless browser (Lightpanda) on the same Fly VM, behind a TTL disk cache.

## Non-goals

- No SSR for real users. They always get the SPA shell.
- No SSR for auth-gated routes (`/notes`) — bots have no session; rendering them is wasted compute and bad SEO signal.
- No dynamic cache invalidation. TTL only (see Decisions). Public content is assumed to change rarely.
- No dev-mode SSR pipeline. Dev keeps Bun HTMLBundle routes + HMR. Feature is prod-only.

## Decisions (from brainstorm)

1. **Scope**: public routes only. `/notes` (auth-gated) and `/login` (no SEO value) excluded.
2. **Public-route marking**: server-side allowlist in a shared module (`shared/ssr-paths.ts`), imported by the server. No build-time manifest, no route-tree introspection. Single source of truth, explicit, trivial to audit.
3. **Lightpanda location**: same Fly VM, in-process (Bun spawns the lightpanda CDP server as a child process).
4. **Cache invalidation**: TTL only. No manual purge hook, no mutation-tagged invalidation.
5. **Render engine**: `lightpanda.serve()` CDP server + Playwright `connectOverCDP` (not `lightpanda.fetch()`). Chosen because the `@lightpanda/browser` `fetch()` wrapper uses `execSync` (blocks the Bun event loop), exposes no custom-header support, and exposes no `waitUntil`/`networkidle` control — risking an empty-shell dump before async tRPC data renders. Playwright is already a repo dep and is the same toolchain as the verification test.
6. **Cache store**: disk (ephemeral). Configurable dir; defaults to OS `tmpdir()` in prod and `./.ssr-cache` in dev. **Does not survive Fly auto-stop** (accepted tradeoff: re-render after wake; bot traffic is rare so cost is negligible). Chosen over memory to keep rendered HTML out of process RAM and inspectable on disk.
7. **Testing**: one Playwright API/E2E test as the single verification contract. No unit tests.

## Architecture

### Request flow (prod, in `backend/server.ts` `fetch`, strict order)

1. **Static asset** (`serveDistFile`) — first. Lightpanda's own sub-resource fetches for JS/CSS resolve here and never hit the SSR pipeline.
2. **`/api/trpc`** → tRPC fetch handler (unchanged).
3. **`/api/auth`** → better-auth handler (unchanged).
4. **SSR gate** (new) — entered only when `!isDev && PUBLIC_SSR_PATHS.includes(pathname) && isbot(userAgent)`:
   - If `req.headers.get('x-ssr-renderer') === 'lightpanda'` → **recursion break**: serve raw `dist/index.html`. (This is the inner request from the headless browser; it must not re-trigger a render.)
   - Else → `bot_handler`: cache lookup → render-or-serve.
5. Non-bot SPA path → raw `dist/index.html` (unchanged fallback).
6. 404 JSON (unchanged).

Dev is untouched: Bun HTMLBundle `routes` + HMR. Feature gated on `!isDev`.

### Why this order

Static + API handlers run before the SSR gate so lightpanda's inner fetches (page HTML via the `x-ssr-renderer` header; assets via path) can never recurse into another render. The recursion break is header-based (clean canonical URL — no query param needed), which is only possible because Playwright supports custom request headers; the `lightpanda.fetch()` wrapper does not, which is one reason we use Playwright.

## Components (each isolated, independently testable)

- **`shared/ssr-paths.ts`** — exports `PUBLIC_SSR_PATHS: string[]`. Single source of truth for which SPA paths may be bot-rendered. Today effectively empty (`/` redirects to `/notes`, so it has no public content to render yet). This is forward-looking infra, activated when a real public page (e.g. landing) is added.
- **`backend/ssr/allowlist.ts`** — re-exports `PUBLIC_SSR_PATHS` from shared for server-side use.
- **`backend/ssr/cache.ts`** — disk cache. `get(pathname): string | null`, `set(pathname, html): void`.
- **`backend/ssr/renderer.ts`** — Playwright-over-CDP renderer. `render(url): Promise<string>`.
- **`backend/ssr/lightpanda.ts`** — CDP server lifecycle: spawn, health/respawn, SIGTERM cleanup.
- **`backend/ssr/bot-handler.ts`** — orchestrator. isbot + allowlist gate, cache check, single-flight dedupe, render + cache + fallback. Exposes `handleBotRequest(req, url): Promise<Response | null>` (returns `null` when not a bot/SSR path, so `server.ts` falls through).

### Disk cache (`backend/ssr/cache.ts`)

- Config: `SSR_CACHE_DIR` (prod: `os.tmpdir()/mino-ssr-cache`; dev: `./.ssr-cache`). `SSR_CACHE_TTL_MS` (default 3,600,000 = 1h).
- Filename: `sha1(pathname).hex() + '.html'`. Hash avoids path traversal and weird-filename issues.
- `get`: read file; if missing → `null`; if `Date.now() - mtimeMs > TTL` → `null` (stale) and delete the file (lazy cleanup); else return HTML.
- `set`: write to `${key}.tmp` then `rename` to `${key}.html` (atomic). mtime = now.
- No background sweep: few public paths, tiny files, lazy deletion on stale `get` is enough.

### Renderer (`backend/ssr/renderer.ts`)

- `render(url): Promise<string>` using Playwright `chromium` `connectOverCDP` to the lightpanda CDP server.
- Navigate with `extraHTTPHeaders: { 'x-ssr-renderer': 'lightpanda' }`, `waitUntil: 'networkidle'`.
- Timeout: `SSR_RENDER_TIMEOUT_MS` (default 5,000). On timeout/error → throw → `bot-handler` falls back to raw `dist/index.html` (graceful degradation: bot still gets a working SPA shell).
- `await page.content()` → close page → return HTML.
- Reused browser context; new page per render.

### Lightpanda CDP lifecycle (`backend/ssr/lightpanda.ts`)

- Boot: `lightpanda.serve({ host: '127.0.0.1', port: 9222 })` → child process, proc ref stored.
- Health: lazy connect on first render; if connection dead, respawn.
- Shutdown: `process.on('SIGTERM' | 'SIGINT')` → `proc.kill()`. Fly sends SIGTERM on stop.
- Playwright moves from devDependency → dependency (prod runtime needs it). Knip/Biome must not flag it unused.

### Single-flight dedupe (`backend/ssr/bot-handler.ts`)

- In-flight `Map<pathname, Promise<string>>`. Concurrent bot hits on the same pathname await one render; map entry cleared on resolve/reject. Bounds concurrent renders of the same path to one.

### Response headers

- `content-type: text/html; charset=utf-8`.
- `x-ssr: hit | miss | fallback` — observability. `hit` = served from cache; `miss` = cache empty/stale, rendered now and cached; `fallback` = render failed or timed out, served raw SPA shell.

## Recursion-break correctness

The headless browser fetches the public URL to render it. The server receives that fetch. Without a break, the server would hand it back to the renderer → infinite loop. Break mechanism: the renderer navigates with `x-ssr-renderer: lightpanda`. The server's SSR gate checks that header first; if present, it serves the raw SPA shell, which the browser then executes (its tRPC calls hit `/api/trpc` normally — step 2, not the SSR gate — and public routes need no session). The canonical URL the bot originally requested stays clean (no query param), so SEO indexing is unaffected.

## Concurrency & memory (512MB Fly VM)

- Render concurrency **limit = 1**. `bot-handler` serializes renders via a simple queue (await an in-flight render-or-queue promise before starting a new one for a different path). Bot traffic is rare; serial renders keep memory bounded.
- Residents on the VM: Bun server + Prisma (bun:sqlite, no Rust engine) + lightpanda process + one Playwright chromium page at a time. The chromium page is the heaviest resident; serial rendering is what makes 512MB viable.

## Error handling

- Render timeout (`SSR_RENDER_TIMEOUT_MS`) → throw → fallback to raw SPA shell with `x-ssr: fallback`.
- CDP connection dead → respawn lightpanda, retry once; if still failing → fallback.
- Cache read/write failure (disk full, perms) → catch, treat as cache miss / skip cache; never fail the request.
- Any unexpected error in `bot-handler` → fallback to raw SPA shell. SSR must never break the request.

## Testing

One Playwright API/E2E spec: `e2e/ssr.spec.ts`.

Setup: `bun run build` then `bun run start` (prod server + lightpanda CDP). Requires the lightpanda binary in the test env (postinstall download; Linux x86_64 must be supported — verify, else set `LIGHTPANDA_EXECUTABLE_PATH`).

Assertions:
1. Request with bot UA (`Googlebot/2.1`) to a public path:
   - `content-type` is `text/html`.
   - `x-ssr` header present (`miss` on first call, `hit` on second).
   - Body contains content that only exists after JS/tRPC executes (absent from the raw `dist/index.html` shell) — proves real render.
2. Second bot request to same path: `x-ssr: hit` (cache served, no re-render).
3. Request with a normal browser UA: body equals the raw SPA shell (no SSR) — proves the isbot gate.

Until a real public page exists, the test either targets a throwaway public fixture route or is skipped (documented). The test is the single verification contract; no unit tests.

## Deployment (Fly)

- `Dockerfile` runtime stage must provide both browser binaries:
  - **Lightpanda binary** — installed by `@lightpanda/browser` postinstall during the build stage's `bun install`, landing in `/root/.cache/lightpanda-node`. The current runtime stage copies `node_modules` but NOT this cache dir, so the binary is lost. Fix: `COPY --from=build /root/.cache/lightpanda-node /root/.cache/lightpanda-node`. Keeps the default path `getExecutablePath()` reads, no env override needed. (Verify the oven/bun image runs as root so `~` = `/root`; if not, set `LIGHTPANDA_EXECUTABLE_PATH` explicitly to the copied path.)
  - **Playwright `chromium`** — `npx playwright install --with-deps chromium` in the runtime stage (~150MB). This is the real footprint cost — larger than lightpanda itself.
- Boot order: Bun spawns lightpanda on server boot (single entrypoint `bun run backend/server.ts` handles spawn + SIGTERM cleanup). No separate CMD for lightpanda.
- Dockerfile CMD stays `prisma migrate deploy && bun run backend/server.ts`; lightpanda spawn happens inside the server boot, not the CMD.
- `fly.toml` unchanged: volume still only `/data` for the DB. SSR cache is ephemeral `tmpdir`; no new mount.
- Memory: serial-render cap (above) keeps 512MB viable. Watch OOM risk in first deploys; tune timeout / disable SSR via env if needed.

## Env vars

- `SSR_CACHE_DIR` — cache location (default `os.tmpdir()/mino-ssr-cache` prod, `./.ssr-cache` dev).
- `SSR_CACHE_TTL_MS` — default 3,600,000 (1h).
- `SSR_RENDER_TIMEOUT_MS` — default 5,000.
- `SSR_CDP_PORT` — lightpanda CDP port (default 9222).
- `SSR_ENABLED` — kill switch (default `true` in prod). When `false`, the SSR gate is skipped entirely (raw SPA shell for everyone); useful for emergency rollback.

## New deps

- `isbot` — bot UA detection.
- `@lightpanda/browser` — lightpanda binary + serve() API.
- `playwright` — promote from devDependency to dependency (runtime CDP driver).

Add to `.env.example` and document in `AGENTS.md` conventions section.

## Open risks / follow-ups

- **No public page exists today.** Allowlist is effectively empty; SSR produces no value until a landing/public route is added. This spec delivers the infra; a separate task adds the first public page and populates `PUBLIC_SSR_PATHS`.
- **Lightpanda `--dump` timing** is bypassed by using Playwright `networkidle`, but `networkidle` on an SPA that long-polls or retries could hang until timeout. Mitigation: the 5s timeout + fallback. Validate with the E2E test against the real public page once it exists.
- **Playwright chromium install size** on a 512MB image — verify image build still fits and boot is acceptable.