import { contributionsRouter } from '@backend/trpc/contributions'
import type { Context } from '@backend/trpc/context'
import { publicRouter } from '@backend/trpc/public'
import { roomsRouter } from '@backend/trpc/rooms'
import { votingRouter } from '@backend/trpc/voting'
import { initTRPC } from '@trpc/server'

const t = initTRPC.context<Context>().create()

export const appRouter = t.router({
	public: publicRouter,
	contributions: contributionsRouter,
	rooms: roomsRouter,
	voting: votingRouter,
})

export type AppRouter = typeof appRouter
