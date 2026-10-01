import {
	createRoom,
	endRoom,
	reportApplyResult,
	skipPoll,
	startRoom,
	undoLastChange,
} from '@backend/rooms/service'
import type { Context } from '@backend/trpc/context'
import { createRoomSchema } from '@shared/schemas/room'
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
			const counts: Record<string, number> = {}
			for (const row of voteAgg) {
				counts[row.choice] = row._count.choice
			}
			return {
				room,
				versions,
				openPoll,
				voteCounts: { yes: counts.yes ?? 0, no: counts.no ?? 0 },
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
				input.versionId,
				input.ok,
				input.error,
			)
		}),
})
