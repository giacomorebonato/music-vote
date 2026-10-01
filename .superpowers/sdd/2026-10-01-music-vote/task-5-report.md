# Task 5 Report — StateDoc + prompt builders

## What I implemented

**`backend/music/state-doc.ts`** (brief said `stateDoc.ts` — see deviation below)

- `type MusicParams = { genre: string; bpm: number }`
- `type StateDoc` exactly per brief: `genre`, `bpm`, `elements { drums, bass, melody, harmony, soundDesign: string[] }`, `history { at, question, winner, changeSummary }[]`, `polledDimensions: string[]`. `StateDocElements` / `StateDocHistoryEntry` are internal (unexported) named subtypes.
- `initialStateDoc(params): StateDoc` — zero-history doc: all element booleans `false`, `soundDesign: []`, `history: []`, `polledDimensions: []`.
- `applyChange(doc, question, winner, changeSummary): StateDoc` — immutable; returns a new doc with a new history entry (`at: Date.now()`), new `polledDimensions` (appends the polled question), and new `elements`. Element presence is inferred from the change-summary wording (`drums|bass|melody|harmony` keyword sets; sound-design keywords append the summary to `soundDesign`). `changeSummary === null` (vote made no change) leaves elements as-is.

**`backend/music/prompts.ts`**

- `FEW_SHOTS` — 4 short, parser-valid Strudel snippets (`s("bd sd cp hh")`, two-layer drum groove, `note(...)` bass-ish line, `setcps(0.5)` + `n(...).scale(...)` piece).
- `buildInitialPatternPrompt(params)`, `buildQuestionPrompt(doc)`, `buildEvolutionPrompt(doc, question, winner, currentCode)`, `buildOutroPrompt(doc, currentCode)` — all `(x) => string`.
- Shared blocks: `fewShotsBlock()`, `elementsBlock(doc)`, `historyBlock(doc)` (empty → `none yet`), `polledBlock(doc)` (empty → `none yet`), `bpmToCps(bpm)` = `bpm/240` rounded to 3dp (one cycle = one 4/4 bar).
- `CODE_ONLY_RULE = 'Output ONLY strudel.js code, no prose, no markdown fences.'` — present in **initial, evolution, outro**; comment records the Task-4 carry: fence-stripper only handles one well-formed fence, so the prohibition stays explicit.
- Initial: `setcps(<cps>)` + genre + bpm + loopability + few-shots + code-only rule.
- Question: `Output ONE yes/no question, nothing else. Max 120 characters.`, `Dimensions already polled (do not repeat these): <join(', ')>`, `pace the evolution: do not stack another melody or a third layer right after one was added`, genre + bpm + few-shots + current elements/history context.
- Evolution: current code, poll question, `Winning vote: <winner>`, `Change exactly ONE dimension… The winning vote only decides whether that one change happens, never how many things change`, full history block, genre + bpm + few-shots + code-only rule.
- Outro: current code, genre + bpm + few-shots + resolve/sweep/drop instruction + code-only rule.
- Every prompt contains genre, bpm, and the `FEW_SHOTS` snippets (asserted for all four).

## TDD Evidence

### RED

Wrote `backend/music/__tests__/state-doc.test.ts` + `prompts.test.ts` before sources.

```
bun test backend/music
# Unhandled error between tests
error: Cannot find module '@backend/music/prompts' from '.../backend/music/__tests__/prompts.test.ts'
 9 pass
 2 fail
 2 errors
Ran 11 tests across 3 files. [42.00ms]
```

(state-doc module also missing; both new test files errored on import.)

### GREEN

After implementing both modules:

