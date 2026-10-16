# Party experience implementation plan

Date: 2026-10-16

## Outcome

People dance, glance at their phone, make one easy choice, and hear the crowd's decision together. A successful round makes the relationship between voting and music obvious, then gives people time to enjoy it.

Build in vertical slices. Milestone 1 is the first party-testable release; later milestones improve timing and musical depth. The timing values below are experiment defaults, not validated conclusions.

## Product decisions

- New evolution polls have exactly two short, concrete options. The winner needs more than half of valid votes cast, not half of everyone in the room.
- Ties and zero-vote rounds keep the current groove. Show why; never randomly choose a musical direction.
- Each anonymous browser session gets one vote per round. Reuse its existing cookie across reloads. This is lightweight participation, not proof of a unique physical person.
- Hide the running split from the audience; reveal final counts and percentages together. Keep host monitoring.
- Occasionally offer “Stay here / Take us somewhere new.” Staying is a successful crowd decision and requires no generation.
- Use a 20-second voting window and initially 60 seconds of dancing after a round resolves. Make both host-configurable with clear labels. A skipped, tied, failed, or unchanged round also enters this resting period.
- Keep the last result visible between rounds. Show the next vote time when known; do not require people to keep the page open.
- Never announce playback from a generated candidate alone. Separate the vote result, preparation, scheduling, and playback confirmation.
- Preserve the existing genre and tempo initially. No streaks, individual leaderboards, or rewards for watching the screen continuously.

## Current implementation and gaps

- `frontend/routes/vote.tsx` refreshes on `poll_closed` but discards its winner. `poll-card.tsx` ends the interaction at “Vote counted.”
- `backend/music/engine.ts` accepts two to four generated options and rejects unchanged choices. `backend/polls/scheduler.ts` selects the highest count and breaks ties randomly.
- Generation starts after voting closes. A new pattern is sent only to the host; `reportApplyResult` does not notify the audience of success.
- `voting.summary` currently treats any matching pattern version as applied, including candidates and rejected versions.
- `state-doc.ts` infers musical elements from text; evolution history is updated before host playback confirmation. Initial and undo versions also need their playback semantics reviewed.
- Room duration currently uses `createdAt`, so time spent in the lobby consumes set time.
- The audio adapter calls Strudel `evaluate`. Its comments describe implicit cycle-boundary behavior, but this is not sufficient evidence for a precise phrase countdown or audible-onset acknowledgement.

## Milestone 1: Complete the crowd decision loop

### 1. Persist outcomes and expose a reconnectable audience state

Work in `prisma/schema.prisma`, a Prisma migration, `shared/schemas/`, `shared/realtime/events.ts`, `backend/trpc/voting.ts`, and the room/poll services.

- Define shared validated types for option intent (`change` or `hold`), vote outcome (`winner`, `tie`, `no_votes`, `skipped`), and music delivery state (`preparing`, `ready`, `scheduled`, `applied`, `failed`, `unchanged`). Voting and music delivery are separate concerns.
- Persist the closed tally, winning key, resolved label, outcome, and resolution time. Persist delivery status and relevant timestamps; retain a failure reason suitable for host diagnostics.
- Add a durable room playback version/revision and link generated candidates to the version they were based on. Prevent a late candidate from overwriting a newer change or undo.
- Add `startedAt` and `nextPollAt`. Calculate set duration from the start of the live set, not room creation.
- Extend the audience query with the active poll, this session's recorded choice, latest result, delivery state, and next poll time. Keep code and host-only errors out of this payload.
- Use WebSocket lifecycle events to invalidate this authoritative snapshot. Refresh on reconnect and when a backgrounded phone becomes visible again.
- Make session claiming reuse a valid existing cookie. Recover the recorded choice after refresh instead of allowing a newly minted session to vote again.
- Update summary generation to require confirmed application and render human-readable labels. Include holds, ties, and failures honestly.
- Use additive migrations and explicit compatibility handling for existing options without intent metadata and existing multi-option polls. For legacy polls, require a strict majority; otherwise record no majority and hold the groove.

Acceptance:

- A new phone or a reconnected phone sees the same last result and delivery status as an already connected phone.
- Refreshing preserves the session and cannot create another vote in the same round.
- A candidate or rejected pattern never appears as an applied musical change.
- Ten minutes in a lobby does not shorten a newly started set.

### 2. Make majority voting simple and predictable

Work in `backend/music/prompts.ts`, `backend/music/engine.ts`, `backend/votes/service.ts`, and `backend/polls/scheduler.ts`.

