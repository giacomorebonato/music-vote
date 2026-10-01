# Task 7 Report — RealtimeHub + WS wiring

## What was implemented

- `shared/realtime/events.ts` — discriminated union `WsEvent` with the exact event types from the brief:
  - audience: `poll_opened`, `poll_closed`, `room_ended`
  - host: `code_update`, `vote_count`, `room_status`, `warning`, `pattern_rejected`
- `backend/realtime/hub.ts` — `createRealtimeHub()` returning `RealtimeHub` with:
  - `joinRoom(ws, roomId, role, isHost)`
  - `onClose(ws)` (used by the server close handler)
  - `publishAudience(roomId, event)` and `publishHost(roomId, event)`
  - JSON frame protocol
  - `createWsUpgradeHandler({ resolveRole })` — injectable role resolver so tests can stub auth
- `backend/server.ts` — added Bun `websocket` handlers and a `/ws` upgrade path:
  - dev: `/ws` added to the existing `routes` map, matched before the `/*` HTMLBundle wildcard; the route function calls `server.upgrade(req, { data })` and returns `undefined` on success
  - prod: `fetch` handler checks `url.pathname === '/ws'` and runs the same upgrade; falls through to the existing SPA/static handlers for other paths
  - host role is resolved by `auth.api.getSession(req.headers)` + `prisma.room` host check; room must exist; host iff session user id matches `room.hostId`; authenticated non-owner gets 403 and the connection is closed; anonymous sessions become audience
- `knip.json` — added `// @public` annotations to the public realtime API exports instead of changing entry patterns; keeps knip green while leaving the interface discoverable for Tasks 8/9/10/12/13

## TDD evidence

RED (before implementation):

```
$ bun test backend/realtime/__tests__/hub.test.ts
[FAIL] ERRORS:
  error: Cannot find module '@backend/realtime/hub' ...
SUMMARY: 0 pass, 1 fail, 1 error
```

GREEN (after implementation):

```
$ bun test backend/realtime/__tests__/hub.test.ts
SUMMARY: 3 pass, 0 fail
```

Full suite:

```
$ bun run check
...
79 pass
0 fail
✓ all checks passed
```

## Files changed

- `shared/realtime/events.ts` (created)
- `backend/realtime/hub.ts` (created)
- `backend/realtime/__tests__/hub.test.ts` (created)
- `backend/server.ts` (modified)
- `knip.json` (modified)

## Self-review findings

- Dev route map still serves `/api/trpc/...`, `/`, and returns 404 for an unknown room on `/ws`.
- Prod `fetch` path still serves `/api/...`, `/`, and `/ws` (verified after `bun run build`).
- Host event isolation: audience client receives `publishAudience`, does not receive `publishHost`.
- Non-owner host attempt: injected resolver returns an error response → WebSocket is closed (`readyState === CLOSED`).
- `WsEvent` union matches the brief exactly.
- No scope beyond the brief; the `onClose` helper is internal wiring only.

## Concerns

1. **Biome nursery warnings:** The test file triggers `useExplicitReturnType` on four small arrow functions. These are warnings, not errors, and the project already carries many identical warnings in frontend files. They do not block `bun run check`.
2. **Knip public API:** The realtime exports are marked `@public` because Tasks 8/9/10/12/13 are the consumers. Once those tasks land, the `@public` markers can be reviewed and possibly removed.

## Fix (post-controller ruling)

**What changed:**
- `backend/server.ts`: production resolver no longer closes authenticated non-owner sessions. Now: owner → host; everyone else (authenticated non-owner or anonymous) → audience. Only nonexistent-room joins are closed.
- `backend/realtime/__tests__/hub.test.ts`: replaced the "non-owner gets closed" test with two tests:
  - `authenticated non-owner joins audience channel, not host` — asserts the socket receives `publishAudience` and does not receive `publishHost`.
  - `nonexistent room join is rejected and connection closed` — keeps the original closed-connection behavior for missing rooms.

**Commands:**
```
bun test backend/realtime/__tests__/hub.test.ts
bun run check
```

**Output:**
```
SUMMARY: 4 pass, 0 fail
...
80 pass
0 fail
✓ all checks passed
```

**Concerns resolved:** Authenticated non-owners now correctly join the audience channel so registered users scanning the QR code can vote.

## Fix round 1 (review findings)

**Finding 1 — prod `/ws` return value:**
- `backend/server.ts` prod `fetch` branch changed from returning `new Response(null, { status: 101 })` after a successful upgrade to `return await handleWs(req, server)`.
- Bun's docs say to return `undefined` after `server.upgrade`; the previous code risked a post-hijack invalid Response.
- Confirmation: `bun -e "new Response(null, { status: 101 })"` constructs the Response with status `101` in this Bun version and does not throw at construction time, but returning it from the fetch handler after a WS upgrade is still the wrong pattern, so the fix was applied.

**Finding 2 — single hub instance:**
- `backend/server.ts` now imports the singleton `hub` from `@backend/realtime/hub` instead of creating a separate `createRealtimeHub()` instance.
- `backend/realtime/hub.ts` remains the single source of truth; Tasks 8/9/10/12/13 will import this same singleton.

**Finding 3 — prod role resolver + non-vacuous channel isolation test:**
- Extracted `createProdRoleResolver({ getSession, findRoom })` in `backend/realtime/hub.ts` with minimal `SessionLike`/`RoomLike` types for testability.
- `backend/server.ts` wires it to `auth.api.getSession` and `prisma.room.findUnique`.
- Added four direct unit tests for the resolver: owner → host, non-owner → audience, anonymous → audience, missing room → 404.
- Replaced the vacuous non-owner test with a non-vacuous integration test that holds both a host and an audience socket in the same room and asserts channel isolation.

**Commands:**
```
bun test backend/realtime/__tests__/hub.test.ts
bun run check
bun run build && NODE_ENV=production PORT=3458 bun backend/server.ts
```

**Output:**
```
SUMMARY: 7 pass, 0 fail
...
83 pass
0 fail
✓ all checks passed
```

**Prod probe (after build):**
- `/api/trpc/public.siteInfo` → 200
- `/` → 200
- `/ws?room=missing` with Upgrade headers → 404
