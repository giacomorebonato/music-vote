import { auth } from '@backend/auth/auth'
import { prisma } from '@backend/db/client'
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch'

export async function createContext({ req }: FetchCreateContextFnOptions) {
	const session = await auth.api.getSession({ headers: req.headers })
	return { prisma, session }
}

export type Context = Awaited<ReturnType<typeof createContext>>
