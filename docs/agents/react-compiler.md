# React Compiler (experimental)

Build compilation is experimental and toggleable. Native `bun lint` checks React hooks by default; the former Biome React Compiler lint diagnostics are no longer part of the gate.

- **Build compilation** — `scripts/build.ts` passes `reactCompiler: true` to `Bun.build` (Bun 1.4+ native, no Babel/plugin). Produces `_c(N)` memo cache calls + `react/compiler-runtime` imports in `dist/`. Off via `REACT_COMPILER=0`. Runs **only in the prod bundler** — `bun --hot` dev server uses the runtime transpiler and is unaffected (DevTools "Memo ✨" badge visible on a prod build, not in dev). Cannot fail the build: Bun falls back to original source on any compiler bailout/parse error. Known limit: sourcemaps map to the compiled intermediate, not original lines. The Dockerfile builds with `bun --bun run build`.
- **Type gap** — `@types/bun`/`bun-types` do not yet declare `reactCompiler`/`reactCompilerOutputMode` on `BuildConfig`. `scripts/build.ts` is outside `tsconfig.json` `include`, so `bun check` does not see it; the editor may flag those lines until types ship.
- **Verify it ran** — `rm -rf dist && bun run build && F=$(ls dist/chunk-*.js) && grep -c memo_cache_sentinel "$F"` → expect `2` (compiler on). With `REACT_COMPILER=0` expect `1`. Under minify the `react/compiler-runtime` import string is renamed, so the `memo_cache_sentinel` count is the robust signal (the delta vs the 1-sentinel React baseline).
- **File bugs at** — https://github.com/oven-sh/bun/issues (compiler output correctness, fallback behavior).