- Generate exactly two distinct options with short labels; start with a 32-character limit and a curated fallback pair. Validate output before opening a poll.
- Represent “hold” as structured intent, not a label-based guess. Introduce occasional hold/change rounds through the scheduler rather than relying on arbitrary model wording.
- Replace random tie-breaking with an unchanged outcome. Do not invoke the music generator for a hold, tie, or zero votes.
- Close polls and persist final tallies atomically with respect to vote acceptance. A vote racing the deadline must either be included or rejected, never accepted after the final tally.
- Make close and result handling idempotent so duplicate timers/retries cannot generate or apply twice.
- Keep wrap/continue end polls explicit and apply the same tie/no-vote clarity. A tie does not extend the configured set deadline.

Acceptance:

- A 6–4 split selects the six-vote option; 5–5 and 0–0 keep the groove.
- Hold wins display a positive result without generating a replacement pattern.
- Invalid model output falls back to a valid two-option poll.

### 3. Deliver the result on the listener's phone

Work in `frontend/routes/vote.tsx`, `frontend/components/poll-card.tsx`, new small components under `frontend/components/` as needed, and `frontend/lib/room-ws.ts`.

- Implement these visible states: voting, vote recorded, winner revealed/preparing, applied, unchanged, unavailable, and resting until the next round.
- Use two large buttons, one short question, readable contrast, and a restrained countdown. Avoid making color the only indicator.
- After voting, show the selected option and “Back to dancing.” Keep final results accessible to people who did not vote.
- Reveal the winner with percentage and total votes. Explain the denominator as votes cast; avoid implying everyone present voted.
- During generation show “Deeper bass won — getting it ready.” After host confirmation show “Deeper bass is in.” Do not show a bars countdown yet.
- On failure show “The groove continues — that change couldn't play.” Keep technical details in the host UI.
- Between rounds retain the result and next vote time. Respect reduced motion and avoid flashing effects or repeated screen-reader announcements.

Acceptance:

- Every terminal outcome has a clear screen; no round silently disappears into a generic waiting state.
- A phone returning from its lock screen shows current state without replaying stale celebrations.
- The complete vote/result flow works on a narrow phone viewport and with keyboard input.

### 4. Make playback confirmation and round pacing trustworthy

Work in `backend/rooms/service.ts`, `backend/polls/scheduler.ts`, `frontend/routes/host.tsx`, `frontend/audio/strudel-init.ts`, `frontend/lib/pending-candidate.ts`, and room configuration schemas/forms.

- Update `reportApplyResult` transactionally: confirm the expected room revision, mark the version applied, update current code and musical history, then publish audience state changes.
- Keep proposed state separate from applied state. Rejected candidates do not update musical elements or successful-change history.
- Make repeated acknowledgements safe. Ignore stale results after undo, skip, end, or a newer version; retain their diagnostic outcome.
- Distinguish successful evaluation from an active audio engine. Do not confirm playback while the host audio context is suspended. Document the remaining onset precision until Milestone 2.
- Serialize evolution delivery per room. Resolve or time out the current change before another evolution round opens.
- Bound preparation and host-acknowledgement waits. Begin with a configurable 30-second preparation deadline and tune from measured generation latency. On timeout keep the existing music and mark the round failed.
- Schedule the next poll from round resolution plus the resting interval. Rename the form label to “Dance time between rounds”; preserve stored settings through an explicit migration/compatibility mapping.
- Restore pending lifecycle state after restart. Invalidate work that cannot be safely reconciled with the current host/version. Host disconnects must not produce false success.
- Preserve host skip, undo, and end controls. Cancel pending work on end and ensure that late generation cannot revive the room.

Acceptance:

- No next evolution poll opens while an earlier outcome is still unresolved.
- Failed generation, a disconnected host, and a suspended audio context keep the existing groove and lead to an honest audience state.
- Restart, duplicate acknowledgements, and undo during generation do not apply stale music.

Milestone 1 release gate: complete the tests below and run a small listening session before adding new party mechanics.

## Milestone 2: Make the change land together

### 5. Verify and implement phrase scheduling

Start with a bounded audio spike in the existing Strudel adapter and a real browser using the repository's browser/E2E workflow. Inspect the installed Strudel implementation before choosing an API.

- Establish what clock position, scheduling, cancellation, and onset notification are actually available. Verify with an audible recording or timing instrumentation; compilation tests cannot prove musical timing.
- Implement a host-owned target cycle at the next suitable phrase boundary. Start with four-bar phrases and preserve tempo.
- Expose a scheduling receipt containing version, playback epoch, target cycle, and estimated wall-clock time. Keep the host audio clock authoritative and make phone countdowns approximate displays of that target.
- Only show “Coming in 4 bars” after the candidate is ready and a target is committed. Reconcile clock drift, host suspension, and reconnects; cancel obsolete countdowns when the playback epoch changes.
- Acknowledge application when the scheduled transition occurs, not when code evaluation returns. If reliable scheduling is unavailable, retain “Getting it ready” and document the limitation rather than faking precision.

Acceptance: a recorded test demonstrates repeated transitions on the chosen phrase boundary; suspension or cancellation never leaves a countdown claiming an unheard change happened.

