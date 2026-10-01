# Final whole-branch review (34 commits, 925fe17..abea287)

Reviewer: `reviewer` agent on `ollama/deepseek-v4-pro:cloud` (run 630529f7).
Verdict: **Fix first** — 0 Critical, 2 Important (both scheduler/end-room seam, both tied to the spec failure table).
Everything else (security, deploy readiness, craft, coverage) was judged clean or already ledger-tracked.
Not re-run by the reviewer: `bun run check` / the Playwright suites (controller runs them at the merge gate).

## Verified as implemented (spec + failure table)

Pages (create/host/vote), poll cycle incl. pre-generated queue with zero LLM latency at open, tally +
seeded tie-break, evolution → code_update → browser eval at the cycle boundary → reportApplyResult,
stateDoc update, host controls, end-poll at 75% (wrap/continue), three end paths → outro for
pollIntervalSec → summary, constants (BPM 60-200, length 5-60 min, interval 60-600 s, POLL_OPEN_SECS 45),
multi-room isolation.

Failure-table rows verified: LLM timeout (last-good + queued question), codegen invalid ×2 (skip+log),
browser eval fail (last-good plays), host WS drop (reconnect re-applies currentCode), phone WS drop
(reconnect + tRPC fallback). Two rows only PARTIALLY hold — see the two Important findings. Server restart
recovery is wired now (`boot.ts` + `server.ts:144`) but has the queue gap in Finding #2.

Security: host ownership enforced on every mutating router procedure; WS host role server-derived from
session vs `room.hostId` (client only picks the channel); no secret in the client bundle. Known/accepted:
anonymous dedup is a soft UX barrier, not a security control (client-minted UUID token, plus the
ledger's `mv_session` re-mint gap); `summary` exposes version code to anyone with a room id; no rate
limiting. Rooms are never GC'd.

Coverage: scheduler/engine/validator/hub/apply-status/room-ws/claim-controller have real unit coverage.
Untested-but-critical: the 75% end-poll → wrap → outro path in a real browser (E2E ends via the host
button), host WS-drop resync in the browser, browser-eval-failure end-to-end, LLM provider error paths,
real Ollama musicality (manual by design). No stub-theater regressions found.

## IMPORTANT #1 — Host ends the set while the LLM is down → zombie room (spec failure-table violation)

`backend/rooms/service.ts:151-173` (`endRoom`): `disarmScheduler(roomId)` and `closeOpenPoll(roomId)` run
BEFORE `engine.generateOutro(...)`. With the LLM down, `generateOutro` throws `MusicGenError` after 2
attempts (`engine.ts:113-120`, `tryGenerateCode` swallows provider exceptions). Result: mutation rejects,
but the scheduler is already disarmed and the poll already closed; the room stays `status: 'live'` with no
scheduler, no end timer and no polls — music keeps playing, the host sees only an error toast, and nothing
re-arms the room. The spec promises "Ollama entirely down → polls still run from pre-generated queue".

Smallest fix (spec-consistent): on outro-generation failure, restore the room to a normal live polling
state — re-arm the scheduler and make sure the question queue is replenished (the close consumed it), so
the set keeps running and the host can retry End later. Do not leave the failure to the caller.

## IMPORTANT #2 — `restoreSchedulers` overdue close never replenishes the question queue

`backend/polls/scheduler.ts:463-481`: the overdue branch does a raw `prisma.poll.update` to `closed` +
`publishAudience` (audience only), bypassing `closePoll` → `queueNextEvolution` never runs. Because the
design keeps the queue at ≥1 only BEHIND an open poll (the next question is generated when a poll closes),
a crash while a poll was open leaves nothing queued. After restore: `armLive` → `openNextQueuedPoll` finds
nothing and `liveTick` (scheduler.ts:168-190) only opens queued polls — it never generates questions — so
evolution polls stop for the rest of the set (only the 75% end-poll still fires). The non-overdue path
(`armExistingPollClose` → `closePoll`) replenishes correctly; only the overdue branch is broken.

Evidence: the restore tests (scheduler.test.ts:471,513,608) assert "closed no-change + armed" but never
assert that a subsequent poll opens.

Smallest fix: after the overdue close in `restoreSchedulers`, replenish the queue (call
`queueNextEvolution(room.id, room)`, or route the overdue close through a path that pre-generates) before
arming.

## MINOR (controller triage)
- `reportApplyResult` (`service.ts:227-230`) takes no `hostId` and does no ownership check, unlike every
  sibling service function — enforced only at the router boundary. Latent defense-in-depth gap. → FIX NOW
  (cheap, same file as Finding #1).
- `updateRoomDoc` runs at candidate creation (`scheduler.ts:388`), not at `applied`, so a browser-rejected
  evolution still lands in `stateDoc.history`/`nextElements` (the spec lists the doc update after apply).
  → DEFER with an explicit ledger note: the change is compile-validated and browser-rejected evolutions are
  rare; moving the update to the apply path is a real refactor of verified code late in the cycle.
- Outro finalize uses a raw untracked `setTimeout` (`service.ts:172-174`) outside the scheduler's `active`
  map → DEFER (fires once, status-guarded).
- `rooms.get` returns a `versions` payload the host page never reads → DEFER (harmless dead payload).
- Cumulative severity of the known-deferred list: judged ACCEPTABLE to ship; none compound into a
  venue-critical failure.

## Residual risks the humans should know

1. The vote is not really one-per-person: clearing the cookie / minting a fresh token lets someone vote
   repeatedly. That is the accepted anonymous design (explicit non-goal), but a motivated crowd can tip a poll.
2. A restart mid-poll or an LLM outage at "End set" could silently stop the remaining polls on the
   unfixed paths — the two Important fixes close those specific paths.
3. The summary's "music changed" is optimistic: the `applied` flag ignores version status, so a
   rejected-compile poll can still claim it changed the music (cosmetic, already ledger-tracked).
