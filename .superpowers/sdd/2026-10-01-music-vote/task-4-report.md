# Task 4 Report: LLM provider layer

## Summary

Implemented `backend/llm/provider.ts` — the LLM access seam every later consumer
(MusicEngine Task 6, e2e Task 14) goes through.

Exports:

- `interface LlmProvider { chat(prompt: string, opts?: LlmChatOptions): Promise<string> }`
- `type LlmChatOptions = { system?: string; temperature?: number }`
- `class OllamaProvider` — POSTs to `${OLLAMA_BASE_URL}/api/chat`, returns
  `message.content` as string, strips a single markdown fence.
- `class MockLlmProvider` — scripted responses, pops in order, throws on
  exhaustion.
- `getLlmProvider(): LlmProvider` — env selection, default `ollama`.

Env contract wired: `LLM_PROVIDER=ollama|mock` (default ollama),
`OLLAMA_BASE_URL` (default `http://localhost:11434`), `OLLAMA_MODEL`,
`OLLAMA_API_KEY` (→ `Authorization: Bearer <key>` when set). All four added to
`.env.example` with one-line comments.

## Mock construction paths (controller ruling)

Both paths work, precedence: explicit constructor array → `LLM_MOCK_SCRIPT`
fixture file (`{ responses: string[] }`) → throw.

- `new MockLlmProvider(['a','b'])` uses the array even when `LLM_MOCK_SCRIPT` is
  set (test asserts file value is ignored).
- `new MockLlmProvider()` with `LLM_MOCK_SCRIPT` pointing at a JSON file reads
  and validates it (temp-file test).
- `new MockLlmProvider()` with neither throws at construction, so no test can
  silently fall through to a real model.
- `getLlmProvider()` with `LLM_PROVIDER=mock` constructs the env-file path.

Constructor arg is `responses?: string[]` (optional). This is the minimum needed
to make both paths reachable inside the mock, per the ruling; Task 14 only needs
to set `LLM_MOCK_SCRIPT` + `LLM_PROVIDER=mock` and does not extend this module.

## Ollama request shape

Exact body asserted in tests:

```json
{ "model": "llama3", "messages": [{ "role": "system", "content": "..." }, { "role": "user", "content": "..." }], "stream": false }
```

System message present only when `opts.system` is provided (separate test asserts
the user-only body). Bearer header asserted present when key set and `null` when
unset. Fence stripping tested for fenced and unfenced responses.

## TDD evidence

### RED

```sh
bun test backend/llm
error: Cannot find module '@backend/llm/provider' from '.../backend/llm/__tests__/provider.test.ts'
 0 pass, 1 fail, 1 error
```

### GREEN

```sh
bun test backend/llm
15 pass, 0 fail, 21 expect() calls
```

Full gate:

```sh
bun run check
42 pass, 0 fail
✓ all checks passed
```

## Files changed

- `backend/llm/provider.ts` (new, 134 lines)
- `backend/llm/__tests__/provider.test.ts` (new, 211 lines)
- `.env.example` (added LLM_PROVIDER, OLLAMA_BASE_URL, OLLAMA_MODEL,
  OLLAMA_API_KEY)

Commit: `04e4e32 feat(llm): provider interface, ollama impl, test mock`

## Self-review findings

- Interface matches brief verbatim.
- Factory tested for default ollama, `mock`, and unknown-value throw.
- Bearer asserted present AND absent.
- Fence stripping tested (fenced → inner trimmed; unfenced → untouched).
- Env-file mock path tested via real temp file; constructor-wins precedence
  tested.
- Biome/typecheck/knip clean; no staged files remain.

## Concerns

1. `OLLAMA_MODEL` has no default in the brief/spec. Chosen: fail fast with
   `OLLAMA_MODEL is required for LLM_PROVIDER=ollama` rather than inventing a
   model tag. Prod deploys must set it (Task 15 docs already plan to document
   `OLLAMA_*`).
2. `opts.temperature` is part of the mandated interface but the brief's exact
   body omits it. Chosen mapping: `body.options = { temperature }`, the Ollama
   native shape, emitted only when provided — so the exact-body assertion for
   the no-temperature case is unchanged. Flagging as an inferred detail, not a
   product decision.
3. `LLM_MOCK_SCRIPT` intentionally not added to `.env.example` (controller
   listed only the four vars; it is a test-only hook).

## Next step

Task 6 MusicEngine consumes `LlmProvider` + `MockLlmProvider` from this module.
