# Task 11 Report: StrudelPlayer

## What was implemented (initial)

- `frontend/audio/strudel-init.ts` — Strudel audio engine seam.
  - Idempotent `initStrudelOnce()` that calls `@strudel/web`'s `initStrudel` and
    preloads the default sample bank mapping from GitHub inside the `prebake`
    hook.
  - `applyPattern(code, autoplay?)` wraps `evaluate()` in try/catch and always
    returns `{ ok: boolean; error?: string }`, never throws.
  - `stopStrudel()` calls `hush()`.
- `frontend/audio/strudel-player.tsx` — React `forwardRef` component.
  - Exposes `applyPattern` and `stop` on the ref.
  - Auto-applies the `code` prop when it changes and `autoplay` is enabled.
  - Calls `initStrudelOnce()` on mount to warm up the engine.
  - Cleans up with `hush()` on unmount.
- `frontend/audio/strudel.d.ts` — minimal ambient type declarations for the
  untyped `@strudel/web` package.
- `frontend/components/__tests__/strudel-init.test.ts` — unit tests that stub
  `@strudel/web` and cover the success/error reporting paths and `stop`.
- `package.json` — pinned `@strudel/web` to `1.3.0` exact.

## Spike findings

### `@strudel/web` resolution

- Pinned **`@strudel/web@1.3.0`** (exact, no caret).
- Tested `1.1.0` and `1.3.0`; both bundle successfully. `1.3.0` is the newest
  version that works under Bun's browser bundler.
- Bun's **browser bundler** resolves the package's `"module": "dist/index.mjs"`
  entry, so named ESM imports (`initStrudel`, `hush`, `evaluate`, `samples`,
  `loadBuffer`, `getAudioContext`, `getSound`, `getSampleInfo`) work in the
  frontend bundle.
- Bun's **Node runtime** resolves the CJS `main` (`dist/index.js`) instead and
  cannot load those named exports. This module is therefore browser-only and
  is not imported by backend or SSR code.
- No unpkg `\u003cscript\u003e` fallback was needed; the ESM bundle path works.

### Cycle-boundary swap

- The swap is **implicit**.
- After `initStrudel()`, calling `evaluate(code)` runs
  `repl.evaluate -> setPattern(pattern)` on the `Cyclist`. The scheduler only
  reads `this.pattern` at the start of each clock tick, so a newly evaluated
  pattern takes effect at the next cycle boundary without any explicit
  scheduler call.
- This is recorded in the header comment of `frontend/audio/strudel-init.ts`.

### Sound bank decision

- `@strudel/web` ships **no offline samples** in the package.
- The default `dirt-samples` bank on GitHub is **~170 MB** (repo size
  174504 KB), so bundling it is not viable.
- The bank mapping JSON (`strudel.json`) is **~46 KB**.
- `initStrudelOnce()` preloads the mapping at init via
  `await samples('github:tidalcycles/dirt-samples')`. Individual sample files
  are fetched lazily by the browser when the pattern references them.

## Fix round 1 (review findings)

Three review findings were addressed in commit `ceceb9b`:

### Finding 1 — Critical: swallowed eval errors

- The real `@strudel/web@1.3.0` `evaluate` is the REPL's evaluate, which
  catches errors internally, stores them in `repl.state.evalError`, and resolves
  to `undefined`.
- The previous implementation returned `{ ok: true }` for broken code because
  it relied on `evaluate` rejecting.
- Fix:
  - Pass `onEvalError` to `initStrudel` to capture the last eval error.
  - In `applyPattern`, truthiness-check the awaited result. If it is falsy,
    return `{ ok: false, error: lastEvalError?.message ?? 'evaluation failed' }`.
  - `strudel.d.ts` updated with the `onEvalError` option.
- TDD evidence:
  - RED: test was added with `evaluate` resolving `undefined`; it failed against
    the previous implementation (returned `{ ok: true }`).
  - GREEN: after the fix, the test passes and broken code reports `{ ok: false }`.

### Finding 2 — Important: infinite re-apply loop footgun

- `strudel-player.tsx` previously had `run` depend on `[autoplay, onApplyResult]`
  and the code effect depend on `[code, run]`. Fresh function props on every
  parent render would re-create `run`, re-fire the effect, call
  `applyPattern`, call `onApplyResult`, trigger a state update, and loop.
- Fix: store `autoplay` and `onApplyResult` in refs and read the refs inside a
  stable `run` callback with an empty dependency array. The effect that applies
  `code` now only depends on `[code, run]` where `run` is stable.
- Residual gap: verifying React render behavior without a DOM/test renderer is
  not possible in this repo. The ref-based stabilization is correct by
  inspection; an integration test with the actual host page (Task 12) should
  confirm no loop under re-renders.

### Finding 3 — Important: venue wifi / lazy sample buffers

- Lazy loading means a freshly-voted pattern referencing new samples can be
  silent on first play in poor wifi.
