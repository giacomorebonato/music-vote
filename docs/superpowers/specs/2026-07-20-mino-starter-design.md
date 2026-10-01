# mino-starter: reusable full-stack starter design

Date: 2026-07-20
Topic: Bun fullstack starter (auth + notes CRUD)

## Purpose

Reusable full-stack web project starter. Proves the stack wires end-to-end with a minimal demo: better-auth email/password + a small notes CRUD resource. Template, not a product.

## Stack (fixed by requirements.txt)

- Bun: runtime, package manager, bundler, test runner
- daisyUI v5 + Tailwind v4 (CSS-first config)
- SQLite
- tRPC v11 + @trpc/tanstack-react-query
- better-auth + @better-auth/prisma adapter
- Prisma ORM
- React 19 SPA only, no SSR
- Biome (lint + format): no semicolons, trailing comma all, single quotes
- Playwright E2E
- APM (Agent Package Manager) for skills/MCP
- Fly.io deployment via Dockerfile

### Not used

- No Express/Fastify/Hono/Elysia
- No Vite
- No NPM/PNPM
- No vendor-specific filenames (CLAUDE.md etc.)

## Architecture

Single `Bun.serve` process in `backend/server.ts`. Approach A: Bun fullstack server.

### Routes

- `/` → `frontend/index.html` (Bun HTML import bundles TSX/CSS)
- `/api/trpc/*` → `fetchRequestHandler` from `@trpc/server/adapters/fetch`
- `/api/auth/*` → better-auth `auth.handler`
- `/api/*` fallback → 404 JSON
- SPA catch-all: non-API, non-asset paths serve `index.html` for TanStack Router

### Modes

- Dev: `development: { hmr: true, console: true }`. HMR + React Fast Refresh on. Server code hot via `bun --hot`.
- Prod: `bun build frontend/index.html --outdir dist --production` in Docker build stage. Server serves prebuilt dist + API with `development: false`.

### Auth boundaries

- better-auth base path `/api/auth`.
- Session cookie same-origin (SPA + API same process). No CORS.
- `BETTER_AUTH_SECRET` env required.

### Database

- Prisma + SQLite.
- `DATABASE_URL=file:./prisma/dev.db` in dev.
- `DATABASE_URL=file:/data/prod.db` on Fly volume.
- Migrations via Prisma Migrate.

## Components & project structure

```
frontend/
  index.html              # Bun HTML entry, links main.tsx + app.css
  main.tsx                # React root, QueryClient, tRPC client, RouterProvider
  app.css                 # @import "tailwindcss"; @plugin "daisyui"
  router.tsx              # TanStack Router config + route tree
  routes/
    login.tsx             # email/password sign in/up
    notes.tsx             # protected notes list/create/delete
  components/             # NoteForm, NoteList, etc.
  lib/
    trpc.ts               # createTRPCReact + httpBatchLink
    auth.ts               # better-auth react client
  __tests__/              # frontend unit tests if needed
backend/
  server.ts               # Bun.serve routes, dev/prod mode, static serving
  trpc/
    context.ts            # create context from better-auth session
    root.ts               # root router
    notes.ts              # notes CRUD procedures
  auth/
    auth.ts               # better-auth instance + Prisma adapter
    session.ts            # getSession helper for tRPC context
  db/
    client.ts             # PrismaClient singleton
  __tests__/              # tRPC router unit tests
shared/
  trpc.ts                 # AppRouter type export (type-only)
prisma/
  schema.prisma           # User, Session, Account, Verification, Note
  migrations/
e2e/
  auth.spec.ts
  notes.spec.ts
apm.yml
AGENTS.md
README.md
biome.json
tsconfig.json
package.json
Dockerfile
fly.toml
.github/workflows/ci.yml
```

### Key packages

- `react@19`
- `@trpc/server@11`, `@trpc/client@11`, `@trpc/tanstack-react-query@11`
- `@tanstack/react-router`, `@tanstack/react-query@5`
- `better-auth`, `@better-auth/prisma`
- `@prisma/client`, `prisma`
- `tailwindcss@4`, `daisyui@5`
- `@biomejs/biome`
- `@playwright/test`

