import { contributionContextSchema } from '@shared/schemas/contributions'
import { samplePlayback } from '@backend/recordings'
import {
	createRoom,
	endRoom,
	reportApplyResult,
	skipPoll,
	startRoom,
	steerRoom,
	undoLastChange,
	perform,
	setGrooveLock,
} from '@backend/rooms/service'
import type { Context } from '@backend/trpc/context'
import { parseOptions } from '@backend/votes/service'
import {
	createRoomSchema,
	performanceActionSchema,
	grooveLockSchema,
	steerSchema,
} from '@shared/schemas/room'
import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.context<Context>().create()

const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	const userId = ctx.session?.user?.id
	if (!userId) {
		throw new TRPCError({ code: 'UNAUTHORIZED' })
	}
	return next({ ctx: { ...ctx, userId } })
})

async function requireRoomOwner(
	prisma: Context['prisma'],
	roomId: string,
	userId: string,
): Promise<void> {
	const room = await prisma.room.findUnique({ where: { id: roomId } })
	if (!room || room.hostId !== userId) {
		throw new TRPCError({ code: 'FORBIDDEN' })
	}
}

export const roomsRouter = t.router({
	perform: protectedProcedure
		.input(performanceActionSchema)
		.mutation(async ({ ctx, input }) => {
			await requireRoomOwner(ctx.prisma, input.roomId, ctx.userId)
			await perform(input.roomId, ctx.userId, input.action)
		}),
	steer: protectedProcedure
		.input(steerSchema)
		.mutation(async ({ ctx, input }) => {
			await requireRoomOwner(ctx.prisma, input.roomId, ctx.userId)
			try {
				return await steerRoom(input.roomId, ctx.userId, input.text)
			} catch (error) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: error instanceof Error ? error.message : 'Steering failed',
				})
			}
		}),
	lock: protectedProcedure
		.input(grooveLockSchema)
		.mutation(async ({ ctx, input }) => {
			await requireRoomOwner(ctx.prisma, input.roomId, ctx.userId)
			await setGrooveLock(input.roomId, ctx.userId, input.locked)
		}),
	create: protectedProcedure
		.input(createRoomSchema)
		.mutation(async ({ ctx, input }) => {
			const room = await createRoom(ctx.userId, input)
			return { id: room.id }
		}),

	get: protectedProcedure
		.input(z.object({ roomId: z.string() }))
		.query(async ({ ctx, input }) => {
			await requireRoomOwner(ctx.prisma, input.roomId, ctx.userId)
			const [room, versions, openPoll, voteAgg] = await Promise.all([
				ctx.prisma.room.findUnique({ where: { id: input.roomId } }),
				ctx.prisma.patternVersion.findMany({
					where: { roomId: input.roomId },
					orderBy: { id: 'desc' },
				}),
				ctx.prisma.poll.findFirst({
					where: { roomId: input.roomId, status: 'open' },
				}),
				ctx.prisma.vote.groupBy({
					by: ['choice'],
					where: { poll: { roomId: input.roomId, status: 'open' } },
					_count: { choice: true },
				}),
			])
			if (!room) {
				throw new TRPCError({ code: 'NOT_FOUND' })
			}
			// Zero-fill from the open poll's option keys so the shape matches the
			// `vote_count` WS event and the client can render any poll (evolution
			// polls carry their own generated option keys, the end poll is
			// wrap/continue).
			const voteCounts: Record<string, number> = {}
			for (const option of parseOptions(openPoll?.options)) {
				voteCounts[option.key] = 0
			}
			for (const row of voteAgg) {
				if (row.choice in voteCounts) {
					voteCounts[row.choice] = row._count.choice
				}
			}
			const replayVersions = await Promise.all(
				versions.map(async (v) => {
					const context = contributionContextSchema.safeParse(v.context)
					const recording =
						context.success &&
						context.data.recordingId &&
						v.status === 'candidate'
							? await ctx.prisma.recording.findUnique({
									where: { id: context.data.recordingId },
								})
							: null
					return {
						...v,
						sample:
							recording?.status === 'preparing'
								? samplePlayback(recording, room.bpm)
								: null,
					}
				}),
			)
			return {
				room,
				versions: replayVersions,
				// Shape the wire response so the client never has to narrow Prisma's
				// recursive Json column (the host console renders options generically).
				openPoll: openPoll
					? {
							id: openPoll.id,
							question: openPoll.question,
							closesAt: openPoll.closesAt,
							options: parseOptions(openPoll.options),
						}
					: null,
				voteCounts,
			}
		}),

	start: protectedProcedure
		.input(z.object({ roomId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await requireRoomOwner(ctx.prisma, input.roomId, ctx.userId)
			await startRoom(input.roomId, ctx.userId)
		}),

	undo: protectedProcedure
		.input(z.object({ roomId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await requireRoomOwner(ctx.prisma, input.roomId, ctx.userId)
			await undoLastChange(input.roomId, ctx.userId)
		}),

	skip: protectedProcedure
		.input(z.object({ roomId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await requireRoomOwner(ctx.prisma, input.roomId, ctx.userId)
			await skipPoll(input.roomId, ctx.userId)
		}),

	end: protectedProcedure
		.input(z.object({ roomId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await requireRoomOwner(ctx.prisma, input.roomId, ctx.userId)
			await endRoom(input.roomId, ctx.userId)
		}),

	reportApplyResult: protectedProcedure
		.input(
			z.object({
				roomId: z.string(),
				versionId: z.string(),
				ok: z.boolean(),
				error: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await requireRoomOwner(ctx.prisma, input.roomId, ctx.userId)
			await reportApplyResult(
				input.roomId,
				ctx.userId,
				input.versionId,
				input.ok,
				input.error,
			)
		}),
})
