# Prod-only E2E gate

Date: 2026-08-28
Status: Approved (pending implementation)

## Context

Today the repo runs E2E against two different servers:

- `test:e2e` → `playwright test` uses `playwright.config.ts`, which boots the **dev**
  server (`NODE_ENV=development bun run backend/server.ts`) and `testIgnore`s
  `ssr.spec.ts`.
- `test:e2e:ssr` → `playwright test --config=playwright.ssr.config.ts` builds the
  **prod** bundle and runs only `ssr.spec.ts`.

Neither runs automatically. CI (`ci.yml`) runs `bun run check` only — zero E2E.
`premerge.sh` runs `scripts/check.sh` only — zero E2E. `check:full` (local) runs
`check` + dev `test:e2e`.

This split caused a real regression: a lightpanda nightly binary changed its
default `--wait-until` to `load`, which dumps the DOM before the SPA's async
tRPC query resolves. The prod SSR test caught it; the dev-gated suite could not,
and because the prod SSR test ran in nothing automated, the bug shipped uncaught.

### Prod-only surface that dev E2E cannot cover

- React Compiler output (`_c()` memo cache) — `scripts/build.ts` runs
  `reactCompiler: true`; the dev server's runtime transpiler does not.
- Devtools stub plugin (`scripts/build.ts` swaps `@tanstack/*-devtools` for a
  no-op in the prod bundle, ~270KB). Dev server loads the real devtools.
- `publicPath: "/"`, minification, hashed chunk names.
- Bot prerender handler — constructed only when `NODE_ENV === 'production'`
  (`backend/server.ts`). Dev serves the raw SPA shell to everyone.

### Empirical confirmation

Ran all four specs (auth, notes, drawer, ssr) against a prod build via a
temporary config reusing the running prod server. Result: **6/6 passed in
5.2s** — including `auth.spec.ts` signup, which was a pre-existing failure
under the dev server. Prod is strictly more faithful and not slower here.

## Decision

**Collapse to one prod config, one script.** Drop the dev E2E mode entirely.

- One `playwright.config.ts` — prod build, **all** specs, no `testIgnore`.
- One script: `test:e2e` → `playwright test` (the gate).
- Delete `playwright.ssr.config.ts` and the `test:e2e:ssr` script.
- Targeted runs use Playwright's native filter: `bun run test:e2e --grep ssr`.

### Why no dev E2E mode

The dev server's only E2E-specific value was HMR while iterating on *app code*
during test authoring (edit a component, re-run without rebuilding). Test-only
iteration (selectors, assertions) works fine on prod because
`webServer.reuseExistingServer` keeps the prod server alive across re-runs, so
the build is paid once per session. The app-code-during-testing case is rare and
costs a rebuild of a few seconds. For a starter whose job is minimal surface
and teaching-by-example, faithfulness and simplicity win, and dropping the mode
removes the dev/prod split that caused the original bug.

`bun run dev` (HMR app development) is unaffected — this design only removes the
*E2e* dev mode.

## Design

### `playwright.config.ts` (rewritten)

Single config, prod-only:

```ts
import { defineConfig } from '@playwright/test'

const E2E_ENV = [
	'DATABASE_URL=file:./test.db',
	"BETTER_AUTH_SECRET='ExNy8Q9ALAjH2BEc31RrQ+KNFG4K+KjprJexVc9Xw80='",
	'BETTER_AUTH_URL=http://localhost:3000',
	'NODE_ENV=production',
	'SSR_CACHE_DIR=/tmp/mino-ssr-cache-e2e',
].join(' ')

export default defineConfig({
	testDir: './e2e',
	globalSetup: './e2e/global-setup.ts',
	use: { baseURL: 'http://localhost:3000' },
	webServer: {
		command: `bun run build && ${E2E_ENV} bun run start`,
		url: 'http://localhost:3000',
		reuseExistingServer: !process.env.CI,
		timeout: 60000,
	},
})
```

Notes:
- `test:e2e` is the only E2E script; `playwright test` resolves this config by
  default.
- `testIgnore` is removed — `ssr.spec.ts` runs with everything else.
- `E2E_ENV` is defined once (no duplication across two config files).
- `SSR_CACHE_DIR` is set so the prod prerender uses a temp cache that
  `global-setup.ts` clears each run.
- `reuseExistingServer: !process.env.CI` — locally, a second `test:e2e` invocation
  reuses the already-running prod server (fast re-runs); in CI a fresh server is
  always started per job.

### `e2e/global-setup.ts` (unchanged)

Already correct: clears `/tmp/mino-ssr-cache-e2e` and recreates a fresh
`prisma/test.db` via `prisma migrate deploy`. No change needed. (The SSR cache
clear was previously only relevant to the SSR config; now it is relevant to
every run, which is fine — it is cheap and the cache is only used by bot
requests.)

### `package.json` scripts

Before:

```json
"test:e2e": "playwright test",
"check:full": "bash scripts/check.sh && bun run test:e2e",
"test:e2e:ssr": "playwright test --config=playwright.ssr.config.ts",
```

After:

