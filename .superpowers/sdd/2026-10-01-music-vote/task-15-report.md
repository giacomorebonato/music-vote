# Task 15 report — Deploy config, docs, license

Commit: `9404d55 docs: license, deploy + ops docs, product README` (branch `music-vote`, no upstream → not pushed; amended once to fold in the `.env.example` fix below).

## What changed, per file

| File | Change | Why |
|---|---|---|
| `LICENSE` (new) | Verbatim GNU AGPL-3.0 text, 34 523 bytes | Spec decision: the repo is public because it embeds Strudel (AGPL v3). Fetched, not authored. |
| `docs/agents/music-vote.md` (new) | Product runbook: process shape, env table (14 vars), local mock-LLM run, Fly deploy + secrets, ops notes, known limitations | Task step 2; the failure table from the spec restated as operational rules. |
| `README.md` | Rewritten: product story, quickstart, mock-LLM instructions, docs index, verification, license | Starter blurb replaced. Dead reference to `docs/superpowers/README.md` (deleted in the bootstrap task) removed; links now point at the spec, the plan, and `docs/agents/music-vote.md`. |
| `.env.example` | Added `LLM_MOCK_SCRIPT` + `MV_E2E_FAST` (both documented, code-verified); `SSR_CACHE_DIR`/`LIGHTPANDA_EXECUTABLE_PATH` kept documented but **commented out** | The file must match what the code reads. The two prerender vars were shipping as **empty assignments**, and `request-from-browser.ts` resolves the binary with `??`, so `cp .env.example .env` (the documented quickstart) set `LIGHTPANDA_EXECUTABLE_PATH=''` and silently disabled bot prerender → see “Pre-existing bug found” below. |
| `fly.toml` | `app = "music-vote"`, volume `music_vote_data` | Purge starter identity; keeps deploy + volume naming consistent with the docs. Rest of the config verified unchanged and correct (see verification). |
| `docs/agents/deployment.md` | App name, volume name, `BETTER_AUTH_URL`, destroy/open examples; pointer to `music-vote.md` | Must stay true to `fly.toml`. |
| `docs/agents/commands.md` | Prod URL `https://music-vote.fly.dev`; added LLM env rows + pointer to `music-vote.md`; noted `NODE_ENV`/`REACT_COMPILER` come from scripts, `MV_E2E_FAST` is test-only | Stale prod URL + new env surface. |
| `docs/agents/conventions.md` | Removed `frontend/components/note-form.tsx` (deleted with the notes demo); example schema now `createRoomSchema`/`shared/schemas/room.ts`/`backend/trpc/rooms.ts`; SPA routes now `/`, `/login`, `/create`, `/r/$id`, `/r/$id/host` | Starter-era references that no longer resolve (step 8 sweep). |
| `AGENTS.md` | Added `docs/agents/music-vote.md` to the deep-docs index | New doc was otherwise not discoverable from the repo's front door. |
| `backend/trpc/public.ts` | `siteInfo` → `name: 'music-vote'`, `tagline: 'Crowd-voted AI live music.'` | Rendered on the home route; was the starter blurb. |
| `frontend/routes/home.tsx` | Fallback name → `music-vote` | Rendered when `siteInfo` has not loaded. |
| `frontend/components/sidebar.tsx` | Wordmark → `music-vote` | User-visible starter brand. |
| `frontend/index.html` | `<title>music-vote</title>` | User-visible tab title; missed by the task scan, found by the branding grep. |
| `backend/server.ts` | Startup log → `music-vote on http://localhost:PORT` | Operator-visible starter identity. |
| `apm.yml` | `name: music-vote` | Starter identity in config; `apm.lock.yaml` has no name field, so nothing else to change. |
| `scripts/bootstrap.sh` | Doc comment "fresh clone of mino-starter" → `music-vote` | Developer-visible branding; one comment line, no behavior change. |
| `e2e/ssr.spec.ts` | Bot assertion now expects `Crowd-voted AI live music.`; the browser-shell negative assertion uses the same string | The spec pinned the old starter tagline, which the product tagline change invalidates. Test updated, not weakened. |

