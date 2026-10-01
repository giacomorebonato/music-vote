# music-vote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crowd-voted, AI-steered live Strudel music rooms — host plays, phones vote, music evolves.

**Architecture:** Fly/Bun server = conductor (room state machine, poll scheduler, LLM orchestration, Prisma). Host browser = audio terminal (embedded `@strudel/web`, applies validated code at cycle boundaries). Phones = anonymous vote clients (QR → tRPC + WS push).

**Tech Stack:** mino-starter (Bun, React 19, tRPC v11, better-auth, Prisma 7/SQLite, daisyUI 5, Tailwind 4, Playwright) + `@strudel/web`/`@strudel/transpiler` (pinned) + Ollama provider layer.

**Spec:** `docs/superpowers/specs/2026-10-01-music-vote-design.md` — read it first; this plan argues from it.

## Global Constraints

- Bun everywhere — runtime, PM, bundler, test runner. Never npm/pnpm.
- Aliases `@backend/* @frontend/* @shared/*`. Unit tests colocated in `__tests__/`. Zod schemas in `shared/schemas/`. Biome style = tabs, no semicolons — `bun run check` green before every commit.
- tRPC v11 `protectedProcedure` pattern (see `backend/trpc/notes.ts` in starter); Prisma v7 `prisma-client` generator, `runtime = "bun"`, SQLite.
- **LLM is mocked in every test.** Real Ollama calls happen only in manual verification steps.
- Pin exact `@strudel/web` + `@strudel/transpiler` versions in package.json (spec: no `@latest`; REPL-breaking upgrades forbidden).
- Spec constants verbatim: BPM 60–200, length 5–60 min, poll interval 60–600 s, end-poll at 75% of length, outro duration = pollIntervalSec. Poll open window = 45 s (spec silent; plan decision, constant `POLL_OPEN_SECS = 45`).
- AGPL: repo goes public; Task 15 adds LICENSE.

## Review Focus

