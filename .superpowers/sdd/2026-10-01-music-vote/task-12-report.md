# Task 12 Report: Host page (controls, QR, live counts) + create page

Commit: `cb71959` — `feat(host): create room, host console — strudel, controls, qr, live counts`

## What I implemented

- `frontend/lib/room-ws.ts`
  - `createRoomChannel(options): { close }` — framework-free WS client for `/ws?room=<id>`: parses JSON frames into `WsEvent`, dispatches to `onEvent`, auto-reconnects with exponential backoff 1s → 2s → 4s → 8s → cap 10s, resets the backoff on a successful open, calls `onReconnect` on every open **after** a drop (first open is not a resync), reports `onStatusChange(connected)`, and `close()` cancels the pending timer + closes the socket and never reconnects.
  - Injected seams: `wsFactory` (socket factory) and `scheduler` (`schedule`/`cancel`) keep unit tests off real sockets and real timers. Types `WebSocketLike`/`WebSocketFactory`/`RoomScheduler` are module-private (knip flags unused exports).
  - `useRoomChannel(roomId, { onEvent, onReconnect }): { connected }` — one channel per `roomId`, callbacks held in refs so a parent re-render never re-opens the socket; effect cleanup closes the channel.
- `frontend/components/qr-code.tsx` — `qrDataUrl(value)` (`qrcode` `toDataURL`, PNG) with a per-value memo (`resolved`/`pending` maps), and `QrCode({ value, size })` that renders a skeleton until the data URL is ready, then `<img src={dataUrl} alt="QR code for <url>" data-testid="qr-code">`. Memo also lets the first render read a cached URL synchronously (used by the test).
- `frontend/components/poll-monitor.tsx` — `PollMonitor({ question, options, counts })` renders one bar per entry of `options` (`key`/`label` from the poll), count + percentage. **No yes/no hardcoding**; end polls render wrap/continue.
- `frontend/routes/create.tsx` — session-gated form (genre, BPM 60–200, length 5–60 min, poll interval 60–600s) validated by `createRoomSchema` via TanStack Form; `rooms.create` → `navigate({ to: '/r/$id/host' })`.
- `frontend/routes/host.tsx` — session-gated host console:
  - `rooms.get` query → `StrudelPlayer code={room.currentCode}` (seed apply), code preview, QR + vote URL `${origin}/r/${roomId}`, room/WS status badges, `PollMonitor` from the open poll, toast for `warning`, apply-status badge (`change applied` / `change rejected: …` / `reverted`), ended banner with link to `/r/<id>`.
  - `code_update` → `playerRef.applyPattern(code)` → `reportApplyResult({roomId, versionId, ok, error?})` for **both** ok and fail. Report is skipped for `kind: 'initial' | 'undo'` because those versions are already `applied` server-side and `reportApplyResult` rejects non-candidates (would toast a spurious error). Verified in dev: evolution updates are confirmed (see below).
  - WS reconnect → `queryClient.fetchQuery(rooms.get)` then imperative `applyPattern(fresh.room.currentCode)` (spec row "Host WS drop").
  - Controls: Start (lobby), Undo / Skip poll / End set → mutations; refetch after each. `room_status` event → refetch (this is how the host learns the set ended).
- `frontend/router.tsx` — added `create` and `/r/$id/host`; the host component gets its typed param from a tiny `HostRouteContainer` using `hostRoute.useParams()` (avoids a router↔route import cycle).
- `backend/trpc/rooms.ts` — see ruling 1 below.
- `knip.json` — **removed** the temporary `frontend/audio/strudel-player.tsx` ignore entry (now imported by the host route). `bun run check` green with the entry gone.
- `package.json` / `bun.lock` — kept the prior worker's `qrcode@1.5.4` + `@types/qrcode@1.5.6` (needed; committed here).

## Ruling 1 — `rooms.get` counts shape

`rooms.get` previously returned `voteCounts: { yes, no }`, which cannot express end-poll (wrap/continue) tallies. I normalized **server-side** to match the WS `vote_count` shape exactly:

