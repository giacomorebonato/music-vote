# Responsive DaisyUI Drawer Layout — Design

Date: 2026-07-31
Status: Approved (pending user spec review)

## Goal

Replace the top-bar-only `AppShell` with a shared, responsive drawer layout using the daisyUI `drawer` component. Mobile-first: sidebar slides in as an overlay on small screens, persists pinned beside content on `lg:` and up. A static allowlist lets selected routes (e.g. `/login`, future landing pages) opt out of the sidebar entirely.

## Non-goals

- File-based routing / TanStack Router CLI migration. Evaluated and rejected: project uses `Bun.build` (not Vite), route count is 3, migration churn outweighs benefit. Revisit when routes grow past ~15 or nested layouts/params appear.
- Collapsible/icon-only sidebar variant. Not needed now.
- Theme toggle or footer block in sidebar. Minimal nav + auth only.

## Architecture

`AppLayout` renders a daisyUI `drawer` with the `lg:drawer-open` modifier:

- **Mobile-first (`<lg`)**: sidebar hidden by default. A hamburger `<label>` in the top bar toggles the hidden `drawer-toggle` checkbox; daisyUI handles the open/close slide + overlay via CSS — no React state for drawer open state.
- **`lg:` and up**: `lg:drawer-open` pins the sidebar in the grid. Hamburger hidden (`lg:hidden`). Content reflows beside the sidebar. No overlay.
- **Top bar** lives inside `drawer-content` (daisyUI rule: page content, navbar, footer must all be inside `drawer-content`). Slim: hamburger (`lg:hidden`) on the left, route-level `actions` slot on the right.
- **Sidebar** lives in `drawer-side`: wordmark at top, primary nav (`menu`), auth block at bottom (email only — no sign-out here).
- **Bare opt-out**: routes in `BARE_ROUTES` render only `children` + top bar; the `drawer-side` markup is omitted entirely (not hidden) so the grid collapses to a single column and no sidebar gutter remains.

### Mobile-first ordering

The daisyUI `drawer` is mobile-first by construction: the default (unmodified) state is closed/overlay; `lg:drawer-open` is the enhancement that pins it on large screens. No `max-lg:` overrides needed.

## Component API

```tsx
// frontend/components/app-layout.tsx
export function AppLayout({
  children,
  actions,
}: {
  children: ReactNode
  actions?: ReactNode
})
```

Same `actions` contract as the current `AppShell` — `/notes` continues to pass its Sign-out button here. No route changes required to keep `actions` working.

## Bare-route allowlist

```ts
// frontend/lib/layout.ts
import { useLocation } from '@tanstack/react-router'

export const BARE_ROUTES = new Set(['/login'])

export function isBareRoute(pathname: string): boolean {
  return BARE_ROUTES.has(pathname)
}
```

`AppLayout` calls `useLocation()` and branches on `isBareRoute(pathname)`. Adding a future landing page = one entry in `BARE_ROUTES`.

Upgrade path (not implemented now): route `staticData: { bare: true }` read via `useMatchRoute` / route context, if the allowlist grows or dynamic routes appear. Noted via a comment in `layout.ts`.

## Sidebar content model

A single `<Sidebar>` component, session-aware via `authClient.useSession()`:

- **Always**: wordmark (reuses the existing `.wordmark` / `.wordmark-cursor` CSS from `app.css`) at the top.
- **Unauthenticated** (no session): nav = `Home` (`/`), `Sign in` (`/login`).
- **Authenticated** (session present): nav = `Home` (`/`), `Notes` (`/notes`); bottom block = user email (read-only text, no sign-out button).
- **Active link**: TanStack Router `<Link>` with `activeProps` (or `data-status="active"`) → daisyUI `menu-active` class on the active `<a>`.

Sign-out placement (decision B): the Sign-out button stays in the top-bar `actions` slot on `/notes` only. The sidebar shows the user email but no sign-out control. Top-bar `actions` remain the home for page-specific actions.

## Files

| File | Change |
|------|--------|
| `frontend/components/app-layout.tsx` | **New** — drawer layout + slim top bar |
| `frontend/components/sidebar.tsx` | **New** — session-aware sidebar (wordmark, nav, email) |
| `frontend/lib/layout.ts` | **New** — `BARE_ROUTES`, `isBareRoute` |
| `frontend/components/app-shell.tsx` | **Delete** — replaced by `AppLayout` |
| `frontend/routes/home.tsx` | Swap `AppShell` import → `AppLayout` |
| `frontend/routes/notes.tsx` | Swap `AppShell` import → `AppLayout` (keeps `actions` Sign-out) |
| `frontend/routes/login.tsx` | Swap `AppShell` import → `AppLayout` |
| `frontend/app.css` | Minor: sidebar background uses `bg-base-200`; adjust `.app-bar` width handling if the drawer grid changes its stacking. No theme-token changes. |

## Layout details

- Sidebar width: `w-64` (16rem) on `lg:` — standard app-sidebar width, fits the daisyUI `menu` comfortably.
- Sidebar background: `bg-base-200` (matches the theme's second-level surface). Content area stays on `base-100`.
- Top bar: keep the existing `.app-bar` sticky style + backdrop blur. Hamburger button: `btn btn-ghost btn-square lg:hidden` wired to the `drawer-toggle` `id` via `htmlFor`.
- Content max-width: today `AppShell` constrains content to `max-w-3xl` centered. With a pinned sidebar the content column already narrows; drop the `max-w-3xl` cap on the main content area inside the drawer and let it fill the remaining grid track, keeping `px-6 py-8` padding. (Per-route content blocks like `HomeRoute`'s `max-w-md` still self-constrain.)
- `drawer-toggle` `id`: `app-drawer`, unique to this layout.

## Error handling

None specific. The sidebar degrades gracefully: if `useSession()` is loading, render nav without the auth block (no email yet). If session fetch errors, same as unauthenticated state. No throw.

## Testing

- **Unit**: `isBareRoute` truthy for `/login`, falsy for `/`, `/notes`, unknown paths.
- **Unit**: `<Sidebar>` renders `Home` + `Sign in` when no session; renders `Home` + `Notes` + email when session present.
- **E2E (Playwright)**: mobile viewport — hamburger visible, sidebar hidden, clicking hamburger opens overlay; desktop viewport — sidebar visible, hamburger hidden. `/login` — no sidebar on either viewport.
- Manual visual check at `sm`, `md`, `lg`, `xl` breakpoints.

## Decisions log

- **Sign-out placement: B** — stays in top-bar `actions` on `/notes`; sidebar shows email only.
- **TanStack Router CLI: not adopted** — Bun.build (not Vite) + small route count; revisit on growth.
- **daisyUI drawer over custom CSS grid**: uses daisyUI's built-in checkbox toggle + overlay + `lg:drawer-open`; no React state for open/close; matches the project's daisyUI-first convention.