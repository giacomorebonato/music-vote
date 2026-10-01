import { CreateRoute } from '@frontend/routes/create'
import { HomeRoute } from '@frontend/routes/home'
import { HostRoute } from '@frontend/routes/host'
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

const createRoomRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: 'create',
	component: CreateRoute,
})

const hostRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/r/$id/host',
	component: HostRouteContainer,
})

function HostRouteContainer() {
	const { id } = hostRoute.useParams()
	return <HostRoute roomId={id} />
}

const routeTree = rootRoute.addChildren([
	homeRoute,
	loginRoute,
	createRoomRoute,
	hostRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}

export { RouterProvider }