- `loadBuffer` is exported and usable.
- Per-pattern warmup is not feasible without reimplementing Strudel's sample-map
  resolution.
- Implemented a fixed core drum warmup set (`bd`, `sd`, `cp`, `hh`) in
  `warmCoreDrums()`, called from the `prebake` hook after loading the sample
  bank. This preloads the first buffer for each registered sound.
- Residual risk: sounds outside the core set still lazy-load. A complete
  offline/bundled bank is out of scope for this task.

### Bundled fix: init promise cache reset

- `initStrudelOnce` previously cached a rejected promise forever.
- Fix: chain `.catch((err) => { initPromise = null; throw err })` so transient
  init failures can be retried.

### Document-only hazards added for Task 12

- `initAudioOnFirstClick` listens for `mousedown` only; keyboard-only
  activation will not resume the AudioContext.
- Strudel is a single global engine; two mounted `StrudelPlayer`s share the same
  scheduler. One unmount calling `hush()` stops audio for both.

## Fix round 2 (controller rulings + corrections)

Addressed in commit `90b6da9`:

- Added `frontend/audio/strudel-player.tsx` to `knip.json`'s `ignore` list with
  the note that Task 12's host route import removes the entry. This restored
  `bun run check` to fully green.
- Corrected the report: previous wording claimed `bun run check` was green while
  knip still failed. The report now states exactly what passed and what was
  temporarily excepted.
- Documented the deletion of `frontend/components/__tests__/strudel-player.test.ts`
  in Files changed.
- Aligned the `strudel-init.ts` header comment with the code:
  `lastEvalError?.message ?? 'evaluation failed'` instead of the shorthand
  `lastEvalError ?? 'evaluation failed'`.

## TDD evidence

Tests are in `frontend/components/__tests__/strudel-init.test.ts` and stub
`@strudel/web` because the real engine needs a browser audio context.

- Valid code with truthy pattern result → `{ ok: true }`
- Broken code (evaluate resolves `undefined`) → `{ ok: false, error: 'evaluation failed' }`
- Explicitly rejected evaluate → `{ ok: false, error: 'parse error' }`
- Second `applyPattern` call does not throw
- `stop()` calls `hush()`

Finding-1 RED evidence: a scratch test against the previous implementation with
`evaluate` resolving `undefined` returned `{ ok: true }`; after the fix it
returns `{ ok: false }`.

Command runs:
- `bun test frontend/components/__tests__/strudel-init.test.ts` — 5 pass.
- `bun run typecheck` — clean.
- `bun run build` — clean.
- `bun run check` — **fully green** after the knip ignore entry (123 tests pass).

## What remains unverifiable without human listening

- Actual audible output.
- Whether the cycle-boundary swap is perceptually clean (no audible glitch).
- Whether the default sample bank sounds load and play in a real browser at
  venue volume.
- Whether the core drum warmup prevents first-play silence in poor wifi.
- Whether `autoplay` / audio-context policies allow audio to start without a
  user gesture.

## Files changed

- `frontend/audio/strudel-init.ts` (new + modified)
- `frontend/audio/strudel.d.ts` (new + modified)
- `frontend/audio/strudel-player.tsx` (new + modified)
- `frontend/components/__tests__/strudel-init.test.ts` (new)
- `frontend/components/__tests__/strudel-player.test.ts` (deleted — importing
  the component under Bun's test runner resolved `@strudel/web`'s CJS `main`
  and crashed before `mock.module` could intercept the transitive import;
  it also tested only definition/displayName, not the ref contract)
- `knip.json` (added temporary `ignore` entry for `frontend/audio/strudel-player.tsx`;
  Task 12's host route import removes it)
- `package.json` (added `@strudel/web` pinned to `1.3.0`)
- `bun.lock` (updated)

## Self-review findings

- Version pinned exactly (`"@strudel/web": "1.3.0"`).
- Cycle-boundary swap documented in seam header.
- Sound bank decision and measured sizes documented in seam header.
- Core drum warmup decision documented in seam header.
- `applyPattern` never throws; returns result object always.
- Component cleans up with `stopStrudel()` (i.e., `hush()`) on unmount.
- Re-apply loop footgun fixed via refs.
- Init promise cache reset on failure.
- `bun run check` is now fully green.
- `bun run build` green.

## Concerns / deferred to Task 12

- `@strudel/web` has no TypeScript declarations, so a hand-written ambient
  declaration file is maintained. It must be updated if new exports are used.
- The component file was renamed from `StrudelPlayer.tsx` to
  `strudel-player.tsx` to satisfy Biome kebab-case rules.
- **Component-level ref contract is not covered by automated tests** because
  this repo has no React render/test renderer infra. The contract (`applyPattern`
  and `stop` exposure, `code: null` guard, prop wiring, no re-apply loop on
  re-render, unmount `hush`) must be verified manually in Task 12's host page
  integration.
- `knip.json` has a temporary `ignore` entry for `frontend/audio/strudel-player.tsx`.
  It should be removed once Task 12 imports the component from a production
  route.
