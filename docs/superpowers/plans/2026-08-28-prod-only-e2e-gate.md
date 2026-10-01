# Prod-only E2E gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the dev/prod E2E split into a single prod-build gate that runs all specs, wired into CI and premerge.

**Architecture:** One `playwright.config.ts` builds the prod bundle and runs every `e2e/*.spec.ts` against the prod server. The dev E2E mode and `playwright.ssr.config.ts` are deleted. `test:e2e` is the sole E2E script (the gate). CI gains an `e2e` job (cached lightpanda binary + Playwright browsers, gated on `check`); `deploy` gains a `needs` on `e2e`. `premerge.sh` runs `check` + `test:e2e` before merging.

**Tech Stack:** Bun, Playwright, @lightpanda/browser, Prisma, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-28-prod-only-e2e-gate-design.md`

## Global Constraints

- Bun version pinned `1.4.0` (`.bun-version` + `package.json` engines). CI uses `oven-sh/setup-bun@v2` with `bun-version: 1.4.0`.
- TypeScript filenames: kebab-case; no `src/` root dirs.
- Biome: no semicolons, single quotes, trailing comma all. Run `bun run format` after edits, `bun run check` before claiming done.
- Auth base path `/api/auth`; tRPC endpoint `/api/trpc`; SPA routes `/`, `/login`, `/notes`.
- Prisma CLI runs under Bun (`bunx prisma ...`). `DATABASE_URL=file:./test.db` for E2E.
- The test secret `BETTER_AUTH_SECRET='ExNy8Q9ALAjH2BEc31RrQ+KNFG4K+KjprJexVc9Xw80='` is already hardcoded in the existing configs — not a real secret, fine to keep inline.
- `@lightpanda/browser` stays in `knip.json` `ignoreDependencies` (needed for its postinstall binary download; no longer imported by source).

---

## File Structure

- **Modify:** `playwright.config.ts` — rewrite to prod-only, all specs, self-contained env.
- **Delete:** `playwright.ssr.config.ts` — superseded by the single config.
- **Modify:** `package.json` — drop `test:e2e:ssr` script.
- **Modify:** `scripts/check.sh` — update the E2E exclusion comment.
- **Modify:** `scripts/premerge.sh` — run `bun run test:e2e` after `check.sh`.
- **Modify:** `.github/workflows/ci.yml` — add `e2e` job + caches; `deploy` needs `e2e`.
- **Modify:** `AGENTS.md` — update Scripts, TL;DR, and Bot SSR E2E sections.

Each file has one responsibility and changes for one reason: prod-faithful gating.

---

### Task 1: Single prod-only Playwright config + script cleanup

**Files:**
- Modify: `playwright.config.ts` (full rewrite)
- Delete: `playwright.ssr.config.ts`
- Modify: `package.json` (drop `test:e2e:ssr`)

**Interfaces:**
- Produces: `playwright.config.ts` exporting a `defineConfig` whose `webServer.command` is `bun run build && <E2E_ENV> bun run start` and which has no `testIgnore`. This is what `bun run test:e2e` (`playwright test`) and the CI `e2e` job invoke.

- [ ] **Step 1: Rewrite `playwright.config.ts`**

Replace the entire file with:

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

- [ ] **Step 2: Delete the SSR-only config**

Run:
```bash
git rm playwright.ssr.config.ts
```

- [ ] **Step 3: Drop the `test:e2e:ssr` script from `package.json`**

Remove this exact line from `scripts`:
```json
		"test:e2e:ssr": "playwright test --config=playwright.ssr.config.ts",
