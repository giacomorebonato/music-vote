import type { Context } from '@backend/trpc/context'
import { initTRPC } from '@trpc/server'

const t = initTRPC.context<Context>().create()

export const publicRouter = t.router({
	siteInfo: t.procedure.query(() => ({
		name: 'mino-starter',
		tagline: 'A Bun + React fullstack starter with bot-friendly SSR.',
	})),
})
