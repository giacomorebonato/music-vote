import { auth } from '@backend/auth/auth'
import { prisma } from '@backend/db/client'
import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch'

export async function createContext({
	req,
	resHeaders,
}: FetchCreateContextFnOptions) {
	const session = await auth.api.getSession({ headers: req.headers })
	// `req` lets procedures read request cookies (anonymous vote session).
	// `resHeaders` is the fetch adapter's response header sink; procedures set
	// cookies on it and the adapter merges it into the final response.
	return { prisma, session, req, resHeaders }
}

export type Context = Awaited<ReturnType<typeof createContext>>
