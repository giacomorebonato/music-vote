### Task 10: VoteService + voting tRPC router

**Files:**
- Create: `backend/votes/service.ts`, `backend/trpc/voting.ts`, `backend/votes/__tests__/service.test.ts`
- Modify: `backend/trpc/root.ts` (compose `voting:`)

**Interfaces:**
- Consumes: prisma models, hub (vote_count push on tally change).
- Produces service: `claimSession(): { token: string }` (cookie `mv_session`, httpOnly, 24h — set via tRPC context response headers); `castVote(pollId, token, choice)`: poll must be `open` + not closed by closesAt; dedup on unique constraint → `ALREADY_VOTED` error; then `publishHost(vote_count)`.
- Produces router `votingRouter` (all publicProcedure): `claimSession`, `currentPoll(input {roomId})` → `{ poll: {id, question, options, closesAt} | null, roomStatus }`, `castVote(input {pollId, choice})`, `summary(input {roomId})` → `{ polls: [{question, winningOption, applied: boolean}], versions: [{code, appliedAt, source}] }`.

- [ ] **Step 1: Failing tests** — service.test.ts: claimSession sets cookie header; castVote on closed poll → error; second vote same token → `ALREADY_VOTED` (friendly, not P2002 leak); vote after closesAt rejected; vote_count event pushed. Router test: `currentPoll` on lobby room → null + lobby (**Review Focus #5** half), on ended → null + ended.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** service + router + root composition.
- [ ] **Step 4: Run** — PASS; `bun run check`.
- [ ] **Step 5: Commit** — `git commit -m "feat(votes): anonymous session, dedup, voting router"`.

