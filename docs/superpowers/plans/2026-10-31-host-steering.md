# Host Steering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The room creator can type a short steering note on the host console; the model regenerates the current pattern with that note applied, delivered through the existing one-at-a-time candidate path, consumed when used.

**Architecture:** Follows `perform()`'s claim→deliver shape plus the scheduler's `prepareUpdate` guard: a `kind=performance` poll row claims the delivery slot in one transaction, `generateSteeredPattern` runs outside it, and a second transaction re-guards (status, base version, still-preparing) before creating the candidate version that the host browser applies and confirms exactly like every other change.

**Tech Stack:** Bun + tRPC v11 + Prisma/SQLite, zod shared schemas, React 19 host console (daisyUI), MockLlmProvider for offline tests/e2e.

**Spec:** `docs/superpowers/specs/2026-10-31-host-steering-design.md`

## Global Constraints

- Bun everywhere; native checks via `bun check` / `bun lint` / `bun fmt`.
- Shared schemas are the single source of truth: new input lives in `shared/schemas/room.ts`.
- Only the room owner may steer (`room.hostId === session.user.id`); the existing `requireRoomOwner` helper is reused.
- Raw steer text is never persisted server-side and never reaches audience phones.
- Generation: max 2 attempts (`MAX_CODE_ATTEMPTS`), same 25s provider timeout, `compileCheck` validation; failure never stops current music.
- The delivery slot is `poll.deliveryStatus='preparing'`; never two unresolved updates per room.

## Review Focus

- Steer attempted while another change is preparing → clean "Wait for the current musical change to finish" rejection, no second candidate. Pinned by Task 4 test.
- Steer attempted on a non-live room (lobby/outro/ended) or by a non-owner → rejected before any claim. Pinned by Task 4 tests.
- Model returns HOLD or identical code → claim resolves `unchanged`, host sees held toast, no candidate version. Pinned by Task 3/4 tests.
- Generation failure → slot released as `failed`, error surfaced to host, current music untouched, base version not advanced. Pinned by Task 4 test.
- Stale base (crowd update applied while steering generates) → candidate dropped, slot released; the newer version is never overwritten. Pinned by Task 4 test.

---

### Task 1: Steer input schema

