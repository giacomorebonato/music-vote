# Conventions

## Stack

- Frontend: React 19 SPA, TanStack Router, TanStack Query, TanStack Form, tRPC (`@trpc/tanstack-react-query`), daisyUI v5 + Tailwind v4
- Backend: `Bun.serve` fullstack server, tRPC v11 fetch adapter, better-auth (Prisma adapter, email/password only)
- Lint/format: Biome; E2E: Playwright

## TypeScript / files

- TypeScript/TSX/config filenames: kebab-case (`note-list.tsx`, not `NoteList.tsx`). React component identifiers stay PascalCase; only file names are kebab-case.
- No vendor-specific instruction filenames (e.g. `CLAUDE.md`) — use `AGENTS.md`.
- Biome `noChildrenProp` is disabled for `frontend/components/note-form.tsx` and `frontend/components/auth-form.tsx` (TanStack Form's `form.Field`/`form.Subscribe` use a children render-prop).
- Placement rules + move verification gate live in `.agents/skills/project-structure/SKILL.md` — see [vertical-slices.md](vertical-slices.md).

## Client state

- Local UI state: React `useState`/`useReducer`.
- Server state stays in TanStack Query — don't duplicate.
- If shared client state becomes necessary later: add a single Zustand store under `frontend/stores/` with a `createStore()` factory wrapping `devtools` middleware.

## Forms

TanStack Form (`useForm`) with Zod schemas passed directly to `validators` (Standard Schema native support — no `@tanstack/zod-form-adapter`). Render fields via `form.Field` render-prop and submit state via `form.Subscribe`.

## Shared schemas

Shared validation schemas live in `shared/schemas/` — single source of truth, reused by both frontend form `validators` and backend tRPC `input(...)`. Example: `noteSchema` in `shared/schemas/note.ts`, consumed by `backend/trpc/notes.ts`.

## Devtools

Unified TanStack devtools shell at `frontend/components/devtools.tsx`, mounted once in `main.tsx`. Panels: Query, Router, Form.

- Dev-only: gated on `process.env.NODE_ENV` (Bun folds it; `import.meta.env` is **not** shimmed in the browser bundle and will throw) + lazy `import()`.
- Prod exclusion: Bun's bundler does not tree-shake dead dynamic imports, so `scripts/build.ts` registers a `Bun.build` plugin that redirects the four `@tanstack/*-devtools` packages to a no-op stub (`frontend/components/devtools-stub.ts`) — keeps ~270KB out of the prod JS.

## Build internals

`scripts/build.ts` bundles with `Bun.build` using `publicPath: "/"` so hashed JS/CSS links are root-relative and work on all SPA routes; Tailwind CSS compiles via `scripts/prod-css.ts`. React Compiler details: [react-compiler.md](react-compiler.md).

## Wiring / endpoints

- Auth base path: `/api/auth` (configured in `backend/auth/auth.ts`)
- tRPC endpoint: `/api/trpc` (configured in `backend/server.ts`)
- SPA client routes: `/`, `/login`, `/notes`
- `Context` type flows from `backend/trpc/context.ts` → `backend/trpc/root.ts` → `shared/trpc.ts` → `frontend/lib/trpc.ts`