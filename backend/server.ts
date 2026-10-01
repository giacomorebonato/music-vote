import { auth } from '@backend/auth/auth'
import { bootSchedulers } from '@backend/boot'
import { prisma } from '@backend/db/client'
import {
	normalizeTrpcRequest,
	TRPC_ENDPOINT,
} from '@backend/normalize-trpc-request'
import {
	createProdRoleResolver,
	createWsUpgradeHandler,
	hub,
	type RoleResolver,
	type SocketData,
} from '@backend/realtime/hub'
import { createPrerenderHandler } from '@backend/ssr/prerender'
import { createContext } from '@backend/trpc/context'
import { appRouter } from '@backend/trpc/root'
import { PUBLIC_SSR_PATHS } from '@shared/ssr-paths'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

const isDev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT ?? 3000)

const resolveRole: RoleResolver = createProdRoleResolver({
	getSession: (req) => auth.api.getSession({ headers: req.headers }),
	findRoom: (roomId) => prisma.room.findUnique({ where: { id: roomId } }),
})

const handleWs = createWsUpgradeHandler({ resolveRole })

let devIndex: unknown
if (isDev) {
	devIndex = (await import('../frontend/index.html')).default
}

async function serveDistFile(pathname: string): Promise<Response | null> {
	if (pathname.includes('..')) return null
	const file = Bun.file(`dist${pathname}`)
	if (await file.exists()) return new Response(file)
	return null
}

// Prod-only bot prerender (port of fastify-prerender-plugin, adapted to Bun.serve).
// Dev keeps the HTMLBundle routes + HMR; no prerendering.
let prerender: ReturnType<typeof createPrerenderHandler> | null = null
if (!isDev) {
	prerender = createPrerenderHandler({
		urls: PUBLIC_SSR_PATHS,
		port,
		cacheDir: process.env.SSR_CACHE_DIR || undefined,
	})
}

// Dispatch /api/* requests (tRPC + better-auth). Used both from the dev
// `routes` map (so the `/*` HTMLBundle wildcard doesn't shadow API POSTs with
// 405) and from the prod `fetch` handler.
async function handleApi(req: Request): Promise<Response> {
	const url = new URL(req.url)
	if (url.pathname.startsWith(TRPC_ENDPOINT)) {
		const trpcReq = normalizeTrpcRequest(req, url)
		return fetchRequestHandler({
			endpoint: TRPC_ENDPOINT,
			req: trpcReq,
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
}

const httpServer = Bun.serve<SocketData>({
	port,
	...(isDev
		? {
				// Dev: register /api/* as explicit function routes so they take
				// precedence over the `/*` HTMLBundle wildcard. Bun matches `routes`
				// before `fetch`, and a wildcard HTMLBundle route only accepts
				// GET/HEAD (POST -> 405), which previously broke auth signup and
				// tRPC mutations. The `/*` route serves the SPA shell + HMR for any
				// other path so new client routes need no server change.
				// /ws is also registered as a route so Bun can upgrade it from the
				// routes path (the route returns undefined after server.upgrade).
				routes: {
					'/api/auth/*': handleApi,
					'/api/trpc/*': handleApi,
					'/ws': handleWs,
					'/*': devIndex as unknown as import('bun').HTMLBundle,
				},
				development: { hmr: true, console: true },
			}
		: {
				development: false,
			}),
	async fetch(req, server) {
		const url = new URL(req.url)

		if (url.pathname === '/ws') {
			return await handleWs(req, server)
		}

		// Bot prerender runs first (like the plugin's onRequest hook). Lightpanda's
		// own inner requests self-identify via UA and fall through to the SPA shell.
		if (prerender) {
			const ssrRes = await prerender.handle(req)
			if (ssrRes) return ssrRes
		}

		if (!isDev) {
			const staticFile = await serveDistFile(url.pathname)
			if (staticFile) return staticFile
		}
		if (url.pathname.startsWith('/api')) {
			return handleApi(req)
		}
		// SPA fallback: serve the shell for any non-static, non-API path so the
		// client router owns routing. New client routes need no server change.
		// Unknown /api/* paths still 404 (handled by handleApi above).
		return new Response(Bun.file('dist/index.html'))
	},
	websocket: {
		open(ws) {
			const { roomId, role } = ws.data
			hub.joinRoom(ws, roomId, role, role === 'host')
		},
		close(ws) {
			hub.onClose(ws)
		},
		message() {
			// client -> server protocol is not used yet
		},
	},
})

console.log(`music-vote on http://localhost:${httpServer.port}`)

// Re-arm timers for rooms that were mid-set when the process stopped. Failures
// are logged and non-fatal (see backend/boot.ts).
await bootSchedulers()
