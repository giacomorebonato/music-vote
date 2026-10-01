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

