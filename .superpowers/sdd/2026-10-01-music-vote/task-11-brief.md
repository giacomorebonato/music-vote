### Task 11: StrudelPlayer (spec spike 1 — embed + cycle swap)

**Files:**
- Create: `frontend/audio/StrudelPlayer.tsx`, `frontend/audio/strudel-init.ts`, `frontend/components/__tests__/strudel-player.test.ts`
- Modify: `package.json` (pinned `@strudel/web`)

**Interfaces:**
- Produces: `StrudelPlayer` — React component, `forwardRef` exposing `applyPattern(code: string): Promise<{ ok: boolean; error?: string }>` (eval candidate in try/catch; Strudel swaps at cycle boundary natively — verify in Step 1) and `stop(): void` (`hush()`); props: `{ code: string | null; onApplyResult: (result: {ok: boolean; error?: string}) => void; autoplay?: boolean }`.
- `frontend/audio/strudel-init.ts`: `initStrudelOnce()` — idempotent init (imports from `@strudel/web`), preloads default sound bank at init; sound-bank decision (spec spike 2): attempt bundled samples; if package has no offline bank or size > ~10 MB, preload from CDN at init and document in comment. Bun bundler must resolve `@strudel/web` — Step 2 verifies; fallback if it can't: unpkg `<script>` tag with pinned version (document in commit).
- Browser test limits: audio can't be asserted in CI — unit test covers ref contract with init stubbed; real audio = manual step.

- [ ] **Step 1: Spike probe (throwaway)** — scratch page: import `@strudel/web` via Bun dev bundle, `initStrudel()`, play `s("bd sd")`, re-apply different pattern, confirm swap waits for cycle boundary. Record actual API in `strudel-init.ts` header comment. If cycle-boundary swap needs explicit API (e.g. scheduler options), capture it there.
- [ ] **Step 2: Failing test** — unit test with init stubbed: `applyPattern('this is ( broken')` → `{ok:false, error}`; `applyPattern` valid → `{ok:true}`; second call while playing does not throw.
- [ ] **Step 3: Implement** component + init module + dep.
- [ ] **Step 4: Run** — `bun test frontend` → PASS; **manual**: `bun run dev`, host a scratch route, hear `bd sd`, hear swap on re-apply, confirm no mid-bar glitch.
- [ ] **Step 5: Commit** — `git commit -m "feat(audio): StrudelPlayer — embed, cycle-boundary swap, sound bank preload"`.

