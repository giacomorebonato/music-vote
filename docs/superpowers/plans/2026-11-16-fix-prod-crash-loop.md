# Fix production crash loop (music-vote.fly.dev down) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the production crash loop by fixing the IPv6 loopback boot probe's error classification, and close the CI/prod Bun-version gap that let it ship.

**Architecture:** `backend/server-bind-check.ts` `expectIpv6LoopbackRefused` decides "[::1] is occupied" by regex-matching fetch error messages (`/ECONNREFUSED|Connection refused|Connection reset/i`). Bun wraps connect failures in `TypeError`, and the message text drifts by Bun version/platform: Bun 1.4.2 on Linux (the prod Docker image) says only `Unable to connect. Is the computer able to access the url?` — no errno token — so a **free** port is misclassified as a probe failure, `server.ts` calls `process.exit(1)`, and the Fly machine crash-loops on every wake (restart_count 10, requests time out). Fix: invert the classification — only two outcomes mean "occupied": the probe is *answered*, or the connect *times out* after being accepted. Every other connect failure means [::1] is free (if the v6 loopback is unreachable, nothing can squat it). Guard: a new CI job runs the e2e suites under the Dockerfile-pinned Bun so prod's exact runtime boots the server in CI.

**Tech Stack:** Bun 1.4.2 (prod image) / canary (CI check job), bun:test, GitHub Actions, Fly.io machines.

**Spec:** This plan is its own spec — findings below are the evidence chain.

## Evidence chain (investigation, 2026-11-16)

1. `https://music-vote.fly.dev/` — 0 bytes, curl timeout at 20s and 60s. DNS fine (Fly edge `66.241.124.64`).
2. Fly machine `83d1299cd52e48` (`shy-wood-1255`, ams): state `stopped`; every proxy auto-start exits **code 1** ~5s later, `restart_count: 10`. Not OOM.
3. `process.exit(1)` exists at exactly one boot path: `backend/server.ts:174` (bind-check catch).
4. Ground truth on the Fly machine (via exec): `fetch('http://[::1]:3000/x')` → `TypeError: Unable to connect. Is the computer able to access the url?` — no errno token.
5. Same image locally (`oven/bun:1.4.2`, and full Docker build of deployed commit `1dd1750`): server exits with `Server bind check failed: probe http://[::1]:3000/api/trpc/boot-probe was neither refused nor answered (Unable to connect…)` → exit 1. macOS Bun 1.4.4 prefixes `ECONNREFUSED:` — which is why dev never saw it.
6. CI is blind to this: `.bun-version` = `canary` (check job, incl. e2e boots on ubuntu) while Dockerfile pins `oven/bun:1.4.2`. Canary surfaces the errno token, so CI passed; prod 1.4.2 does not.
7. Unit tests mock `globalThis.fetch` — the real-error-message path was never exercised on Linux.
8. Timeline: probes shipped `aef261b`/`c168674` (Nov 14), CI run `43726771537` deployed `1dd1750` Nov 15 14:53Z → machine crash-loops since.

## Global Constraints

- Bun everywhere — runtime, package manager, test runner. Never npm/pnpm/yarn.
- Unit tests co-located in `__tests__/` (`backend/__tests__/server-bind-check.test.ts`).
- `bun run verify` must pass before any "done" claim (it runs check + lint + fmt + knip + unit + both Playwright suites).
- Conventional commit style (`fix:`, `ci:`, `docs:`) as in existing history.
- Deploy path: push to `main` → CI `deploy` job runs `flyctl deploy --remote-only --ha=false`.
- Keep changes minimal: no Bun version bumps, no probe removal, no refactor of `expectOwnsLoopback` (IPv4 probe is correct — it connects to our own listening server).

## Review Focus

Failure modes the fix must handle; each is pinned by a test in the task that owns it:

1. **Bun 1.4.2 Linux "Unable to connect" on a free [::1]** → probe must resolve (Task 1, new mocked test — this exact regression took prod down).
2. **Accepted-but-silent listener on [::1]** (connect ok, no answer) → still a conflict (Task 1, existing timeout test kept).
3. **Real squatter answering on [::1]** → still a conflict (Task 1, existing answered test kept).
4. **Classic `ECONNREFUSED`-style rejection** → free (Task 1, existing test kept passing under new classification).
5. **Prod-runtime server boot on Linux** (the class CI never ran) → runtime job boots the real server under Dockerfile-pinned Bun and runs e2e (Task 2).
6. **Timeout classification is by error shape, not errno regex** — `TimeoutError` name or "timed out" message; mocked tests use `Error('The operation timed out.')`, runtime uses DOMException `TimeoutError` (Task 1 tests cover both spellings).

