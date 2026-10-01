# TanStack Form + Unified Devtools — Design

Date: 2026-07-28
Status: Approved (pending spec review)

## Goal

1. Migrate the two existing `useState`-based forms to **TanStack Form** with Zod (Standard Schema) validation.
2. Install **TanStack Devtools** (unified shell) for local dev only, supporting Form + Query + Router panels.

## Context

Project: mino-starter. Stack: Bun (bundler + dev server), React 19, TanStack Router, TanStack Query, tRPC, better-auth, Prisma. No Vite — frontend bundled by `bun build frontend/index.html --outdir dist --production`; dev served by `bun --hot backend/server.ts` with `import.meta.env.DEV` available.

Existing forms:
- `frontend/components/note-form.tsx` — title + content, submits via tRPC `notes.create` (backend validates with `z.object({ title: z.string().min(1), content: z.string().min(1) })`).
- `frontend/components/auth-form.tsx` — signin/signup, email + password + optional name, submits via `authClient.signIn.email` / `authClient.signUp.email`.

Project already has `zod@4.4.3`. TanStack Form natively supports **Standard Schema** (which Zod v4 implements) — no adapter package required. The legacy `@tanstack/zod-form-adapter` is deprecated and pinned to Zod v3; **do not use it**.

## Scope

In scope:
- Install `@tanstack/react-form` + dev-only devtools packages.
- New unified devtools component, mounted once, dev-only.
- Migrate both forms to TanStack Form with shared Zod schemas.
- Share the note schema between client and backend tRPC input.

Out of scope:
- No form-level refactor of UX/visuals. daisyUI markup preserved.
- No new features (array fields, async validation, etc.) unless needed by current behavior.
- No backend logic changes beyond reusing the shared note schema import.

## Packages

Dependencies:
- `@tanstack/react-form`

devDependencies:
- `@tanstack/react-devtools` — unified shell (`TanStackDevtools`, `config.position`).
- `@tanstack/react-form-devtools` — `formDevtoolsPlugin()`.
- `@tanstack/react-query-devtools` — `ReactQueryDevtoolsPanel`.
- `@tanstack/react-router-devtools` — `TanStackRouterDevtoolsPanel`.

Notes:
- `@tanstack/react-devtools` is alpha (0.10.x). Acceptable because dev-only; prod bundle excludes it.
- No `@tanstack/zod-form-adapter` (deprecated, Zod v3).
- No `@tanstack/devtools-vite` — project uses Bun bundler, not Vite.

## Architecture

### Devtools (dev-only)

New `frontend/components/devtools.tsx`:
- Exports `AppDevtools({ router })`.
- Renders `null` when `!import.meta.env.DEV`.
- Lazy-loads each devtools module via dynamic `import()` so the main chunk never carries devtools and prod build never loads them. Bun replaces `import.meta.env.DEV` with `false` on `bun build --production` → the guard short-circuits before the dynamic import fires.
- Mounts `<TanStackDevtools>` with `config={{ position: 'bottom-right' }}` and a `plugins` array:
  - `{ name: 'TanStack Query', render: <ReactQueryDevtoolsPanel /> }`
  - `{ name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel router={router} /> }`
  - `formDevtoolsPlugin()`
- Wrapped in `<Suspense fallback={null}>`.

Mount in `frontend/main.tsx`, inside `QueryClientProvider` and `TRPCProvider`, after `RouterProvider`, passing the `router` instance already created in `frontend/router.tsx`.

Rationale: unified shell places all panels under one toggleable dock, so Query/Router/Form panels never clash on screen.

### Shared schemas

`shared/schemas/note.ts`:
```ts
import { z } from 'zod'

export const noteSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
})

export type NoteInput = z.infer<typeof noteSchema>
```

`shared/schemas/auth.ts`:
```ts
import { z } from 'zod'

export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
})

export type SignInInput = z.infer<typeof signInSchema>
export type SignUpInput = z.infer<typeof signUpSchema>
```

### Backend

