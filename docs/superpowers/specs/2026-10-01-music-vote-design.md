# music-vote — Design Spec

Date: 2026-10-01
Status: Approved design, pending user spec review

## Summary

music-vote is a web app where a host creates a live music room, and an audience
at the venue votes on AI-generated polls to democratically steer an
AI-generated Strudel (live-coding) performance in real time. Music plays from
the host's browser through the venue sound system. Phones are voting devices
only, joining via QR code with zero login friction.

**Core loop:** poll opens on phones → audience votes yes/no on a musical
direction ("should this sound more 80s?") → winning answer is interpreted by
an LLM into new Strudel code → code is validated and applied live at a cycle
boundary → music evolves. At song end, an AI outro closes the piece and the
room shows a timeline of every vote that shaped it.

## Goals

- Host creates a room in under a minute (genre/vibe, BPM, song length, poll
  interval) and gets a QR code.
- Audience scans QR, votes immediately. No login, one vote per poll per phone.
- Music changes live, at cycle boundaries, without interrupting playback.
- Host has real-time controls: undo last change, skip poll, end song early.
- Song ends via AI outro (3 trigger paths) with a vote-summary screen.
- Multi-room: N concurrent rooms, isolated, same per-room state machine.

## Non-goals (MVP)

- Remote audio streaming — audience never hears audio on phones (Strudel runs
  in host browser only; venue sound via host's output → PA).
- Tigris/S3 storage — dropped; no binary assets stored (pending spike on
  sound bank loading, which may bundle samples in-repo instead).
- Jev-style decision models (Ollama `nimble`/`tev1`) — evaluated, wrong tool
  for generative tasks; possible later use for "which dimension to poll next".
- Audience accounts, vote weighting, per-voter identity — anonymous session
  tokens only.
- Playback continuation across host browser crashes — reconnect re-applies
  current code; playback resumes, does not restore exact phase.

## Tech stack

Base: **mino-starter** (Bun, React, tRPC, better-auth, Prisma, daisyUI,
Tailwind, Fly.io deploy, Biome, Playwright).

Added:
- `@strudel/web` (audio engine, embedded in host page, AGPL v3)
- `@strudel/transpiler` (server-side compile validation, AGPL v3)
- `qrcode` (QR generation)
- Ollama client (cloud subscription in prod; local Ollama in dev — same API
  shape) behind a thin provider interface so tests never call a real LLM.

**License constraint:** embedding Strudel (AGPL v3) requires this repo to be
open source. Decision: repo goes public.

## Architecture

```
Phones (QR, anonymous)          Fly server (Bun + mino-starter)         Host browser (auth'd)
   │  vote via tRPC  ──────►  RoomService                             ◄──── WS: code updates
   │  WS: poll push      │       PollScheduler (per-room timers)           embeds @strudel/*
   │                      │       MusicEngine (Ollama calls)                audio engine → PA
   │                      │       CodeValidator (@strudel/transpiler)       undo/skip/end controls
   │                      │       RealtimeHub (WS fan-out per room)
   ▼                      ▔ Prisma: rooms, polls, votes, pattern versions
```

Principles:
- Server = conductor + single source of truth for room state.
- Host browser = "dumb audio terminal": applies validated code, holds undo
  stack, is the only place sound happens.
- Phones = vote buttons. WebSocket push, tRPC fallback on reconnect.
- LLM calls happen server-side only. API keys never leave server.

### Components (backend)

- **RoomService** — lifecycle: create, start, end; owns room status machine:
  `lobby → live → outro → ended`.
- **PollScheduler** — per-room in-memory timers backed by DB state. Opens
  polls on interval, closes them, triggers the evolution step. Restores
  timers on server restart from DB (polls are timestamped, not tick-based).
- **MusicEngine** — all LLM orchestration: initial pattern generation, poll
  question generation (maintains a queue ≥ 1 question ahead), evolution
  codegen, outro generation. Builds prompts from the room's musical state
  doc.
- **CodeValidator** — server-side `@strudel/transpiler` compile check.
  Catches syntax/semantic errors before code ever reaches the host browser.
- **VoteService** — tally with dedup via unique(pollId, sessionToken).
- **RealtimeHub** — per-room WS channels: audience channel (poll open/close
  push), host channel (code updates, live vote counts).

### Components (frontend)

- **Create page** (auth'd): genre/vibe, BPM, length, poll interval → room.
- **Host page** (auth'd, `/r/:id/host`): embeds Strudel, shows current code +
  live vote counts + QR code; buttons: undo, skip poll, end song.
- **Vote page** (anonymous, `/r/:id`): current poll, two big buttons (yes/no),
  countdown, "waiting for next poll" idle state, "song ended" summary link.
- **Ended screen**: timeline of all polls, winners, applied changes.

## Data model (Prisma)

```
Room
  id, hostId (auth user), bpm, lengthSec, pollIntervalSec, genre,
  status: lobby | live | outro | ended,
  currentCode, stateDoc (Json), createdAt

Poll
  id, roomId, question, options (Json: [{key, label}]),
  openedAt, closesAt, status: open | closed, winningOption

Vote
  id, pollId, sessionToken, choice
  unique(pollId, sessionToken)

PatternVersion
  id, roomId, code, source: initial | pollId,
  status: candidate | applied | rejected | reverted,
  appliedAt
```

`stateDoc` = JSON: musical summary the LLM reads as context — genre, BPM,
current elements (drums/bass/melody/harmony/sound design), change history
(poll question, winner, what changed), and dimensions already polled (to avoid
repetition and pace the evolution, e.g. don't add a lead melody 30 seconds
after adding one).

## Room lifecycle + poll cycle

### Start

1. Host creates room (params validated: BPM 60–200, length 5–60 min, poll
   interval 1–10 min).
2. MusicEngine generates initial Strudel pattern from genre+BPM+length.
3. Validation pipeline (below). On pass: code pushed to host browser,
   playback starts, status `live`, QR shown.

### Poll cycle (repeats on interval)

1. Scheduler opens next poll — question already pre-generated during the
   previous cycle (queue ≥ 1). **Zero LLM latency at poll open.**
2. WS push to phones; votes arrive via tRPC; VoteService tallies with dedup.
3. Poll closes; winner determined (tie → random pick with seed logged).
4. MusicEngine: winner + stateDoc + currentCode → LLM → **new full pattern**
   (not a diff — diffs are error-prone; full pattern regeneration is simpler
   and Strudel replaces patterns atomically anyway).
5. CodeValidator compile-check. Fail → one regeneration retry → still fail
   → keep last-good pattern, log, poll marked "no change".
6. Push candidate to host browser → **real eval in browser sandbox** →
   apply at next cycle boundary (Strudel-native pattern swap). Fail →
   reject version server-side, keep last-good.
7. stateDoc updated with the change; next poll question pre-generated;
   scheduler waits for the next interval.

### Host controls (any time during `live`)

- **Undo** → server pushes previous applied PatternVersion → browser
  re-applies at cycle boundary. Marks version reverted.
- **Skip poll** → closes open poll without applying a change.
- **End song** → immediate outro (below).

### Ending — 3 paths, all end in an outro version + `ended`

1. **Length target reached** → MusicEngine outro prompt (filter sweep, drop
   elements, resolve) → final pattern applied → after outro duration (≈
   pollIntervalSec), playback stops, `ended`.
2. **Democratic end-vote** → at 75% of length, one deterministic end-poll
   ("wrap it up or keep going?"). "Wrap up" wins → outro.
3. **Host ends early** → immediate outro.

`ended` screen: summary timeline of all polls + winners + code snapshots per
version (all in DB already).

## Validation pipeline (every code change)

1. **Server compile-check** (`@strudel/transpiler`) — catches broken code
   before network transit. One retry on failure.
2. **Browser sandbox eval** — host page evals the candidate in an isolated
   Strudel instance before swapping the live one; errors reported to server,
   version marked rejected.
3. **Apply at cycle boundary** — live pattern swap only happens on a cycle
   boundary (Strudel's natural update point), so transitions sound musical,
   never mid-bar glitches.

## Failure handling

| Failure | Behavior |
|---|---|
| LLM timeout | Music keeps playing last-good. Pre-generated question queue covers the next poll. Background retry. |
| Codegen invalid ×2 | Skip change. Poll closed normally, music unchanged, logged. |
| Browser eval fail | Version rejected server-side, last-good keeps playing. |
| Host WS drop | Music stops (browser is the audio engine — documented limitation). Reconnect re-applies `currentCode`, playback resumes. Room state survives on server. |
| Phone WS drop | Auto-reconnect + tRPC fetch fallback for current poll state. |
| Ollama entirely down | Polls still run from pre-generated queue. Music frozen at last-good. Warning surfaced to host page. |
| Server restart | PollScheduler rebuilds timers from DB (polls timestamped). Host browser reconnects, re-applies currentCode. |

## LLM provider layer

- Thin interface: `generateChat(prompt, opts) → string`. Implementations:
  Ollama cloud (prod, subscription key via Fly secret), local Ollama (dev,
  `localhost:11434`).
- Model choice configurable per room? No — single app-level config for MVP.
- **All tests mock the provider.** Real Ollama = manual musicality checks
  only (taste is not automatable).
- Prompt assets live in-repo as templates with fixtures: initial pattern,
  poll question, evolution, outro. Evolution prompt includes few-shot
  Strudel examples + stateDoc.

## Multi-room

Per-room PollScheduler instances (in-memory timers) with DB as source of
truth. Fly single machine MVP. Scaling out later = room→machine assignment
(out of scope; noted, not built).

## Testing

- **Unit:** vote tally + dedup, poll scheduler timing + restore-from-DB,
  stateDoc update logic, prompt builders (snapshot), CodeValidator against
  golden Strudel snippets (valid + broken fixtures), room status
  transitions, all 3 end paths.
- **E2E (Playwright):** create room → QR page renders → open poll → vote
  from two "phones" → dedup enforced → winner applied (mock LLM returns
  fixture pattern) → host undo works → end song → summary screen.
- **Spikes (first implementation tasks, throwaway-adjacent but in repo):**
  1. `@strudel/web` embed: confirm cycle-boundary swap API works in React,
     mirror REPL internals (`strudel.cc/technical-manual/project-start`).
  2. Sound bank loading: CDN fetch vs bundled samples — a venue may have bad
     wifi; bundled is safer if size is sane.
  3. Server-side `@strudel/transpiler` compile-check works headless in Bun.

## Decisions log

- Venue-only audio: host browser → PA. Phones never stream audio.
- Audience: no login. Anonymous session token cookie on QR hit.
- Votes in Prisma DB (not file) — enables dedup, summary, and costs nothing.
- Full-pattern regeneration over diffs.
- Tigris, Jev models dropped from MVP.
- AGPL compliance: repo public.
- Ollama cloud prod + local dev behind one provider interface.

## Open questions (non-blocking, resolve during implementation)

- Exact Strudel sound bank size/bundling strategy (spike 2 decides).
- Outro duration: fixed vs derived from BPM (pick during implementation,
  document in code).