```ts
// zero-filled from the open poll's option keys, then DB counts merged in
const voteCounts: Record<string, number> = {}
for (const option of parseOptions(openPoll?.options)) voteCounts[option.key] = 0
for (const row of voteAgg) if (row.choice in voteCounts) voteCounts[row.choice] = row._count.choice
```

The response also returns a shaped `openPoll: { id, question, closesAt, options: {key,label}[] } | null` instead of the raw Prisma `Poll`. Rationale: `Poll.options` is Prisma `Json` (recursive `JsonValue`), and accessing it client-side triggered `TS2589: Type instantiation is excessively deep`. Shaping on the server (the same pattern `votingRouter.currentPoll` already uses) gives the client typed options and lets `PollMonitor` stay generic. No other consumer reads `rooms.get` (checked: only `backend/rooms/__tests__/service.test.ts` exercises the FORBIDDEN path).

Client-side `parsePollOptions` was written first and then deleted once the server started returning typed options — no dead code left.

## Ruling 3 — StrudelPlayer ref contract verification

**Component import in a test: works now.** Task 11's crash came from resolving `@strudel/web` before `mock.module` could intercept. The passing pattern (now `frontend/components/__tests__/strudel-player-import.test.ts`) is `mock.module('@strudel/web', …)` followed by a **dynamic** `await import('@frontend/audio/strudel-player')`. I did **not** reproduce the original crash error, so there is no error string to report; the guard test now imports the module successfully under Bun's runner (`1 pass`). A static top-level import was not attempted.

**Manual verification (real browser, scratch route + scratch Playwright spec, both deleted before commit).** Results from the recorded apply log:

| Contract | How | Result |
|---|---|---|
| `applyPattern` + `stop` exposed on ref | `expose` button read `typeof ref.current.applyPattern/stop` | `{ applyPattern: 'function', stop: 'function' }` ✅ |
| `ref.applyPattern` really applies | `ref.current.applyPattern('s("cp")')` → rendered result | `{"ok":true}` ✅ |
| null-`code` guard | mount with `code=null`, 3 forced parent re-renders, 1.5s | apply count stayed `0` ✅ |
| fresh `onApplyResult` does NOT re-apply (no loop) | 5 forced parent re-renders (each creating a new callback), waited 2s | apply count stayed `1` ✅ (Task 11 Finding 2 regression confirmed fixed against a real render tree) |
| unmount → remount works | toggle unmount (hush), remount | re-applies and keeps working; no page errors ✅ |
| unmount hushes | only observable by ear | **verified by inspection only** (cleanup calls `stopStrudel()`); not audible/verifiable in headless Chromium |

Observation: on remount with `code` already set, the apply log recorded **two** applies ~550 ms apart (count 1 → 3). All other paths applied exactly once. This only happens for a mount whose `code` prop is already non-null; the host page mounts the player with `code=null` and seeds it later, so the observed path does not occur in the host console. Not investigated further (would need render instrumentation); flagged as a residual risk.

## TDD evidence

RED (before implementation):

```
$ bun test frontend/lib/__tests__/room-ws.test.ts frontend/components/__tests__/qr-code.test.tsx frontend/components/__tests__/poll-monitor.test.tsx
error: Cannot find module '@frontend/components/qr-code' ...
error: Cannot find module '@frontend/components/poll-monitor' ...
error: Cannot find module '@frontend/lib/room-ws' ...
 0 pass, 3 fail
```

Also RED in the sense that the `strudel-player-import` test could not have passed before the mock-then-dynamic-import pattern was established (that file is the ruling-3 probe).

GREEN:

```
$ bun test frontend
16 pass, 0 fail  (qr-code 2, poll-monitor 2, strudel-player-import 1, strudel-init 5, room-ws 5)

$ bun run check
biome: 0 errors (73 pre-existing nursery warnings)
typecheck: clean   knip: clean   test: 133 pass / 0 fail   ✓ all checks passed

$ bun run build
build done
```

Two of my first room-ws expectations were wrong (I asserted backoff kept growing across a *successful* open); the implementation resets the counter on open, which is correct, so the tests were fixed, not the implementation.

## Dev-server verification (no real LLM)

Steps:

