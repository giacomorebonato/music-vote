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

