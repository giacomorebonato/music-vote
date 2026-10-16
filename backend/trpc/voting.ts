import type { Context } from '@backend/trpc/context'
import { castVote, claimSession, parseOptions } from '@backend/votes/service'
import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.context<Context>().create()

const SESSION_COOKIE = 'mv_session'
const SESSION_MAX_AGE_SECS = 60 * 60 * 24

/**
 * Anonymous audience voting. All procedures are public: the QR vote page has
 * no account, it claims an `mv_session` cookie on first load and sends that
 * token with every vote. Poll lifecycle (open/close/tally) belongs to the
 * scheduler; this router only intakes votes and serves the read models the
 * vote page and ended-summary need.
 */
export const votingRouter = t.router({
	claimSession: t.procedure.mutation(({ ctx }) => {
		const existing = readSessionToken(ctx.req.headers.get('cookie'))
		if (existing) return { token: existing }
		const { token } = claimSession()
		// fetchRequestHandler captures this Headers object as the response
		// header sink, so the cookie set here lands on the tRPC response.
		ctx.resHeaders.append(
			'set-cookie',
			`${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECS}`,
		)
		return { token }
	}),

	currentPoll: t.procedure
		.input(z.object({ roomId: z.string() }))
		.query(async ({ ctx, input }) => {
			const room = await ctx.prisma.room.findUnique({
				where: { id: input.roomId },
			})
			if (!room) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Room not found' })
			}

			const poll = await ctx.prisma.poll.findFirst({
				where: { roomId: input.roomId, status: 'open' },
				orderBy: { seq: 'desc' },
			})
			const latest = await ctx.prisma.poll.findFirst({
				where: {
					roomId: input.roomId,
					status: 'closed',
					openedAt: { not: null },
				},
				orderBy: { seq: 'desc' },
				include: { votes: true },
			})
			const queued = await ctx.prisma.poll.findFirst({
				where: { roomId: input.roomId, status: 'queued' },
				orderBy: { seq: 'asc' },
			})
			const sessionToken = readSessionToken(ctx.req.headers.get('cookie'))
			const choice =
				poll && sessionToken
					? ((
							await ctx.prisma.vote.findFirst({
								where: { pollId: poll.id, sessionToken },
							})
						)?.choice ?? null)
					: null
			const latestOptions = latest ? parseOptions(latest.options) : []
			const counts = Object.fromEntries(
				latestOptions.map((option) => [option.key, 0]),
			)
			for (const vote of latest?.votes ?? []) {
				if (vote.choice in counts) counts[vote.choice] += 1
			}
			const total = Object.values(counts).reduce((sum, count) => sum + count, 0)

			return {
				roomStatus: room.status,
				choice,
				latestResult: latest
					? {
							id: latest.id,
							question: latest.question,
							winnerLabel:
								latestOptions.find(
									(option) => option.key === latest.winningOption,
								)?.label ?? null,
							winnerCount: latest.winningOption
								? (counts[latest.winningOption] ?? 0)
								: 0,
							total,
							status:
								latest.deliveryStatus ??
								(latest.winningOption ? 'preparing' : 'unchanged'),
							nextPollAt:
								queued?.kind === 'evolution' && latest.resolvedAt
									? new Date(
											latest.resolvedAt.getTime() + room.pollIntervalSec * 1000,
										)
									: null,
						}
					: null,
				poll: poll
					? {
							id: poll.id,
							question: poll.question,
							options: parseOptions(poll.options),
							closesAt: poll.closesAt,
						}
					: null,
			}
		}),

	castVote: t.procedure
		.input(z.object({ pollId: z.string(), choice: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const token = readSessionToken(ctx.req.headers.get('cookie'))
			if (!token) {
				throw new TRPCError({
					code: 'PRECONDITION_FAILED',
					message: 'SESSION_REQUIRED',
				})
			}
			await castVote(input.pollId, token, input.choice)
			return { ok: true }
		}),

	summary: t.procedure
		.input(z.object({ roomId: z.string() }))
		.query(async ({ ctx, input }) => {
			const [polls, versions] = await Promise.all([
				ctx.prisma.poll.findMany({
					where: { roomId: input.roomId },
					orderBy: { seq: 'asc' },
				}),
				ctx.prisma.patternVersion.findMany({
					where: { roomId: input.roomId },
					orderBy: { appliedAt: 'asc' },
				}),
			])

			return {
				polls: polls.map((poll) => ({
					question: poll.question,
					winningOption: poll.winningOption,
					winningLabel:
						parseOptions(poll.options).find(
							(option) => option.key === poll.winningOption,
						)?.label ?? null,
					deliveryStatus: poll.deliveryStatus,
					applied: versions.some(
						(version) =>
							version.source === poll.id && version.status === 'applied',
					),
					reverted: versions.some(
						(version) =>
							version.source === poll.id && version.status === 'reverted',
					),
				})),
				versions: versions.map((version) => ({
					code: version.code,
					appliedAt: version.appliedAt,
					source: version.source,
				})),
			}
		}),
})

function readSessionToken(cookieHeader: string | null): string | null {
	if (!cookieHeader) return null
	for (const part of cookieHeader.split(';')) {
		const [name, ...rest] = part.trim().split('=')
		if (name === SESSION_COOKIE) return rest.join('=') || null
	}
	return null
}