---

### Task 1: Fix `expectIpv6LoopbackRefused` classification

**Files:**
- Modify: `backend/server-bind-check.ts` (function `expectIpv6LoopbackRefused`, ~lines 60-100)
- Modify: `backend/__tests__/server-bind-check.test.ts` (add regression test)

**Interfaces:**
- Consumes: none (self-contained; `globalThis.fetch`).
- Produces: `expectIpv6LoopbackRefused(port: number, probePath: string): Promise<void>` — signature unchanged; only rejection/resolve semantics change as below.
- Semantics (the contract `server.ts:171` relies on): resolve (free) when fetch rejects with any non-timeout error; reject (conflict) when fetch resolves OR rejects with a timeout-shaped error (`name === 'TimeoutError'` or message matches `/timed out|operation timed out/i`); keep rethrowing its own "another process is answering" error unchanged.

- [ ] **Step 1: Write the failing regression test**

Add to `backend/__tests__/server-bind-check.test.ts`:

```ts
test('IPv6 loopback probe passes when Bun wraps the refusal without an errno', async () => {
	// Bun 1.4.2 on Linux wraps a refused connect as a bare TypeError with no
	// ECONNREFUSED token — seen live on the Fly machine (prod crash loop).
	globalThis.fetch = (async () => {
		throw new TypeError('Unable to connect. Is the computer able to access the url?')
	}) as unknown as typeof fetch

	await expect(
		expectIpv6LoopbackRefused(3000, '/api/trpc/boot-probe'),
	).resolves.toBeUndefined()
})

test('IPv6 loopback probe still conflicts on TimeoutError name from AbortSignal.timeout', async () => {
	globalThis.fetch = (async () => {
		const e = new Error('The operation timed out.')
		e.name = 'TimeoutError'
		throw e
	}) as unknown as typeof fetch

	await expect(
		expectIpv6LoopbackRefused(3000, '/api/trpc/boot-probe'),
	).rejects.toThrow(/accepted the connection .* without answering/)
})
```

Also update the existing accepted-but-silent test (`'IPv6 loopback probe refuses when the connection is accepted but never answers'`): its current assertion `rejects.toThrow(/expected \[::1\] to be free/)` matches the old error wording — change it to `rejects.toThrow(/accepted the connection .* without answering/)` so it pins the new conflict message.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test backend/__tests__/server-bind-check.test.ts`
Expected: the first new test FAILs with `/neither refused nor answered/`; the second new test FAILs (current code's message lacks `accepted the connection`); the updated existing timeout test FAILs the same way — all three prove current code misclassifies or carries stale wording.

- [ ] **Step 3: Implement the inverted classification in `backend/server-bind-check.ts`**

Replace the catch body of `expectIpv6LoopbackRefused` with: rethrow if message matches `/another process is answering/`; throw a conflict error (worded `another process accepted the connection on [::1]:${port} without answering (probe ${probePath} timed out). Stop it or set PORT.`) if `cause.name === 'TimeoutError' || /timed out|operation timed out/i.test(message)`; otherwise resolve. Update the module doc comment: explain that Bun's fetch wraps connect failures in version/platform-drifting text (1.4.2 Linux has no errno token; 1.4.4+/canary prefix it), so only answered/timeout mean occupied and every other connect failure means [::1] is free — including unreachable (no v6 loopback ⇒ nothing can squat it).

- [ ] **Step 4: Run the full bind-check suite**

Run: `bun test backend/__tests__/server-bind-check.test.ts`
Expected: all tests PASS (9 existing — one assertion updated — plus 2 new), including the kept `ECONNREFUSED`-passes and answered-conflict tests.

- [ ] **Step 5: Boot-check the real server in the prod-parity container**

Run:
```sh
docker build -t music-vote-prod-fix . && \
docker volume rm mvfix >/dev/null 2>&1; docker volume create mvfix >/dev/null && \
docker run --rm -v mvfix:/data -e PORT=3000 -e BETTER_AUTH_SECRET=test-secret-not-default music-vote-prod-fix & sleep 12 && \
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/ ; docker rm -f $(docker ps -q --filter ancestor=music-vote-prod-fix) 2>/dev/null; docker volume rm mvfix
```
Expected: container stays up (no exit), curl prints a 200-line (or any HTTP status — the point is the server no longer exits).

- [ ] **Step 6: Commit**

```bash
git add backend/server-bind-check.ts backend/__tests__/server-bind-check.test.ts
git commit -m "fix(server): treat non-timeout IPv6 connect failures as free port

