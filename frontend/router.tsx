import { CreateRoute } from '@frontend/routes/create'
import { HomeRoute } from '@frontend/routes/home'
import { HostRoute } from '@frontend/routes/host'
import { LoginRoute } from '@frontend/routes/login'
import { VoteRoute } from '@frontend/routes/vote'
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

const voteRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/r/$id',
	component: VoteRouteContainer,
})

function VoteRouteContainer() {
	const { id } = voteRoute.useParams()
	return <VoteRoute roomId={id} />
}

const routeTree = rootRoute.addChildren([
	homeRoute,
	loginRoute,
	createRoomRoute,
	hostRoute,
	voteRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}

export { RouterProvider }
