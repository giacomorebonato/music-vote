### Task 7: RealtimeHub + WS wiring

**Files:**
- Create: `shared/realtime/events.ts`, `backend/realtime/hub.ts`, `backend/realtime/__tests__/hub.test.ts`
- Modify: `backend/server.ts` (add `websocket` handler + `/ws` upgrade; keep existing route map intact)

**Interfaces:**
- Produces: WS event types — audience: `poll_opened {poll}`, `poll_closed {pollId, winningOption|null}`, `room_ended`; host: `code_update {code, versionId, kind:'initial'|'evolution'|'undo'|'outro'}`, `vote_count {pollId, yes, no}`, `room_status {status}`, `warning {message}`, `pattern_rejected {versionId, error}` (discriminated union `WsEvent` in `shared/realtime/events.ts`).
- Produces: `hub.joinRoom(ws, roomId, role, isHost)`; `hub.publishAudience(roomId, event)`; `hub.publishHost(roomId, event)` — in `backend/realtime/hub.ts`. Host-channel join verified against better-auth session (cookie on upgrade) + room ownership; audience join open.
- WS URL: `/ws?room=<roomId>`; role derived server-side (host iff session matches room host).

- [ ] **Step 1: Failing tests** — hub.test.ts (Bun WS client): two audience clients on room A receive `publishAudience`; host event on room A not delivered to audience client; non-owner session attempting host join gets closed. (Real sockets against `Bun.serve` in test.)
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** hub + server.ts wiring.
- [ ] **Step 4: Run** — PASS; `bun run check` (verify dev route map + prod fetch both still serve — start server in test mode).
- [ ] **Step 5: Commit** — `git commit -m "feat(realtime): per-room ws hub, audience/host channels"`.

