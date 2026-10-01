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