```json
"test:e2e": "playwright test",
"check:full": "bash scripts/check.sh && bun run test:e2e",
```

- `test:e2e` now means prod-all-specs (was dev).
- `test:e2e:ssr` deleted; `bun run test:e2e --grep ssr` replaces it.
- `check:full` script string is unchanged but now runs prod-all-specs (because
  `test:e2e` changed meaning).

### `scripts/premerge.sh`

Add the prod E2E gate after the check gate, before the merge. Cost: premerge goes
from ~10s to ~40–60s (build + lightpanda render for the bot test). Accepted:
premerge is the explicit "I am about to merge" command, and the whole point is
that merges are gated on prod E2E.

```sh
echo "Running pre-merge checks on '$branch'..."
bash scripts/check.sh
bun run test:e2e
```

Add a short comment noting E2E is now included.

### `scripts/check.sh`

Unchanged. The comment that says "E2E … is intentionally excluded — run
manually" is updated to: "E2E is run by `check:full`, `premerge`, and CI; excluded
from the fast `check` loop." `check` stays fast (no build, no E2E) for the
quick iteration gate.

### `.github/workflows/ci.yml`

Add a second job `e2e`, parallel to `check`, gated on `check` passing:

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.0
      - run: bun install
        env:
          DATABASE_URL: file:./dev.db
      - run: bunx prisma generate
        env:
          DATABASE_URL: file:./dev.db
      - run: bun run check

  e2e:
    needs: [check]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.0
      - name: Cache lightpanda binary
        uses: actions/cache@v4
        with:
          path: ~/.cache/lightpanda-node
          key: lightpanda-${{ runner.os }}-${{ hashFiles('bun.lock') }}
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('bun.lock') }}
      - run: bun install
        env:
          DATABASE_URL: file:./dev.db
      - run: bunx prisma generate
        env:
          DATABASE_URL: file:./dev.db
      - run: bunx playwright install --with-deps chromium
      - run: bun run test:e2e
        env:
          DATABASE_URL: file:./test.db
          BETTER_AUTH_SECRET: ExNy8Q9ALAjH2BEc31RrQ+KNFG4K+KjprJexVc9Xw80=
          BETTER_AUTH_URL: http://localhost:3000

  deploy:
    needs: [check, e2e]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Notes:
- `e2e` job `needs: [check]` — skip the expensive E2E job when lint/type/knip
  already fail (saves CI minutes).
- `deploy` now `needs: [check, e2e]` — Fly deploy is gated on prod E2E green.
- Lightpanda binary (~82MB, downloaded by `@lightpanda/browser` postinstall) is
  cached by `hashFiles('bun.lock')` so it is re-downloaded only when the dep
  version changes. `bun install` reuses the cache.
- Playwright's Chromium is installed explicitly and cached. `--with-deps`
  installs OS libs Playwright needs on the Ubuntu runner.
- `BETTER_AUTH_SECRET` and `DATABASE_URL` are passed as job env. The
  `BETTER_AUTH_SECRET` value is the test secret already hardcoded in the
  config today (not a real secret). `DATABASE_URL=file:./test.db` matches
  `global-setup.ts`.

### `AGENTS.md`

Update the relevant sections:

- **TL;DR — first commands**: `bun run check:full` now means check + prod
  E2E (all specs). Keep the note that it adds E2E; drop the "(adds Playwright
  E2E)" qualifier that implied dev E2E.
- **TL;DR — add a feature**: step 5 references `e2e/<name>.spec.ts`; add that
  all E2E runs against the prod build.
- **Bot SSR (SEO)** → **E2E** paragraph: rewrite. The default
  `playwright.config.ts` now runs the prod build and includes `ssr.spec.ts`.
  `test:e2e:ssr` is gone; use `bun run test:e2e --grep ssr`.
- **Scripts** section: remove the `test:e2e:ssr` bullet and the note that
  "The default `playwright.config.ts` ignores `ssr.spec.ts`." Update
  `test:e2e` to "Playwright E2E (prod build, all specs)" and `check:full` to
  "check + prod E2E".
- Note the premerge change: premerge now runs `check` + prod E2E before the
  fast-forward merge.

## Verification

1. `bun run test:e2e` from a clean checkout builds prod, starts the prod
   server, and all 6 specs pass. (Already confirmed empirically: 6/6 in 5.2s.)
2. `bun run test:e2e --grep ssr` runs only the SSR spec against prod.
3. `bun run check:full` runs `check` then prod-all-specs and is green.
4. `bun run premerge` runs `check` + prod E2E before merging.
5. CI `e2e` job is green on a PR; lightpanda + Playwright caches hit on the
   second run.
6. `bun run knip` does not flag `@lightpanda/browser` (already in
   `ignoreDependencies` from the prior fix).
7. `bun run check` stays fast (no E2E, no build) for the iteration loop.

## Out of scope

- Fixing the pre-existing auth/notes dev-server failures (per project memory)
  — these now pass under prod, so no work needed; if a dev-server failure
  reappears it is out of scope for this design.
- Adding new specs.
- Changing the prod build pipeline itself.
- Per-spec Playwright timeouts or retries tuning (current defaults suffice).