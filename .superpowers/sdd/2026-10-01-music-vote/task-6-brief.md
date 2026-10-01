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