## LICENSE provenance

- URL: `https://www.gnu.org/licenses/agpl-3.0.txt` (`curl -fsSL`), the canonical FSF document.
- Byte count: **34 523** (in the commit: `git show HEAD:LICENSE | wc -c` → 34523).
- SHA-256: **`0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0`**.
- Verification markers present: `GNU AFFERO GENERAL PUBLIC LICENSE` (line 1), `Version 3, 19 November 2007` (line 2), `Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>`, sections `0. Definitions.` … `13.`, and the complete `How to Apply These Terms to Your New Programs` section ending with the `https://www.gnu.org/licenses/` footer. The placeholder pattern in that section is the standard `Copyright (C) <year>  <name of author>` — no project copyright header was invented and the text was not edited.
- Cross-check: SPDX `AGPL-3.0-only.txt` (`raw.githubusercontent.com/spdx/license-list-data`) contains the same content but is re-wrapped and uses `http://fsf.org` (34 020 bytes, different digest). The FSF file was used, per the brief.

## Remaining `mino-starter` grep hits (all intentional)

Command: `grep -rn "mino-starter\|mino_starter" --exclude-dir={node_modules,.git,dist,generated,.superpowers} .`

1. `requirements.md:26` — the user's original requirement notes ("re-use my mino-starter kit"). Explicitly out of scope.
2. `.agents/skills/project-structure/SKILL.md:8` — APM-managed skill wording; the brief forbids touching `.agents/skills/**` wording (and the file is partly APM-regenerated).
3. `docs/superpowers/plans/2026-10-01-music-vote.md` (5 hits) + `docs/superpowers/specs/2026-10-01-music-vote-design.md` (2 hits) — the historical plan/spec record "Base: mino-starter" and Task 1's rsync commands. Those are accurate history; rewriting them would falsify the approval trail.

Also still contain the shorter `mino` token (not the product brand, no user-visible surface):

4. `backend/ssr/prerender.ts:53` — `mkdtemp(join(tmpdir(), 'mino-prerender-'))` temp-dir prefix.
5. `e2e/global-setup.ts:5` — `/tmp/mino-ssr-cache-e2e` temp path.

Both are internal filesystem identifiers with no user or config impact; renaming them is churn without benefit, so I left them. Say the word and they are a two-line change.

`backend/music/prompts.ts`'s `"C:minor"` (music scale) was deliberately left alone, as were `prisma/generated/**` and specs/plans.

## Verification performed

- `bun run check` → **green** (biome + typecheck + knip + 149 unit tests, 0 fail).
- `bun run build` → **green**; `dist/` produced, `dist/index.html` carries `<title>music-vote`.
- `bun run test:e2e` → **5 passed** (auth, drawer ×3, and the 3.2-minute `e2e/music-vote.spec.ts` democratic cycle).
- `bun run test:e2e:ssr` → **1 passed** (bot gets prerendered HTML containing the new tagline; browser gets the raw shell). This only passes after removing the empty `LIGHTPANDA_EXECUTABLE_PATH=` line from the local (untracked) `.env` — see below.
- `fly.toml` parsed with `Bun.TOML.parse` and structurally inspected: `app`, `primary_region`, `[build]`, `[mount] {source: music_vote_data, destination: /data}`, `[http_service] {internal_port: 3000, force_https, auto_stop_machines, auto_start_machines, min_machines_running}`, `[[vm]] {shared-cpu-1x, 512mb}`. `internal_port = 3000` matches `PORT`'s default in `backend/server.ts` and `EXPOSE 3000` in the Dockerfile.
- Relative-link check: every `](…)` target in `README.md`, `AGENTS.md` and `docs/agents/*.md` exists (scripted check, zero misses).
- `.github/workflows/ci.yml`: the deploy job has **no** app name — `flyctl deploy --remote-only` reads `fly.toml`, so the rename propagates with no workflow edit; the token stays a repo secret. Inspected, left unchanged.
- No secrets committed: `.env.example` ships placeholders only (`BETTER_AUTH_SECRET=replace-with-openssl-rand-base64-32`, `OLLAMA_API_KEY=` empty); the local `.env` is gitignored (`git check-ignore` confirms) and untracked.
- `git status` clean, `git diff --cached` empty after the commit.

