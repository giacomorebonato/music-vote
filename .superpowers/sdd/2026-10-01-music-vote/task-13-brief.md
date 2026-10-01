### Task 13: Vote page (poll UI, states, summary)

**Files:**
- Create: `frontend/routes/vote.tsx`, `frontend/components/poll-card.tsx`
- Modify: `frontend/router.tsx` (route `/r/$id`)

**Interfaces:**
- Consumes: `votingRouter` (Task 10), `useRoomChannel` (Task 12), `WsEvent`.
- Produces: vote page states — lobby: "waiting for the DJ"; live no poll: countdown to next (from last closesAt or interval); poll open: question + Yes/No buttons + closesAt countdown, disabled after vote with "vote counted"; ended: summary timeline via `votingRouter.summary` (**Review Focus #5** second half). On mount: `claimSession()` then `currentPoll`; `poll_opened`/`poll_closed`/`room_ended` events drive transitions; WS drop → tRPC `currentPoll` refetch on reconnect.

- [ ] **Step 1: Failing unit test** — `poll-card.test.ts`: renders question text + two buttons; disabled + "vote counted" after `onVote`; countdown prop renders `m:ss`. Vote page state test: with mocked router/trpc — lobby → waiting copy; ended → summary list from mocked `summary` query.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** page + card + route.
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(vote): anonymous vote page — poll, countdown, ended summary"`.

