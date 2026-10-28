import { prisma } from '@backend/db/client'
import {
	audienceToken,
	contextValid,
	invalidateContributions,
	liveRoom,
	notifyContributions,
	previewDirection,
	resolveContributionContext,
	queueMoment,
	submitDirection,
} from '@backend/contributions'
import { samplePlayback } from '@backend/recordings'
import type { Context } from '@backend/trpc/context'
import {
	contributionContextSchema,
	directionTextSchema,
	momentActionSchema,
	describeIntent,
	musicalIntentSchema,
} from '@shared/schemas/contributions'
import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.context<Context>().create()
const roomInput = z.object({ roomId: z.string().min(1) })
const joined = t.procedure.use(({ ctx, next }) =>
	next({
		ctx: { ...ctx, token: audienceToken(ctx.req.headers.get('cookie')) },
	}),
)
const owner = t.procedure.input(roomInput).use(async ({ ctx, input, next }) => {
	const room = await prisma.room.findUnique({ where: { id: input.roomId } })
	if (!room || room.hostId !== ctx.session?.user.id)
		throw new TRPCError({ code: 'FORBIDDEN' })
	return next({ ctx: { ...ctx, room } })
})

export const contributionsRouter = t.router({
	mine: joined.input(roomInput).query(async ({ ctx, input }) => {
		const room = await prisma.room.findUnique({ where: { id: input.roomId } })
		if (!room) throw new TRPCError({ code: 'NOT_FOUND' })
		const direction = await prisma.direction.findUnique({
			where: {
				roomId_sessionToken: { roomId: input.roomId, sessionToken: ctx.token },
			},
		})
		return {
			settings: {
				textEnabled: room.textEnabled,
				recordingsEnabled: room.recordingsEnabled,
				momentsEnabled: room.momentsEnabled,
			},
			direction: direction
				? {
						text: direction.text,
						status: direction.status,
						outcome: direction.outcome,
						revision: direction.revision,
						summary: describeIntent(
							musicalIntentSchema.parse(JSON.parse(direction.interpretation)),
						),
					}
				: null,
			recordings: await prisma.recording.findMany({
				where: { roomId: input.roomId, sessionToken: ctx.token },
				select: {
					id: true,
					use: true,
					status: true,
					reason: true,
					createdAt: true,
				},
				orderBy: { createdAt: 'desc' },
				take: 5,
			}),
			moments: await prisma.moment.findMany({
				where: { roomId: input.roomId, sessionToken: ctx.token },
				select: { id: true, action: true, status: true },
				orderBy: { createdAt: 'desc' },
				take: 3,
			}),
		}
	}),
	preview: joined
		.input(roomInput.extend({ text: directionTextSchema }))
		.mutation(({ ctx, input }) =>
			previewDirection(input.roomId, ctx.token, input.text),
		),
	submit: joined
		.input(roomInput.extend({ reviewToken: z.string().max(4000) }))
		.mutation(({ ctx, input }) =>
			submitDirection(input.roomId, ctx.token, input.reviewToken),
		),
	clear: joined.input(roomInput).mutation(async ({ ctx, input }) => {
		await liveRoom(input.roomId)
		const row = await prisma.direction.findUnique({
			where: {
				roomId_sessionToken: { roomId: input.roomId, sessionToken: ctx.token },
			},
		})
		if (row) {
			await prisma.direction.update({
				where: { id: row.id },
				data: {
					status: 'withdrawn',
					outcome: 'withdrawn',
					revokedThrough: row.revision,
				},
			})
			await invalidateContributions(input.roomId, row.id)
		}
	}),
	withdraw: joined
		.input(roomInput.extend({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await liveRoom(input.roomId)
			await prisma.recording.updateMany({
				where: { id: input.id, roomId: input.roomId, sessionToken: ctx.token },
				data: { status: 'withdrawn' },
			})
			await invalidateContributions(input.roomId, undefined, input.id)
		}),
	moment: joined
		.input(roomInput.extend({ action: momentActionSchema }))
		.mutation(async ({ ctx, input }) => {
			await prisma.$transaction(async (tx) => {
				const room = await tx.room.findUnique({ where: { id: input.roomId } })
				if (room?.status !== 'live' || !room.momentsEnabled)
					throw new TRPCError({
						code: 'BAD_REQUEST',
						message: 'Musical moments are paused.',
					})
				await queueMoment(tx, input.roomId, ctx.token, input.action)
			})
			notifyContributions(input.roomId)
		}),
	host: owner.query(async ({ ctx, input }) => {
		const recordings = await prisma.recording.findMany({
			where: {
				roomId: input.roomId,
				status: {
					in: [
						'queued',
						'processing',
						'review',
						'ready',
						'preparing',
						'applied',
					],
				},
			},
			orderBy: { createdAt: 'asc' },
			take: 12,
		})
		return {
			settings: {
				textEnabled: ctx.room.textEnabled,
				recordingsEnabled: ctx.room.recordingsEnabled,
				momentsEnabled: ctx.room.momentsEnabled,
				sampleApproval: ctx.room.sampleApproval,
			},
			directions: (
				await prisma.direction.findMany({
					where: { roomId: input.roomId, status: 'active' },
					orderBy: { updatedAt: 'desc' },
					take: 100,
				})
			).map((d) => ({ id: d.id, text: d.text, outcome: d.outcome })),
			recordings: recordings.map((r) => ({
				id: r.id,
				use: r.use,
				status: r.status,
				sample: ['review', 'ready', 'preparing', 'applied'].includes(r.status)
					? samplePlayback(r, ctx.room.bpm)
					: null,
			})),
			activeSample:
				ctx.room.status === 'live'
					? (() => {
							const r = recordings.find(
								(r) =>
									r.status === 'applied' &&
									r.expiresAt &&
									r.expiresAt.getTime() > Date.now(),
							)
							return r ? samplePlayback(r, ctx.room.bpm) : null
						})()
					: null,
		}
	}),
	settings: owner
		.input(
			z.object({
				textEnabled: z.boolean(),
				recordingsEnabled: z.boolean(),
				momentsEnabled: z.boolean(),
				sampleApproval: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await prisma.room.update({
				where: { id: input.roomId },
				data: {
					textEnabled: input.textEnabled,
					recordingsEnabled: input.recordingsEnabled,
					momentsEnabled: input.momentsEnabled,
					sampleApproval: input.sampleApproval,
				},
			})
			if (!input.recordingsEnabled)
				await prisma.recording.updateMany({
					where: {
						roomId: input.roomId,
						status: { in: ['applied', 'preparing'] },
					},
					data: { status: 'expired' },
				})
			const candidates = await prisma.patternVersion.findMany({
				where: { roomId: ctx.room.id, status: 'candidate' },
			})
			const preparing = await prisma.poll.findMany({
				where: { roomId: input.roomId, deliveryStatus: 'preparing' },
			})
			for (const update of preparing)
				if (
					!(await prisma.$transaction((tx) =>
						contextValid(tx, input.roomId, update.context),
					))
				) {
					await prisma.$transaction((tx) =>
						resolveContributionContext(
							tx,
							input.roomId,
							update.context,
							'failed',
						),
					)
					await prisma.poll.updateMany({
						where: { id: update.id, deliveryStatus: 'preparing' },
						data: { deliveryStatus: 'failed', resolvedAt: new Date() },
					})
				}
			if (!input.momentsEnabled)
				await prisma.moment.updateMany({
					where: {
						roomId: input.roomId,
						status: { in: ['queued', 'preparing'] },
					},
					data: { status: 'cancelled' },
				})
			for (const c of candidates)
				if (
					!(await prisma.$transaction((tx) =>
						contextValid(tx, input.roomId, c.context),
					))
				) {
					await prisma.patternVersion.updateMany({
						where: { id: c.id, status: 'candidate' },
						data: { status: 'rejected' },
					})
					await prisma.poll.updateMany({
						where: { id: c.source, deliveryStatus: 'preparing' },
						data: { deliveryStatus: 'failed', resolvedAt: new Date() },
					})
				}
			notifyContributions(input.roomId)
		}),
	moderate: owner
		.input(
			z.object({
				id: z.string(),
				kind: z.enum(['direction', 'recording']),
				action: z.enum(['approve', 'remove']),
			}),
		)
		.mutation(async ({ input }) => {
			if (input.kind === 'direction') {
				const direction = await prisma.direction.findFirst({
					where: { id: input.id, roomId: input.roomId },
				})
				await prisma.direction.updateMany({
					where: { id: input.id, roomId: input.roomId },
					data: {
						status: 'dismissed',
						outcome: 'dismissed',
						revokedThrough: direction?.revision ?? 0,
					},
				})
				await invalidateContributions(input.roomId, input.id)
			} else {
				await prisma.recording.updateMany({
					where: {
						id: input.id,
						roomId: input.roomId,
						...(input.action === 'approve' ? { status: 'review' } : {}),
					},
					data: { status: input.action === 'approve' ? 'ready' : 'withdrawn' },
				})
				await invalidateContributions(input.roomId, undefined, input.id)
			}
			notifyContributions(input.roomId)
		}),
	authorize: owner
		.input(z.object({ versionId: z.string() }))
		.query(async ({ ctx, input }) => {
			const version = await prisma.patternVersion.findFirst({
				where: {
					id: input.versionId,
					roomId: input.roomId,
					status: 'candidate',
				},
			})
			if (
				!version ||
				version.baseVersionId !== ctx.room.currentVersionId ||
				!(await prisma.$transaction((tx) =>
					contextValid(tx, input.roomId, version.context),
				))
			)
				throw new TRPCError({
					code: 'CONFLICT',
					message: 'This contribution is no longer current.',
				})
			const context = contributionContextSchema.safeParse(version.context)
			const recording =
				context.success && context.data.recordingId
					? await prisma.recording.findUnique({
							where: { id: context.data.recordingId },
						})
					: null
			return {
				sample: recording ? samplePlayback(recording, ctx.room.bpm) : null,
			}
		}),
})
