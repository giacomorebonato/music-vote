# Host Performance Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the host console's Build up / Drop / Strip back / Lock this groove controls read as on/off toggles, with tap-active-to-off support for the three performance layers.

**Architecture:** Move the performance marker/transform constants to a new shared module (single source of truth for backend and frontend), add a `clear` action that strips the performance layer, derive each toggle's state from the pattern code the host browser is actually playing, and restyle the four buttons as constant-label toggles.

**Tech Stack:** Bun runtime + test runner, Zod schemas, tRPC v11, React 19, daisyUI v5, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-performance-toggles-design.md`

## Global Constraints

- Bun everywhere; never npm/pnpm/yarn. Unit tests: `bun test <path>`; e2e: `bun run test:e2e`; full gate: `bun run verify`.
- The performance marker line must stay byte-identical: `// music-vote performance\n`. Existing DB rows, e2e assertions (`'music-vote performance'`), crowd prompts (`backend/music/prompts.ts`) and moment fixtures embed it.
- Unit tests co-located in `__tests__/` next to source; named exports only; kebab-case filenames; no new top-level dirs (`shared/music/` mirrors `backend/music/`).
- Phone-side "Ask for a moment" stays one-shot (`shared/schemas/contributions.ts` `momentActionSchema` untouched: `'build' | 'drop' | 'strip'`).
- Keep testids `perform-build`, `perform-drop`, `perform-strip`, `groove-lock` — e2e depends on them.
- Frontend must never import `@backend/*`; shared module imports only zod types.

## Review Focus

- **Marker drift** — a changed marker string makes every existing layered version invisible to `activePerformanceAction`. Pinned byte-exact in Task 1 Step 1.
- **Clear during a preparing change** — must reject like every other perform (`'Wait for the current musical change to finish'`), never silently no-op or double-fire. Tested in Task 2 Step 1.
- **Unknown transform line under the marker** (LLM crowd output keeping the comment but editing the line) — `activePerformanceAction` must return `null`, not a wrong button. Tested in Task 1 Step 1.
- **Stale toggle state** — layer removed by crowd evolution or an ended audience moment must flip the toggle off without any click: state derives from `displayCode` inline on every render, never cached. E2e-observed in Task 3 (clear path); the derivation is pure so Task 1's unit tests pin it.
- **Double-tap race** — two rapid taps on an active toggle: first creates a pending clear, second hits the pending check and errors to the UI (existing mutation-error surface), leaving state consistent. Covered by Task 2 pending test + existing e2e disable-while-changing assertions.

---

### Task 1: Shared performance module

**Files:**
- Create: `shared/music/performance.ts`
- Create: `shared/music/__tests__/performance.test.ts`
- Delete: `backend/music/performance.ts`
- Modify: `backend/rooms/service.ts` (import), `backend/polls/scheduler.ts` (import)
- Modify: `backend/music/__tests__/performance.test.ts` (import + keep compile checks)

**Interfaces:**

- Produces (consumed by Tasks 2–3):
  - `export const MARKER: string` — value `'/\/\ music-vote performance\n'` written literally as `'// music-vote performance\n'`
  - `export type PerformanceLayer = 'build' | 'drop' | 'strip'`
  - `export type PerformanceAction = PerformanceLayer | 'clear'`
  - `export function performancePattern(code: string, action: PerformanceAction): string`
  - `export function activePerformanceAction(code: string): PerformanceLayer | null`

- [ ] **Step 1: Write the failing tests** in `shared/music/__tests__/performance.test.ts`

```ts
import { expect, test } from 'bun:test'
import {
	MARKER,
	activePerformanceAction,
	performancePattern,
} from '../performance'

const base = 'setcps(0.5)\nstack(s("bd*4"), note("c2 eb2 g2").s("sawtooth"))'

test('the marker stays byte-identical for existing versions and prompts', () => {
	expect(MARKER).toBe('// music-vote performance\n')
})

test('each layer wraps the base and strips cleanly', () => {
	for (const action of ['build', 'drop', 'strip'] as const) {
		const code = performancePattern(base, action)
		expect(code.startsWith(MARKER)).toBe(true)
		expect(code.endsWith(base)).toBe(true)
		expect(performancePattern(code, 'clear')).toBe(base)
	}
})

test('a new layer replaces the previous one instead of stacking', () => {
	const built = performancePattern(base, 'build')
	expect(performancePattern(built, 'drop')).toBe(performancePattern(base, 'drop'))
})

test('clear is idempotent on plain code', () => {
	expect(performancePattern(base, 'clear')).toBe(base)
	expect(performancePattern(performancePattern(base, 'clear'), 'clear')).toBe(
		base,
	)
})

test('activePerformanceAction reads the layer from the playing code', () => {
	for (const action of ['build', 'drop', 'strip'] as const) {
		expect(activePerformanceAction(performancePattern(base, action))).toBe(action)
	}
	expect(activePerformanceAction(base)).toBeNull()
	// An LLM-kept comment with an unrecognized transform must not light a toggle.
	expect(
		activePerformanceAction(`${MARKER}all(x => x.hpf(9999))\n${base}`),
	).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test shared/music/__tests__/performance.test.ts`
