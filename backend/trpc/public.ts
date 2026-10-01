import type { Context } from '@backend/trpc/context'
import { initTRPC } from '@trpc/server'

const t = initTRPC.context<Context>().create()

export const publicRouter = t.router({
	siteInfo: t.procedure.query(() => ({
		name: 'music-vote',
		tagline: 'Crowd-voted AI live music.',
	})),
})