## Data flow & auth context

- Client: TanStack Query + tRPC batch link → POST `/api/trpc/notes.list` etc.
- `fetchRequestHandler` builds tRPC context from incoming `Request`.
- Context calls `auth.api.getSession({ headers })` → session+user or null.
- Protected procedures use `t.procedure` + auth guard middleware; throw `UNAUTHORIZED` if no session.
- Notes procedures: `list` (own notes), `create`, `delete` (own only). Prisma queries filter by `userId`.
- Auth flow: `frontend/lib/auth.ts` calls better-auth client → `/api/auth/sign-in` etc. Cookie set, TanStack Query refetches session.

## Data model

### Prisma schema

- User: id (string, cuid), email (string unique), name, emailVerified, image, createdAt, updatedAt
- Session: id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId
- Account: id, accountId, providerId, userId, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
- Verification: id, identifier, value, expiresAt, createdAt, updatedAt
- Note: id (string cuid), title (string), content (string), userId (string), createdAt, updatedAt, relation to User

## Error handling

- tRPC: `TRPCError` with codes (`UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`, `INTERNAL_SERVER_ERROR`). `onError` logs server-side.
- better-auth: returns own error responses; frontend maps to form errors.
- Server `fetch` fallback: 404 JSON. Top-level try/catch in route handlers → 500 JSON.
- Dev: include error message; prod: generic message.

## Testing

- Unit: `bun test` in `backend/__tests__` for notes router (mock Prisma). `frontend/__tests__` for components if useful.
- E2E: Playwright. Before suite: `DATABASE_URL=file:./prisma/test.db`, `prisma migrate reset --force`, start server, run tests. After: teardown.
- E2E covers: sign up → log in → create note → see note → delete note → gone.

## Config

- `biome.json`: semicolons `asNeeded`, trailing comma `all`, quote style `single`, organize imports.
- `tsconfig.json`: strict, path aliases `@backend/*`, `@frontend/*`, `@shared/*`.
- `package.json` scripts:
  - `dev`: `bun --hot backend/server.ts`
  - `build`: `bun build frontend/index.html --outdir dist --production`
  - `start`: `NODE_ENV=production bun backend/server.ts`
  - `test`: `bun test`
  - `test:e2e`: Playwright with test DB setup
  - `lint`: `biome check`
  - `format`: `biome format --write`
  - `typecheck`: `tsc --noEmit`
  - `db:migrate`: `prisma migrate dev`
  - `db:reset`: `prisma migrate reset`

## CI

GitHub Actions workflow:

1. Install Bun
2. `bun install`
3. Biome lint + format check
4. TypeScript typecheck (`tsc --noEmit`)
5. `prisma generate` + `prisma migrate diff` check
6. Unit tests via `bun test`
7. Playwright E2E (test DB, `prisma migrate reset`, start server, run, teardown)

## Deployment

### Dockerfile

Multi-stage:

- Build stage: `bun install`, `prisma generate`, `bun build frontend/index.html --outdir dist --production`.
- Runtime stage: `oven/bun`, copy dist + backend + prisma + node_modules. Entrypoint runs `prisma migrate deploy` then `bun run backend/server.ts`.

### Fly.io

- `fly.toml`: volume mounted at `/data`, `DATABASE_URL=file:/data/prod.db`, `PORT=3000`.
- Persistent volume for SQLite.
- `prisma migrate deploy` on container startup.

## Agent context

- `AGENTS.md`: stack summary, scripts, conventions, env vars, skills/MCP via apm.
- `apm.yml` declares:
  - `anthropics/skills/skills/frontend-design`
  - `io.github.microsoft/playwright-mcp`
  - `io.github.github/github-mcp-server`
  - Prisma MCP (if available)

## Env vars

- `DATABASE_URL` — SQLite file path
- `BETTER_AUTH_SECRET` — auth secret
- `PORT` — server port (default 3000)
- `NODE_ENV` — development/production

## Non-goals

- No SSR.
- No social OAuth (email/password only for v1).
- No external DB (SQLite only).
- No microservices.
- No vendor-specific agent files.