```
Leave `test:e2e` (`"playwright test"`) and `check:full` (`"bash scripts/check.sh && bun run test:e2e"`) intact.

- [ ] **Step 4: Format and run the check gate**

Run:
```bash
bun run format
bun run check
```
Expected: `check` passes (biome + typecheck + knip + unit tests). `@lightpanda/browser` must NOT appear as an unused dependency — it is in `knip.json` `ignoreDependencies` (verify it is still listed).

- [ ] **Step 5: Verify the full prod E2E suite passes**

Run:
```bash
bun run test:e2e
```
Expected: 6 tests pass (auth signup-then-signout, notes create-and-delete, 3 drawer specs, ssr bot-render). The webServer runs `bun run build` then starts the prod server; `global-setup.ts` recreates `prisma/test.db`.

- [ ] **Step 6: Verify the targeted SSR run still works via `--grep`**

Run:
```bash
bun run test:e2e --grep ssr
```
Expected: only `e2e/ssr.spec.ts` runs (1 test), passes. This replaces the deleted `test:e2e:ssr`.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts package.json
git commit -m "refactor(e2e): single prod-only Playwright config

Collapse the dev/prod E2E split. playwright.config.ts now builds the prod
bundle and runs all specs (auth, notes, drawer, ssr) against the prod
server. Drops playwright.ssr.config.ts and the test:e2e:ssr script; use
'bun run test:e2e --grep ssr' for targeted SSR runs. The dev E2E mode is
gone — every run tests the prod build (React Compiler output, devtools
stub, prerender, minified CSS), which is what the gate should verify."
```

---

### Task 2: Wire the gate into premerge and update check.sh comment

**Files:**
- Modify: `scripts/premerge.sh`
- Modify: `scripts/check.sh`

**Interfaces:**
- Consumes: `bun run test:e2e` (Task 1) and `bash scripts/check.sh` (existing).
- Produces: `premerge.sh` that runs `check` + prod E2E before the fast-forward merge; `check.sh` with an accurate comment.

- [ ] **Step 1: Add the E2E gate to `scripts/premerge.sh`**

In `scripts/premerge.sh`, find:
```sh
echo "Running pre-merge checks on '$branch'..."
bash scripts/check.sh
```
Replace with:
```sh
echo "Running pre-merge checks on '$branch'..."
bash scripts/check.sh
# Prod-build E2E gate: builds the prod bundle, runs all specs (auth,
# notes, drawer, ssr) against the prod server. Catches prod-only
# regressions (React Compiler output, devtools stub, prerender) that the
# fast check gate cannot.
bun run test:e2e
```
Leave the rest of the script (merge + push) untouched.

- [ ] **Step 2: Update the E2E comment in `scripts/check.sh`**

In `scripts/check.sh`, find:
```sh
# E2E (test:e2e / test:e2e:ssr) is intentionally excluded — run manually.
```
Replace with:
```sh
# E2E is run by `check:full`, `premerge`, and CI; excluded from the fast
# `check` loop. It builds the prod bundle and runs all specs.
```

- [ ] **Step 3: Format and verify the gate scripts are valid bash**

Run:
```bash
bun run format
bash -n scripts/premerge.sh && echo "premerge.sh ok"
bash -n scripts/check.sh && echo "check.sh ok"
```
Expected: both scripts pass `bash -n` (syntax check). `bun run format` may reflow comments; re-run if it changes anything.

- [ ] **Step 4: Verify premerge runs the full gate end-to-end (dry)**

Run the gate portion manually to confirm it executes the new E2E step:
```bash
bash scripts/check.sh && bun run test:e2e
```
Expected: `check` passes, then all 6 E2E specs pass. (Do not run the merge/push portion — that is interactive and only runs on a clean branch; this step just exercises the two commands premerge now runs.)

- [ ] **Step 5: Commit**

```bash
git add scripts/premerge.sh scripts/check.sh
git commit -m "ci: gate premerge on prod-build E2E

premerge.sh now runs bun run test:e2e (prod, all specs) after the check
gate and before the fast-forward merge. check.sh's comment updated to
reflect that E2E is now wired into check:full, premerge, and CI."
```

---

