# Continuous crowd controls, text directions, and recorded samples

Date: 2026-10-28. Status: implemented; physical-device and venue release checks remain (see implementation notes below).

## Goal and agreed experience

During a ten-minute set, listeners can repeatedly change musical preferences, describe new directions in their own words, and contribute short recordings that become musical material. Participation remains optional, anonymous, and available throughout the live set. There is no fixed number of interactions, timed voting round, or majority winner.

This extends the continuous-preference design in `docs/superpowers/specs/2026-10-01-music-vote-design.md`. It supersedes this conversation's earlier suggestion to rotate a limited number of questions. Implement each phase as a complete vertical slice, using Bun throughout and the existing project layout.

## Product defaults for the first implementation

- Seven persistent dimensions: energy, rhythm, mood, bass movement, melody behavior, texture, and space. Preserve the current three dimensions and their stored option meanings; add four new dimensions. Three choices per dimension, with wording adapted to the sound palette and genre.
- Each phone's latest answer replaces its previous answer independently per dimension. Allow clearing an answer. Answers remain until changed, cleared, or the set ends; reconnecting does not reset them.
- All dimensions remain accessible. A featured question can draw attention to one dimension without hiding the others, resetting selections, expiring answers, or imposing a deadline.
- One current text direction per phone, initially capped at 240 characters. Users can edit or clear it. Keep draft editing local; only explicit submission changes the active direction.
- Recordings are submitted clips, initially one to three seconds with a three-second maximum. Preview and re-record before sending. Offer percussion, chopped hook, and atmosphere as intended uses.
- Initially allow one pending recording per phone and one crowd sample layer playing at a time. Proposed starting limits: one accepted upload per phone per 30 seconds, ten queued clips per room, 2 MiB per upload, and one decoder process per server. Validate and tune these during the audio spike.
- A sample's initial musical appearance lasts eight bars, then expires unless deliberately reused. Retain its asset until the room ends so host reload and undo can resolve references. Start with a 24-hour post-room cleanup grace period; make retention configurable.
- Build/drop/strip-back are discrete moments, distinct from persistent preference targets. Audience requests for these are an optional later slice, with one-shot consumption and cooldowns.
- Preserve host lock, undo, end, current tempo, recognizable motifs, and server-owned room state. No new audience audio playback except an explicit local recording preview.

## Phase 1 — Define contribution state and compatibility

Primary files: `shared/schemas/preferences.ts`, new `shared/schemas/contributions.ts`, `prisma/schema.prisma`, `prisma/migrations/`, `backend/music/state-doc.ts`, `shared/realtime/events.ts`.

- [ ] Give preference definitions stable dimension keys and a catalog version, rather than using display wording or row position as identity. Preserve existing saved answers and option semantics.
- [ ] Specify the initial four added dimensions and an audible mapping for every option: bass rhythm/envelope, existing motif behavior, synth waveform/filter/envelope, and spatial effects. Separate mood, energy, and density so they do not all simply add more notes.
- [ ] Add durable records for current text directions, immutable submitted direction revisions, recording assets, and contribution outcomes. Enforce one active direction per `(roomId, sessionToken)` and idempotent recording submissions.
- [ ] Store the exact contribution revisions and sample asset IDs used by each candidate version. Keep private ownership tokens out of public responses and model prompts.
- [ ] Define distinct states for an active input, delivery attempt, and playback outcome. Suggested delivery states: received, preparing, applied, held, failed, superseded, withdrawn, and expired. Record reasons separately.
- [ ] Use additive migrations. Backfill stable identities for existing preference rows; make recovery add missing dimensions idempotently instead of returning when any preference already exists. Never reset the database or rewrite historic answers.
- [ ] Document how existing rooms are upgraded and how legacy snapshots remain readable. Keep existing internal Poll delivery records initially; do not replace the whole delivery subsystem just to add contributions.

Acceptance: an existing live room retains its answers, gains missing dimensions once, and survives repeated recovery. Public reads expose counts and the caller's own contributions without exposing other phones' identities or private text.

## Phase 2 — Ship revisitable musical controls