## Could NOT verify (and how compensated)

- **`fly deploy --dry-run` / `fly config validate`** — no Fly credentials in this environment (`fly auth whoami` → "no access token available"; `fly config validate` → same). Not faked. Compensated by parsing `fly.toml` with `Bun.TOML`, checking every field against `backend/server.ts` (port, env), the Dockerfile (`EXPOSE 3000`, `DATABASE_URL=file:/data/prod.db`, volume destination `/data`), `docs/agents/deployment.md` and `ci.yml`. A real deploy still needs a credentialed run.
- **WebSocket behavior through the Fly proxy** — cannot be exercised without a deploy. Compensated by reading the upgrade path (`Bun.serve` `routes['/ws']` in dev, `fetch` handler in prod, `hub.joinRoom` in the `open` hook) and documenting the ops consequence (idle sockets must not be cut aggressively; no app-level ping exists; the client reconnects with capped backoff and re-applies `currentCode`).
- **Real Ollama musicality** — out of scope by design; only the mock path is verified.

## Pre-existing bug found (NOT fixed — outside this task's file scope)

`backend/ssr/request-from-browser.ts:16` resolves the binary with
`process.env.LIGHTPANDA_EXECUTABLE_PATH ?? ~/.cache/lightpanda-node/lightpanda`.
Because Bun auto-loads `.env`, the **empty assignment** shipped by the old
`.env.example` made that value `''`, `??` does not fall back, and
`execFileSync('')` threw `The argument 'file' cannot be empty. Received ''`.
The prerender handler swallows render failures and falls through to the raw SPA
shell, so the symptom is silent: bots get the unrendered shell and
`bun run test:e2e:ssr` fails on the tagline assertion. Repro:

```sh
printf 'LIGHTPANDA_EXECUTABLE_PATH=\n' >> .env   # (or copy the old .env.example)
bun run test:e2e:ssr                              # fails: bot body has empty #root
```

I fixed the in-scope half (`.env.example` no longer ships empty assignments for
those two vars; `music-vote.md` warns that empty ≠ unset). The code-side
fragility remains and is the same class of trap as
`LLM_PROVIDER` (`?? 'ollama'` → `''` → `Unknown LLM_PROVIDER: `) in
`backend/llm/provider.ts:120`. Recommended follow-up: treat empty env values as
unset (`||` / `.trim()` guards) in those two files. I did not make that code
change because it is outside Task 15's approved file set.

Local, untracked side effect: I removed the empty `LIGHTPANDA_EXECUTABLE_PATH=`
line from this worktree's `.env` (backup at `/tmp/mv-env-backup`) so the SSR E2E
could be verified.

## Self-review findings

- License: verbatim, complete, byte count + sha256 recorded, in the commit.
- Every relative link in README/AGENTS/agent docs resolves; no reference to the deleted `docs/superpowers/README.md` remains.
- Env docs match the code: all 12 app-read vars are documented; the only omissions are build/CI-level `NODE_ENV`, `CI`, `REACT_COMPILER`, which are explained in `commands.md` and set by the scripts/Dockerfile.
- `fly.toml` ↔ `ci.yml` ↔ `deployment.md` ↔ `music-vote.md` consistent (app `music-vote`, volume `music_vote_data`, port 3000).
- User-visible starter brand: none left (wordmark, home heading/fallback, tab title, `siteInfo`, server log).
- `check` + `build` + both E2E suites green on the committed tree.
- Remaining concerns: (1) the prerender/empty-env bug above; (2) `test:e2e:ssr` is environment-sensitive — anyone with the old empty assignment in `.env` will still see it fail until they fix their local file; (3) no credentialed deploy verification.