### Task 3: CI — add `e2e` job with caches; gate `deploy` on it

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `bun run test:e2e` (Task 1). Relies on `@lightpanda/browser` postinstall downloading the binary into `~/.cache/lightpanda-node` and Playwright's Chromium into `~/.cache/ms-playwright`.
- Produces: a CI `e2e` job that runs on every PR/push (when `check` passes) and a `deploy` job that only runs when both `check` and `e2e` pass on `main`.

- [ ] **Step 1: Rewrite `.github/workflows/ci.yml`**

Replace the entire file with:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Bun 1.4.0 is now stable. Pin to the version declared in .bun-version
      # and package.json engines so CI is reproducible.
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
      # The lightpanda binary (~82MB) is downloaded by @lightpanda/browser's
      # postinstall into ~/.cache/lightpanda-node. Cache it by bun.lock hash so
      # it is only re-downloaded when the dep version changes.
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

Notes for the implementer:
- `e2e` `needs: [check]` — skip the expensive E2E job when lint/type/knip already fail.
- `deploy` now `needs: [check, e2e]` — Fly deploys only when the prod E2E gate is green on `main`.
- `BETTER_AUTH_SECRET` and `DATABASE_URL` are passed as job env for the `test:e2e` step. The `BETTER_AUTH_SECRET` value is the test secret already hardcoded in the existing config (not a real secret).
- The Playwright config's `webServer.command` sets the env inline (`E2E_ENV`), so the server process uses those values regardless of the job env; the job env covers the Playwright process and `global-setup.ts` (which reads `DATABASE_URL` for `migrate deploy`).
- `global-setup.ts` runs `DATABASE_URL=file:./test.db bunx prisma migrate deploy` — the job env `DATABASE_URL: file:./test.db` satisfies it.

- [ ] **Step 2: Format (YAML is not Biome-managed, but keep the gate consistent)**

Run:
```bash
bun run format
```
Expected: Biome ignores YAML; no changes to `ci.yml`. (If Biome touches anything else, re-stage.)

- [ ] **Step 3: Validate the CI YAML structure locally**

Run:
```bash
bun -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ci.yml','utf8');const must=['  check:','  e2e:','  deploy:','needs: [check]','needs: [check, e2e]','Cache lightpanda binary','Cache Playwright browsers','bunx playwright install --with-deps chromium','bun run test:e2e'];for(const m of must){if(!s.includes(m))throw new Error('missing: '+m)}console.log('ci.yml structure ok')"
```
Expected: prints `ci.yml structure ok`. If it throws, the YAML is missing a required element — fix before proceeding.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add prod-build E2E job, gate deploy on it