Expected: FAIL — cannot resolve `../performance`

- [ ] **Step 3: Implement `shared/music/performance.ts`**

Move `MARKER` and the three transform strings verbatim from `backend/music/performance.ts` (do not retype them — copy from the old file, then delete it). `transforms: Record<PerformanceLayer, string>` stays unexported. `performancePattern(code, action)`: compute `base` with the existing marker-stripping logic (starts-with + first `\n` after `MARKER.length`), then `return action === 'clear' ? base : \`${MARKER}${transforms[action]}\n${base}\``. `activePerformanceAction(code)`: return `null` unless `code.startsWith(MARKER)`; otherwise read the line after the marker (`code.slice(MARKER.length).split('\n')[0]`) and return the layer whose `transforms` value equals it, else `null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test shared/music/__tests__/performance.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Re-point the backend**

In `backend/rooms/service.ts` and `backend/polls/scheduler.ts` change the import `@backend/music/performance` → `@shared/music/performance`. Delete `backend/music/performance.ts`. In `backend/music/__tests__/performance.test.ts` import `performancePattern` from `@shared/music/performance` (keep both existing tests unchanged — the compile-check loop and the anchors test), and extend the compile test with `expect(compileCheck(performancePattern(base, 'clear'))).toEqual({ ok: true })`.

- [ ] **Step 6: Run the touched backend suites**

Run: `bun test backend/music backend/polls backend/rooms shared`
Expected: PASS, zero failures

- [ ] **Step 7: Commit**

```bash
git add shared/music backend/rooms/service.ts backend/polls/scheduler.ts backend/music/__tests__/performance.test.ts && git rm backend/music/performance.ts
git commit -m "feat: move performance layer transforms to shared module with clear action support"
```

### Task 2: `clear` action through schema and room service

**Files:**
- Modify: `shared/schemas/room.ts:3-6` (enum)
- Modify: `backend/rooms/service.ts` (`perform`)
- Test: `shared/schemas/__tests__/room.test.ts`, `backend/rooms/__tests__/service.test.ts`

**Interfaces:**

- Consumes: `performancePattern`, `MARKER`, `PerformanceAction` from Task 1.
- Produces: `performanceActionSchema` action enum `'build' | 'drop' | 'strip' | 'clear'`; `perform(roomId, hostId, 'clear')` — clears an active layer via the normal candidate flow, no-ops when no layer is active, rejects while a change is preparing.

- [ ] **Step 1: Write the failing tests**

In `shared/schemas/__tests__/room.test.ts` (file already imports from `../room`):

```ts
test('performanceActionSchema accepts the clear action and rejects unknowns', () => {
	expect(
		performanceActionSchema.safeParse({ roomId: 'r1', action: 'clear' }).success,
	).toBe(true)
	expect(
		performanceActionSchema.safeParse({ roomId: 'r1', action: 'build' }).success,
	).toBe(true)
	expect(
		performanceActionSchema.safeParse({ roomId: 'r1', action: 'explode' })
			.success,
	).toBe(false)
})
```

In `backend/rooms/__tests__/service.test.ts`, after the existing `'performance actions require owner and live room…'` test:

```ts
test('clear removes an active performance layer as a candidate and no-ops without one', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())
	await service.startRoom(room.id, host.id)

	// No layer is active on a fresh pattern: clear must not create anything.
	await service.perform(room.id, host.id, 'clear')
	expect(
		await prisma.patternVersion.findFirst({
			where: { roomId: room.id, status: 'candidate' },
		}),
	).toBeNull()
	expect(
		await prisma.poll.findFirst({ where: { roomId: room.id, kind: 'performance' } }),
	).toBeNull()

	// Activate a layer, confirm it, then clear it.
	const built = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'applied' },
		orderBy: { appliedAt: 'desc' },
	})
	await service.perform(room.id, host.id, 'build')
	const layerCandidate = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'candidate' },
	})
	await service.reportApplyResult(room.id, host.id, layerCandidate.id, true)
	expect(
		(await prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
			.currentCode,
	).toContain('music-vote performance')

	// A second perform while the clear is preparing must wait.
	await service.perform(room.id, host.id, 'clear')
	const clearCandidate = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'candidate' },
	})
	expect(clearCandidate.code).not.toContain('music-vote performance')
	expect(clearCandidate.code).toBe(built.code)
	await expect(service.perform(room.id, host.id, 'clear')).rejects.toThrow(
		'Wait',
	)
})
```

Note: `built` is the plain pre-layer pattern the clear restores to; if `reportApplyResult`-confirmed layered code makes that comparison awkward, assert `clearCandidate.code` equals the marker-stripped currentCode instead — the essential assertion is marker absent + rest of pattern unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test shared/schemas/__tests__/room.test.ts backend/rooms/__tests__/service.test.ts`
Expected: FAIL — zod rejects `'clear'` / `perform` rejects or creates wrong candidate

