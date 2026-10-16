---
name: project-structure
description: Verifies the project directory structure stays intact when a new file is added or an existing file is moved. Fires on "where do I put", "new component", "new route", "new tRPC procedure", "new test", "move file", "rename file", "refactor folder structure". Encodes the placement rules for frontend, backend, shared, e2e, and scripts so files land in the right dir with the right name and existing references stay wired.
---

# Project Structure

mino-starter has a fixed, small directory layout. Keep it intact. When adding or
moving a file, place it where the rules below say, then run the verification
gate at the end. Do not invent new top-level dirs or split existing dirs
prematurely.

## Top-level layout (fixed)

```
backend/    Bun.serve fullstack server, tRPC, auth, db
frontend/   React 19 SPA — components, routes, lib, app entry
shared/     Code imported by both sides — schemas, tRPC type re-export
e2e/        Playwright specs + global setup
scripts/    Build / prod tooling
docs/       Agent deep docs (docs/agents/*.md), linked from AGENTS.md
```

No `src/`. No other top-level dirs without explicit approval. `AGENTS.md`,
`README.md`, `LICENSE`, `Dockerfile`, `fly.toml`, root configs are the only
files allowed at repo root.

## Placement rules

| Adding…                       | Location                                                        | Wiring                                           |
| ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| React component               | `frontend/components/<name>.tsx`                                | import from `@frontend/components/…`             |
| Route component               | `frontend/routes/<name>.tsx`                                    | register in `frontend/router.tsx` `routeTree`    |
| tRPC route (router)           | `backend/trpc/<name>.ts`                                        | mount in `backend/trpc/root.ts` `appRouter`      |
| Shared Zod schema             | `shared/schemas/<name>.ts`                                      | reuse in tRPC input + TanStack Form `validators` |
| Backend helper (server-level) | `backend/<name>.ts`                                             | e.g. `normalize-trpc-request.ts`                 |
| Backend auth/db module        | `backend/auth/` or `backend/db/`                                | only if it grows past one file                   |
| Unit test                     | `__tests__/<source-name>.test.ts` **co-located next to source** | see below                                        |
| E2E test                      | `e2e/<name>.spec.ts`                                            | `e2e/global-setup.ts` for shared setup           |
| Build script                  | `scripts/<name>.ts`                                             | add to `package.json` scripts if runnable        |

## Co-located unit tests (enforced)

Every unit test nests in a `__tests__/` dir **directly next to its source
file**. Never use a single root test bucket.

```
backend/trpc/notes.ts            → backend/trpc/__tests__/notes.test.ts
backend/normalize-trpc-request.ts → backend/__tests__/normalize-trpc-request.test.ts
shared/schemas/auth.ts            → shared/schemas/__tests__/auth.test.ts
```

If you move a source file, move its `__tests__/` with it. A source file
without a test is acceptable; a test far from its source is not.

## Filenames

- TypeScript / TSX / CSS / config filenames: **kebab-case**
  (`note-list.tsx`, not `NoteList.tsx`). Component identifiers stay PascalCase;
  only the file name is kebab-case.
- Conventionally uppercase docs are the only exceptions: `AGENTS.md`,
  `README.md`, `LICENSE`.
- Use named exports for `.ts`/`.tsx` (Playwright specs exempt).
  Don't add `export default` to app code.

## Do not (without explicit reason)

- Add a new top-level dir (`src/`, `lib/`, `utils/`).
- Introduce another HTTP framework dir (Express/Hono/Fastify/Elysia) —
  `requirements.txt` forbids it.
- Split `frontend/components/` into subdirs until it passes ~12 files (the
  3-file devtools group can become `frontend/components/devtools/` then).
- Flatten `backend/auth/` or `backend/db/` to a bare file unless they will
  never grow.
- Create a `src/` or move code into `app/` / `pages/` conventions from other
  frameworks.

## Verification gate (run after every add/move)

```sh
bun fmt             # Native formatter (writes fixes)
bun lint            # Native linter (verify-only)
bun check           # Native type checker — catches broken imports / references
bun x --no-install knip        # catches now-unused exports / dead files after a move
bun run test --parallel # unit tests still resolve from new paths
# or all at once: bun run verify
```

A move is not done until all checks pass. If `knip` flags the moved file as
unused, re-check that every importer was updated to the new path. If `knip`
flags an export as unused, the move likely orphaned it — re-wire the
importer.

## Common move pitfalls

- Moving a source file but leaving its `__tests__/` behind → move the test
  too.
- Moving a tRPC router file but not updating `backend/trpc/root.ts` → knip
  flags it, fix the mount.
- Moving a shared schema but not updating frontend form `validators` or
  tRPC `input(...)` → typecheck fails, fix both importers.
- Moving a frontend component but not updating the route that renders it →
  typecheck fails.
- Renaming a file without updating the `@backend/*` / `@frontend/*` /
  `@shared/*` alias imports → typecheck fails.

## When the layout genuinely needs to change

If a real need outgrows this layout (e.g. `shared/` gains a `types/` family,
`frontend/components/` splits by feature), propose the change to the user
first, update this file, then make the move. This skill documents the
contract — do not silently let it drift.
