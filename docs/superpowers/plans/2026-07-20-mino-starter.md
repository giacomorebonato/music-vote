# mino-starter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable full-stack starter (Bun + React + tRPC + better-auth + Prisma + daisyUI) with auth + notes CRUD, tests, CI, and Fly deployment.

**Architecture:** Single `Bun.serve` fullstack server. HTML import route for SPA, `/api/trpc/*` → tRPC fetch adapter, `/api/auth/*` → better-auth handler. Prisma + SQLite. TanStack Router + TanStack Query on the client.

**Tech Stack:** Bun, React 19, tRPC v11, @trpc/tanstack-react-query, TanStack Router + Query v5, better-auth + @better-auth/prisma, Prisma, Tailwind v4 + daisyUI v5, Biome, Playwright, APM.

## Global Constraints

- Bun only: runtime, package manager, bundler, test runner. No Vite, no Express/Fastify/Hono/Elysia, no npm/pnpm.
- Biome: no semicolons (`asNeeded`), trailing comma `all`, single quotes.
- No vendor-specific filenames (e.g., CLAUDE.md). Use AGENTS.md.
- Latest stable packages via `bun add` (pins exact versions in package.json).
- Path aliases: `@backend/*`, `@frontend/*`, `@shared/*`.
- Root-level dirs: `frontend/`, `backend/`, `shared/`, `prisma/`. Nested `__tests__/` where useful.
- Email/password auth only (no OAuth for v1).
- Same-origin SPA + API (no CORS).

---

## File Structure

```
frontend/
  index.html
  main.tsx
  app.css
  router.tsx
  routes/login.tsx
  routes/notes.tsx
  components/NoteForm.tsx
  components/NoteList.tsx
  lib/trpc.ts
  lib/auth.ts
backend/
  server.ts
  db/client.ts
  auth/auth.ts
  trpc/context.ts
  trpc/root.ts
  trpc/notes.ts
  __tests__/notes.test.ts
shared/
  trpc.ts
prisma/
  schema.prisma
  migrations/
e2e/
  global-setup.ts
  auth.spec.ts
  notes.spec.ts
apm.yml
AGENTS.md
README.md
biome.json
tsconfig.json
package.json
playwright.config.ts
Dockerfile
fly.toml
.github/workflows/ci.yml
.env.example
.gitignore
```

---

## Task 1: Project scaffolding + config

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `.gitignore`, `.env.example`, `README.md`
- Modify: root

**Interfaces:**
- Produces: config files consumed by all later tasks.

- [ ] **Step 1: Init package + install deps**

Run:
```bash
bun init -y
bun add @prisma/client better-auth @better-auth/prisma @trpc/server @trpc/client @trpc/tanstack-react-query @tanstack/react-router @tanstack/react-query react react-dom zod
bun add -d prisma @biomejs/biome @types/react @types/react-dom typescript tailwindcss@latest daisyui@latest @playwright/test
```

