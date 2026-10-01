### Task 12: Host page (controls, QR, live counts)

**Files:**
- Create: `frontend/routes/host.tsx`, `frontend/routes/create.tsx`, `frontend/components/qr-code.tsx`, `frontend/lib/room-ws.ts`, `frontend/components/poll-monitor.tsx`
- Modify: `frontend/router.tsx` (routes: `create`, `/r/$id/host`)

**Interfaces:**
- Consumes: `roomsRouter` (Task 8), `votingRouter.claimSession` not needed here; `WsEvent` + `/ws?room=` client (Task 7), `StrudelPlayer` (Task 11), `qrcode` dep.
- Produces: `frontend/lib/room-ws.ts` → `useRoomChannel(roomId, opts: { onEvent: (e: WsEvent) => void }): { connected: boolean }` (auto-reconnect, backoff 1s→10s).
- Host page behavior: on mount fetch `rooms.get` → render `StrudelPlayer` with `code=currentCode`; on WS reconnect (spec failure row "Host WS drop"): refetch `rooms.get` and re-apply `currentCode` via `applyPattern`; `code_update` events → `applyPattern` → `onApplyResult` → `rooms.reportApplyResult({roomId, versionId, ok, error})`; buttons undo/skip/end → tRPC mutations; QR = `${origin}/r/${roomId}`; `vote_count` → PollMonitor bars; `warning` → toast; ended → link to summary. Create page: form (genre, BPM, length, interval) → `rooms.create` → navigate to host page → start button.

- [ ] **Step 1: Failing unit test** — `qr-code.test.ts`: renders `<img>` with data URL prefix `data:image/png` for input URL; `room-ws` test: fake `WebSocket` (injected factory) — reconnects after close, calls onEvent for message.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** all files + router entries + `qrcode` dep.
- [ ] **Step 4: Verify** — `bun test frontend` PASS; `bun run check`; **manual with local Ollama**: create room (house, 120bpm, 10min, 1min interval), start, hear music, QR scans to vote page, vote steers audio, undo works, end → outro → stopped.
- [ ] **Step 5: Commit** — `git commit -m "feat(host): create room, host console — strudel, controls, qr, live counts"`.

