# Task 14 Report: E2E — full democratic cycle

Commit: `431e40d` — `test(e2e): full democratic music cycle`

## What the spec covers, step by step

File: `e2e/music-vote.spec.ts` (one test, ~3.2 min, three independent browser contexts).

1. **Host signs up** (`signUp` helper copied from `e2e/auth.spec.ts`) → `/create`.
2. **Creates a room**: length 5 min, interval 60s (the schema minimums —
   `shared/schemas/room.ts`); bpm/genre left at form defaults.
3. **Host console**: asserts `room-status` = `lobby`, reads the QR target from
   `data-testid="vote-url"`.
4. **Two phones** (separate contexts → separate `mv_session` cookies) open
   `/r/<id>` before the set starts and sit on the lobby copy `waiting-dj`.
5. **Start**: host clicks `start-room`; `room-status` → `live`; the QR card is
   still on screen; a click on the page supplies the audio user gesture.
6. **Poll 1 opens** on both phones (`poll-card`, `poll-question` = the fixture's
   poll-1 question). Option buttons are located generically
   (`getByTestId(/^vote-option-/)`, first) — no yes/no literal, no option-count
   assumption.
7. **Votes**: phone A votes → `vote-counted`; phone B votes → `vote-counted`;
   phone A votes again → still `vote-counted` and **no** `vote-error`
   (ALREADY_VOTED renders as counted, per the Task 13 ruling).
   - Phone A's reload re-mints `mv_session` (the deferred Task 10 gap), so the
     spec restores phone A's original cookie value from the jar before the
     duplicate tap — that is what makes the retry a real duplicate of the same
     poll rather than a new identity's first vote.
   - Host-side proof it was a rejection, not a second accepted vote: the
     `poll-option-<key>` row settles on **2** (A once + B once).
8. **Evolution**: poll 1 closes (FAST hook → 5s window) and the winning option
   drives the mocked evolution; host console shows `apply-status` =
   `change applied`.
9. **Audio**: node starts grow while the set is live, stay silent after `ended`
   (see the audio section).
10. **Next poll cycle**: poll 2 opens ~60s later (interval tick), question is not
    poll 1's, phone A votes it → `vote-counted`.
11. **Zero-vote poll**: poll 3 opens ~60s after that and is left unvoted; the
    spec watches it open and then closes the set.
12. **Undo**: host clicks `undo` → `apply-status` = `reverted`.
13. **End**: host clicks `end-room` → `room-status` = `outro`, the outro
    `code_update` goes through the same apply loop (`change applied`), then the
    room finalizes to `ended` (60s outro window).
14. **Audience summary**: both phones show `poll-timeline`; the timeline has
    **exactly 2** `timeline-item`s although **3** polls were created (the
    zero-vote poll 3 is filtered out), each item carries the winning option key
    and the `music changed` flag.

## Fixture response ordering and why

`e2e/fixtures/llm-script.json`:

```json
{
  "responses": [
    "s(\"bd sd cp hh\").gain(0.8)\nnote(\"c2 eb2 g2\").s(\"sawtooth\").lpf(700)",
    "More energy?"
  ]
}
```

Derived from the code, not from the plan text:

- `getLlmProvider()` (`backend/llm/provider.ts`) has **no memoization**: every
  call constructs a fresh `MockLlmProvider`, and each construction re-reads the
  file and starts at index 0. This matches Task 12's note that poll 2's question
  is the idx-0 fixture string.
- Call sites: `startRoom` (`backend/rooms/service.ts:59`) makes two chats on one
  provider instance — `generateInitialPattern` (index 0) then
  `generateNextQuestion` (index 1). `runEvolution` (`scheduler.ts:365`),
  `queueNextEvolution` (`scheduler.ts:452`) and `endRoom` (`service.ts:142`) each
  build their own provider, so every one of them reads **index 0**.
- Consequence: `responses[0]` must simultaneously be a valid Strudel snippet
  (initial pattern, each evolution, outro — it passes `compileCheck`) and an
  acceptable "question" string (non-empty, ≤120 chars, so `generateNextQuestion`
  does not retry/fall back). `responses[1]` is only ever poll 1's question.
- Residual limitation: the mock **cannot** script distinct codes per call site,
  so the initial pattern and every evolution are the same string. The spec
  therefore cannot prove the audio changed on a vote; it proves the apply path
  ran (badge) and that a version was created per decided poll (summary `music
  changed`). Documented as a gap below, not worked around.

## Audio evidence