Primary files: `backend/votes/preferences.ts`, `backend/votes/service.ts`, `backend/trpc/voting.ts`, `frontend/components/poll-card.tsx`, `frontend/components/poll-monitor.tsx`, `frontend/routes/vote.tsx`, `frontend/routes/host.tsx`, `frontend/components/performance-stage.tsx`, `backend/music/prompts.ts`.

- [ ] Add answer clearing and support all seven persistent dimensions in counts, saved selections, host monitoring, and projector display.
- [ ] Present a compact phone layout with every dimension reachable and the current choice clearly visible. A featured dimension is a presentation choice only.
- [ ] Use desired-state choices, such as deep pulses/bouncy/rolling, rather than commands that accumulate intensity on every check. Include melody retention as a valid preference.
- [ ] Extend crowd prompts with concrete mappings for the new dimensions. Blend the entire distribution, preserve motifs and tempo, and make one coherent main adjustment per update.
- [ ] Preserve latest-answer upserts, arbitrary repeat edits, cookie continuity, reconnect reconciliation, unanswered dimensions, and no-op detection for unchanged aggregates.

Acceptance: two phones can change several dimensions repeatedly during a ten-minute room, reload, clear answers, and continue. Counts and saved choices stay correct; no question closes and no winner is produced.

## Phase 3 — Unify musical scheduling and playback feedback

Primary files: `backend/polls/scheduler.ts`, `backend/music/engine.ts`, `backend/music/prompts.ts`, `backend/rooms/service.ts`, `frontend/lib/pending-candidate.ts`, `frontend/audio/strudel-init.ts`, `frontend/audio/strudel-player.tsx`, `shared/realtime/events.ts`.

- [ ] Build a bounded input snapshot containing current parameter distributions, active text revisions, and eligible sample metadata. Compare canonical snapshots; repeated identical input must not trigger another generation.
- [ ] Keep the existing ten-second input checks and one unresolved candidate per room. Continue accepting input while preparing or waiting for host confirmation; coalesce intermediate changes.
- [ ] Apply crowd changes at the existing four-bar host-clock boundary, as performance actions already do. Measure actual generation plus boundary latency before adjusting timing constants.
- [ ] Distinguish input acceptance, candidate preparation, phrase-boundary waiting, and confirmed application. Publish a short concrete change description only after the host confirms application; describe model-reported intent honestly rather than claiming verified audibility.
- [ ] Define the edit-during-generation policy: newer revisions feed the next snapshot; edits do not cancel every in-flight preference update. Withdrawal/removal of a referenced text revision or sample invalidates the candidate before playback. Enforce revision checks on server acknowledgement and client cancellation on invalidation.
- [ ] Retain existing base-version checks, generation timeouts, stale rejection, and no automatic failure retry loops. Recovery must distinguish interrupted preparation from a recoverable candidate.
- [ ] Define musical priority: end/outro closes input; host actions and lock retain control; samples and text share the serialized crowd delivery path. Lock collects input but starts no new automatic contribution, and releases using current state.
- [ ] Snapshot all new musical context for undo. Consumed one-shot events stay consumed even if the host undoes their musical result, preventing automatic replay.

Acceptance: slow generation, rapid edits, withdrawal, lock, undo, host reload, timeout, and room end cannot create overlapping updates or apply a stale contribution. Received input is never presented as already playing.

## Phase 4 — Add editable free-text directions

Primary files: new `backend/contributions.ts`, new `backend/trpc/contributions.ts`, `backend/trpc/root.ts`, `shared/schemas/contributions.ts`, new `frontend/components/direction-input.tsx`, `frontend/routes/vote.tsx`, `backend/music/engine.ts`, `backend/music/prompts.ts`.

