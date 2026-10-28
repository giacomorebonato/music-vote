# music-vote — Design Spec

Updated: 2026-10-28. Continuous crowd preferences supersede the original timed majority-vote design and the timed-round portions of the 2026-10-16 party-experience plan.

## Experience

A host chooses genre, BPM, and set length, starts music in their browser, and shares a QR code. Audience phones join without accounts or audio playback. The host browser plays Strudel through the venue sound system.

Seven stable questions remain available for the whole live set:

- Energy: mellow / balanced / intense.
- Rhythm: steady / flowing / busy.
- Mood: dark / warm / bright.
- Bass: deep pulses / bouncy / rolling.
- Melody: minimal / repeat the hook / playful.
- Texture: smooth / gritty / sharp.
- Space: close and dry / echoing / spacious.

Answer any subset, at any time. A phone's latest answer replaces its previous answer for that question; clearing removes that answer. Saved selections survive reloads through the existing anonymous session cookie. Preferences remain until changed or the set ends; locking a phone or losing its socket does not remove its answers.

Phones and the host screen display the complete distribution of current answers, for fun. There is no winner, majority rule, final result reveal, countdown, voting window, or end-of-set vote. Host controls retain undo and end. Room setup has no round timing controls.

## Music loop

Every 10 seconds, compare the aggregate counts across all questions with the last submitted snapshot. Do nothing if there are no answers or the complete distribution has not changed. Identical submissions and swaps that preserve aggregate counts cause no additional model call.

Send all counts, including minority preferences and unanswered dimensions, with the currently confirmed code and last applied crowd snapshot. Never send session identifiers. The agent interprets desired musical states rather than repeated instructions for “more” or “less.” It preserves tempo and musical identity, makes at most one gentle adjustment, or returns HOLD when the groove already fits.

Generation and playback delivery are serialized per room. While a change is preparing or awaiting host confirmation, people can keep changing answers. The next eligible check takes the newest distribution; intermediate snapshots are coalesced. A changed snapshot is submitted once. A failed snapshot is not retried repeatedly unless the distribution changes.

## Persistence and compatibility

The existing Poll and Vote tables support the new behavior without a destructive schema change:

- `kind=preference` rows are stable questions with `status=open`, no deadline, and no winning option. Vote's `(pollId, sessionToken)` uniqueness supports answer upserts.
- Internal `kind=crowd` rows save the submitted snapshot in `options`, with no winning option. They track preparation, application, hold, or failure and are linked to generated pattern versions through the existing source field. They are delivery records, not audience polls.
- The room's current version and state document advance only on host confirmation. Applied versions retain recent crowd snapshots, so undo restores that context too.
- On scheduler recovery, older live rooms retire outstanding timed polls and receive the stable questions. Old histories remain stored. Historical poll read endpoints remain for compatibility; the current UI uses `voting.crowd`.
- Legacy room timing columns remain for storage/API compatibility. `pollIntervalSec` still supplies the outro duration; neither field controls crowd checks or question availability.

## Reliability

The server stores changes immediately and broadcasts invalidations to phones and host. Clients refetch authoritative state after changes, reconnects, and phone visibility changes; a 10-second query refresh provides fallback reconciliation.

Only one unresolved update is delivered at a time. Preparation and host confirmation have a shared 60-second deadline; expired candidates are rejected. Model requests have a 25-second timeout per attempt, with at most two attempts. Invalid code or model failure leaves current music playing. Same-code responses and HOLD produce an unchanged outcome.

Candidate creation and host acknowledgement verify the room status, source delivery state, and base version. Undo and end invalidate pending updates, and late generation cannot revive an ended set or overwrite a newer version. Restart reconstructs the set deadline from `startedAt`, restores outro timing, and keeps persistent questions and the last submitted snapshot. A pending candidate remains recoverable by the host; an interrupted generation expires after its delivery deadline.

The configured set length ends the live set, or the host can end early. Input closes when the outro begins. Music stops when the room ends. Phones retain the final distribution, without winners or a decision timeline.

## Validation

Unit and integration coverage includes answer replacement, independent questions, session continuity, public distributions without session identifiers, even splits, unchanged counts, coalescing during slow generation, hold/failure, host confirmation/rejection, stale versions, timeout, undo, restart, and legacy-room recovery.

The browser suite exercises two anonymous phones, host counts, a narrow phone reload, editable choices across music updates, real Web Audio activity, undo, outro, and final playback stop. Production SSR has its own browser suite. Run `bun run verify` before declaring the implementation complete. Real-model musical quality and phrase timing still require a listening session; mock generation only verifies behavior and delivery.

## Text, recording, and moment contributions

Implemented extension: `docs/superpowers/plans/2026-10-28-crowd-contributions.md`.
Preferences remain continuously editable; this does not reinstate timed voting.
A current text direction per phone is translated into schema-validated catalog
choices and reviewed before activation. Signed, expiring review tokens bind the
exact text and interpretation to its room and author. Immutable revisions record
submissions. Repeating a submitted token is idempotent. New revisions coalesce
with crowd checks, and withdrawn/dismissed revisions cannot return after replacement.
Raw text and session identifiers are excluded from music prompts; the agent sees
bounded musical targets. Up to 100 current text directions are admitted per room.
The host can pause text and dismiss individual directions.

Recordings and audience moments start disabled and are controlled separately by
the host. Recordings default to host approval, with one pending clip per phone,
a 30-second submission limit, ten waiting clips per room, twenty across the server, and a 2 MiB upload cap.
MediaRecorder selects a supported browser codec. A single bounded FFmpeg worker
validates and prepares up to three seconds of mono PCM audio, controlling peaks
and edge clicks. Binary uploads use the existing Bun HTTP server, while tRPC
handles metadata and moderation. Room-scoped signed URLs expire after a short
period. Originals and processed files are not a public sample library.

Ready recordings share the one-candidate delivery path. The host decodes before
applying, rechecks candidate eligibility at the musical boundary, and schedules
a trusted Web Audio accompaniment using the Strudel clock. There is one active
crowd sample layer, with a recognizable first appearance and an eight-bar
lifetime enforced by scheduled audio stops as well as server expiry. This layer
is deliberately outside generated code so normal generation cannot accidentally
retain it. Recovery uses the remaining absolute lifetime. Withdrawal, host
removal, undo, and end stop or invalidate the relevant work. Expired and removed
sounds are never restored by undo.

Build/drop/strip-back requests are consumed only on host confirmation, have a
30-second room cooldown, and restore their underlying groove after eight bars.
Restoration may wait for the next phrase or an already preparing update. It runs
while the groove is locked, so locking cannot leave a temporary action stuck.
Unchanged input does not replay consumed events.

All contribution outcomes distinguish receipt from confirmed application.
Directions included in an applied candidate are described as included, rather
than claiming that the model's audible interpretation was independently measured.
Automated verification covers simulated browser capture and real codec processing;
physical phone recording, PA bleed, and real-model musical quality require a
separate rehearsal. Recording remains opt-in for each room.