**Files:**
- Modify: `shared/schemas/room.ts`
- Test: `shared/schemas/__tests__/room.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `steerSchema` = `{ roomId: string min 1, text: trimmed string min 3 max 200 }`.

- [x] **Step 1: Write the failing tests** in `shared/schemas/__tests__/room.test.ts`: valid steer input passes; `text` under 3 chars (whitespace padded) rejected; over 200 chars rejected.
- [x] **Step 2: Run** `bun test shared/schemas/__tests__/room.test.ts` → FAIL.
- [x] **Step 3: Implement** `steerSchema` in `shared/schemas/room.ts`.
- [x] **Step 4: Run** same test → PASS. Commit.

### Task 2: Steer prompt + engine generation

**Files:**
- Modify: `backend/music/prompts.ts`
- Modify: `backend/music/engine.ts`
- Test: `backend/music/__tests__/prompts.test.ts`, `backend/music/__tests__/engine.test.ts`

**Interfaces:**
- Produces: `buildSteerPrompt(doc: StateDoc, currentCode: string, steerText: string): string`
- Produces: `generateSteeredPattern(provider: LlmProvider, doc: StateDoc, currentCode: string, steerText: string): Promise<{ code: string } | 'hold' | null>`

- [x] **Step 1: Failing tests.** Prompt test: builds with genre/BPM, contains the note verbatim, current code, sound palette names, and "Output ONLY strudel.js code". Engine tests: valid script → `{ code }`; 'HOLD' → `'hold'`; response identical to current code → `'hold'`; first attempt invalid compile then valid → `{ code }`; both attempts invalid → `null`.
- [x] **Step 2: Run** `bun test backend/music` → FAIL.
- [x] **Step 3: Implement** `buildSteerPrompt` after `buildCrowdPrompt`; `generateSteeredPattern` mirrors `generateCrowdEvolution` (static `buildSteerPrompt` import).
- [x] **Step 4: Run** → PASS. Commit.

### Task 3: Mock provider steer script key

**Files:**
- Modify: `backend/llm/provider.ts`
- Modify: `e2e/fixtures/llm-script.json`
- Test: `backend/llm/__tests__/provider.test.ts`

**Interfaces:**
- Produces: script key `steerResponses` (string[], falls back to `responses`); `MockLlmProvider.chat` routes prompts starting with `Steer this live ` to it.

- [x] **Step 1: Failing test:** a MockLlmProvider built without an explicit array must read `steerResponses` for a steer prompt (construct with a temp script file holding distinct `responses` and `steerResponses`).
- [x] **Step 2: Run** `bun test backend/llm` → FAIL.
- [x] **Step 3: Implement**: extend `readScriptFile` steer flag, `MockLlmProvider` routing (before the crowd check), fixture gains `"steerResponses": ["s(\"bd sd cp [hh hh]\").gain(0.85)"]`.
- [x] **Step 4: Run** → PASS. Commit.

### Task 4: `steerRoom` service + `rooms.steer` mutation

**Files:**
- Modify: `backend/rooms/service.ts` (add `generateSteeredPattern` to `EngineDeps`; new `steerRoom`)
- Modify: `backend/trpc/rooms.ts` (import `steerSchema`; new `steer` mutation wrapping service errors as `TRPCError` `CONFLICT`)
- Test: `backend/rooms/__tests__/service.test.ts` (update explicit `startRoom`/engine literals for the new dep)

**Interfaces:**
- Consumes: `generateSteeredPattern` (Task 2), `steerSchema` (Task 1).
- Produces: `steerRoom(roomId: string, hostId: string, text: string, engine?: EngineDeps): Promise<{ held: boolean }>`; router mutation returns that `{ held }`.
- Client-visible error messages (exact): 'Wait for the current musical change to finish', 'Room not found or access denied', 'Live room not found or access denied', 'The music agent could not steer this direction — adjust it and try again'.

- [x] **Step 1: Failing service tests:** (a) happy path — live room, `held:false`, poll `kind=performance question=steer` preparing → candidate created with `baseVersionId`/`stateDoc` minus `moment`, `code_update` `kind='evolution' phraseAligned:true` published, then `reportApplyResult(ok)` → poll delivered `applied`; (b) other change preparing → throws 'Wait for the current musical change to finish', no poll created; (c) engine hold → `{held:true}`, poll `unchanged`, no patternVersion; (d) engine null → poll `failed` and throws the cannot-steer message; (e) stale base (currentVersionId advanced mid-generation) → no candidate, poll `failed`; (f) 'outro'/'ended'/'lobby' → rejected; (g) non-owner → rejected; (h) router `steer` resolves through `requireRoomOwner` (FORBIDDEN for non-owner).
- [x] **Step 2: Run** `bun test backend/rooms` → FAIL.
- [x] **Step 3: Implement** `claimSteerUpdate` + `steerRoom` per spec (claim tx → generate → guard tx with the scheduler's checks → candidate/publish; hold/failed branches release the slot).
- [x] **Step 4: Run** → PASS. Commit.

### Task 5: Host console steer box

**Files:**
- Modify: `frontend/routes/host.tsx`
- Test: e2e covers it (Task 6); no new unit component test (no host-console component tests exist today)

**Interfaces:**
- Consumes: `trpc.rooms.steer` (Task 4), existing `showToast`, `changing`, `mutationError` chains.

- [x] **Step 1 (single step):** Add a `Steer the music` console card below the performance-controls row (NOT inside `performanceControls`, so it stays off the projector view): textarea `data-testid="steer-input"` (maxLength 200, placeholder 'the kick is buried — bring the drums forward'), `btn` `data-testid="steer-submit"` labelled `Steer` / `Generating…` while pending. Disabled when room not live, or `changing`, or pending, or trimmed text < 3. On success `held:false` clear the box + toast 'Steering note sent to the music agent'; `held:true` keep text + toast 'Held: the model kept the current groove'; on error keep text + toast `Steer failed: <message>`. Add `steerMusic.isPending` to `changing` and `steerMusic.error` to `mutationError`. Commit.

### Task 6: E2E + docs

**Files:**
- Create: `e2e/steering.spec.ts`
- Modify: `README.md` (Performing live section), `docs/agents/music-vote.md` (mock script keys if they are listed there)

- [x] **Step 1: E2E spec** mirroring the existing host-console flow (signup → create → start with mock LLM): fill steer input, submit, expect the applied pattern text to change to the steer response and status stays live. Keep under 2 assertions of flow + the disabled state while generating.
- [x] **Step 2: Run** `bun run test:e2e` (steer spec) + `bun run verify` → PASS. Update docs. Commit.

## Self-review notes

- Approach choice recorded in the spec: `perform`-shaped claim + scheduler-style guard was chosen over a scheduler-queued pending steer because it is synchronous (mutation returns the claim's fate), needs no new persisted note state, and "consumed when used" is trivially satisfied.
- `EngineDeps` gains `generateSteeredPattern`; existing test literals that construct engine deps must be updated (compile errors list all sites).