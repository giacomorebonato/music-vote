# Responsive DaisyUI Drawer Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top-bar-only `AppShell` with a responsive daisyUI `drawer` layout (`AppLayout`) — sidebar overlay on small screens, pinned on `lg:`, with a static bare-route allowlist for opt-out.

**Architecture:** `AppLayout` renders a daisyUI `drawer lg:drawer-open`. A hidden `drawer-toggle` checkbox + hamburger `<label>` handles open/close with pure CSS (no React state). `AppLayout` reads `useLocation()` and consults `isBareRoute` to omit the `drawer-side` entirely for allowlisted routes. A session-aware `<Sidebar>` renders wordmark + nav (`TanStack Router <Link>` with `activeProps` → `menu-active`) + user email.

**Tech Stack:** React 19, TanStack Router (`@tanstack/react-router`), better-auth client (`authClient.useSession()`), daisyUI 5 (`drawer`, `menu`), Tailwind v4, Biome, Playwright E2E.

## Global Constraints

- Lint/format: Biome — no semicolons, single quotes, trailing comma all. Run `bun run format` to autofix before committing.
- Filenames: kebab-case (`app-layout.tsx`, `sidebar.tsx`, `layout.ts`). Component identifiers PascalCase.
- Path aliases: `@frontend/*`, `@backend/*`, `@shared/*`.
- No new dependencies. No icon library — use inline SVG for the hamburger.
- Frontend has no unit-test harness; project norm is backend `bun:test` + Playwright E2E. Verify frontend via E2E + `bun run typecheck`. Do not introduce a frontend unit-test runner.
- daisyUI theme is `mino` (custom, in `frontend/app.css`). Use semantic tokens (`bg-base-200`, `menu-active`, `btn-ghost`) — no hardcoded colors.
- `drawer-toggle` checkbox `id` must be unique: use `app-drawer`.
- Run `bun run check` (Biome + typecheck + knip + test) before the final commit. Knip must pass — delete `app-shell.tsx` and remove all its imports in the same task so no unused file/export remains.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/lib/layout.ts` | `BARE_ROUTES` set + `isBareRoute(pathname)` pure helper. |
| `frontend/components/sidebar.tsx` | Session-aware sidebar: wordmark, nav links, user email block. |
| `frontend/components/app-layout.tsx` | daisyUI `drawer lg:drawer-open` shell: top bar (hamburger + `actions`), optional sidebar, content slot. Branches on `isBareRoute`. |
| `frontend/routes/home.tsx`, `notes.tsx`, `login.tsx` | Swap `AppShell` → `AppLayout`. |
| `frontend/components/app-shell.tsx` | **Delete.** |
| `frontend/app.css` | Minor: ensure sidebar surface + content padding work under the drawer grid. |
| `e2e/drawer.spec.ts` | **New** Playwright spec: responsive drawer + bare-route behavior. |

---

### Task 1: Bare-route helper (`frontend/lib/layout.ts`)

**Files:**
- Create: `frontend/lib/layout.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BARE_ROUTES: Set<string>`, `isBareRoute(pathname: string): boolean`. Later tasks import `isBareRoute` from `@frontend/lib/layout`.

- [ ] **Step 1: Create the file**

```ts
// frontend/lib/layout.ts

/**
 * Routes that render without the sidebar.
 * Add a pathname here to opt a route out of the drawer layout
 * (e.g. `/login`, future landing pages).
 *
 * Upgrade path if routes grow or become dynamic: move this to per-route
 * `staticData: { bare: true }` and read it in AppLayout via useMatchRoute.
 */
export const BARE_ROUTES = new Set<string>(['/login'])

