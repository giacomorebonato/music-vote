# Adding a Feature (Vertical Slice)

1. `shared/schemas/<name>.ts` — Zod schema (single source of truth)
2. `backend/trpc/<name>.ts` — router using the schema as `input`; mount in `backend/trpc/root.ts` `appRouter`
3. `frontend/routes/<name>.tsx` — route; register in `frontend/router.tsx` `routeTree`. Add components under `frontend/components/`
4. `__tests__/<source>.test.ts` — co-located next to each source (backend + frontend)
5. `e2e/<name>.spec.ts` — Playwright spec
6. `bun run check` (and `bun run check:full` if UI/auth/route changes)

Placement rules + the move verification gate live in `.agents/skills/project-structure/SKILL.md` — follow both.