1. Scratch fixture `/tmp/mv-llm-mock.json` (`LLM_MOCK_SCRIPT`, uncommitted): initial `s("bd*4, hh*8")`, question, evolution `s("bd*4, hh*8, cp")`, question, outro `s("bd*2, hh*4")`.
2. `LLM_PROVIDER=mock LLM_MOCK_SCRIPT=/tmp/mv-llm-mock.json MV_E2E_FAST=1 bun run dev` (fast mode: 5s poll window, 10s min interval).
3. Scratch Playwright spec (uncommitted, deleted) against the real dev server: signup → `/create` → create room → start → vote via the tRPC HTTP API (Task 13's vote page does not exist yet: `voting.claimSession` → `voting.currentPoll?input=…` → `voting.castVote`) → assertions.

Outcome (spec passed, 1.1 min):

- console renders after create; room status `lobby` → Start → `live`; WS badge `connected`.
- QR `<img>` `src` starts with `data:image/png` (browser bundle resolved `qrcode`'s canvas renderer); `#vote-url` equals `http://localhost:3000/r/<roomId>`.
- seed apply of the initial pattern reached the player (`current-code` shows `bd*4`).
- audience vote → poll closes → evolution `code_update` → `applyPattern` → apply-status `change applied` (i.e. `reportApplyResult(ok:true)` succeeded and the version was promoted); `poll-monitor` rendered with live bars.
- Undo → apply-status `reverted`; End set → outro `code_update` applied → room `ended` banner with an `Open summary` link to `/r/<roomId>`.

Still needs human ears/output (cannot be asserted here): audible playback, cycle-boundary swap quality, whether the lazily-fetched sample bank loads at venue volume, whether the core-drum warmup avoids first-play silence, and the mousedown-only audio unlock in a real browser session.

Cleanup: all scratch files removed (`e2e/scratch-host.spec.ts`, `e2e/scratch-player.spec.ts`, `frontend/routes/scratch-player.tsx`, the temporary router entry, `/tmp` fixture). `git status` shows only the intended files; no DB/E2E fixtures committed.

## Files changed

- `frontend/lib/room-ws.ts` (new)
- `frontend/lib/__tests__/room-ws.test.ts` (new)
- `frontend/components/qr-code.tsx` (new)
- `frontend/components/poll-monitor.tsx` (new)
- `frontend/components/__tests__/qr-code.test.tsx` (new)
- `frontend/components/__tests__/poll-monitor.test.tsx` (new)
- `frontend/components/__tests__/strudel-player-import.test.ts` (new — ruling 3)
- `frontend/routes/create.tsx` (new)
- `frontend/routes/host.tsx` (new)
- `frontend/router.tsx` (modified — `create`, `/r/$id/host`)
- `backend/trpc/rooms.ts` (modified — generic `voteCounts`, shaped `openPoll`)
- `knip.json` (modified — temporary player ignore removed)
- `package.json`, `bun.lock` (modified — `qrcode` + `@types/qrcode`, from the prior worker)

## Self-review findings

- WS hook: backoff, cap, reset-on-open, no reconnect after `close()`, cleanup on unmount — covered by unit tests; `useRoomChannel` holds callbacks in refs so parent re-renders cannot re-open the socket.
- `code_update` reports **both** ok and fail; report is intentionally skipped for initial/undo (non-candidate) versions, with a comment.
- Knip ignore removed and `bun run check` green (biome 0 errors, typecheck, knip, 133 tests).
- PollMonitor has no yes/no hardcoding; test renders wrap/continue and asserts `Yes`/`No` are absent.
- Both routes are session-gated (sign-in CTA when no session); `rooms.get` errors render an alert + retry.
- The player is mounted unconditionally inside the authed console so `playerRef` exists before any WS frame arrives (no dropped early `code_update`).
- Host page keeps exactly one `StrudelPlayer` mounted (documented global-engine hazard).
- Tailwind-visible class literals: apply-status tones map through `APPLY_STATUS_CLASS` so `badge-success/error/warning` are emitted by the scanner.
- No scratch fixtures or verification files committed.

## Concerns / residual risks

1. **Remount double-apply** (see ruling-3 table): two applies ~550 ms apart when a player mounts with a non-null `code`. Does not affect the host console's mount path (seeds from `null`, never remounts mid-set), so it is a follow-up, not a live-flow bug. **Root cause: unknown** — an earlier draft of this report blamed React dev-mode effect double-invocation, but `frontend/main.tsx` has no `StrictMode`, so that hypothesis is disproven; the cause was not investigated further (would need render instrumentation) and is explicitly deferred.
2. **`unmount hushes` is verification-by-inspection only** — no audible assertion is possible in headless Chromium, and there is no instrumentation hook.
3. **Reconnect re-apply is untested end-to-end.** The wiring (`onReconnect` → `refetch` → `applyPattern`) is exercised indirectly by the room-ws unit test + code inspection; forcing a real WS drop in the dev browser was not done.
4. The code preview shows the last successfully applied code; a rejected evolution is surfaced only in the apply-status badge.
5. `@strudel/web` remains browser-only and untyped upstream (`frontend/audio/strudel.d.ts`); backend tests print `cannot use window: not in browser?` / `🌀 @strudel/core loaded 🌀` from the transpiler import — pre-existing, unrelated to this task.
6. No vote page exists yet, so the dev verification cast its vote through the tRPC HTTP API rather than the real phone UI (Task 13 owns that).

---

# Fix round 1 (review: no Critical, 2 Important both in the primary host flow, 1 bundled minor, report hygiene)

Commit: `e2a58e9` — `fix(host): stop audio at set end, follow poll lifecycle on host channel`.

The WS channel, apply/report loop and the `rooms.get` reshape were judged correct and were **not** touched (the reshape is explicitly kept). Deferred items were left alone: `qrDataUrl` memo, create-form per-field validation messages, PollMonitor percent-math tests, remount double-apply root cause.

## P1-1 — audio never stopped at `ended` (fixed)

`frontend/routes/host.tsx`: added an idempotent effect keyed on the status string, placed with the other hooks (before the early returns so hook order is stable):

```tsx
const roomStatus = room?.status
useEffect(() => {
	if (roomStatus !== 'ended') return
	playerRef.current?.stop()
}, [roomStatus])
```

Runs once per transition into `ended`; a later `rooms.get` refetch that returns the same status cannot re-fire it. The `ended` banner text ("Set finished — playback stopped.") is now truthful.

**Verification (manual, browser — the `react-dom/server` infra used by `poll-monitor.test.tsx` renders statically and never runs effects, so no unit test can cover this).** Observed real audio activity in headless Chromium by wrapping `AudioBufferSourceNode.prototype.start` in an init script and counting starts:

| run | audio starts while live | new starts in the 4 s window after `ended` |
|---|---|---|
| with the fix | 387 | **0** |
| fix temporarily removed (RED probe) | 387 | **24** |

RED (`bunx playwright test e2e/scratch-host2.spec.ts`, fix reverted): `Expected: 0 / Received: 24` — the outro keeps playing forever, exactly the reported symptom. GREEN with the fix: `AUDIO starts beforeEnd=387 endsWindow=747..747 errors=0`, `1 passed (2.2m)`. The RED probe was a temporary edit to `host.tsx` only (restored immediately; the shipped effect is the code above).

Note on the earlier STOP-message idea: `MessagePort` STOP frames are not usable as evidence here — this playback path uses superdough (`AudioContext` + buffer sources) and never constructs the kabelsalat `AudioWorkletNode` (verified: `workletNodes=0` across a full set), so the engine's internal STOP message is never posted even when `hush()` runs. Audio activity is the observable that works.

## P1-2 — host poll state froze after poll 1 (fixed at the source)

**(a) Scheduler — `backend/polls/scheduler.ts`.** `openNextQueuedPoll` and `closePoll` now build the event once and publish it to **both** channels; the audience publication and its payload are byte-identical to before, no new event shapes:

```ts
const opened: WsEvent = { type: 'poll_opened', poll: { … } }
hub.publishAudience(roomId, opened)
hub.publishHost(roomId, opened)
// closePoll: same for { type: 'poll_closed', pollId, winningOption }
```

**(b) Host console — mechanism choice: refetch `rooms.get`** (not state from the payload). Reasons:

- `poll_opened`'s payload carries option **labels only** (`options: string[]`), while the console's bars and `vote_count` matching are keyed by option **key**; using the payload would mean re-deriving keys or changing the event shape, which the ruling forbids.
- `poll_closed` carries no poll body at all, so the payload cannot clear/replace the panel.
- The venue case the ruling calls out — a poll opening with **zero votes** — needs zero-filled counts; `rooms.get` zero-fills from the open poll's option keys (the Task 12 reshape), so one refetch renders the new question with 0/0 bars.
- `rooms.get` is ownership-checked and already the console's single source of truth for `openPoll` + `voteCounts`; no second rendering path or new state is introduced.

```tsx
case 'poll_opened':
case 'poll_closed':
	void refetchRoom()
	break
```

**RED → GREEN (scheduler unit test, mirrors Task 9's audience assertions).** New test `host channel receives poll_opened and poll_closed alongside the audience` in `backend/polls/__tests__/scheduler.test.ts`:

```
RED   bun test backend/polls/__tests__/scheduler.test.ts -t "host channel receives"
      Expected: "cmupttqli0001x84ptgw9wa2x"
      Received: undefined          ← host channel had no poll_opened
      0 pass, 1 fail, 12 filtered out
GREEN 1 pass, 12 filtered out, 0 fail, 6 expect() calls
```

It also asserts the audience copy of each event is **deep-equal** to the host copy, pinning “audience unchanged”. Full file: 13 pass / 0 fail; whole suite: 134 pass / 0 fail.

**Host-side verification (manual, browser).** Same scratch e2e: after the poll-1 vote/evolution, poll 2 opens ~60 s later **with zero votes** and the console switches to it — `poll-monitor` contained `More energy?` (poll 1, bars `Yes 1 / No 0`) and then `bd*4` (poll 2) with `poll-option-yes`/`poll-option-no` both `0` and `More energy?` gone. That is the projector case from the ruling. With `LLM_PROVIDER=mock` every `getLlmProvider()` call constructs a fresh `MockLlmProvider` reading `responses[0]`, which is why poll 2's question is the idx-0 fixture string rather than a bespoke second question. A host-side *unit* test is not possible with the available infra (static `react-dom/server` render, no effects/hooks), so this path is verified in the browser and stated as such.

## P2-1 — Start-flow double-apply race (fixed)

`handleCodeUpdate` now returns early for `event.kind === 'initial' && appliedCodeRef.current === event.code`, so the `initial` frame that `startRoom` publishes cannot re-apply a code the seed effect is already applying from the refetched room. Initial frames with a genuinely different code still apply.

## Report hygiene (corrected)

- The remount double-apply cause is **unknown**; the dev-mode effect double-invocation hypothesis in the first draft is disproven (`frontend/main.tsx` has no `StrictMode`). The host flow is unaffected (the player mounts with `code=null` and is never remounted mid-set). Marked a follow-up.
- This section records that P1-2 is now handled by host-side poll lifecycle publication (scheduler → `publishHost` → console refetch).

## Fix-round validation

```
bun test backend/polls/__tests__/scheduler.test.ts -t "host channel receives"   RED (1 fail) → GREEN (1 pass)
bun run check    → biome 0 errors, typecheck clean, knip clean, 134 pass / 0 fail
bun run build    → build done
```

Note on test invocations: `bun run check` runs `bun run test --parallel`, which is the repo gate and is green. Two invocations that are *not* the gate fail for pre-existing reasons unrelated to this change: bare `bun test` also discovers `e2e/*.spec.ts` (Playwright files → "Playwright Test did not expect test() to be called here"), and sequential `bun run test` hits cross-file mock/DB interference in the `backend/votes` and `backend/rooms` suites. Verified pre-existing by reverting this commit in the working tree (`git revert --no-commit`): the parent tree shows the same interference, and worse (34 failing assertions vs 18 here; identical failing test names, none in the files this commit touches). The tree was restored with `git reset --hard` and re-verified green.

Scratch verification artifacts were deleted before the commit (`e2e/scratch-host2.spec.ts`, `e2e/scratch-engine.spec.ts`, `playwright.scratch.config.ts`, `test-results/`); `git status` is clean.