Bun wraps refused connects in platform/version-drifting text; prod (Bun
1.4.2 linux) lost the ECONNREFUSED token and the boot probe exited 1 on
a free port, crash-looping the Fly machine. Only answered or
accepted-but-silent means occupied now."
```

### Task 2: CI runtime-parity job (e2e under Dockerfile-pinned Bun)

**Files:**
- Modify: `.github/workflows/ci.yml` (add `runtime` job; `deploy.needs`)

**Interfaces:**
- Consumes: existing scripts `bun run test:e2e` / `bun run test:e2e:ssr` and Playwright configs (they boot `backend/server.ts` themselves with a test DB and `LLM_PROVIDER=mock`).
- Produces: job `runtime` (green = server boots and e2e suites pass under the same Bun major/minor as the prod image).

- [ ] **Step 1: Add the `runtime` job**

In `.github/workflows/ci.yml`, after `check`, add:

```yaml
  # Prod-parity gate: the Dockerfile pins oven/bun:1.4.2, but the check job
  # runs canary (lint/fmt need it). Bun wraps connect errors in
  # version-drifting text, so a server that boots on canary may still
  # crash-loop on 1.4.2 — this job boots the real server under the exact
  # prod Bun and runs both Playwright suites. Keep this version in sync
  # with the Dockerfile FROM line.
  runtime:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install
        env:
          DATABASE_URL: file:./dev.db
      - run: bun x playwright install --with-deps chromium
      - run: sudo apt-get update && sudo apt-get install -y --no-install-recommends ffmpeg
      - run: bun run test:e2e
        env:
          PORT: 3100
          CI: 1
      - run: bun run test:e2e:ssr
        env:
          PORT: 3100
          CI: 1
```

- [ ] **Step 2: Gate the deploy on it**

Change `deploy.needs: [check]` → `needs: [check, runtime]`.

- [ ] **Step 3: Verify the workflow file parses**

Run: `bun x --no-install action-validator .github/workflows/ci.yml 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
Expected: prints `yaml ok` (or action-validator passes). Also eyeball indentation — the file uses 2-space YAML.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run e2e under the Dockerfile-pinned Bun (prod parity)"
```

### Task 3: Docs — probe semantics + parity rule

**Files:**
- Modify: `docs/agents/deployment.md` (CI bullet)
- Modify: `docs/agents/music-vote.md` (ops note on boot probes / crash-loop triage)

**Interfaces:**
- Consumes: Task 1 semantics, Task 2 job.

- [ ] **Step 1: Update `docs/agents/deployment.md`**

In the automatic-deploy section add one bullet: the `runtime` CI job runs both Playwright suites under the Bun version pinned in the Dockerfile; when bumping the Dockerfile `FROM oven/bun:X`, bump `runtime`'s `bun-version` in the same commit (canary stays only for `check`, which needs it for `bun check`/`lint`/`fmt`).

- [ ] **Step 2: Update `docs/agents/music-vote.md` ops notes**

Add/adjust the boot-probe note: both loopback probes run on every boot in every env; the IPv6 probe treats only answered or accepted-but-silent as conflict (Bun's connect-error text drifts across versions — do not match on errno strings); triage a down machine with machine events (`exit_code 1` + restart_count climbing = boot-time refusal; the error line is in the machine's console via `flyctl logs`).

- [ ] **Step 3: Commit**

```bash
git add docs/agents/deployment.md docs/agents/music-vote.md
git commit -m "docs: prod-parity runtime job; boot-probe triage notes"
```

### Task 4: Verify locally, ship, verify production

**Files:** none (verification + merge + deploy)

- [ ] **Step 1: Full local gate**

Run: `bun run verify`
Expected: exit 0 (native checks + knip + unit + both Playwright suites).

- [ ] **Step 2: Merge to main (repo flow)**

Run: `bun run merge`
Expected: verify re-runs, fast-forward to `main`, push. CI then deploys automatically.

- [ ] **Step 3: Watch the deploy**

Run: `gh run watch --workflow=ci.yml` (or poll `gh run list --workflow=ci.yml --limit 3`)
Expected: `check`, `runtime`, `deploy` all green.

- [ ] **Step 4: Verify production is up**

Run:
```sh
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' https://music-vote.fly.dev/
```
Expected: `200` within a few seconds (first request pays the machine wake). If the machine is wedged at restart_count 10, start it via the Fly MCP `start_machine` (app `music-vote`, machine `83d1299cd52e48`) — it only stays stopped if boot still fails; then check `list_machine_events` for fresh `exit` events. Success = request answered and the newest events show a plain `start` with no trailing `exit`.

- [ ] **Step 5: Report**

Summarize: root cause, fix, CI guard, prod verification evidence (curl output + machine events).