```
bun test backend/music
(pass) initialStateDoc: zero-history doc carries genre and bpm
(pass) applyChange: appends history entry with winner and change summary
(pass) applyChange: records polled dimension and marks the changed element
(pass) applyChange: sound-design change lands in soundDesign list
(pass) applyChange: accumulative over successive polls
(pass) applyChange: null change summary leaves elements untouched
(pass) applyChange is immutable
(pass) FEW_SHOTS: at least 3 snippets, all valid strudel
(pass) every prompt carries genre, bpm and few-shot snippets
(pass) code prompts forbid prose and markdown fences
(pass) initial pattern prompt asks for a loopable pattern at the room bpm
(pass) evolution prompt carries current code, poll result, history and one-dimension rule
(pass) evolution prompt renders empty history as none yet
(pass) outro prompt carries current code and the code-only rule
(pass) question prompt: one yes/no question, max 120 chars, no repeats, paced
(pass) question prompt renders empty polled dimensions as none yet
 25 pass / 0 fail
```

Full gate:

```
bun run check
→ biome check: 19 warnings (pre-existing nursery `useExplicitReturnType` style warnings), 0 errors
→ typecheck: tsc --noEmit clean
→ knip: clean
→ test: 58 pass, 0 fail, 141 expect() calls
✓ all checks passed
```

## Files changed

```
backend/music/state-doc.ts                 (new, 92 lines)
backend/music/prompts.ts                   (new, 145 lines)
backend/music/__tests__/state-doc.test.ts  (new)
backend/music/__tests__/prompts.test.ts    (new)
```

Commit: `6552a13 feat(music): state doc + llm prompt builders` (4 files, +437). Working tree clean, nothing staged.

## Self-review findings

- **Filename deviation (forced):** the brief/plan names `stateDoc.ts` / `stateDoc.test.ts`, but Biome's `style/useFilenamingConvention` restricts TS filenames to kebab-case, so `stateDoc.ts` fails `bun run check` (`× The filename should be in kebab-case`). The parent instruction "Starter conventions (AGENTS.md, placement rules) govern you" plus the co-location rule (`__tests__/<source-name>.test.ts`) resolved it to `state-doc.ts` / `state-doc.test.ts`. I did **not** add a Biome override (that would widen scope into config). No API/type names changed, so Task 6 is unaffected.
- Immutability is asserted directly, not just implied: input doc's `history`/`polledDimensions`/`elements.harmony`/`soundDesign` unchanged, and `next !== doc`, `next.elements !== doc.elements`, `next.history !== doc.history`.
- Every briefed prompt contract has an explicit `toContain`/`toMatch` assertion (no opaque full-file snapshots). `FEW_SHOTS` validity is asserted through the real Task-3 `compileCheck`, so they cannot silently rot.
- Fixed during self-review: `nextElements` originally duplicated regex sets per branch — collapsed to one function; knip flagged `StateDocElements`/`StateDocHistoryEntry` as unused exported types → unexported them (public `StateDoc` shape unchanged).
- Nothing added beyond the brief: no engine calls, no `LlmProvider` import, no fixture files.

## Concerns

1. **Element-update semantics were under-specified.** Brief only says "update elements"; the only signal available in `applyChange(doc, question, winner, changeSummary)` is the free-text summary, so I infer `drums|bass|melody|harmony` booleans (sticky `||`, never flipped back off) and append sound-design summaries. Documented by comment. If Task 6/8 expects a different rule (e.g. winner-driven, or a structured dimension returned by the LLM), `state-doc.ts` is the single place to change.
2. **`initialStateDoc` starts all elements absent.** The initial pattern prompt asks for drums+bass/melody/harmony, so the post-initial doc arguably should be `drums: true`. Brief says "zero-history doc", so I kept it fully zero; Task 6 can set elements after validating the initial pattern if needed.
3. **`polledDimensions` stores the full question text** (no separate dimension field exists). The question prompt forbids repeats against that join; if Task 6 wants short dimension labels, the question builder's join is the seam.
4. **No changeSummary producer.** These prompts only produce code (or a question); nothing here yields the `changeSummary` that Task 6's `generateEvolution` must return. Task 6 will need a source for it (derive from question/winner, or a summary-asking prompt) — flagged early so it isn't discovered mid-Task-6.
