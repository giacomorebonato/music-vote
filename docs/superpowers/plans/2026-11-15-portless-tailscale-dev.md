# Portless + Tailscale dev sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bun run dev:net` serves a dev branch through portless with Tailscale sharing, and better-auth works on the shared URLs.

**Architecture:** Opt-in npm script wraps the existing `dev` script in `portless run --tailscale`; a new pure module `backend/auth/base-url.ts` resolves better-auth's `baseURL` and `trustedOrigins` from the portless child-process env. Plain `bun run dev`, CI, and Playwright flows are untouched.

**Tech Stack:** Bun, portless 0.17, Tailscale, better-auth, bun:test.

**Spec:** `docs/superpowers/specs/2026-11-15-portless-tailscale-dev-design.md`

## Global Constraints

- Bun everywhere — never npm/pnpm/yarn.
- Knip runs in the gate and fails on unused dependencies/exports; `treatConfigHintsAsErrors`.
- Unit tests co-located: `__tests__/<source-name>.test.ts` next to source; named exports only; kebab-case filenames.
- `bun run dev`, `bun run verify`, and both Playwright suites behave exactly as before.
- No Tailscale Funnel or public exposure — tailnet only.
- Conventional commit style (`feat:`, `docs:`, `chore:`).

## Review Focus

1. All three URL envs set → `PORTLESS_TAILSCALE_URL` wins (phones hit ts.net; auth origin must match). → Task 1 test.
2. Only `PORTLESS_URL` set → it beats a stale `.env` `BETTER_AUTH_URL=http://localhost:3000` (portless assigns an ephemeral 4xxx port). → Task 1 test.
3. No portless env → byte-identical legacy behavior (`BETTER_AUTH_URL` then default). → Task 1 test.
4. Empty-string env values → treated as unset; `''` must never win the chain. → Task 1 test.
5. Host browser on the `.localhost` origin while `baseURL` is ts.net → `trustedOrigins: [PORTLESS_URL]` keeps auth POSTs from 403. → Task 1 test pins the value; Task 2 smoke checks a real auth POST path responds (not 403) on the localhost URL.

---

### Task 1: Auth base URL resolution from portless env

**Files:**
- Create: `backend/auth/base-url.ts`
- Create: `backend/auth/__tests__/base-url.test.ts`
- Modify: `backend/auth/auth.ts`

**Interfaces:**
- Produces: `resolveAuthBaseURL(env?: NodeJS.ProcessEnv): string` and `resolveAuthTrustedOrigins(env?: NodeJS.ProcessEnv): string[]` in `@backend/auth/base-url` — first non-empty of `PORTLESS_TAILSCALE_URL`, `PORTLESS_URL`, `BETTER_AUTH_URL`, else `'http://localhost:3000'`; trusted origins are `[PORTLESS_URL]` when non-empty, else `[]`.

- [ ] **Step 1: Write the failing test**

`backend/auth/__tests__/base-url.test.ts` with `describe('resolveAuthBaseURL')` and `describe('resolveAuthTrustedOrigins')`, passing explicit env objects (never mutating `process.env`):

- tailscale wins: `{ PORTLESS_TAILSCALE_URL: 'https://node.tailnet.ts.net', PORTLESS_URL: 'https://branch.music-vote.localhost', BETTER_AUTH_URL: 'http://localhost:3000' }` → `'https://node.tailnet.ts.net'`
- portless-only: `{ PORTLESS_URL: 'https://branch.music-vote.localhost', BETTER_AUTH_URL: 'http://localhost:3000' }` → `'https://branch.music-vote.localhost'`
- legacy: `{ BETTER_AUTH_URL: 'https://example.com' }` → `'https://example.com'`
- default: `{}` → `'http://localhost:3000'`
- empty strings skipped: `{ PORTLESS_TAILSCALE_URL: '', PORTLESS_URL: '', BETTER_AUTH_URL: 'https://example.com' }` → `'https://example.com'`; all-empty → `'http://localhost:3000'`
- trusted origins: `{ PORTLESS_URL: 'https://branch.music-vote.localhost' }` → `['https://branch.music-vote.localhost']`; `{}` and `{ PORTLESS_URL: '' }` → `[]`

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test backend/auth/__tests__/base-url.test.ts`
Expected: FAIL — cannot resolve module `../base-url` (or equivalent import error).

- [ ] **Step 3: Implement `backend/auth/base-url.ts`**

`const firstNonEmpty = (...values: Array<string | undefined>) => values.find((v) => v !== undefined && v !== '')`; both exported functions default `env` to `process.env` and fall back to the default URL via `??`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test backend/auth/__tests__/base-url.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Wire into `auth.ts`**

Import both from `./base-url`; replace `baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'` with `baseURL: resolveAuthBaseURL()`; add `trustedOrigins: resolveAuthTrustedOrigins()`. No other config changes.