- [ ] Add submit/replace/clear/read-own-direction procedures using the existing anonymous cookie and explicit ownership checks. Reject submissions outside a live room. Rate-limit submissions independently of local typing.
- [ ] Interpret a submitted direction into bounded musical intent: affected dimensions, desired state or one-shot request, brief explanation, and reference to known musical history when appropriate. A normal direction must not execute as code or override the agent's system rules.
- [ ] Show the interpretation for review before activation. Editing the text invalidates an older interpretation; activate only the exact reviewed revision. Interpret unavailable requests honestly instead of inventing a voice, instrument, or sample.
- [ ] Group similar active directions and balance conflicting ones alongside fixed answers. Give each phone one active contribution weight; message count, length, or repeated edits do not increase its weight. Budget input and output size for busy rooms.
- [ ] Track which exact revisions were considered and which the model reports incorporating. Link outcomes to confirmed versions. HOLD, incompatible intent, and failure have explicit outcomes without a false promise that every request will be heard.
- [ ] Add a host ability to disable text contributions or dismiss a direction. Dismissed content stays out until its owner explicitly submits a new revision.
- [ ] Keep raw directions private to their author, host, and generation pipeline by default; do not create a public chat feed.

Acceptance: “underwater” can be reviewed as muted timbre and spacious effects, submitted, replaced with “drier and punchier,” and cleared. Only current eligible revisions influence future updates; incompatible directions resolve coherently. Arbitrary user text never becomes executable code.

## Phase 5 — Prove recording and sample playback feasibility

Primary files: a Bun-driven probe under `scripts/`, then `frontend/audio/`, `backend/music/validate.ts`, `Dockerfile`, `.env.example`, `docs/agents/music-vote.md` as needed.

- [ ] Test microphone capture and recording format negotiation on actual iOS Safari and Android Chrome over HTTPS. Use supported MIME detection and establish a decode/transcode path; do not assume every browser records WebM or decodes every format.
- [ ] Record claps, speech, beatboxing, and whistles with the PA playing. Compare input processing settings; select practical defaults from listening results. Stop microphone tracks immediately after recording/cancel/unmount.
- [ ] Prove a room clip can be decoded, trimmed, gain-controlled, registered under a generated sample name, preloaded, and played by the host on a four-bar boundary while the existing loop continues.
- [ ] Measure upload-to-ready latency and peak memory on the current 512 MiB Fly machine. Prefer a bounded server decoder/transcoder invoked by Bun when needed, rather than assuming native Bun media decoding exists. Pin any system package in Docker and document local installation.
- [ ] Verify that server-side validation can admit only ready samples belonging to this room, and that the host reload can reconstruct the sample registry before replaying a pattern.
- [ ] Record findings and choose the recording format, normalized output format, upload cap, decoder timeout, and concurrency limits before implementing general uploads. Require a playable retained sample first; do not add transcription or melody extraction to this milestone.

Acceptance: at least one recording from each target mobile browser plays recognizably in the real Strudel host. Decode errors and unavailable microphones leave the existing song playing. Stop and address a failed feasibility criterion before promising the recording feature is ready.

## Phase 6 — Ship the recording contribution pipeline

Primary files: `shared/schemas/contributions.ts`, `backend/contributions.ts`, new `backend/recordings.ts`, `backend/server.ts`, `backend/trpc/contributions.ts`, new `frontend/components/recording-input.tsx`, `frontend/routes/vote.tsx`, `frontend/routes/host.tsx`, `backend/boot.ts`.

- [ ] Build record, stop, local preview, trim, re-record, cancel, intended-use selection, submit, status, and withdraw flows. Explain that submission contributes the recording to room playback; offer a usable path when microphone access is denied.
- [ ] Add a bounded binary upload endpoint on the existing Bun server, with matching development and production routing. Use tRPC for metadata and control; avoid base64 audio in JSON or WebSocket messages.
- [ ] Check room ownership/session, live status, byte and decoded-duration limits, actual decodability, and quotas. Use generated asset paths and names. Do not accept arbitrary external URLs or trust MIME/filename declarations.
- [ ] Store metadata in SQLite and audio outside it. Initially use a configured directory on the existing `/data` volume in production and an ignored local directory in development; preserve the single-machine deployment assumption.
- [ ] Process clips with bounded concurrency: decode, trim silence, remove DC offset if needed, control peaks, apply short edge fades, and encode the selected playback format. Silence or an unusable clip gets an actionable outcome.
- [ ] Implement durable queued/processing/ready/failed/withdrawn/expired asset states, idempotent upload completion, interrupted-job recovery, orphan cleanup, and disk-pressure rejection before accepting more bytes.
- [ ] Serve audio through room-scoped, expiring asset access suitable for host fetches. Refresh access after reload; do not expose filesystem paths or make original uploads a public sample library.
- [ ] Show the host a bounded queue with audition, dismiss, and remove controls. Audition must be explicitly routed: the host browser normally feeds the PA, so do not describe main-output audition as private. Provide optional approval mode and a pause for new samples.
- [ ] On room end close uploads and processing-to-playback admission. Cleanup runs on boot and periodically, removes expired assets and cached host buffers, and retries interrupted deletions. Retained history must not point to usable audio after the retention deadline.