export function isBareRoute(pathname: string): boolean {
	return BARE_ROUTES.has(pathname)
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS (no errors). `isBareRoute` is unused until Task 3 — that is fine; knip is run only at the final gate and by then it is imported.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/layout.ts
git commit -m "feat(layout): add bare-route allowlist helper"
```

---

### Task 2: Session-aware sidebar (`frontend/components/sidebar.tsx`)

**Files:**
- Create: `frontend/components/sidebar.tsx`

**Interfaces:**
- Consumes: `authClient` from `@frontend/lib/auth`; TanStack Router `Link` from `@tanstack/react-router`.
- Produces: default export-free named `Sidebar` component, signature `Sidebar(): ReactNode`. Used by `AppLayout` (Task 3) inside `drawer-side`.

- [ ] **Step 1: Create the sidebar component**

```tsx
// frontend/components/sidebar.tsx

import { authClient } from '@frontend/lib/auth'
import { Link } from '@tanstack/react-router'

export function Sidebar() {
	const { data: session } = authClient.useSession()
	const user = session?.user
	const signedIn = Boolean(user)

	return (
		<div className="flex h-full flex-col gap-4 bg-base-200 p-4">
			<a href="/" className="flex items-center gap-2.5 px-2 pt-1">
				<span className="wordmark">
					mino-starter
					<span className="wordmark-cursor" aria-hidden="true" />
				</span>
			</a>

			<ul className="menu w-full flex-1 gap-1 px-0">
				<li>
					<Link
						to="/"
						activeProps={{ className: 'menu-active' }}
						activeOptions={{ exact: true }}
					>
						Home
					</Link>
				</li>
				{signedIn ? (
					<li>
						<Link to="/notes" activeProps={{ className: 'menu-active' }}>
							Notes
						</Link>
					</li>
				) : (
					<li>
						<Link to="/login" activeProps={{ className: 'menu-active' }}>
							Sign in
						</Link>
					</li>
				)}
			</ul>

			{signedIn && user?.email ? (
				<div className="px-2 pb-1 text-sm opacity-70">{user.email}</div>
			) : null}
		</div>
	)
}
```

Notes:
- `Link` `activeProps` merges extra classes onto the anchor when active. `activeOptions={{ exact: true }}` on Home so `/notes` does not also mark Home active (TanStack Router treats `/` as a prefix match by default).
- No sign-out button here — decision B: sign-out stays in `/notes` top-bar `actions`.

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS. `Sidebar` is unused until Task 3 — fine until the final knip gate.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/sidebar.tsx
git commit -m "feat(layout): add session-aware sidebar"
```

---

### Task 3: Drawer layout shell (`frontend/components/app-layout.tsx`)

**Files:**
- Create: `frontend/components/app-layout.tsx`

**Interfaces:**
- Consumes: `isBareRoute` from `@frontend/lib/layout`; `Sidebar` from `@frontend/components/sidebar`; `useLocation` from `@tanstack/react-router`.
- Produces: named `AppLayout` component, signature `AppLayout({ children, actions }: { children: ReactNode; actions?: ReactNode }): ReactNode`. Used by routes in Task 4.

- [ ] **Step 1: Create the layout component**

```tsx
// frontend/components/app-layout.tsx

import { Sidebar } from '@frontend/components/sidebar'
import { isBareRoute } from '@frontend/lib/layout'
import { useLocation } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function AppLayout({
	children,
	actions,
}: {
	children: ReactNode
	actions?: ReactNode
}) {
	const { pathname } = useLocation()
	const bare = isBareRoute(pathname)

	return (
		<div className={`drawer lg:drawer-open ${bare ? 'drawer-not-bare-hidden' : ''}`}>
			<input id="app-drawer" type="checkbox" className="drawer-toggle" />

			<div className="drawer-content flex min-h-screen flex-col">
				<header className="app-bar sticky top-0 z-10">
					<div className="flex h-14 w-full items-center justify-between px-4">
						<div className="flex items-center gap-2">
							{bare ? null : (
								<label
									htmlFor="app-drawer"
									className="btn btn-ghost btn-square lg:hidden"
									aria-label="Toggle sidebar"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										className="h-5 w-5"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M4 6h16M4 12h16M4 18h16"
										/>
									</svg>
								</label>
							)}
						</div>
						<div className="flex items-center gap-2">{actions}</div>
					</div>
				</header>

				<main className="flex-1 px-6 py-8">{children}</main>
			</div>

			{bare ? null : (
				<div className="drawer-side z-20">
					<label
						htmlFor="app-drawer"
						aria-label="close sidebar"
						className="drawer-overlay"
					/>
					<div className="min-h-full w-64">
						<Sidebar />
					</div>
				</div>
			)}
		</div>
	)
}
```

Notes:
- When `bare` is true the `drawer-side` is omitted entirely, so the daisyUI grid collapses to a single column (no empty gutter). The `drawer` root class still wraps it; the unused `drawer-toggle` checkbox stays (harmless, hidden). The placeholder `drawer-not-bare-hidden` class is intentionally absent — remove it from the template string so no dangling class is emitted. (See Step 2.)
- The hamburger label targets `app-drawer` and is `lg:hidden` so it only appears on small screens; on `lg:` the sidebar is pinned by `lg:drawer-open` and the hamburger is hidden.
- Removed the old `max-w-3xl` content cap and the `mx-auto` centering — the pinned sidebar already narrows the content column. Per-route blocks (e.g. `HomeRoute`'s `max-w-md`) still self-constrain.

- [ ] **Step 2: Clean up the dangling placeholder class**

Edit the root `className` so it reads exactly:

```tsx
<div className="drawer lg:drawer-open">
```

(Remove `${bare ? 'drawer-not-bare-hidden' : ''}` — it was a scaffolding placeholder. The `bare` branch is already handled by omitting `drawer-side`.)

- [ ] **Step 3: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/app-layout.tsx
git commit -m "feat(layout): add responsive daisyUI drawer AppLayout"
```

---

### Task 4: Wire routes to `AppLayout` and delete `AppShell`

**Files:**
- Modify: `frontend/routes/home.tsx`
- Modify: `frontend/routes/notes.tsx`
- Modify: `frontend/routes/login.tsx`
- Delete: `frontend/components/app-shell.tsx`

**Interfaces:**
- Consumes: `AppLayout` from `@frontend/components/app-layout` (Task 3). Same `{ children, actions }` contract as the old `AppShell`, so only the import + JSX tag change.
- Produces: `AppShell` removed; no dangling references.

- [ ] **Step 1: Update `frontend/routes/home.tsx`**

Replace the import line:

```tsx
import { AppShell } from '@frontend/components/app-shell'
```

with:

```tsx
import { AppLayout } from '@frontend/components/app-layout'
```

and replace the JSX wrapper `<AppShell>` → `<AppLayout>` and `</AppShell>` → `</AppLayout>`. The body between them stays unchanged (the `max-w-md` block self-constrains).

- [ ] **Step 2: Update `frontend/routes/notes.tsx`**

Same import swap (`AppShell` → `AppLayout`). Replace `<AppShell actions={...}>` → `<AppLayout actions={...}>` and closing tag. The `actions` prop (Sign-out button) stays exactly as-is — it now renders in the new top bar.

- [ ] **Step 3: Update `frontend/routes/login.tsx`**

Same import swap. Replace `<AppShell>` → `<AppLayout>` and closing tag. `/login` is in `BARE_ROUTES`, so `AppLayout` will render it without the sidebar automatically — no special prop needed here.

- [ ] **Step 4: Delete the old shell**

```bash
git rm frontend/components/app-shell.tsx
```

- [ ] **Step 5: Verify typecheck + format**

Run:
```bash
bun run typecheck
bun run format
```
Expected: typecheck PASS; Biome reformats if needed.

- [ ] **Step 6: Verify knip sees no unused exports**

Run: `bun run knip`
Expected: PASS (exit 0). If knip reports `AppLayout`/`Sidebar`/`isBareRoute` as unused, re-check that all three route files import `AppLayout` and that `AppLayout` imports `Sidebar` + `isBareRoute`.

- [ ] **Step 7: Commit**

```bash
git add frontend/routes/home.tsx frontend/routes/notes.tsx frontend/routes/login.tsx
git commit -m "refactor(routes): swap AppShell for AppLayout, remove AppShell"
```

(`git rm` already staged the deletion.)

---

### Task 5: CSS adjustments (`frontend/app.css`)

**Files:**
- Modify: `frontend/app.css`

**Interfaces:**
- Consumes: nothing new.
- Produces: sidebar surface + content padding behave under the drawer grid.

- [ ] **Step 1: Review whether CSS changes are needed**

The sidebar uses `bg-base-200` (already a theme token) and `w-64` (Tailwind utility). `.app-bar` already exists and still applies. The only thing to confirm: `.wordmark` and `.eyebrow` render fine inside the sidebar (they do — they're element-scoped, not layout-scoped).

Likely **no CSS change is required**. If the pinned sidebar overlaps content on `lg:` (e.g. content sits under the sidebar), add this block at the end of `frontend/app.css`:

```css
/* Ensure drawer content does not underlap the pinned sidebar on lg+. */
@media (min-width: 1024px) {
	.drawer.lg\:drawer-open > .drawer-content {
		padding-left: 0;
	}
}
```

Only add it if a visual check (Task 6 manual step) shows overlap. daisyUI's `drawer-open` handles the grid track, so this is a safety net, not expected work.

- [ ] **Step 2: If you added the block, verify build + typecheck**

Run: `bun run typecheck`
Expected: PASS (CSS changes don't affect TS, but confirms no accidental break).

- [ ] **Step 3: Commit (only if changed)**

```bash
git add frontend/app.css
git commit -m "style(layout): guard drawer content underlap on lg+"
```

If no change was needed, skip — leave a note in the task result: "No CSS change needed; daisyUI drawer-open handles the grid track."

---

### Task 6: E2E test for responsive drawer + bare route (`e2e/drawer.spec.ts`)

**Files:**
- Create: `e2e/drawer.spec.ts`

**Interfaces:**
- Consumes: the running dev server (Playwright `webServer` config in `playwright.config.ts` already starts it on `:3000` with `test.db`).
- Produces: a Playwright spec covering: mobile overlay open/close, desktop pinned sidebar, `/login` bare on both viewports.

- [ ] **Step 1: Write the spec**

```ts
// e2e/drawer.spec.ts

import { expect, test } from '@playwright/test'

test.describe('drawer layout', () => {
	test('mobile: sidebar hidden, hamburger toggles overlay', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 800 })
		await page.goto('/')

		// sidebar overlay not visible initially
		const sidebar = page.locator('.drawer-side')
		await expect(sidebar).not.toBeVisible()

		// open via hamburger
		await page.getByLabel('Toggle sidebar').click()
		await expect(sidebar).toBeVisible()

		// close via overlay
		await page.getByLabel('close sidebar').click()
		await expect(sidebar).not.toBeVisible()
	})

	test('desktop: sidebar pinned, hamburger hidden', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 })
		await page.goto('/')

		await expect(page.locator('.drawer-side')).toBeVisible()
		await expect(page.getByLabel('Toggle sidebar')).not.toBeVisible()
	})

	test('bare route: no sidebar on /login (mobile + desktop)', async ({ page }) => {
		for (const [w, h] of [
			[375, 800],
			[1280, 800],
		] as const) {
			await page.setViewportSize({ width: w, height: h })
			await page.goto('/login')
			await expect(page.locator('.drawer-side')).toHaveCount(0)
			await expect(page.getByLabel('Toggle sidebar')).toHaveCount(0)
		}
	})
})
```

Notes:
- `.drawer-side` visibility: daisyUI hides it via `display: none` when the toggle is unchecked on mobile, so `not.toBeVisible()` is the correct assertion (element still in DOM). For the bare route it is removed from the DOM entirely, so `toHaveCount(0)` is used there.
- `getByLabel('Toggle sidebar')` matches the hamburger's `aria-label`; `getByLabel('close sidebar')` matches the overlay's `aria-label` (lowercase, as in the JSX `aria-label="close sidebar"`).

- [ ] **Step 2: Run the E2E spec**

Run: `bun run test:e2e -- e2e/drawer.spec.ts`
Expected: 3 tests PASS. (First run starts the dev server per `playwright.config.ts` `webServer`.)

If the mobile "close via overlay" step fails, check that the overlay `<label>` `aria-label` is exactly `close sidebar` and that clicking it toggles the checkbox (daisyUI behavior).

- [ ] **Step 3: Commit**

```bash
git add e2e/drawer.spec.ts
git commit -m "test(e2e): responsive drawer + bare-route behavior"
```

---

### Task 7: Final gate — full check + manual visual

**Files:** none (verification only).

- [ ] **Step 1: Run the project pre-merge gate**

Run: `bun run check`
Expected: PASS. This runs Biome check (no writes) + typecheck + knip + `bun test backend`. Knip must report zero unused files/exports/dependencies — confirms `AppShell` deletion is clean and `AppLayout`/`Sidebar`/`isBareRoute` are all used.

- [ ] **Step 2: Run the full E2E suite (drawer + existing specs)**

Run: `bun run test:e2e`
Expected: all specs PASS (`auth.spec.ts`, `notes.spec.ts`, `drawer.spec.ts`; `ssr.spec.ts` is ignored by the default config per AGENTS.md).

- [ ] **Step 3: Manual visual check across breakpoints**

Run `bun run dev`, open `http://localhost:3000`, resize through `sm` (375), `md` (768), `lg` (1024), `xl` (1280):
- `sm`/`md`: hamburger visible, sidebar slides in as overlay with backdrop, nav shows Home + Sign in (signed out) or Home + Notes + email (signed in).
- `lg`/`xl`: sidebar pinned left, content fills remaining column, hamburger hidden.
- `/login`: no sidebar, content centered/top bar only, on all sizes.
- Active nav link shows `menu-active` styling on `/` and `/notes`.

