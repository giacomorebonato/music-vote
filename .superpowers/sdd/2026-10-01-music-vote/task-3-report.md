# Task 3 Report: CodeValidator (server-side Strudel compile + JS guard)

## Summary

Implemented `backend/music/validate.ts` exporting `compileCheck(code: string): { ok: true } | { ok: false; error: string }`.
It runs a server-side JS guard and then a headless Strudel transpile via `@strudel/transpiler`.

## Spike probe result

The brief's probe command was run against npm "latest" (`@strudel/transpiler@1.2.6`).
It failed in Bun 1.4.2 with:

```
Export named 'SalatRepl' not found in module '.../node_modules/@kabelsalat/web/dist/index.js'.
```

Root cause: Bun resolves `@kabelsalat/web`'s CJS `main` (`dist/index.js`) instead of its ESM `module` (`dist/index.mjs`) when `@strudel/core` imports it transitively from inside `node_modules`.
This makes the current npm latest unloadable headless in Bun.

Tested older exact versions:

- `1.2.6` — fails import.
- `1.1.0` — imports cleanly and transpiles headless.
- `1.0.1` — also works.

After escalating to the supervisor, **option 1 was approved**: pin `@strudel/transpiler@1.1.0` exactly and proceed.
The dependency line in `package.json` carries this note: do not upgrade to 1.2.x without re-running the headless import probe, because the 1.2.x line pulls in `@kabelsalat/web` which Bun resolves incorrectly.

## Transpiler API found

`@strudel/transpiler@1.1.0` exports:

```ts
export { evaluate, getWidgetID, registerWidgetType, transpiler }
```

For this task the relevant API is:

```ts
transpiler(code: string, options?: {
  wrapAsync?: boolean
  addReturn?: boolean
  emitMiniLocations?: boolean
  emitWidgets?: boolean
}): { output: string, miniLocations: [...], widgets: [...] }
```

Default options (`addReturn: true`, `emitMiniLocations: true`) are used.
The function parses JS with `acorn` and validates mini-notation strings by calling `@strudel/mini`'s `getLeafLocations`, so both unbalanced JS parentheses and invalid mini syntax throw synchronously.
The package's `evaluate` export is async and requires a browser-like eval scope; it is intentionally not used for the sync `compileCheck` signature.

## TDD evidence

### RED (module missing)

```sh
bun test backend/music
[FAIL] ERRORS:
  error: Cannot find module '@backend/music/validate' from '.../backend/music/__tests__/validate.test.ts'
SUMMARY: 0 pass, 1 fail, 1 error
```

### GREEN (after implementation)

```sh
bun test backend/music
SUMMARY: 9 pass, 0 fail
```

## Files changed

- `backend/music/validate.ts` — `compileCheck` + JS guard.
- `backend/music/strudel-transpiler.d.ts` — minimal type declaration for the untyped `@strudel/transpiler` package.
- `backend/music/__tests__/validate.test.ts` — unit tests for valid snippets, broken snippets, and all guard blocklist entries.
- `package.json` — added exact dependency `@strudel/transpiler@1.1.0`.
- `bun.lock` — lockfile updated by `bun add -E`.

## Guard blocklist

Regexes checked before transpile:

```ts
/\bfetch\(/      // fetch call
/\bimport\(/     // dynamic import
/\brequire\(/     // CommonJS require
/XMLHttpRequest/  // XHR constructor
/document\./      // DOM access
```

## Self-review

- [x] Guard runs before transpile; clear `blocked: disallowed pattern (...)` errors.
- [x] Both `fetch` and `import` guard paths tested, plus `require`, `XMLHttpRequest`, and `document`.
- [x] Broken-snippet tests assert the error string (`Unterminated` for unbalanced paren, `mini` for invalid pattern syntax).
- [x] `compileCheck` signature matches the brief exactly: `{ ok: true } | { ok: false; error: string }`.
- [x] No untested blocklist entries.
- [x] Exact version pinned (`@strudel/transpiler@1.1.0`), no `^` or `latest`.
- [x] `bun run check` passes (pre-existing Biome warnings remain, no new errors).

## Concerns

1. `@strudel/transpiler` 1.2.6 (npm latest) cannot load headless in Bun 1.4.2 due to `@kabelsalat/web` module resolution. We are pinned to `1.1.0`. Any future upgrade must re-run the probe.
2. The later `@strudel/web` task (audio engine) may hit the same `@kabelsalat/web` CJS/ESM resolution bug in Bun's bundler. Flag this for that task's dispatch.
3. The guard is regex-based and only catches the listed dangerous patterns. It does not sandbox the code; the eventual browser eval remains the security boundary, which is the intended architecture.