New e2e job runs 'bun run test:e2e' (prod build, all specs) on every PR
and push, gated on the check job to save CI minutes on lint/type
failures. Caches the lightpanda binary (~82MB, via @lightpanda/browser
postinstall) and Playwright's Chromium by bun.lock hash. deploy now
needs both check and e2e, so Fly deploys only when the prod E2E gate is
green on main."
```

---

### Task 4: Update AGENTS.md to match the new contract

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: the final script/config shape from Tasks 1–3.
- Produces: AGENTS.md sections consistent with `bun run test:e2e` = prod-all-specs and the removed `test:e2e:ssr`.

- [ ] **Step 1: Update the "Scripts" section**

In AGENTS.md, find the Scripts block and update the E2E-related bullets. Replace:

```md
- `bun run test:e2e` — Playwright E2E
- `bun run check:full` — `check` + `test:e2e`; run before claiming UI/auth/route work is done (E2E is intentionally excluded from `check` for speed)
- `bun run test:e2e:ssr` — Playwright E2E (separate `playwright.ssr.config.ts` running the prod server, clears its cache in `e2e/global-setup.ts`) is the verification contract. The default `playwright.config.ts` ignores `ssr.spec.ts`.
```
with:

```md
- `bun run test:e2e` — Playwright E2E against the **prod build** (builds the bundle, runs all `e2e/*.spec.ts` against the prod server). Targeted run: `bun run test:e2e --grep <pattern>`.
- `bun run check:full` — `check` + `test:e2e` (prod, all specs); run before claiming UI/auth/route work is done (E2E is intentionally excluded from `check` for speed).
```

- [ ] **Step 2: Update the "TL;DR — first commands" section**

In AGENTS.md, find:
```md
- **Before claiming work done:** `bun run check`. For UI/auth/route changes also `bun run check:full` (adds Playwright E2E).
```
Replace with:
```md
- **Before claiming work done:** `bun run check`. For UI/auth/route changes also `bun run check:full` (adds Playwright E2E against the prod build — all specs).
```

- [ ] **Step 3: Update the "Bot SSR (SEO)" → E2E paragraph**

In the Bot SSR (SEO) section, find:
```md
- E2E: `bun run test:e2e:ssr` (separate `playwright.ssr.config.ts` running the prod server, clears its cache in `e2e/global-setup.ts`) is the verification contract. The default `playwright.config.ts` ignores `ssr.spec.ts`.
```
Replace with:
```md
- E2E: `bun run test:e2e` runs the prod build and includes `ssr.spec.ts` (alongside auth/notes/drawer). Targeted SSR run: `bun run test:e2e --grep ssr`. The single `playwright.config.ts` builds the prod bundle and runs all specs; `e2e/global-setup.ts` clears the SSR cache (`/tmp/mino-ssr-cache-e2e`) and recreates `prisma/test.db` each run.
```

- [ ] **Step 4: Update the premerge mention**

In AGENTS.md, find:
```md
- **Merge:** `bun run premerge` runs `check`, then fast-forwards current branch → main and pushes.
```
Replace with:
```md
- **Merge:** `bun run premerge` runs `check` + `bun run test:e2e` (prod, all specs), then fast-forwards current branch → main and pushes.
```

- [ ] **Step 5: Format and verify no stale references remain**

Run:
```bash
bun run format
grep -n "test:e2e:ssr\|playwright.ssr.config\|ignores.*ssr.spec" AGENTS.md
```
Expected: Biome may reflow prose; the `grep` must return nothing (no stale references to the deleted script/config/behavior). If grep matches, fix the remaining stale text.

- [ ] **Step 6: Run the check gate to confirm docs edits broke nothing**

Run:
```bash
bun run check
```
Expected: passes (knip does not flag AGENTS.md; it is not a tracked entry).

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md for prod-only E2E gate

test:e2e now means the prod build (all specs). Drop references to the
removed test:e2e:ssr script and playwright.ssr.config.ts; note the
--grep replacement and that premerge now runs prod E2E before merge."
```

---

## Self-Review

**Spec coverage:**
- Single prod config → Task 1 (rewrite `playwright.config.ts`). ✓
- Delete `playwright.ssr.config.ts` + `test:e2e:ssr` → Task 1 Steps 2–3. ✓
- `test:e2e --grep ssr` replacement → Task 1 Step 6 verifies. ✓
- `check:full` now prod-all-specs → Task 1 leaves `check:full` intact; meaning changes because `test:e2e` changes. ✓
- `premerge.sh` runs `test:e2e` → Task 2. ✓
- `check.sh` comment update → Task 2 Step 2. ✓
- CI `e2e` job + caches + `deploy needs` → Task 3. ✓
- AGENTS.md updates (Scripts, TL;DR, Bot SSR E2E, premerge) → Task 4. ✓
- Verification (all specs pass under prod, knip clean, check fast) → Tasks 1–4 each verify. ✓

**Placeholder scan:** No TBD/TODO; every code/comment step contains the exact text. CI YAML is complete and inline. ✓

**Type/name consistency:** `E2E_ENV`, `bun run test:e2e`, `--grep ssr`, `BETTER_AUTH_SECRET` test value, `DATABASE_URL=file:./test.db`, `/tmp/mino-ssr-cache-e2e` — used consistently across tasks and matching the existing `e2e/global-setup.ts`. ✓