- [ ] **Step 4: If everything green, no extra commit needed**

If Steps 1–3 all pass, the feature is complete. If any fix was needed during the gate, commit it with an appropriate message before declaring done.

---

## Self-Review

**Spec coverage:**
- Responsive mobile-first drawer, pinned on `lg:` → Task 3 (`drawer lg:drawer-open`).
- Sidebar always open on big screens, toggle on small → Task 3 (hamburger `lg:hidden` + daisyUI checkbox toggle).
- Slim top bar (hamburger mobile-only + page actions) → Task 3.
- Sidebar wordmark + nav + auth, session-aware → Task 2.
- Bare-route allowlist, opt-out omits sidebar entirely → Tasks 1 + 3.
- Sign-out stays in `/notes` top-bar `actions` (decision B) → Task 4 Step 2 (actions preserved).
- Files touched / deleted → Task 4 deletes `app-shell.tsx`; Task 5 touches CSS; Tasks 1–3 create new files.
- Testing: E2E for responsive + bare route → Task 6; unit skipped per project norm (frontend has no unit harness) — noted in Global Constraints.
- Error handling: session loading → no auth block; error → unauthenticated state → Task 2 (conditional render on `signedIn`).

No spec requirement left unaddressed.

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". All code steps contain real code. The one placeholder class in Task 3 Step 1 is explicitly removed in Step 2 — intentional, not a plan gap.

**Type consistency:** `isBareRoute(pathname: string): boolean` (Task 1) matches the call in Task 3. `Sidebar()` (Task 2) matches the usage `<Sidebar />` in Task 3. `AppLayout({ children, actions })` (Task 3) matches the route usage in Task 4. `BARE_ROUTES` is a `Set<string>`; `isBareRoute` consumes `BARE_ROUTES.has`. `authClient.useSession()` returns `{ data }` with `data.user` — matches `session?.user` in Task 2 and existing usage in `routes/notes.tsx`.

No issues found.