- [ ] **Step 3: Implement**

In `shared/schemas/room.ts` change the enum: `action: z.enum(['build', 'drop', 'strip', 'clear'])`. In `backend/rooms/service.ts` `perform`, after the pending check and before `poll.create`, insert the no-op guard: `if (action === 'clear' && !room.currentCode.startsWith(MARKER)) return` — import `MARKER` from `@shared/music/performance`. No other changes: `clear` flows through `performancePattern(room.currentCode, action)` (marker-stripping branch from Task 1) and the existing candidate/confirm/publish machinery.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test shared/schemas/__tests__/room.test.ts backend/rooms/__tests__/service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/schemas/room.ts shared/schemas/__tests__/room.test.ts backend/rooms/service.ts backend/rooms/__tests__/service.test.ts
git commit -m "feat: add clear performance action that strips the active layer"
```

### Task 3: Host console toggles, e2e, README

**Files:**
- Modify: `frontend/routes/host.tsx:511-560` (`performanceControls`)
- Modify: `e2e/music-vote.spec.ts:180-221`
- Modify: `README.md:55-62` (Performing live section)

**Interfaces:**

- Consumes: `activePerformanceAction`, `PerformanceLayer` from Task 1; `perform` mutation accepting `'clear'` from Task 2.
- Produces: user-visible toggles.

- [ ] **Step 1: Restyle the four buttons in `frontend/routes/host.tsx`**

Derive the active layer inline on every render (no caching — a crowd evolution or ended moment removes the layer without a click): `const activeLayer = activePerformanceAction(displayCode ?? '')` placed next to `changing`. The three layer buttons get constant labels and testids (unchanged), `aria-pressed={activeLayer === action}`, `className={\`btn ${activeLayer === action ? 'btn-secondary' : 'btn-outline'}\`}`, and `onClick` sends `{ roomId, action: activeLayer === action ? 'clear' : action }` — drop the old special case that made Drop always `btn-secondary`. The lock button keeps its `aria-pressed` and accent-when-locked styling but a constant label: replace `{room.grooveLocked ? 'Release groove' : 'Lock this groove'}` with `Lock this groove`. Import `activePerformanceAction` from `@shared/music/performance`.

- [ ] **Step 2: Update e2e in `e2e/music-vote.spec.ts`**

After the existing `for (const action of ['build', 'strip', 'drop'])` loop (which leaves Drop active): add `await expect(stage.getByTestId('perform-drop')).toHaveAttribute('aria-pressed', 'true')` (generous timeout, 25_000, since the flip lands after the phrase-aligned apply); then click `perform-drop` again, wait disabled→enabled as the loop does, and assert `aria-pressed` `'false'`. Replace the reveal-code assertion to run after this clear: `current-code` must NOT contain `'music-vote performance'` (keep the existing reveal/hide clicks around it). In the lock section, after the first lock click add `await expect(host.getByTestId('groove-lock')).toHaveText('Lock this groove')` to pin the constant label.

- [ ] **Step 3: Update README.md "Performing live" section**

Rewrite the second paragraph: the three controls are on/off toggles — tapping an inactive layer applies it at the next four-bar phrase and lights the toggle; tapping the active layer strips it back to the plain groove (`clear`); crowd evolution and ended audience moments turn a toggle off by themselves because state is read from the playing pattern; **Lock this groove** keeps its label and shows locked state. Keep the existing descriptions of what each layer does musically and the crowd-evolution stripping sentence.

- [ ] **Step 4: Type-check, lint, and run the full gate**

Run: `bun run verify`
Expected: PASS — check, lint, fmt, knip, unit, both Playwright suites

- [ ] **Step 5: Commit**

```bash
git add frontend/routes/host.tsx e2e/music-vote.spec.ts README.md
git commit -m "feat: host performance controls as on/off toggles"
```