Technique: an init script (`host.addInitScript`) wraps
`AudioScheduledSourceNode.prototype.start` and `AudioBufferSourceNode.prototype.start`
and counts starts on `window.__audioStarts`, de-duplicating node instances with a
`WeakSet`. The host browser is the audio engine, so this observes the Web Audio
graph; no speakers are involved and no autoplay flag was needed.

Measured numbers:

| observation | result |
|---|---|
| diagnostic probe, 12s after start, sampled every 1s | 0, 3, 6, 9 … 33 starts (~3 starts/s, steady) |
| `AudioContext.resume` calls in the same probe | 0 — the context was already running; the Start click + click gesture sufficed |
| first full-spec run: starts at `ended`, then 4s later | 541 → 542 (one already-scheduled voice landed after the DOM flipped to `ended`) |
| first full-spec run: live/outro growth | monotonic (~3/s), never stalled |

The first run exposed a sampling race, not a product bug: the `ended` effect
hushes the engine on the render *after* the status flips, so sampling the counter
the instant the badge reads `ended` can catch one in-flight voice. The spec now
first waits for quiescence with `expect.poll` (1s deltas until the delta is 0,
bounded to 15s) and then asserts **0 new starts across a further fixed 4s
window**. That 4s window is an absence-of-activity observation, not a sleep
standing in for an event wait.

The fixture pattern mixes drum samples (`s("bd sd cp hh")`) with a synth line
(`note(...).s("sawtooth")`), so audio activity does not depend on the
`dirt-samples` bank download succeeding.

## Real product bugs exposed by the E2E

**None.** Two behaviours the E2E had to work around or that are worth recording:

1. **`mv_session` re-mint on reload** (already deferred by Task 13 as a Task 10
   backend gap): `voting.claimSession` issues a new `crypto.randomUUID()` on every
   call, so a reloaded phone is a new voter. The spec restores the original cookie
   value to reach the `ALREADY_VOTED` branch; without it the "duplicate" would
   simply be accepted. Not fixed (out of scope, explicitly deferred).
2. **Undo badge is a race, observed to settle on `reverted`.** `undo` sets
   `apply-status` = `reverted` in the mutation `onSuccess`, while the server also
   publishes the undo `code_update`, whose apply handler sets `change applied`.
   A 20 ms-resolution badge sampler around the click recorded
   `['30:change applied', '40:reverted']` and no further change over the next 5s,
   i.e. the undo frame was applied before the mutation callback landed. The spec
   asserts `reverted` (auto-waiting), which is the shipped/intended feedback. It is
   ordering-dependant; flagged, not changed.

## Full-gate output

```
$ bun run check:full
biome check .        → 0 errors (warnings only, repo baseline)
typecheck (tsc)      → clean
knip                 → clean (new spec + fixture not flagged)
bun test --parallel  → 145 pass, 0 fail, 425 expect() calls, 20 files
$ playwright test
  ✓ e2e/auth.spec.ts:3:1 › signup lands on home
  ✓ e2e/drawer.spec.ts ... (3)
  ✓ e2e/music-vote.spec.ts:109:1 › host runs a set that the audience votes through, undoes, and ends (3.2m)
  5 passed (3.2m)
✓ all checks passed
```

`bun run check` alone is green: the spec lives under `e2e/`, which
`bun run test` (`bun test backend shared frontend`) never discovers, so no
Playwright file leaks into the unit runner. No bare-`bun test` interference was
hit; the repo gate (`--parallel`) was used as-is. `test-results/` and
`playwright-report/` were deleted before committing and are gitignored.

## Files changed

- `e2e/music-vote.spec.ts` (new)
- `e2e/fixtures/llm-script.json` (new)
- `playwright.config.ts` (webServer env: `LLM_PROVIDER=mock`,
  `LLM_MOCK_SCRIPT=e2e/fixtures/llm-script.json`, `MV_E2E_FAST=1`)

## Self-review findings

- Fails for real reasons: state assertions (`live`/`lobby`/`outro`/`ended`),
  per-poll question text, counted/disabled vote state, host tally = 2, badge
  texts, timeline item count and contents, and audio start counts — not "page
  loaded".
- No hardcoded yes/no, no two-option assumption: option buttons are found by
  `^vote-option-` testid and the option key is derived from that element.
- No fixed sleeps standing in for waits — every wait is `expect`/`expect.poll`
  with a bounded timeout. The only fixed waits are the 4s silence window and the
  1s deltas inside the quiescence poll, both measuring absence of activity.
- No debug artifacts, no screenshots/traces committed, no scratch spec left
  (`e2e/scratch-14.spec.ts` was deleted; `git status` clean).
