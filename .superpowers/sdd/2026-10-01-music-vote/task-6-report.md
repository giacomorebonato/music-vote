# Task 6 Report: MusicEngine

## What was implemented

Created `backend/music/engine.ts` with four exported functions and the `MusicGenError` error class:

- `generateInitialPattern(provider, params)` — builds the initial prompt, validates the LLM output through `compileCheck`, retries once, and throws `MusicGenError` on two failures. Returns the validated code plus a `StateDoc` seeded with `initialStateDoc(params)` and one history entry (`changeSummary: "initial pattern"`).
- `generateEvolution(provider, doc, question, winner, currentCode)` — builds the evolution prompt, validates, retries once, and returns `null` after two failures (per spec: skip change, keep last-good). The returned `changeSummary` is derived exactly as `` `${question} — winner: ${winner}` ``.
- `generateOutro(provider, doc, currentCode)` — builds the outro prompt, validates, retries once, and throws `MusicGenError` on failure.
- `generateNextQuestion(provider, doc)` — builds the question prompt, trims the response, rejects empty or >120 char answers with one retry, then falls back verbatim to `"Do you want more energy? yes/no"`. Provider exceptions are caught and treated like invalid responses.

Shared helper `tryGenerateCode` runs up to two attempts, catching provider throws (timeout/network) and treating them exactly like invalid code.

Created `backend/music/__tests__/engine.test.ts` with `MockLlmProvider` and a custom `ThrowingProvider`.

## TDD Evidence

**RED** — first run after writing tests against a stub engine:

```
bun test backend/music/__tests__/engine.test.ts
SUMMARY: 0 pass, 18 fail
```

**GREEN** — final implementation run:

```
bun test backend/music/__tests__/engine.test.ts
SUMMARY: 18 pass, 0 fail
```

Full gate also green:

```
bun run check
✓ all checks passed
```

## Files changed

- `backend/music/engine.ts` (new)
- `backend/music/__tests__/engine.test.ts` (new)

## Self-review findings

- Exact provider call counts asserted for every retry path (2 calls for invalid-then-valid / twice-invalid / throw-twice, 1 call for happy paths).
- Provider-throw paths covered for all four functions:
  - `generateInitialPattern` → `MusicGenError` after 2 attempts.
  - `generateEvolution` → `null` after 2 attempts.
  - `generateOutro` → `MusicGenError` after 2 attempts.
  - `generateNextQuestion` → canned fallback after 2 attempts.
- `changeSummary` exact format asserted: `"Add bass? — winner: yes"`.
- Initial-pattern history entry asserted with `changeSummary: "initial pattern"`.
- Fallback question asserted verbatim: `"Do you want more energy? yes/no"`.
- `fetch(`-containing code rejected via `compileCheck` guard.
- Biome required a `useMaxParams` suppression on `generateEvolution` because the 5-argument signature is mandated by the brief; added `// biome-ignore lint/complexity/useMaxParams` with explanation.

## Concerns

None. Implementation matches the brief and the full check gate is green.
