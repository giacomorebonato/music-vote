# Host steering — design

Updated: 2026-10-31. Feature: the party host (the room creator) can steer the
music agent with a free-text note when the music is not right.

## Intent

The admin for a party is the person who created the room — no new role and no
new route guard exist; every privileged backend check already compares
`room.hostId` with the session user. The host console therefore gets one new
capability: a **Steer the music** note, sent to the model, which regenerates the
current pattern with that direction applied.

The note is **consumed when used**: it is delivered once through the existing
candidate path, then it is gone. Raw note text never persists server-side; the
host keeps the text in the input so a failed generation is an adjust-and-retry,
not a lost note.

## Behavior

- Works only on a live room with playing music (`status=live`, `currentCode`
  set) and only for the owner.
- Works while the groove is locked — steering is the host's complement to the
  crowd loop, mirroring the manual performance controls.
- Serialized: while another change is preparing (crowd candidate, recording,
  moment, steering, performance layer), a steer attempt is rejected with
  "wait for the current musical change to finish". Same rule inside the
  scheduler: a steering claim blocks a crowd submission until it resolves.
- One claim covers claim → generation → delivery. A generation failure (2
  bounded attempts, existing compile validation) releases the slot and reports
  the error; the current pattern keeps playing.
- A model `HOLD` (or a response identical to the current code) resolves the
  claim as `unchanged`, and the host sees "the model kept the groove". The note
  stays in the input for rewording.
- The delivered candidate flows the same path as every other change: WS
  `code_update` → host browser applies at the next phrase → confirmation
  advances the version chain → Undo and End still work. Steering while a steer
  was just claimed is impossible (serialization above).
- Audience phones never see the note and get no audience-facing event from
  steering itself; the eventual `music_result` refresh after playback
  confirmation is the same one every change already sends.

## Non-goals

- No standing/stored prompt templates, no per-room prompt library, no schedule.
- No mid-set BPM or genre changes: tempo is pinned in every prompt and anchor.
- No audience visibility of steering; the crowd preference loop is untouched.

## Approach taken

- New `rooms.steer` tRPC mutation (`steerSchema` in `shared/schemas/room.ts`:
  `roomId`, `text` 3–200 chars trimmed).
- `steerRoom` in `backend/rooms/service.ts` follows `perform()`'s shape:
  claim a `kind=performance` poll row (`question='steer'`,
  `deliveryStatus='preparing'`) in a transaction, generate outside the
  transaction with the new `generateSteeredPattern` engine call, then re-guard
  the claim in a second transaction (status/base-version/preparing checks,
  mirroring the scheduler's `prepareUpdate`) before creating the candidate.
- `buildSteerPrompt` in `backend/music/prompts.ts` reuses the few-shot, sound
  palette and code-only rules; the host note overrides crowd preference
  interpretation for that one regeneration.
- Host console: textarea + Steer button (console only, not the projector view);
  toast on sent/held/failed; text cleared only on a delivered candidate.
- Mock LLM: `steerResponses` script key (falls back to `responses`), routed by
  prompt prefix, so offline/e2e runs stay deterministic.