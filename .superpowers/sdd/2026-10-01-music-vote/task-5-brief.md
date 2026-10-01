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