Acceptance: two phones can upload clips without blocking music or each other; duplicate retries do not duplicate contributions. Oversized, unsupported, silent, expired, interrupted, and withdrawn recordings resolve correctly. Restart preserves ready clips and recovers queued work.

## Phase 7 — Integrate samples musically

Primary files: `backend/music/engine.ts`, `backend/music/prompts.ts`, `backend/music/validate.ts`, `backend/music/state-doc.ts`, `backend/polls/scheduler.ts`, `backend/rooms/service.ts`, `frontend/audio/strudel-init.ts`, `frontend/lib/pending-candidate.ts`.

- [ ] Register ready assets using generated room-scoped sample identifiers in trusted application code. Extend validation with a per-room sample allowlist; do not globally accept arbitrary sound names or model-generated sample-loading URLs.
- [ ] Include ready asset IDs and intended use in generation context. Start with deterministic transformations for percussion, chopped hook, and atmosphere; preserve a recognizable first appearance and avoid unsupported promises of tuning or automatic tempo extraction.
- [ ] Have the host fetch/decode/preload every required sample before scheduling a candidate. Failed preparation rejects the candidate and preserves the confirmed groove. Include the asset manifest in recovery and candidate delivery.
- [ ] Select eligible clips with a fair queue and bounded playback slots. Consuming a sample happens only on confirmed application. Additional uploads do not increase a phone's preference weight or monopolize queue turns.
- [ ] Implement an eight-bar lifetime on the host musical clock plus an authoritative expiry/removal record. Expiry must run even if no crowd preference changes; otherwise an unchanged snapshot could loop a clip forever.
- [ ] Ensure replacement, withdrawal, host removal, lock, undo, reload, and end cancel the right pending sample work. Withdrawal prevents future appearances and removes an active layer at the next appropriate boundary. Keep the base music separate enough to remove the sample reliably.
- [ ] Preserve sample references for undo during the live room, but do not resurrect withdrawn, expired, or deleted contributions. An unavailable sample must produce a sample-free recovery or a clear rejected undo, never silent broken playback.

Acceptance: a listener recognizes their clip, hears it transformed in time, and sees its confirmed status. Clips leave on schedule without another vote. Later crowd evolution cannot accidentally retain or revive a removed sample layer.

## Phase 8 — Add optional audience musical moments

Primary files: `shared/schemas/contributions.ts`, `backend/contributions.ts`, `backend/music/performance.ts`, `backend/polls/scheduler.ts`, `frontend/routes/vote.tsx`, `frontend/routes/host.tsx`.

- [ ] Reuse prepared build/drop/strip-back transformations through the same serialized candidate path. Make each audience request a one-shot intent, rather than an intensity preference repeated on every check.
- [ ] Define one outstanding request per phone, fair conflict resolution, a proposed 30-second room cooldown, and a bounded lifetime/return to the underlying groove. No winning poll or countdown is required.
- [ ] Route one-shot text interpretations through this same policy. Before this phase, explain that these requests are unsupported rather than turning them into persistent targets.
- [ ] Expose host enable/disable and cancellation controls. Host lock pauses new automatic moments, and end cancels queued ones.

Acceptance: “drop” fires once, never competes with an unresolved candidate, and cannot immediately retrigger from an unchanged text direction or request. Contradictory requests become separate coherent moments or explicit skips.