- Audio is observed from the real Web Audio graph, and the stop-on-`ended` claim
  is asserted both as "quiescent" and "0 new starts over 4s".

## Concerns / residual gaps

1. **The mock cannot script distinct codes per phase** (see above), so the E2E
   proves the evolution *apply path* (host badge + `reportApplyResult`-backed
   `applied`/`music changed` summary flag) but not that the audible pattern
   changed. A one-string fixture is the only shape `MockLlmProvider` supports
   across call sites.
2. **Poll 2's evolution is not independently observable on the host.** The
   applied code string is identical to the current one, so the badge text does
   not change. Coverage for that step is the summary's `music changed` flag for
   the poll-2 timeline item (a version exists for that poll), not a second badge
   transition.
3. **The duplicate-vote path needs a cookie restore** to be reachable, because of
   the deferred session re-mint gap. If that gap is fixed (claim reuses an
   existing token), the restore becomes a no-op and the spec should still pass —
   but it is a test-side dependency worth revisiting then.
4. **Undo badge ordering** (see bug note 2) is not pinned; a slower machine could
   in principle reorder it to `change applied`. The assertion auto-waits for
   `reverted`, which is what the UI intends.
5. **Runtime**: the shipped FAST hook only shrinks the poll open window (5s); the
   poll grid still uses the 60s schema minimum, so a full cycle is ~3.2 min plus
   the 60s outro. `test.setTimeout(300_000)` is scoped to this file.
6. The audience still receives no `outro` push (Task 13 concern); the E2E does
   not depend on it (it waits for `ended`).

---

# Fix round 1 (review: no Critical; 2 Important, 1 of them a product defect; 2 Minors in the spec)

Commit: `194d851` — `fix(host): deterministic apply-status badge; tighten e2e qr + tally asserts`.

## Important #1 — apply-status badge was last-writer-wins and raced (fixed in the PRODUCT)

`frontend/routes/host.tsx` had two writers of `apply-status`:

- `handleCodeUpdate` → `setApplyStatus({ text: 'change applied' })` after Strudel's async `evaluate` resolves.
- the undo mutation's `onSuccess` → `setApplyStatus({ text: 'reverted' })`.

Whichever landed last won. On the run that produced the original passing E2E the
WS apply resolved first and the mutation response last, so the badge settled on
`reverted` — a timing coincidence, not an invariant. When the earlier apply
completes *last* (loaded runner, slower HTTP RTT than `evaluate`, or any apply
still in flight when Undo is clicked) the host console ends up showing
`change applied` for a set it just reverted.

### The fix

New pure module `frontend/lib/apply-status.ts` owns the badge as the outcome of
the **newest operation**:

- Every operation that may write the badge claims a monotonic token (`seq`) when
  it **starts** — each `code_update` frame, and the Undo click.
- `reduceApplyStatus(state, fact)` stores that claimed `seq` in the state, so the
  claim alone rejects an older operation's in-flight result (`fact.seq < state.seq`
  → state unchanged). Ordering comes from dispatch order through functional
  `setState` updates, never from render timing.
- The Undo click **reserves** its token in `pendingUndoSeqRef`; the undo's own
  `code_update` frame (`kind: 'undo'`) reuses that reserved token instead of
  claiming a new one, so the frame and the mutation response cannot fight. Both
  report `reverted` — the host asked for a revert, so that is what the console
  reports.

Resulting invariant: after an undo the badge reads `reverted` whichever writer
completes first, and a late result from the superseded apply can never overwrite
it; a *newer* operation (next evolution, outro) still updates the badge normally.

`pattern_rejected` now dispatches through the same reducer with the newest
claimed token. `reportApply` was extracted (identical behaviour) so
`handleCodeUpdate`'s cognitive complexity stayed at the pre-existing warning
level: `biome lint frontend/routes/host.tsx` on the commit shows the **same**
warning profile as HEAD (`2 × noExcessiveCognitiveComplexity`,
`1 × noExcessiveLinesPerFunction`, `11 × useExplicitReturnType`,
`1 × useReactCompiler`).

### RED → GREEN, both orderings (unit, no DOM)

`frontend/lib/__tests__/apply-status.test.ts`, 4 tests. RED was produced by
temporarily reverting the guard to naive last-writer-wins (the pre-fix
semantics), running, then restoring:

