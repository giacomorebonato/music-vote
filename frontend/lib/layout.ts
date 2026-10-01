/**
 * Routes that render without the sidebar.
 * Add a pathname here to opt a route out of the drawer layout
 * (e.g. `/login`, future landing pages).
 *
 * Upgrade path if routes grow or become dynamic: move this to per-route
 * `staticData: { bare: true }` and read it in AppLayout via useMatchRoute.
 */
const BARE_ROUTES = new Set<string>(['/login'])

export function isBareRoute(pathname: string): boolean {
	return BARE_ROUTES.has(pathname)
}