## Phase 9 — Verify the full experience and roll out

- [ ] Add meaningful co-located tests for catalog upgrades, answer replacement/clearing, revision ownership, idempotency, mixed-input coalescing, conflict handling, playback acknowledgement, contribution withdrawal, asset access, decoding limits, cleanup, sample expiry, stale work, and restart. Keep each database-backed test file's SQLite file isolated.
- [ ] Extend deterministic mock LLM fixtures for text interpretation, mixed directions, HOLD, unavailable intent, and sample-aware code. Unit and CI tests do not depend on a real model.
- [ ] Extend Playwright coverage for host plus two anonymous phones: repeated edits, text revision during generation, reload/reconnect, lock/release, recorded fixture upload, preloading failure, sample appearance/expiry/removal, undo, and ending during upload/generation. Include production SSR and narrow layouts.
- [ ] Test real microphone permission and capture on physical iOS/Android browsers. Fixture uploads and desktop mocks do not establish mobile recording support.
- [ ] Rehearse a real-model ten-minute set through speakers with repeated direction changes, opposing preferences, PA bleed, intermittent connectivity, and several crowd clips. Check recognizability, headroom, phrase alignment, and room-size load.
- [ ] Instrument input-to-confirmed-playback latency, HOLD/failure rates, queue wait, clip decode failures, repeated participation, and host removals. Avoid logging raw text/audio by default. Ask listeners whether their contributions were audible and made the set more fun; do not optimize only for tap count.
- [ ] Update the current design spec, README, deployment/runbook, configuration examples, and host help when each behavior ships. Keep historical plans historical.
- [ ] Release in stages: seven controls; text behind a room toggle; recordings behind a separate room toggle; optional musical moments. Existing rooms and preference-only operation remain supported.
- [ ] Run `bun run verify` for each implementation slice before calling it complete. This includes native checks, knip, isolated unit tests, and both Playwright suites. Record real-device/listening results separately from automated checks.

## Recommended implementation order and scope boundaries

Implement phases 1–4 first for a complete controls-and-text release. Run phase 5 before committing to the detailed audio path, then ship phases 6–7 together as a recording release. Phase 8 is a separate enhancement; phase 9's relevant checks apply throughout.

The first recording release does not include live microphone streaming, automatic humming-to-instrument transcription, guaranteed pitch correction, arbitrary file uploads, external sample search, public chat, or a new distributed storage architecture. These can be evaluated after the short-clip experience works in a loud room.

There is no fixed completion estimate until the mobile codec and deployed-memory spike is done. The largest uncertainties are capture quality near the PA, cross-browser media decoding, fair behavior in crowded rooms, and preserving sample lifecycles through arbitrary generated pattern changes. Resolve these with the stated acceptance checks rather than assuming text prompting alone will solve them.

## Implementation notes

The implementation adds all seven persistent controls with clearing, reviewed and
revisitable text directions, a durable bounded audio queue, browser capture and
trimming, host approval/removal/settings, phrase-aligned sample playback, and
optional one-shot audience moments. Additive migrations preserve old rooms and
answers. Candidate contexts record exact text revisions and recording/event IDs.

The sample integration uses a trusted Web Audio accompaniment sharing Strudel's
AudioContext and clock, rather than asking the model to reference newly registered
Strudel sample names. This keeps generated code validation unchanged and gives
expiry, withdrawal, and undo an independent layer they can reliably remove.
Text is translated into validated catalog targets before reaching generation;
free-form text does not become part of a code prompt. Descriptive feedback says
which direction was included, without pretending to measure model audibility.

Completed automated evidence includes real FFmpeg decoding of WAV, WebM/Opus and
MP4/AAC, silent/invalid input rejection, browser capture using a simulated microphone,
recording approval and playback, removal, reload, persistent answer edits, and
revocation while generation is pending. An iOS simulator renders the phone page.
Physical devices, PA acoustics, a real-model listening rehearsal, and deployed
512 MiB memory measurements remain manual release checks. Recordings and audience
moments default off; approval defaults on. These manual checks are not represented
as completed by the automated suite.