`backend/trpc/notes.ts` `create` procedure input switches from inline `z.object(...)` to `noteSchema` (imported from `@shared/schemas/note`). Behavior unchanged.

### note-form.tsx

Replace `useState` form state with `useForm`:
- `defaultValues: { title: '', content: '' }`
- `validators: { onChange: noteSchema }` (Standard Schema — no adapter).
- `onSubmit: ({ value }) => create.mutate(value)`.
- Render inputs via `form.Field` render-prop for `title` and `content`. Keep daisyUI classes (`input input-bordered`, `textarea textarea-bordered`).
- Submit button uses `form.Subscribe` selector `[state.canSubmit, state.isSubmitting]` for `disabled` + label, mirroring current `create.isPending` behavior.
- `create.mutationOptions.onSuccess` invalidates `notes.list` and calls `form.reset()` (replaces manual `setTitle('')` / `setContent('')`).
- Server mutation error surfaced via `create.error` subscribe or `onSubmit` error capture; preserve current UX (no inline error shown today — keep minimal).

### auth-form.tsx

Replace `useState` with `useForm`:
- `defaultValues: { email: '', password: '', name: '' }`.
- `validators: { onChange: mode === 'signup' ? signUpSchema : signInSchema }`.
- `onSubmit: async ({ value }) => { ... authClient call ... }`.
- `onSubmitInvalid` left default (Form blocks submit).
- Server error (better-auth `res.error`) pushed into form via `form.setErrorMap` or local `error` state rendered below the form as today (`{error && <div className="text-error">{error}</div>}`).
- `name` field rendered only when `mode === 'signup'` (unchanged). When mode flips, reset relevant fields via `form` key or `useForm` re-mount using `key={mode}` to avoid stale validation state. Decision: use `key={mode}` on the form component so a mode switch re-mounts the form cleanly (simplest, matches the mode-toggle UX in `login.tsx`).
- daisyUI classes preserved.

## Data flow

- note-form: `form.Field` → `useForm` state → `onSubmit` → tRPC `notes.create.mutationOptions` → `onSuccess` invalidate `notes.list` + `form.reset()`.
- auth-form: `form.Field` → `useForm` state → `onSubmit` → `authClient.signIn/signUp.email` → success: `window.location.href = '/notes'`; failure: `setError`.
- Devtools: `useForm` instances auto-register with `formDevtoolsPlugin()` (verified during impl); Query panel reads `QueryClient` from context; Router panel reads passed `router`.

## Error handling

- Client validation: Zod schema via Standard Schema; TanStack Form surfaces field errors through `field.state.meta.errors`.
- tRPC mutation error: existing `create.error` access pattern retained (button disabled while pending).
- better-auth error: retained via local `error` state.

## Verification

1. `bun run typecheck` — no new TS errors.
2. `bun run lint` — Biome clean.
3. `bun run dev` — load app:
   - Devtools dock appears bottom-right; toggle between Query / Router / Form tabs.
   - Note form: submit empty → validation blocks; fill → creates note, list refreshes, form resets.
   - Auth form: signin + signup modes both submit; invalid email/short password blocked.
   - Form tab shows both form instances and their field state.
4. `bun run build` then `rg -l 'react-devtools' dist` → no hits (devtools excluded from prod).
5. `bun test` — backend notes tests still green (schema import equivalent).
6. `bun run test:e2e` — Playwright suite green.

## Risks / open items

- `@tanstack/react-devtools` alpha: may break on future bump. Mitigation: pin exact version in `package.json`.
- `formDevtoolsPlugin()` global auto-registration: docs show mounting the plugin alone is sufficient. If forms do not appear in the panel, fall back to per-form wiring (verify during impl; adjust if needed).
- Bun DCE of `import.meta.env.DEV` guarded dynamic imports: verify with the `rg` check in step 4. If any devtools leak into prod, switch to a conditional entry import.
- Zod v4 + Standard Schema typing: ensure `validators.onChange` accepts the schema object without TS friction (per GitHub issue #1529, correct shape is `validators: { onSubmit: schema }` / `onChange: schema`).