```
$ bun test frontend/lib/__tests__/apply-status.test.ts      # naive last-writer-wins
34 | 	const late: ApplyStatusState = reduceApplyStatus(undone, {
35 | 		type: 'applied',
36 | 		seq: 1,
37 | 	})
38 | 	expect(late.status).toEqual(REVERTED)
                          ^
error: expect(received).toEqual(expected)
  {
-   "text": "reverted",
-   "tone": "warning",
+   "text": "change applied",
+   "tone": "success",
  }
(fail) undo response first: a late apply result for the superseded version is ignored
(pass) WS apply first: the undo response still wins and stays reverted
(pass) a later apply after an undo still updates the badge
(fail) a rejected apply reports the error and outranks an older apply
 2 pass, 2 fail

$ bun test frontend/lib/__tests__/apply-status.test.ts      # with the token guard
 4 pass, 0 fail, 9 expect() calls
```

Ordering 1 (WS apply first, then the undo response) passes even naive — that is
exactly why the shipped E2E passed — so the RED is only observable through
ordering 2 (undo response first, then the late apply for the superseded version).
Both orderings are now pinned, plus "a later apply after an undo still updates
the badge" and "a rejected apply outranks an older apply".

### The E2E assertion is unchanged

`await expect(host.getByTestId('apply-status')).toHaveText('reverted')` stays
exactly as it was; it now guards the fix end-to-end instead of guarding a coin
flip.

## Minor A — the QR render node is asserted

`e2e/music-vote.spec.ts` now asserts `await expect(host.getByTestId('qr-code')).toBeVisible({ timeout: 15_000 })`
right after `room-status` reaches `lobby` (the QR node only mounts once
`qrcode.toDataURL` resolves), in addition to reading the `vote-url` text.

## Minor B — bounded tally match

The host tally assertion no longer uses `toContain('2')` (which also matched
"12"/"20"). It reads the count element's own text:

```ts
const hostTally = hostOptionRow.locator('span').last()
await expect
	.poll(async () => (await hostTally.innerText()).trim(), { timeout: 10_000 })
	.toBe('2')
```

## Documentation — FAST 5s poll-window flake vector (report only, no code change)

The duplicate-vote choreography must fit inside the single 5s poll-open window
(`MV_E2E_FAST=1` → `POLL_OPEN_SECS = 5`):

1. phone A votes, 2. phone B votes (parallel), 3. phone A reloads, 4. phone A's
mount re-claims `mv_session`, 5. the spec restores phone A's original cookie,
6. phone A taps the duplicate, 7. the host tally is read.

Measured on this machine the whole block completes in ~2–3s, leaving ~2–3s of
slack. On a loaded CI runner (slow dev-server reload, slow tRPC round trips) the
window can be missed, and the failure would surface as
`expect(poll-card).toBeVisible()` timing out after the reload in step 3 or the
duplicate tap hitting a poll that already closed.

**Controller decision (recorded): the FAST hook constant is NOT changed now.**
The documented remedy if flakiness materializes is to bump
`POLL_OPEN_SECS` from 5 → 10 in `backend/polls/scheduler.ts` (test constant); it
is deliberately not done now because widening the open window risks overlap with
the poll interval/grid.

## Documented limitations (unchanged, per the review)

- The file-based `MockLlmProvider` always serves `responses[0]` from a fresh
  instance, so distinct per-phase codes cannot be scripted. Per-poll applied
  version + `music changed` in the summary remain the accepted evidence.
- The `mv_session` re-mint gap on reload and the `applied`-flag-without-status
  filter are deferred backend gaps and were not touched.

## Fix-round validation

```
$ bun run check
biome: 0 errors (warnings only, repo baseline)   typecheck: clean   knip: clean
149 pass / 0 fail, 434 expect() calls, 21 files        ✓ all checks passed

$ bun run test:e2e   (via check:full)
  ✓ e2e/auth.spec.ts:3:1 › signup lands on home (1.3s)
  ✓ e2e/drawer.spec.ts ... (3)
  ✓ e2e/music-vote.spec.ts:109:1 › host runs a set ... (3.2m)
  5 passed (3.2m)

$ bun run check:full
✓ all checks passed  →  5 passed (3.2m)
```

Scratch artifacts removed (`test-results/`, `playwright-report/`), `git status`
clean, nothing staged before the commit.

## Files changed (fix round 1)

- `frontend/lib/apply-status.ts` (new — pure badge reducer + tokens)
- `frontend/lib/__tests__/apply-status.test.ts` (new — 4 tests, both orderings)
- `frontend/routes/host.tsx` (badge wired to the reducer; undo reserves its token)
- `e2e/music-vote.spec.ts` (QR visibility assertion; bounded tally match)
