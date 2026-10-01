import { HomeRoute } from '@frontend/routes/home'
import { LoginRoute } from '@frontend/routes/login'
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from '@tanstack/react-router'

const rootRoute = createRootRoute({
	component: () => <Outlet />,
})

const homeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	component: HomeRoute,
})

const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: 'login',
	component: LoginRoute,
})

const routeTree = rootRoute.addChildren([homeRoute, loginRoute])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}

export { RouterProvider }
