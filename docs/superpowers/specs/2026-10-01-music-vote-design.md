# music-vote — Design Spec

Updated: 2026-10-27. Continuous crowd preferences supersede the original timed majority-vote design and the timed-round portions of the 2026-10-16 party-experience plan.

## Experience

A host chooses genre, BPM, and set length, starts music in their browser, and shares a QR code. Audience phones join without accounts or audio playback. The host browser plays Strudel through the venue sound system.

Three stable questions remain available for the whole live set:

- Energy: mellow / balanced / intense.
- Rhythm: steady / flowing / busy.
- Mood: dark / warm / bright.

Answer any subset, at any time. A phone's latest answer replaces its previous answer for that question. Saved selections survive reloads through the existing anonymous session cookie. Preferences remain until changed or the set ends; locking a phone or losing its socket does not remove its answers.

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
