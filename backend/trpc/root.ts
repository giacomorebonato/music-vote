import type { Context } from '@backend/trpc/context'
import { publicRouter } from '@backend/trpc/public'
import { roomsRouter } from '@backend/trpc/rooms'
import { initTRPC } from '@trpc/server'

const t = initTRPC.context<Context>().create()

export const appRouter = t.router({
	public: publicRouter,
	rooms: roomsRouter,
})

export type AppRouter = typeof appRouter