### 6. Prepare both choices before the result

- Generate both options against the same confirmed base version during the rest period or voting window. Store candidates by poll, option, and base version.
- Compile-check both and preload required audio resources where the adapter supports reliable discovery. Preparation must not change audible playback.
- Bound concurrency and timeouts; measure the extra generation cost and readiness rate. A hold option needs no candidate.
- Select only the winning candidate. Discard the loser and any stale candidates. If the winner is unready, keep the current groove and use the honest preparation/failure states.
- Initially allow a delayed change rather than silently substituting the losing option.

Acceptance: ready winners can be scheduled without another generation request; losing and stale candidates are never audible.

## Milestone 3: Give the music a recognizable journey

### 7. Track musical structure and support callbacks

Work in `backend/music/state-doc.ts`, prompts/engine, version persistence, and scheduler logic.

- Replace regex-derived element presence with validated structured state: active layers, energy, motif identity, current phase, and recently changed dimensions. Store it with the applied pattern version so undo restores matching state.
- Use a simple warm-up/build/peak/release plan derived from actual set progress. Let votes choose directions within a phase; the phase must not override a winning choice.
- Replace “never repeat a dimension” with a cooldown. Permit returning to bass, drums, or a recognizable motif after other changes.
- Prefer transformations of existing layers over continuous layer accumulation. Keep tempo stable and protect the central hook unless the vote explicitly changes it.
- Start with a curated set of reliable transformations if free-form generation does not preserve musical identity. Treat listening quality as a release criterion beyond syntax validation.

Acceptance: a 15-minute listening session retains a recognizable musical idea, includes contrasts in energy, and can recall an earlier motif without restoring unrelated old state.

## Milestone 4: Optional party features

Implement these as independent slices only after the first party test identifies demand.

1. **Venue screen:** add a read-only route under `frontend/routes/`, register it in `frontend/router.tsx`, and consume the same public audience snapshot. Show join QR, active choices, final result, and confirmed transition. Expose no host controls or generated code. Update route/SSR coverage as required.
2. **Crowd-selected drops:** offer “Drop next phrase / Build a little longer” only when both musical branches are prepared and the scheduling work is proven. No surprise drop triggered by tapping repeatedly.
3. **Set souvenir:** share a recap of confirmed changes, holds, and memorable callbacks using readable labels. Audio export is a separate recording feature with its own scope.

## Validation and first party experiment

For each implementation slice, add meaningful tests next to its source in `__tests__/`. Extend `e2e/music-vote.spec.ts` or add a focused spec under `e2e/` for the audience/host interaction.

- Unit/integration: strict majority, tie/no votes/hold, malformed questions, vote-close race, duplicate close, idempotent acknowledgement, stale base version, failure timeout, undo, end, restart, and duration measured from start.
- UI: final percentages and labels, voted choice after refresh, all outcome states, reduced motion, and visibility/reconnect recovery.
- E2E: multiple anonymous browser contexts vote; host applies winner; all listeners see the result. Cover failed generation, rejected playback, suspended audio, host disconnect, and late acknowledgement.
- Use the mock provider with explicit scripts for both branches and delayed/failing responses. Test real audio behavior separately; mock generation cannot validate musicality.
- Run `bun run check` for each completed slice and `bun run check:full` for UI/auth/route changes. Use Bun for all package/runtime commands.
- Baseline observed on 2026-10-16: `bun run check` stops because TypeScript cannot find `bun-types`; Biome also reports warnings and a schema/CLI version mismatch. Resolve the environment prerequisite before treating future checks as passed.

Instrument room-local timestamps for poll open/close, generation readiness, scheduling, application, and failure. Track poll participation, repeat participation among eligible returning sessions, and close-to-applied latency. Do not treat connected sockets as the number of people in the venue or screen time as success.

First experiment: 8–15 people, one 15–20-minute set, two choices per round, 20 seconds to vote, and 60 seconds to dance after resolution. Have an observer note whether people notice the result and return to dancing; ask afterwards, “Could you hear what the crowd changed?”

Provisional targets: at least 80% can identify one crowd-caused change; no false playback announcements; no interrupted base groove on generation failure. For Milestone 2, target the next four-bar boundary for a ready winner. Record actual latency distributions before setting a production latency promise.

## Delivery order

1. Durable outcomes, audience snapshot, and session continuity.
2. Two-choice majority voting and explicit unchanged outcomes.
3. Listener results, confirmed application, and resting cadence (release together).
4. First party test; adjust wording and timing from observations.
5. Audio scheduling spike, then prepared choices and phrase countdowns.
6. Musical structure and callbacks.
7. Venue screen, drops, or souvenirs according to the party-test findings.

Update `README.md` and the existing design document when the corresponding behavior ships. Keep this plan as the implementation checklist; do not describe planned behavior as already available.