## Files changed

`.env.example`, `AGENTS.md`, `LICENSE` (new), `README.md`, `apm.yml`,
`backend/server.ts`, `backend/trpc/public.ts`, `docs/agents/commands.md`,
`docs/agents/conventions.md`, `docs/agents/deployment.md`,
`docs/agents/music-vote.md` (new), `e2e/ssr.spec.ts`, `fly.toml`,
`frontend/components/sidebar.tsx`, `frontend/index.html`,
`frontend/routes/home.tsx`, `scripts/bootstrap.sh`.

## Concerns

1. Pre-existing empty-env bug (above) — unfixed outside scope, reproducible, silent in production.
2. Local `.env` was edited (untracked) to verify the SSR suite; harmless but worth knowing.
3. Fly deploy itself is unverified without credentials.

---

# Fix round 1

Commits: `0d7a5db fix(boot): wire scheduler restore, harden empty-string env values`
· `abea287 docs: correct restart + mock-LLM claims, finish branding sweep`.

## A. Scheduler restore is now wired (and the boot restore is provable)

- **`backend/boot.ts` (new)** — `bootSchedulers(restore = restoreSchedulers)`:
  awaits the restore, catches, logs with `console.error` (biome-ignore with
  reason; that file is not in the `noConsole` override list) and returns, so a
  restore fault can never stop the server from starting.
- **`backend/server.ts`** — imports `bootSchedulers` and `await bootSchedulers()`
  right after `Bun.serve` reports the port.
- **`backend/__tests__/boot.test.ts` (new, 3 tests)** — seam test (injected spy
  called exactly once), failure test (`resolves.toBeUndefined()` + one
  `console.error` call carrying the thrown error), and the **wiring guard**
  (labeled as such in the file) which reads `backend/server.ts` and asserts both
  the `@backend/boot` import and an `await bootSchedulers()` call site outside
  the import lines.

### RED evidence (A2)

1. Tests written before the seam existed:

```
bun test backend/__tests__/boot.test.ts
# Unhandled error between tests
error: Cannot find module '@backend/boot' from '.../backend/__tests__/boot.test.ts'
 0 pass / 1 fail / 1 error
```

2. `backend/boot.ts` created, `server.ts` still unwired — this is the state the
   guard exists to catch:

```
(pass) bootSchedulers awaits the injected restore exactly once
(pass) a failing restore is logged, not thrown (server still boots)
(fail) server.ts wires the boot restore seam (wiring guard)
   Expected substring or pattern: /from '@backend\/boot'/
   Received: "import { auth } from '@backend/auth/auth'\nimport { prisma } ..."
 2 pass / 1 fail
```

3. After wiring `server.ts`: `3 pass / 0 fail`.

### End-to-end proof against the real entrypoint (manual, not committed)

Seeded `prisma/test.db` with a `live` room + an overdue `open` poll, then booted
the shipped entrypoint (`bun run backend/server.ts`, dev env, `MV_E2E_FAST=1`):

```
poll after boot: {"status":"open","winningOption":null}     # before server start
music-vote on http://localhost:3000                          # server booted
poll after boot: {"status":"closed","winningOption":null}    # restore ran and closed it
```

Temp seed/read scripts were deleted and the E2E DB was reset afterwards.

## B. Empty-string env traps

- `backend/llm/provider.ts`: `process.env.LLM_PROVIDER?.trim() || 'ollama'`
  (comment explains why). Non-empty unknown values still throw.
- `backend/ssr/request-from-browser.ts`: `lightpandaBinary()` is now exported
  (testable seam) and resolves
  `process.env.LIGHTPANDA_EXECUTABLE_PATH?.trim() || ~/.cache/lightpanda-node/lightpanda`.