1. **Zero-vote poll** → no winner, no music change, next poll still scheduled (spec's poll cycle assumes votes; a dead room must not crash or skip).
2. **Host ends song while a poll is open** → poll closes without applying a change (order-of-operations between end path and scheduler).
3. **LLM emits code with network/process calls** (`fetch(`, `import(`, `XMLHttpRequest`) → CodeValidator rejects server-side before it ever reaches a browser. Strudel code is real JS; guard it.
4. **Server restart mid-room** → scheduler restores from DB, overdue poll closes with no change, live room resumes — no duplicate applies, no orphaned timers.
5. **Vote page opened for lobby/ended room** → renders status (not a crash); ended room shows summary.

Each is pinned by a test named below in its owning task.

---

### Task 1: Bootstrap repo from mino-starter

**Files:**
- Create: everything from `~/Code/mino-starter` except `.git/`, `dev.db`, `test.db`, `.env`, `node_modules/`
- Modify: `package.json` (name → `music-vote`), `frontend/router.tsx` + `frontend/routes/notes.tsx` + `frontend/components/note-*.tsx` + `backend/trpc/root.ts` + `backend/trpc/notes.ts` + `shared/schemas/note.ts` + prisma `Note` model + any `e2e/` note references → **deleted**
- Keep: starter's `AGENTS.md`, `.agents/skills/project-structure/`, `docs/agents/`, scripts, hooks (they document conventions this plan follows)

**Interfaces:**
- Produces: working starter skeleton — auth, `appRouter` with only `public` router, clean `bun run check`.

- [ ] **Step 1: Copy starter** — `rsync -a --exclude .git --exclude node_modules --exclude 'dev.db' --exclude 'test.db' --exclude .env ~/Code/mino-starter/ ./` then `bun install && cp .env.example .env` and set `BETTER_AUTH_SECRET`.
- [ ] **Step 2: Strip notes demo** — delete files above; remove `Note` model + its `notes` relation on `User`; delete the note migration (re-baseline: `rm -rf prisma/migrations/* && bun run db:migrate -- --name init`); remove notes route from `router.tsx`.
- [ ] **Step 3: Verify** — `bun run check` (biome + typecheck + knip + unit) — must pass with zero unused-export errors; `bun run dev` serves login + home.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore: bootstrap from mino-starter (notes demo stripped)"`.

### Task 2: Prisma models + room schemas

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `shared/schemas/room.ts`, `backend/db/__tests__/models.test.ts`

**Interfaces:**
- Produces: models `Room` (id, hostId→User, bpm Int, lengthSec Int, pollIntervalSec Int, genre, status `lobby|live|outro|ended` as String, currentCode String?, stateDoc Json, createdAt), `Poll` (id, roomId, kind `evolution|end`, question, options Json, openedAt?, closesAt?, status `queued|open|closed`, winningOption String?, unique(roomId, seq)), `Vote` (id, pollId, sessionToken, choice; **unique(pollId, sessionToken)**), `PatternVersion` (id, roomId, code, source String, status `candidate|applied|rejected|reverted`, appliedAt?).
- Produces: `createRoomSchema` = `{ bpm: z.int().min(60).max(200), lengthMin: z.int().min(5).max(60), pollIntervalSec: z.int().min(60).max(600), genre: z.string().min(1).max(80) }`.

- [ ] **Step 1: Write failing test** — `models.test.ts`: `test('vote dedup: second vote same token+poll throws P2002')` — create room/poll via prisma, insert two votes with same (pollId, sessionToken), expect rejection; `test('createRoomSchema rejects bpm 59 and 201')` with exact boundaries (60, 200 valid).
- [ ] **Step 2: Run** — `bun test backend/db` → FAIL (models/schema don't exist).
- [ ] **Step 3: Implement** — schema.prisma models + `shared/schemas/room.ts`. `bun run db:migrate -- --name music-models`.
- [ ] **Step 4: Run** — `bun test backend/db` → PASS; `bun run check` green.
- [ ] **Step 5: Commit** — `git commit -m "feat(db): room, poll, vote, pattern-version models"`.

### Task 3: CodeValidator (server-side Strudel compile + JS guard)

**Files:**
- Create: `backend/music/validate.ts`, `backend/music/__tests__/validate.test.ts`

**Interfaces:**
- Produces: `compileCheck(code: string): { ok: true } | { ok: false; error: string }` in `backend/music/validate.ts` — wraps `@strudel/transpiler` parse/eval headless; rejects on (a) transpile error, (b) guard blocklist match (regexes for `fetch(`, `import(`, `require(`, `XMLHttpRequest`, `document.`).
- This is spec spike 3 — Step 2 must confirm transpiler runs in Bun before building the guard.

- [ ] **Step 1: Spike probe** — throwaway: `bun -e 'import("@strudel/transpiler").then(m => console.log(Object.keys(m)))'`. If the package cannot import in Bun, stop and report (fallback: regex-only linter, weaker guarantee — needs human decision). Expected: exports including transpiler utilities (e.g. `evalScope`/`transpiler` — read its README).
- [ ] **Step 2: Write failing tests** — `validate.test.ts`: golden valid snippets (from spec prompt few-shots, e.g. `s("bd sd cp hh")`, `setcps(1)` piece) → `{ok:true}`; broken snippet (`s("bd sd cp hhhh")`-style syntax error, unbalanced paren) → `{ok:false, error}`; **Review Focus #3**: `s("bd").play(); fetch('/steal')` and `import('evil')` → `{ok:false}`.
- [ ] **Step 3: Run** — FAIL (module missing).
- [ ] **Step 4: Implement** `compileCheck` + blocklist; add pinned deps `@strudel/transpiler@<exact>`.
- [ ] **Step 5: Run** — `bun test backend/music` → PASS; `bun run check`.
- [ ] **Step 6: Commit** — `git commit -m "feat(music): server-side strudel compile validation + js guard"`.

### Task 4: LLM provider layer

**Files:**
- Create: `backend/llm/provider.ts`, `backend/llm/__tests__/provider.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `interface LlmProvider { chat(prompt: string, opts?: { system?: string; temperature?: number }): Promise<string> }`; `getLlmProvider(): LlmProvider` — env `LLM_PROVIDER=ollama|mock` (default ollama); `MockLlmProvider` — constructor takes `responses: string[]`, pops in order, throws on exhaustion.
- Produces env contract: `OLLAMA_BASE_URL` (default `http://localhost:11434`), `OLLAMA_MODEL`, `OLLAMA_API_KEY` (cloud subscription; header `Authorization: Bearer` when set).

- [ ] **Step 1: Failing tests** — `provider.test.ts`: mock returns scripted sequence; ollama provider (with global `fetch` stubbed) POSTs to `${OLLAMA_BASE_URL}/api/chat` with `{model, messages:[{role:'system'},{role:'user'}], stream:false}` and Bearer header when key set; factory picks by env.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** both providers + factory. Strip markdown fences in Ollama response (later tasks rely on clean text).
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(llm): provider interface, ollama impl, test mock"`.

### Task 5: StateDoc + prompt builders

**Files:**
- Create: `backend/music/stateDoc.ts`, `backend/music/prompts.ts`, `backend/music/__tests__/stateDoc.test.ts`, `backend/music/__tests__/prompts.test.ts`

**Interfaces:**
- Produces: `type StateDoc = { genre: string; bpm: number; elements: { drums: boolean; bass: boolean; melody: boolean; harmony: boolean; soundDesign: string[] }; history: { at: number; question: string; winner: string; changeSummary: string | null }[]; polledDimensions: string[] }` + `initialStateDoc(params): StateDoc` + `applyChange(doc, question, winner, changeSummary): StateDoc` (append history, update elements/`polledDimensions`, immutable).
- Produces: `buildInitialPatternPrompt(params)`, `buildQuestionPrompt(doc)`, `buildEvolutionPrompt(doc, question, winner, currentCode)`, `buildOutroPrompt(doc, currentCode)` — all `(x) => string`. Prompt contracts (assert in tests): initial/evolution/outro instruct "output ONLY strudel.js code, no prose, no markdown fences"; evolution includes current code + history + "change exactly one dimension"; question prompt instructs "output ONE yes/no question, max 120 chars, don't repeat polled dimensions, pace the evolution"; every prompt includes BPM + genre + few-shot snippets from a `FEW_SHOTS` const in `prompts.ts`.

- [ ] **Step 1: Failing tests** — stateDoc: `applyChange` appends + updates polledDimensions + immutability (input doc unmutated); prompts: snapshot-style assertions — evolution prompt contains currentCode, winner, genre, "ONE", fence prohibition; question prompt contains polledDimensions join.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** types + builders.
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(music): state doc + llm prompt builders"`.

### Task 6: MusicEngine

**Files:**
- Create: `backend/music/engine.ts`, `backend/music/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: `LlmProvider` (Task 4), `compileCheck` (Task 3), prompt/stateDoc builders (Task 5).
- Produces: `generateInitialPattern(provider, params): Promise<{ code: string; doc: StateDoc }>` (validate; 1 retry; throw `MusicGenError` on 2nd fail — room start surfaces error to host); `generateNextQuestion(provider, doc): Promise<string>` (trim, reject >120 chars or empty → 1 retry → fallback to canned question `"Do you want more energy? yes/no"`); `generateEvolution(provider, doc, question, winner, currentCode): Promise<{ code: string; changeSummary: string } | null>` (validate, 1 retry, **null after 2 fails** — spec: skip change, keep last-good); `generateOutro(provider, doc, currentCode): Promise<string>` (validate, 1 retry, throw on fail — host can re-trigger). **Provider exceptions (timeout/network — spec failure row "LLM timeout") are caught inside the engine and treated exactly like an invalid response** (evolution → null, question → canned fallback).

- [ ] **Step 1: Failing tests** — engine.test.ts with `MockLlmProvider`: happy path returns validated code; invalid-then-valid triggers exactly 2 provider calls (retry); twice-invalid evolution → `null`; oversized question → fallback canned; `fetch(`-code rejected as invalid (uses Task 3 guard).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** engine orchestration.
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(music): LLM engine — initial pattern, questions, evolution, outro"`.

### Task 7: RealtimeHub + WS wiring

**Files:**
- Create: `shared/realtime/events.ts`, `backend/realtime/hub.ts`, `backend/realtime/__tests__/hub.test.ts`
- Modify: `backend/server.ts` (add `websocket` handler + `/ws` upgrade; keep existing route map intact)

**Interfaces:**
- Produces: WS event types — audience: `poll_opened {poll}`, `poll_closed {pollId, winningOption|null}`, `room_ended`; host: `code_update {code, versionId, kind:'initial'|'evolution'|'undo'|'outro'}`, `vote_count {pollId, yes, no}`, `room_status {status}`, `warning {message}`, `pattern_rejected {versionId, error}` (discriminated union `WsEvent` in `shared/realtime/events.ts`).
- Produces: `hub.joinRoom(ws, roomId, role, isHost)`; `hub.publishAudience(roomId, event)`; `hub.publishHost(roomId, event)` — in `backend/realtime/hub.ts`. Host-channel join verified against better-auth session (cookie on upgrade) + room ownership; audience join open.
- WS URL: `/ws?room=<roomId>`; role derived server-side (host iff session matches room host).

- [ ] **Step 1: Failing tests** — hub.test.ts (Bun WS client): two audience clients on room A receive `publishAudience`; host event on room A not delivered to audience client; non-owner session attempting host join gets closed. (Real sockets against `Bun.serve` in test.)
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** hub + server.ts wiring.
- [ ] **Step 4: Run** — PASS; `bun run check` (verify dev route map + prod fetch both still serve — start server in test mode).
- [ ] **Step 5: Commit** — `git commit -m "feat(realtime): per-room ws hub, audience/host channels"`.

### Task 8: RoomService + rooms tRPC router

**Files:**
- Create: `backend/rooms/service.ts`, `backend/trpc/rooms.ts`, `backend/rooms/__tests__/service.test.ts`
- Modify: `backend/trpc/root.ts` (compose `rooms:`)

**Interfaces:**
- Consumes: `getLlmProvider`, MusicEngine (Task 6), hub (Task 7), prisma models (Task 2), `createRoomSchema` (Task 2).
- Produces service: `createRoom(hostId, input): Promise<Room>` (lengthSec = lengthMin*60, status lobby); `startRoom(roomId, hostId): Promise<void>` — engine initial pattern → `PatternVersion(initial, applied)` → `room.currentCode` → status `live` → `publishHost(code_update kind:'initial')` → pre-generate first poll question (queued Poll) → arms scheduler (Task 9); `undoLastChange(roomId, hostId)` — mark current applied version `reverted`, revert `room.currentCode` to previous applied, push `code_update kind:'undo'`; `skipPoll(roomId, hostId)`; `endRoom(roomId, hostId)` (used by both host button and scheduler); `reportApplyResult(roomId, versionId, ok, error)` — `candidate→applied` or `→rejected` (+`pattern_rejected` host event).
- Produces router `roomsRouter`: `create`, `get` (host view: room + versions + open poll + counts), `start`, `undo`, `skip`, `end`, `reportApplyResult` — all `protectedProcedure`, ownership-checked.

- [ ] **Step 1: Failing tests** — service.test.ts (mock provider + real prisma test db, scheduler stubbed): create→lobby with lengthSec computed; start→live, initial version applied, currentCode set; undo reverts code + marks reverted; **Review Focus #2**: `endRoom` while poll open → poll closed, winningOption null, no new version; `reportApplyResult(false)` → version rejected. Router: non-owner gets FORBIDDEN on get.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** service + router + root composition.
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(rooms): lifecycle service + host tRPC router"`.

### Task 9: PollScheduler

**Files:**
- Create: `backend/polls/scheduler.ts`, `backend/polls/__tests__/scheduler.test.ts`

**Interfaces:**
- Consumes: MusicEngine, hub, prisma, RoomService `endRoom` (Task 8).
- Produces: `armScheduler(roomId): void` (interval = room.pollIntervalSec); `restoreSchedulers(): Promise<void>` (boot: for each `live` room — close overdue open polls (no change), close due queued polls, arm); module const `POLL_OPEN_SECS = 45`; scheduler tick behavior: open queued poll (status open, openedAt, closesAt) → `publishAudience(poll_opened)`; when closesAt passes (its own timer) → close → tally → tie → seeded random (seed logged via `console.info`) → `publishAudience(poll_closed)` → if winner: `generateEvolution` → validate → `PatternVersion(candidate)` → `publishHost(code_update)` → if null/invalid: poll logged `no change`, `warning` event; then pre-generate next question → `Poll(queued)`. End handling: at 75% of lengthSec schedule queued Poll kind `end` (options wrap/continue) — winner `wrap` → `endRoom`; at lengthSec → `endRoom`.
- `endRoom` (Task 8) triggers outro: engine outro → candidate version → `publishHost(code_update kind:'outro')` → after `pollIntervalSec` → status `ended` → `publishAudience(room_ended)` + `room_status`.
- Tests use `Bun.testing` fake timers or injected `setTimeout`/clock — pick one, document in file header.

- [ ] **Step 1: Failing tests** — scheduler.test.ts: full cycle with fake clock — open at t=0, closesAt=t+45s, audience event sent, winner from 2 votes → candidate version + host code_update; **Review Focus #1**: zero votes → closed, winningOption null, NO version, next poll armed; end-poll appears at 75% of length; outro path: endRoom → outro version → after interval → status ended + `room_ended` event; **Review Focus #4**: `restoreSchedulers` with room live + overdue open poll → closed no-change, armed.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** scheduler.
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(polls): scheduler — open/close, tally, evolution, outro, restore"`.

### Task 10: VoteService + voting tRPC router

**Files:**
- Create: `backend/votes/service.ts`, `backend/trpc/voting.ts`, `backend/votes/__tests__/service.test.ts`
- Modify: `backend/trpc/root.ts` (compose `voting:`)

**Interfaces:**
- Consumes: prisma models, hub (vote_count push on tally change).
- Produces service: `claimSession(): { token: string }` (cookie `mv_session`, httpOnly, 24h — set via tRPC context response headers); `castVote(pollId, token, choice)`: poll must be `open` + not closed by closesAt; dedup on unique constraint → `ALREADY_VOTED` error; then `publishHost(vote_count)`.
- Produces router `votingRouter` (all publicProcedure): `claimSession`, `currentPoll(input {roomId})` → `{ poll: {id, question, options, closesAt} | null, roomStatus }`, `castVote(input {pollId, choice})`, `summary(input {roomId})` → `{ polls: [{question, winningOption, applied: boolean}], versions: [{code, appliedAt, source}] }`.

- [ ] **Step 1: Failing tests** — service.test.ts: claimSession sets cookie header; castVote on closed poll → error; second vote same token → `ALREADY_VOTED` (friendly, not P2002 leak); vote after closesAt rejected; vote_count event pushed. Router test: `currentPoll` on lobby room → null + lobby (**Review Focus #5** half), on ended → null + ended.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** service + router + root composition.
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(votes): anonymous session, dedup, voting router"`.

### Task 11: StrudelPlayer (spec spike 1 — embed + cycle swap)

**Files:**
- Create: `frontend/audio/StrudelPlayer.tsx`, `frontend/audio/strudel-init.ts`, `frontend/components/__tests__/strudel-player.test.ts`
- Modify: `package.json` (pinned `@strudel/web`)

**Interfaces:**
- Produces: `StrudelPlayer` — React component, `forwardRef` exposing `applyPattern(code: string): Promise<{ ok: boolean; error?: string }>` (eval candidate in try/catch; Strudel swaps at cycle boundary natively — verify in Step 1) and `stop(): void` (`hush()`); props: `{ code: string | null; onApplyResult: (result: {ok: boolean; error?: string}) => void; autoplay?: boolean }`.
- `frontend/audio/strudel-init.ts`: `initStrudelOnce()` — idempotent init (imports from `@strudel/web`), preloads default sound bank at init; sound-bank decision (spec spike 2): attempt bundled samples; if package has no offline bank or size > ~10 MB, preload from CDN at init and document in comment. Bun bundler must resolve `@strudel/web` — Step 2 verifies; fallback if it can't: unpkg `<script>` tag with pinned version (document in commit).
- Browser test limits: audio can't be asserted in CI — unit test covers ref contract with init stubbed; real audio = manual step.

- [ ] **Step 1: Spike probe (throwaway)** — scratch page: import `@strudel/web` via Bun dev bundle, `initStrudel()`, play `s("bd sd")`, re-apply different pattern, confirm swap waits for cycle boundary. Record actual API in `strudel-init.ts` header comment. If cycle-boundary swap needs explicit API (e.g. scheduler options), capture it there.
- [ ] **Step 2: Failing test** — unit test with init stubbed: `applyPattern('this is ( broken')` → `{ok:false, error}`; `applyPattern` valid → `{ok:true}`; second call while playing does not throw.
- [ ] **Step 3: Implement** component + init module + dep.
- [ ] **Step 4: Run** — `bun test frontend` → PASS; **manual**: `bun run dev`, host a scratch route, hear `bd sd`, hear swap on re-apply, confirm no mid-bar glitch.
- [ ] **Step 5: Commit** — `git commit -m "feat(audio): StrudelPlayer — embed, cycle-boundary swap, sound bank preload"`.

### Task 12: Host page (controls, QR, live counts)

**Files:**
- Create: `frontend/routes/host.tsx`, `frontend/routes/create.tsx`, `frontend/components/qr-code.tsx`, `frontend/lib/room-ws.ts`, `frontend/components/poll-monitor.tsx`
- Modify: `frontend/router.tsx` (routes: `create`, `/r/$id/host`)

**Interfaces:**
- Consumes: `roomsRouter` (Task 8), `votingRouter.claimSession` not needed here; `WsEvent` + `/ws?room=` client (Task 7), `StrudelPlayer` (Task 11), `qrcode` dep.
- Produces: `frontend/lib/room-ws.ts` → `useRoomChannel(roomId, opts: { onEvent: (e: WsEvent) => void }): { connected: boolean }` (auto-reconnect, backoff 1s→10s).
- Host page behavior: on mount fetch `rooms.get` → render `StrudelPlayer` with `code=currentCode`; on WS reconnect (spec failure row "Host WS drop"): refetch `rooms.get` and re-apply `currentCode` via `applyPattern`; `code_update` events → `applyPattern` → `onApplyResult` → `rooms.reportApplyResult({roomId, versionId, ok, error})`; buttons undo/skip/end → tRPC mutations; QR = `${origin}/r/${roomId}`; `vote_count` → PollMonitor bars; `warning` → toast; ended → link to summary. Create page: form (genre, BPM, length, interval) → `rooms.create` → navigate to host page → start button.

- [ ] **Step 1: Failing unit test** — `qr-code.test.ts`: renders `<img>` with data URL prefix `data:image/png` for input URL; `room-ws` test: fake `WebSocket` (injected factory) — reconnects after close, calls onEvent for message.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** all files + router entries + `qrcode` dep.
- [ ] **Step 4: Verify** — `bun test frontend` PASS; `bun run check`; **manual with local Ollama**: create room (house, 120bpm, 10min, 1min interval), start, hear music, QR scans to vote page, vote steers audio, undo works, end → outro → stopped.
- [ ] **Step 5: Commit** — `git commit -m "feat(host): create room, host console — strudel, controls, qr, live counts"`.

### Task 13: Vote page (poll UI, states, summary)

**Files:**
- Create: `frontend/routes/vote.tsx`, `frontend/components/poll-card.tsx`
- Modify: `frontend/router.tsx` (route `/r/$id`)

**Interfaces:**
- Consumes: `votingRouter` (Task 10), `useRoomChannel` (Task 12), `WsEvent`.
- Produces: vote page states — lobby: "waiting for the DJ"; live no poll: countdown to next (from last closesAt or interval); poll open: question + Yes/No buttons + closesAt countdown, disabled after vote with "vote counted"; ended: summary timeline via `votingRouter.summary` (**Review Focus #5** second half). On mount: `claimSession()` then `currentPoll`; `poll_opened`/`poll_closed`/`room_ended` events drive transitions; WS drop → tRPC `currentPoll` refetch on reconnect.

- [ ] **Step 1: Failing unit test** — `poll-card.test.ts`: renders question text + two buttons; disabled + "vote counted" after `onVote`; countdown prop renders `m:ss`. Vote page state test: with mocked router/trpc — lobby → waiting copy; ended → summary list from mocked `summary` query.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** page + card + route.
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(vote): anonymous vote page — poll, countdown, ended summary"`.

### Task 14: E2E — full democratic cycle

**Files:**
- Create: `e2e/music-vote.spec.ts`
- Modify: `playwright.config.ts` (webServer env: `LLM_PROVIDER=mock` + fixture env `LLM_MOCK_SCRIPT=e2e/fixtures/llm-script.json`)

**Interfaces:**
- Consumes: everything; `MockLlmProvider` extended to read `LLM_MOCK_SCRIPT` JSON file (`{ responses: string[] }`) when env set (Task 4 file, small addition).
- Produces: green e2e proving the product story.

- [ ] **Step 1: Write test** — host signup (reuse starter's auth e2e helper) → create room (bpm 120, length 5, interval 60) → start → host page shows QR + music applied (mock initial pattern fixture) → open vote page in second context (audience) → poll appears after interval (fake time not available in e2e — use interval 60s **only for e2e env** or expose test hook `MV_E2E_FAST=1` shrinking `POLL_OPEN_SECS`/interval minimum — pick: env override constant, document in `scheduler.ts`) → vote yes → third context votes yes, first context votes again → expect `ALREADY_VOTED` UI → second poll cycle → code_update applied on host (assert `reportApplyResult` call via host page badge "change applied") → undo → "reverted" badge → end → outro → vote page shows summary with 2+ poll entries. Fixtures: valid initial + evolution Strudel snippets + question lines in `e2e/fixtures/llm-script.json`.
- [ ] **Step 2: Run** — `bun run test:e2e` → iterate to PASS.
- [ ] **Step 3: Run full gate** — `bun run check:full` green.
- [ ] **Step 4: Commit** — `git commit -m "test(e2e): full democratic music cycle"`.

### Task 15: Deploy config, docs, license

**Files:**
- Create: `LICENSE` (AGPL-3.0), `docs/agents/music-vote.md`
- Modify: `.env.example`, `fly.toml` (verify from starter), `README.md`

**Steps:**
- [ ] **Step 1: LICENSE** — full AGPL-3.0 text (spec decision: repo public).
- [ ] **Step 2: docs/agents/music-vote.md** — env vars (`OLLAMA_*`, `LLM_*`), deploy steps (`fly deploy`, secrets: `OLLAMA_API_KEY`, `BETTER_AUTH_SECRET`), ops notes (single-machine rooms, restart behavior per spec failure table), known limitations (host disconnect = music stops).
- [ ] **Step 3: README** — replace starter blurb: one-paragraph product story + quickstart + link to spec + docs/agents/music-vote.md.
- [ ] **Step 4: Verify** — `bun run check` green; `fly deploy --dry-run` (if machine configured; else document).
- [ ] **Step 5: Commit** — `git commit -m "docs: license, deploy + ops docs, product README"`.