- [ ] **Step 2: Write tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"],
    "baseUrl": ".",
    "paths": {
      "@backend/*": ["backend/*"],
      "@frontend/*": ["frontend/*"],
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["frontend", "backend", "shared", "e2e"]
}
```

- [ ] **Step 3: Write biome.json**

Create `biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "javascript": {
    "formatter": {
      "semicolons": "asNeeded",
      "trailingCommas": "all",
      "quoteStyle": "single"
    },
    "organizeImports": { "enabled": true }
  },
  "linter": { "enabled": true, "rules": { "recommended": true } }
}
```

- [ ] **Step 4: Write .gitignore, .env.example, README skeleton**

`.gitignore`:
```
node_modules/
dist/
prisma/dev.db
prisma/test.db
prisma/*.db-journal
.env
.fly/
```

`.env.example`:
```
DATABASE_URL=file:./prisma/dev.db
BETTER_AUTH_SECRET=replace-with-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:3000
PORT=3000
```

`README.md`:
```md
# mino-starter

Reusable full-stack starter: Bun + React + tRPC + better-auth + Prisma + daisyUI.

## Scripts

- `bun run dev` — dev server with HMR
- `bun run build` — production bundle
- `bun run start` — production server
- `bun test` — unit tests
- `bun run test:e2e` — Playwright E2E
- `bun run lint` — Biome check
- `bun run format` — Biome format
- `bun run typecheck` — tsc --noEmit
- `bun run db:migrate` — prisma migrate dev
- `bun run db:reset` — prisma migrate reset

See `AGENTS.md` for agent context.
```

- [ ] **Step 5: Add package.json scripts**

Add to `package.json` `scripts`:
```json
{
  "dev": "bun --hot backend/server.ts",
  "build": "bun build frontend/index.html --outdir dist --production",
  "start": "NODE_ENV=production bun backend/server.ts",
  "test": "bun test",
  "test:e2e": "playwright test",
  "lint": "biome check .",
  "format": "biome format --write .",
  "typecheck": "tsc --noEmit",
  "db:migrate": "prisma migrate dev",
  "db:reset": "prisma migrate reset"
}
```

- [ ] **Step 6: Verify**

Run:
```bash
bun install
bun run typecheck
```
Expected: typecheck passes (no source files yet, may warn about empty program; acceptable).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: project scaffolding and config"
```

---

## Task 2: Prisma schema + better-auth

**Files:**
- Create: `prisma/schema.prisma`, `backend/db/client.ts`, `backend/auth/auth.ts`, `shared/trpc.ts` (empty placeholder not needed here)
- Modify: none

**Interfaces:**
- Produces: `prisma` (PrismaClient singleton), `auth` (better-auth instance), Prisma models `User`, `Session`, `Account`, `Verification`, `Note`.

- [ ] **Step 1: Write Prisma schema**

Create `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id            String   @id @default(cuid())
  name          String
  email         String   @unique
  emailVerified Boolean  @default(false)
  image         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  sessions      Session[]
  accounts      Account[]
  notes         Note[]
}

model Session {
  id        String   @id @default(cuid())
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ipAddress String?
  userAgent String?
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
}

model Account {
  id                String  @id @default(cuid())
  accountId         String
  providerId        String
  userId            String
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken       String?
  refreshToken      String?
  idToken           String?
  accessTokenExpiresAt DateTime?
  refreshTokenExpiresAt DateTime?
  scope             String?
  password          String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model Verification {
  id        String   @id @default(cuid())
  identifier String
  value     String
  expiresAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Note {
  id        String   @id @default(cuid())
  title     String
  content   String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Write Prisma client singleton**

Create `backend/db/client.ts`:
```ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export { prisma }
```

- [ ] **Step 3: Write better-auth instance**

Create `backend/auth/auth.ts`:
```ts
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from '@backend/db/client'

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: 'sqlite' }),
  emailAndPassword: { enabled: true },
})
```

- [ ] **Step 4: Generate client + create first migration**

Run:
```bash
bunx prisma generate
bunx prisma migrate dev --name init
```
Expected: migration created, `prisma/dev.db` exists.

- [ ] **Step 5: Verify auth instance loads**

Run:
```bash
bun -e "import('./backend/auth/auth.ts').then(() => console.log('auth ok'))"
```
Expected: prints `auth ok`, no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: prisma schema and better-auth instance"
```

---

## Task 3: tRPC server + notes router (TDD)

**Files:**
- Create: `backend/trpc/context.ts`, `backend/trpc/root.ts`, `backend/trpc/notes.ts`, `shared/trpc.ts`
- Test: `backend/__tests__/notes.test.ts`

**Interfaces:**
- Consumes: `auth` from Task 2, `prisma` from Task 2.
- Produces: `appRouter` (type `AppRouter`), `createContext`, `notesRouter`.

- [ ] **Step 1: Write failing test for notes router**

Create `backend/__tests__/notes.test.ts`:
```ts
import { test, expect, mock } from 'bun:test'
import { notesRouter } from '@backend/trpc/notes'
import type { Context } from '@backend/trpc/context'

const mockSession = { user: { id: 'user-1' }, session: { id: 'sess-1' } }

function createContext(overrides: Partial<Context> = {}): Context {
  return {
    prisma: {
      note: {
        findMany: mock(() => Promise.resolve([{ id: 'n1', title: 'T', content: 'C', userId: 'user-1' }])),
        create: mock(() => Promise.resolve({ id: 'n1', title: 'T', content: 'C', userId: 'user-1' })),
        deleteMany: mock(() => Promise.resolve({ count: 1 })),
      },
    } as any,
    session: mockSession as any,
    ...overrides,
  }
}

test('notes.list returns own notes', async () => {
  const ctx = createContext()
  const caller = notesRouter.createCaller(ctx)
  const result = await caller.list()
  expect(result.length).toBe(1)
})

test('notes.list throws UNAUTHORIZED without session', async () => {
  const ctx = createContext({ session: null })
  const caller = notesRouter.createCaller(ctx)
  expect(caller.list()).rejects.toThrow()
})

test('notes.create creates a note', async () => {
  const ctx = createContext()
  const caller = notesRouter.createCaller(ctx)
  const result = await caller.create({ title: 'T', content: 'C' })
  expect(result.title).toBe('T')
})

test('notes.delete deletes own note', async () => {
  const ctx = createContext()
  const caller = notesRouter.createCaller(ctx)
  const result = await caller.delete({ id: 'n1' })
  expect(result.count).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test backend/__tests__/notes.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write context**

Create `backend/trpc/context.ts`:
```ts
import { auth } from '@backend/auth/auth'
import { prisma } from '@backend/db/client'
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch'

export async function createContext({ req }: FetchCreateContextFnOptions) {
  const session = await auth.api.getSession({ headers: req.headers })
  return { prisma, session }
}

export type Context = Awaited<ReturnType<typeof createContext>>
```

- [ ] **Step 4: Write notes router**

Create `backend/trpc/notes.ts`:
```ts
import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import type { Context } from '@backend/trpc/context'

const t = initTRPC.context<Context>().create()

const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({ ctx: { session: ctx.session } })
})

export const notesRouter = t.router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.note.findMany({ where: { userId: ctx.session.user.id } }),
  ),
  create: protectedProcedure
    .input(z.object({ title: z.string().min(1), content: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.note.create({
        data: { title: input.title, content: input.content, userId: ctx.session.user.id },
      }),
    ),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.note.deleteMany({ where: { id: input.id, userId: ctx.session.user.id } }),
    ),
})
```

Note: add `import { TRPCError } from '@trpc/server'` at top.

- [ ] **Step 5: Write root router + shared type**

Create `backend/trpc/root.ts`:
```ts
import { initTRPC } from '@trpc/server'
import type { Context } from '@backend/trpc/context'
import { notesRouter } from '@backend/trpc/notes'

const t = initTRPC.context<Context>().create()

export const appRouter = t.router({
  notes: notesRouter,
})

export type AppRouter = typeof appRouter
```

Create `shared/trpc.ts`:
```ts
export type { AppRouter } from '@backend/trpc/root'
```

- [ ] **Step 6: Run test to verify pass**

Run: `bun test backend/__tests__/notes.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: tRPC server with notes router"
```

---

## Task 4: Bun server + route mounting

**Files:**
- Create: `backend/server.ts`
- Modify: none

**Interfaces:**
- Consumes: `appRouter`, `createContext`, `auth`.
- Produces: running server at `PORT`.

- [ ] **Step 1: Write server.ts**

Create `backend/server.ts`:
```ts
import index from '../frontend/index.html'
import { auth } from '@backend/auth/auth'
import { appRouter } from '@backend/trpc/root'
import { createContext } from '@backend/trpc/context'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

const isDev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT ?? 3000)

const server = Bun.serve({
  port,
  routes: {
    '/': index,
    '/login': index,
    '/notes': index,
  },
  development: isDev ? { hmr: true, console: true } : false,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/trpc')) {
      return fetchRequestHandler({
        endpoint: '/api/trpc',
        req,
        router: appRouter,
        createContext,
      })
    }
    if (url.pathname.startsWith('/api/auth')) {
      return auth.handler(req)
    }
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  },
})

console.log(`mino-starter on http://localhost:${server.port}`)
```

- [ ] **Step 2: Smoke test API (after frontend index.html stub exists)**

Create temporary `frontend/index.html` if not yet:
```html
<!doctype html><html><body><div id="root"></div></body></html>
```
Run: `bun run dev`
Expected: server starts, `curl http://localhost:3000/api/trpc/notes/list` returns JSON error (UNAUTHORIZED).
Stop server.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: bun fullstack server with tRPC and auth routes"
```

---

## Task 5: Frontend scaffolding (React + tRPC + auth client + Tailwind)

**Files:**
- Create: `frontend/index.html`, `frontend/main.tsx`, `frontend/app.css`, `frontend/lib/trpc.ts`, `frontend/lib/auth.ts`, `frontend/router.tsx`
- Modify: none

**Interfaces:**
- Consumes: `AppRouter` type from `shared/trpc.ts`.
- Produces: React app root, tRPC client, auth client, router.

- [ ] **Step 1: Write app.css**

Create `frontend/app.css`:
```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: light --default, dark --prefersdark;
}
```

- [ ] **Step 2: Write index.html**

Create `frontend/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>mino-starter</title>
    <link rel="stylesheet" href="./app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Write tRPC + auth clients**

Create `frontend/lib/trpc.ts`:
```ts
import { createTRPCReact } from '@trpc/tanstack-react-query'
import type { AppRouter } from '@shared/trpc'

export const trpc = createTRPCReact<AppRouter>()
```

Create `frontend/lib/auth.ts`:
```ts
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: 'http://localhost:3000',
})
```

- [ ] **Step 4: Write router**

Create `frontend/router.tsx`:
```tsx
import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { authClient } from '@frontend/lib/auth'
import { LoginRoute } from '@frontend/routes/login'
import { NotesRoute } from '@frontend/routes/notes'

const rootRoute = createRootRoute({
  component: () => <Outlet />,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/notes' })
  },
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  component: LoginRoute,
})

const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'notes',
  component: NotesRoute,
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    if (!data) {
      throw redirect({ to: '/login' })
    }
  },
})

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, notesRoute])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export { RouterProvider }
```

- [ ] **Step 5: Write main.tsx**

Create `frontend/main.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { createRoot } from 'react-dom/client'
import { trpc } from '@frontend/lib/trpc'
import { RouterProvider, router } from '@frontend/router'

const queryClient = new QueryClient()
const trpcClient = trpc.createClient({
  links: [httpBatchLink({ url: '/api/trpc' })],
})

createRoot(document.getElementById('root')!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </trpc.Provider>,
)
```

- [ ] **Step 6: Create minimal route components (stubs)**

Create `frontend/routes/login.tsx`:
```tsx
export function LoginRoute() {
  return <div className="p-8">Login page (stub)</div>
}
```

Create `frontend/routes/notes.tsx`:
```tsx
export function NotesRoute() {
  return <div className="p-8">Notes page (stub)</div>
}
```

- [ ] **Step 7: Verify dev server renders**

Run: `bun run dev`
Expected: `http://localhost:3000` redirects to `/notes`, then to `/login` (stub). HMR works on edit.
Stop server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: frontend scaffolding with tRPC, auth, router, Tailwind"
```

---

## Task 6: Auth UI (login/signup/logout/session)

**Files:**
- Create: `frontend/routes/login.tsx` (replace stub), `frontend/components/AuthForm.tsx`
- Modify: `frontend/router.tsx` (optional logout link)

**Interfaces:**
- Consumes: `authClient` from `@frontend/lib/auth`.

- [ ] **Step 1: Write AuthForm component**

Create `frontend/components/AuthForm.tsx`:
```tsx
import { useState } from 'react'
import { authClient } from '@frontend/lib/auth'

export function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const res =
      mode === 'signin'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name })
    if (res.error) {
      setError(res.error.message)
      return
    }
    window.location.href = '/notes'
  }

  return (
    <form className="flex flex-col gap-2 max-w-sm" onSubmit={onSubmit}>
      {mode === 'signup' && (
        <input
          className="input"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <input
        className="input"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        className="input"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <div className="text-error">{error}</div>}
      <button className="btn btn-primary" type="submit">
        {mode === 'signin' ? 'Sign in' : 'Sign up'}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Write LoginRoute with tabs**

Create `frontend/routes/login.tsx`:
```tsx
import { useState } from 'react'
import { AuthForm } from '@frontend/components/AuthForm'

export function LoginRoute() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col gap-4">
        <div className="join">
          <button
            className={`btn join-item ${mode === 'signin' ? 'btn-active' : ''}`}
            onClick={() => setMode('signin')}
          >
            Sign in
          </button>
          <button
            className={`btn join-item ${mode === 'signup' ? 'btn-active' : ''}`}
            onClick={() => setMode('signup')}
          >
            Sign up
          </button>
        </div>
        <AuthForm mode={mode} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify manually**

Run: `bun run dev`
Sign up at `/login` with email/password, expect redirect to `/notes`. Stop.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: auth UI with sign in/up forms"
```

---

## Task 7: Notes UI (list/create/delete)

**Files:**
- Create: `frontend/components/NoteForm.tsx`, `frontend/components/NoteList.tsx`
- Modify: `frontend/routes/notes.tsx`

**Interfaces:**
- Consumes: `trpc` from `@frontend/lib/trpc`, `authClient` for logout.

- [ ] **Step 1: Write NoteForm**

Create `frontend/components/NoteForm.tsx`:
```tsx
import { useState } from 'react'
import { trpc } from '@frontend/lib/trpc'
import { useQueryClient } from '@tanstack/react-query'

export function NoteForm() {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const utils = trpc.useUtils()
  const create = trpc.notes.create.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate()
      setTitle('')
      setContent('')
    },
  })

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    create.mutate({ title, content })
  }

  return (
    <form className="flex flex-col gap-2 max-w-sm" onSubmit={onSubmit}>
      <input
        className="input"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        className="textarea"
        placeholder="Content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        required
      />
      <button className="btn btn-primary" type="submit" disabled={create.isPending}>
        Add note
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Write NoteList**

Create `frontend/components/NoteList.tsx`:
```tsx
import { trpc } from '@frontend/lib/trpc'

export function NoteList() {
  const utils = trpc.useUtils()
  const { data, isPending } = trpc.notes.list.useQuery()
  const del = trpc.notes.delete.useMutation({
    onSuccess: () => utils.notes.list.invalidate(),
  })

  if (isPending) return <div>Loading…</div>

  return (
    <ul className="flex flex-col gap-2">
      {data?.map((note) => (
        <li key={note.id} className="card bg-base-200 shadow p-4 flex justify-between items-center">
          <div>
            <div className="font-bold">{note.title}</div>
            <div>{note.content}</div>
          </div>
          <button
            className="btn btn-error btn-sm"
            onClick={() => del.mutate({ id: note.id })}
            disabled={del.isPending}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Write NotesRoute**

Create `frontend/routes/notes.tsx`:
```tsx
import { authClient } from '@frontend/lib/auth'
import { NoteForm } from '@frontend/components/NoteForm'
import { NoteList } from '@frontend/components/NoteList'

export function NotesRoute() {
  const { data: session } = authClient.useSession()

  return (
    <div className="min-h-screen p-8 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Notes</h1>
        <button
          className="btn btn-ghost"
          onClick={() => authClient.signOut().then(() => (window.location.href = '/login'))}
        >
          Sign out ({session?.user.email})
        </button>
      </div>
      <NoteForm />
      <NoteList />
    </div>
  )
}
```

- [ ] **Step 4: Verify manually**

Run: `bun run dev`. Log in, create note, see it, delete it, confirm gone. Stop.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: notes UI with create/list/delete"
```

---

## Task 8: Playwright E2E

**Files:**
- Create: `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/auth.spec.ts`, `e2e/notes.spec.ts`
- Modify: `package.json` (e2e script already)

**Interfaces:**
- Consumes: running server, test DB.

- [ ] **Step 1: Write global setup**

Create `e2e/global-setup.ts`:
```ts
import { execSync } from 'node:child_process'

export default async () => {
  execSync('DATABASE_URL=file:./prisma/test.db bunx prisma migrate reset --force --skip-generate', {
    stdio: 'inherit',
  })
}
```

- [ ] **Step 2: Write playwright config**

Create `playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'DATABASE_URL=file:./prisma/test.db NODE_ENV=development bun run backend/server.ts',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})
```

- [ ] **Step 3: Write auth spec**

Create `e2e/auth.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('signup then signout', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByPlaceholder('Name').fill('Test User')
  await page.getByPlaceholder('Email').fill(`e2e-${Date.now()}@example.com`)
  await page.getByPlaceholder('Password').fill('password123')
  await page.locator('form button[type=submit]').click()
  await expect(page).toHaveURL(/\/notes/)
  await page.getByRole('button', { name: /Sign out/ }).click()
  await expect(page).toHaveURL(/\/login/)
})
```

- [ ] **Step 4: Write notes spec**

Create `e2e/notes.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('create and delete a note', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByPlaceholder('Name').fill('E2E Notes')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill('password123')
  await page.locator('form button[type=submit]').click()
  await expect(page).toHaveURL(/\/notes/)

  await page.getByPlaceholder('Title').fill('My note')
  await page.getByPlaceholder('Content').fill('Note body')
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.getByText('My note')).toBeVisible()

  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('My note')).toBeHidden()
})
```

- [ ] **Step 5: Run E2E**

Run: `bun run test:e2e`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: playwright e2e for auth and notes"
```

---

## Task 9: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write workflow**

Create `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run lint
      - run: bun run typecheck
      - run: bunx prisma generate
      - run: DATABASE_URL=file:./prisma/ci.db bunx prisma migrate reset --force --skip-generate
      - run: bun test
      - run: bun run test:e2e
        env:
          CI: 'true'
          BETTER_AUTH_SECRET: ci-secret-for-tests-only-not-production
          BETTER_AUTH_URL: http://localhost:3000
```

- [ ] **Step 2: Verify locally (optional)**

Run: `bun run lint && bun run typecheck && bun test && bun run test:e2e`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ci: github actions for biome, typecheck, tests, e2e"
```

---

## Task 10: Dockerfile + Fly deployment

**Files:**
- Create: `Dockerfile`, `fly.toml`

- [ ] **Step 1: Write Dockerfile**

Create `Dockerfile`:
```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx prisma generate
RUN bun build frontend/index.html --outdir dist --production

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/backend ./backend
COPY --from=build /app/shared ./shared
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lockb ./bun.lockb
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/prod.db
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "bunx prisma migrate deploy && bun run backend/server.ts"]
```

- [ ] **Step 2: Write fly.toml**

Create `fly.toml`:
```toml
app = "mino-starter"

[build]

[mount]
source = "mino_starter_data"
destination = "/data"

[http_service]
internal_port = 3000
force_https = true
auto_stop_machines = true
auto_start_machines = true
min_machines_running = 0
```

- [ ] **Step 3: Verify build locally**

Run: `docker build -t mino-starter .`
Expected: image builds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "build: dockerfile and fly.io config"
```

---

## Task 11: AGENTS.md + APM manifest + skills

**Files:**
- Create: `AGENTS.md`, `apm.yml`

- [ ] **Step 1: Write AGENTS.md**

Create `AGENTS.md`:
```md
# AGENTS.md

## Stack

- Runtime/package manager/bundler/test runner: Bun
- Frontend: React 19 SPA, TanStack Router, TanStack Query, tRPC (@trpc/tanstack-react-query), daisyUI v5 + Tailwind v4
- Backend: Bun.serve fullstack server, tRPC v11 fetch adapter, better-auth (Prisma adapter, email/password only)
- DB: Prisma + SQLite
- Lint/format: Biome (no semicolons, trailing comma all, single quotes)
- E2E: Playwright
- Agent context: APM (apm.yml) — run `apm install`

## Scripts

See package.json scripts. Key: `bun run dev`, `bun test`, `bun run test:e2e`, `bun run db:migrate`.

## Env vars

See `.env.example`. Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PORT`.

## Conventions

- Root dirs: `frontend/`, `backend/`, `shared/`, `prisma/`. No `src/`.
- Path aliases: `@backend/*`, `@frontend/*`, `@shared/*`.
- Nested `__tests__/` for unit tests.
- No vendor-specific filenames (e.g., CLAUDE.md).
- Auth base path: `/api/auth`. tRPC endpoint: `/api/trpc`.

## Skills/MCP

Run `apm install` to install frontend-design skill, Playwright MCP, GitHub MCP, Prisma MCP.
```

- [ ] **Step 2: Write apm.yml**

Create `apm.yml`:
```yaml
name: mino-starter
version: 0.1.0
dependencies:
  apm:
    - anthropics/skills/skills/frontend-design
  mcp:
    - io.github.microsoft/playwright-mcp
    - io.github.github/github-mcp-server
    - io.prisma/mcp
```

- [ ] **Step 3: Verify apm install (if apm available)**

Run: `apm install`
Expected: manifest installed (skip if apm not installed; document in README).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: AGENTS.md and APM manifest with skills/MCP"
```

---

## Self-Review Notes

- All spec sections covered by tasks: stack (T1), Prisma/auth (T2), tRPC (T3), server (T4), frontend (T5), auth UI (T6), notes UI (T7), tests (T8), CI (T9), deploy (T10), AGENTS/apm (T11).
- No placeholders: code blocks present for every implementation step.
- Type consistency: `AppRouter` type flows `backend/trpc/root.ts` → `shared/trpc.ts` → `frontend/lib/trpc.ts`. `Context` type used in context, router, tests.
- Note: better-auth Prisma schema field names match better-auth core schema. If `npx auth generate` suggests different field names, reconcile to better-auth docs at runtime.