### RED evidence (B)

```
bun test backend/llm/__tests__/provider.test.ts backend/ssr/__tests__/request-from-browser.test.ts
error: Unknown LLM_PROVIDER:
(fail) factory treats an empty LLM_PROVIDER as unset
error: Unknown LLM_PROVIDER:
(fail) factory treats a whitespace-only LLM_PROVIDER as unset
# Unhandled error between tests
SyntaxError: Export named 'lightpandaBinary' not found in module '.../backend/ssr/request-from-browser.ts'
15 pass / 3 fail
```

After the fix: `24 pass / 0 fail` (the 9 new tests + the existing files).

End-to-end confirmation of the originally reported bug: this worktree's
untracked `.env` still contains `LIGHTPANDA_EXECUTABLE_PATH=` (the state that
silently disabled bot prerender). `bun run test:e2e:ssr` now **passes** with that
line present.

## Harness race surfaced by the wiring (fixed in the same commit)

Playwright starts the **webServer before `globalSetup`** — proven with
`DEBUG=pw:webserver`:

```
19:05:44.05 pw:webserver Starting WebServer process DATABASE_URL=file:./test.db ...
19:05:44.52 pw:webserver WebServer available
           (then) SQLite database test.db created ... Applying migration `20261001103923_init`
```

`e2e/global-setup.ts` wiped `prisma/test.db` *after* the server had booted and
(now) opened it at startup, so every later query failed with
`SQLITE_IOERR_VNODE: disk I/O error` (signup → "Authentication failed").

Fix: `scripts/e2e-reset-db.sh` (new) does the delete + `migrate deploy` and runs
first in both `webServer.command` strings; `e2e/global-setup.ts` keeps only the
SSR-cache cleanup, with a comment explaining why the DB reset cannot live there.

Diagnostic note: an earlier post-fix `test:e2e` run looked red because a server I
had started manually for the boot proof was still listening on 3000 and
Playwright reused it (`reuseExistingServer: !CI`). `pkill -f "bun backend/server.ts"`
never matched it — the real command line is `bun run backend/server.ts`. With the
port verified free, both suites are green (and Playwright's own teardown leaves
3000 free).

## C. Doc corrections

1. `README.md` + `docs/agents/music-vote.md` — mock-LLM semantics now match the
   code and `.env.example` (fresh provider per operation, re-read from index 0;
   `startRoom` consumes `responses[0]`+`[1]`). README's real-LLM path now names
   the required `OLLAMA_MODEL`.
2. `AGENTS.md:3` — product front door, mentions the AGPL license.
3. `docs/agents/commands.md` — starter-era `.mcp.json` wording replaced.
4. `docs/agents/deployment.md` — one bullet: the rename does not migrate data; a
   fresh app gets an empty volume.
5. `e2e/music-vote.spec.ts:80` — "Starter signup helper pattern" → "Signup helper
   pattern".
6. **Flagged deviation**: the approved B fix makes `.env.example`'s
   "an empty assignment is not the same as being unset for the binary path"
   clause (and the same warning in the `LIGHTPANDA_EXECUTABLE_PATH` row of
   `music-vote.md`) false. Both vars stay commented out as instructed; I only
   deleted the now-false clause / reworded the row to "Unset or empty falls back
   to the default". Revert if you want the old wording kept for a different
   reason.

## Gate output (final tree, this worktree)

| Gate | Result |
|---|---|
| `bun run check` | ✓ all checks passed — 158 pass / 0 fail (biome + typecheck + knip + unit), was 149 before (+9 new) |
| `bun run build` | ✓ build done (`dist/` produced) |
| `bun run test:e2e` | ✓ 5 passed (3.2m) — auth, drawer ×3, full democratic cycle |
| `bun run test:e2e:ssr` | ✓ 1 passed — bot gets prerendered HTML with the product tagline, browser gets the raw shell |

Port 3000 verified free before/after each E2E gate; worktree clean, nothing staged.