- [ ] **Step 6: Typecheck + test**

Run: `bun check && bun test backend/auth/__tests__/base-url.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add backend/auth/base-url.ts backend/auth/__tests__/base-url.test.ts backend/auth/auth.ts
git commit -m "feat: resolve auth base URL from portless dev env"
```

### Task 2: `dev:net` script + portless dependency

**Files:**
- Modify: `package.json` (scripts, devDependencies)
- Create: `portless.json`
- Modify: `bun.lock` (via `bun add`)

**Interfaces:**
- Consumes: portless child env `PORT` (already honored by `backend/server.ts:27`), `PORTLESS_URL`, `PORTLESS_TAILSCALE_URL` from Task 1.
- Produces: `bun run dev:net` script; `portless.json` `{ "name": "music-vote" }`.

- [ ] **Step 1: Add portless devDependency**

Run: `bun add -d portless`
Expected: `portless@^0.17.0` in `devDependencies`, lockfile updated.

- [ ] **Step 2: Add script and config**

`package.json` scripts gain `"dev:net": "portless run --tailscale"`; create `portless.json` with `{ "name": "music-vote" }` (worktree branch prefix stays automatic).

- [ ] **Step 3: Knip check**

Run: `DATABASE_URL=${DATABASE_URL:-file:./dev.db} bun x --no-install knip`
Expected: clean. If knip hints at `portless.json`, drop the file (name is also inferred from `package.json`) rather than widening knip config.

- [ ] **Step 4: Smoke test**

Prereq: `.env` exists (`bun run bootstrap`, copy `.env.example`, set `BETTER_AUTH_SECRET`). Start `bun run dev:net` in the background; `portless list` shows a `music-vote` route with the branch-prefixed URL and a ts.net URL; `curl -sk https://<branch>.music-vote.localhost` returns the SPA shell (200 HTML); `curl -sk -X POST https://<branch>.music-vote.localhost/api/auth/get-session` returns 200 JSON (not a 403 origin rejection). If ts.net cert provisioning fails (tailnet HTTPS not enabled), record that as a machine prerequisite and continue. Kill the process.

- [ ] **Step 5: Commit**

```sh
git add package.json bun.lock portless.json
git commit -m "feat: add dev:net portless tailscale sharing"
```

### Task 3: Documentation + full gate

**Files:**
- Modify: `AGENTS.md` (script list — explicitly requested by the user)
- Modify: `docs/agents/commands.md` (scripts section, env var note)
- Modify: `docs/agents/music-vote.md` (Local run section: prerequisites, usage, WS liveness check)
- Modify: `.env.example` (`BETTER_AUTH_URL` applies only to plain `bun run dev`)

**Interfaces:**
- Consumes: shipped behavior from Tasks 1–2.

- [ ] **Step 1: Write the docs**

- `AGENTS.md`: one bullet in the scripts list — `bun run dev:net` — dev server through portless with Tailscale sharing (branch-prefixed `.localhost` URL + ts.net URL), auth URL auto-derived.
- `commands.md`: `dev:net` entry next to `dev`; note that under portless the auth baseURL resolves `PORTLESS_TAILSCALE_URL ?? PORTLESS_URL ?? BETTER_AUTH_URL` (empty = unset).
- `music-vote.md`: prerequisites (portless ≥ 0.17, one-time `portless trust`, tailnet HTTPS certs enabled, `tailscale up`), usage, and the manual WS check — open a host page on the shared URL and confirm the socket holds across a poll interval.
- `.env.example`: comment on `BETTER_AUTH_URL` — ignored while `dev:net` is running (portless URLs take precedence).

- [ ] **Step 2: Format + lint**

Run: `bun fmt && bun lint`
Expected: clean.

- [ ] **Step 3: Full gate**

Run: `bun run verify`
Expected: PASS (native checks, knip, unit tests, both Playwright suites).

- [ ] **Step 4: Commit**

```sh
git add AGENTS.md docs/agents/commands.md docs/agents/music-vote.md .env.example
git commit -m "docs: document dev:net portless tailscale sharing"
```
