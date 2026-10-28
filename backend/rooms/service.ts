import { contributionContextSchema } from '@shared/schemas/contributions'
import {
	contextValid,
	resolveContributionContext,
} from '@backend/contributions'
import { prisma } from '@backend/db/client'
import { getLlmProvider } from '@backend/llm/provider'
import { generateInitialPattern, generateOutro } from '@backend/music/engine'
import { performancePattern } from '@backend/music/performance'
import type { StateDoc } from '@backend/music/state-doc'
import {
	armScheduler,
	disarmScheduler,
	wakeScheduler,
} from '@backend/polls/scheduler'
import { hub } from '@backend/realtime/hub'
import { preferenceQuestions } from '@shared/schemas/preferences'
import type { createRoomSchema } from '@shared/schemas/room'
import type { performanceActionSchema } from '@shared/schemas/room'
import type { z } from 'zod'
import type { Prisma, Room } from '../../prisma/generated/client'

type CreateRoomInput = z.infer<typeof createRoomSchema>

type EngineDeps = {
	generateInitialPattern: typeof generateInitialPattern
	generateOutro: typeof generateOutro
}

const defaultEngine: EngineDeps = {
	generateInitialPattern,
	generateOutro,
}

export async function setGrooveLock(
	roomId: string,
	hostId: string,
	locked: boolean,
): Promise<void> {
	await prisma.$transaction(async (tx) => {
		const changed = await tx.room.updateMany({
			where: { id: roomId, hostId, status: 'live' },
			data: { grooveLocked: locked },
		})
		if (!changed.count) throw new Error('Live room not found or access denied')
		if (locked) {
			for (const update of await tx.poll.findMany({
				where: { roomId, deliveryStatus: 'preparing' },
			}))
				await resolveContributionContext(tx, roomId, update.context, 'failed')
			await tx.poll.updateMany({
				where: { roomId, deliveryStatus: 'preparing' },
				data: { deliveryStatus: 'failed', resolvedAt: new Date() },
			})
			await tx.patternVersion.updateMany({
				where: { roomId, status: 'candidate' },
				data: { status: 'rejected' },
			})
		}
	})
	hub.publishHost(roomId, { type: 'crowd_changed' })
}

export async function perform(
	roomId: string,
	hostId: string,
	action: z.infer<typeof performanceActionSchema>['action'],
): Promise<void> {
	const version = await prisma.$transaction(async (tx) => {
		const room = await tx.room.findUnique({ where: { id: roomId } })
		if (
			!room ||
			room.hostId !== hostId ||
			room.status !== 'live' ||
			!room.currentCode
		)
			throw new Error('Live room not found or access denied')
		const pending = await tx.poll.findFirst({
			where: { roomId, deliveryStatus: 'preparing' },
		})
		if (pending)
			throw new Error('Wait for the current musical change to finish')
		const latest = await tx.poll.findFirst({
			where: { roomId },
			orderBy: { seq: 'desc' },
		})
		const update = await tx.poll.create({
			data: {
				roomId,
				seq: (latest?.seq ?? 0) + 1,
				kind: 'performance',
				question: action,
				options: [],
				status: 'closed',
				deliveryStatus: 'preparing',
				closedAt: new Date(),
			},
		})
		const nextDoc = { ...(room.stateDoc as unknown as StateDoc) }
		delete nextDoc.moment
		return tx.patternVersion.create({
			data: {
				roomId,
				code: performancePattern(room.currentCode, action),
				source: update.id,
				baseVersionId: room.currentVersionId,
				status: 'candidate',
				stateDoc: nextDoc as unknown as Prisma.InputJsonObject,
			},
		})
	})
	hub.publishHost(roomId, {
		type: 'code_update',
		code: version.code,
		versionId: version.id,
		kind: 'evolution',
		phraseAligned: true,
	})
	hub.publishHost(roomId, { type: 'crowd_changed' })
}

export async function createRoom(
	hostId: string,
	input: CreateRoomInput,
): Promise<Room> {
	return prisma.room.create({
		data: {
			hostId,
			bpm: input.bpm,
			lengthSec: input.lengthMin * 60,
			pollIntervalSec: input.pollIntervalSec,
			pollOpenSec: input.pollOpenSec,
			genre: input.genre,
			status: 'lobby',
			stateDoc: {},
		},
	})
}

export async function startRoom(
	roomId: string,
	hostId: string,
	engine: EngineDeps = defaultEngine,
): Promise<void> {
	const room = await prisma.room.findUnique({ where: { id: roomId } })
	if (!room || room.hostId !== hostId) {
		throw new Error('Room not found or access denied')
	}
	if (room.status !== 'lobby') {
		throw new Error('Room is not in lobby')
	}

	const provider = getLlmProvider()
	const { code, doc } = await engine.generateInitialPattern(provider, {
		genre: room.genre,
		bpm: room.bpm,
	})
	const now = new Date()
	const version = await prisma.$transaction(async (tx) => {
		const started = await tx.room.updateMany({
			where: { id: roomId, status: 'lobby' },
			data: {
				currentCode: code,
				stateDoc: doc as unknown as Prisma.InputJsonObject,
				status: 'live',
				startedAt: now,
			},
		})
		if (started.count === 0) throw new Error('Room is not in lobby')
		const initial = await tx.patternVersion.create({
			data: {
				roomId,
				code,
				stateDoc: doc as unknown as Prisma.InputJsonObject,
				source: 'initial',
				status: 'applied',
				appliedAt: now,
			},
		})
		await tx.room.update({
			where: { id: roomId },
			data: { currentVersionId: initial.id },
		})
		await tx.poll.createMany({
			data: preferenceQuestions.map((question, index) => ({
				roomId,
				seq: index + 1,
				kind: 'preference',
				dimensionKey: question.key,
				catalogVersion: 1,
				question: question.question,
				options: question.options,
				status: 'open',
				openedAt: now,
			})),
		})
		return initial
	})

	hub.publishHost(roomId, {
		type: 'code_update',
		code,
		versionId: version.id,
		kind: 'initial',
	})
	hub.publishAudience(roomId, { type: 'crowd_changed' })
	armScheduler(roomId)
}

async function closeOpenPoll(roomId: string): Promise<void> {
	await prisma.poll.updateMany({
		where: { roomId, status: 'open' },
		data: {
			status: 'closed',
			winningOption: null,
			deliveryStatus: 'unchanged',
			closedAt: new Date(),
			resolvedAt: new Date(),
		},
	})
}

async function finalizeRoomEnd(roomId: string): Promise<void> {
	await prisma.room.update({
		where: { id: roomId },
		data: { status: 'ended', endedAt: new Date() },
	})
	hub.publishAudience(roomId, { type: 'room_ended' })
	hub.publishHost(roomId, { type: 'room_status', status: 'ended' })
}

export async function endRoom(
	roomId: string,
	hostId: string,
	engine: EngineDeps = defaultEngine,
): Promise<void> {
	const room = await prisma.room.findUnique({ where: { id: roomId } })
	if (!room || room.hostId !== hostId) {
		throw new Error('Room not found or access denied')
	}
	if (room.status === 'ended' || room.status === 'outro') {
		return
	}

	disarmScheduler(roomId)
	if (room.status === 'live') {
		const claimed = await prisma.room.updateMany({
			where: { id: roomId, status: 'live' },
			data: { status: 'outro', endedAt: new Date() },
		})
		if (claimed.count === 0) return
		hub.publishAudience(roomId, { type: 'room_status', status: 'outro' })
		hub.publishHost(roomId, { type: 'room_status', status: 'outro' })
	}
	await cancelPendingUpdates(roomId)
	await prisma.recording.updateMany({
		where: {
			roomId,
			status: {
				in: [
					'uploading',
					'queued',
					'processing',
					'review',
					'ready',
					'preparing',
					'applied',
				],
			},
		},
		data: { status: 'expired' },
	})
	await prisma.moment.updateMany({
		where: { roomId, status: { in: ['queued', 'preparing'] } },
		data: { status: 'cancelled' },
	})
	await closeOpenPoll(roomId)

	if (room.status === 'lobby') {
		await finalizeRoomEnd(roomId)
		return
	}

	const outroCode = await generateOutroOrWarn(roomId, room, engine)
	if (outroCode !== null) {
		const now = new Date()
		const version = await prisma.patternVersion.create({
			data: {
				roomId,
				code: outroCode,
				source: 'outro',
				status: 'candidate',
				appliedAt: now,
			},
		})
		hub.publishHost(roomId, {
			type: 'code_update',
			code: outroCode,
			versionId: version.id,
			kind: 'outro',
		})
	}

	await prisma.room.update({
		where: { id: roomId },
		data: { status: 'outro' },
	})
	setTimeout(() => {
		void finalizeRoomEnd(roomId)
	}, room.pollIntervalSec * 1000)
}

/**
 * Generates the outro pattern, or `null` when generation fails.
 *
 * Spec failure table: an LLM outage must not break the end sequence. A failed
 * outro is treated as "no outro code change" (same philosophy as a failed
 * evolution): the current pattern keeps playing, the room still transitions to
 * `outro`, and the audience still gets the summary.
 */
async function generateOutroOrWarn(
	roomId: string,
	room: Room,
	engine: EngineDeps,
): Promise<string | null> {
	try {
		return await engine.generateOutro(
			getLlmProvider(),
			room.stateDoc as unknown as StateDoc,
			room.currentCode ?? '',
		)
	} catch (error) {
		console.info(`Outro generation failed for room ${roomId}: ${String(error)}`)
		hub.publishHost(roomId, {
			type: 'warning',
			message: 'Outro generation failed; music unchanged',
		})
		return null
	}
}

export async function undoLastChange(
	roomId: string,
	hostId: string,
): Promise<void> {
	const room = await prisma.room.findUnique({ where: { id: roomId } })
	if (!room || room.hostId !== hostId) {
		throw new Error('Room not found or access denied')
	}

	await prisma.recording.updateMany({
		where: { roomId, status: { in: ['applied', 'preparing'] } },
		data: { status: 'expired' },
	})
	await cancelPendingUpdates(roomId)

	const current = await prisma.patternVersion.findFirst({
		where: { roomId, status: 'applied' },
		orderBy: { appliedAt: 'desc' },
	})
	if (!current) {
		return
	}

	const previous = await prisma.patternVersion.findFirst({
		where: {
			roomId,
			id: { not: current.id },
			status: 'applied',
			appliedAt: { not: null },
		},
		orderBy: { appliedAt: 'desc' },
	})
	if (!previous) {
		return
	}

	const previousDoc = previous.stateDoc as unknown as StateDoc | null
	const previousWasMoment = Boolean(previousDoc?.moment)
	const previousCode = previousDoc?.moment
		? previousDoc.moment.baseCode
		: previous.code
	if (previousDoc) delete previousDoc.moment
	await prisma.patternVersion.update({
		where: { id: current.id },
		data: { status: 'reverted' },
	})

	let targetId = previous.id
	if (previousWasMoment) {
		await prisma.patternVersion.update({
			where: { id: previous.id },
			data: { status: 'reverted' },
		})
		const restored = await prisma.patternVersion.create({
			data: {
				roomId,
				source: 'undo',
				status: 'applied',
				code: previousCode,
				stateDoc: previousDoc as unknown as Prisma.InputJsonObject,
				appliedAt: new Date(),
			},
		})
		targetId = restored.id
	}
	await prisma.room.update({
		where: { id: roomId },
		data: {
			currentCode: previousCode,
			currentVersionId: targetId,
			...(previous.stateDoc
				? { stateDoc: previousDoc as unknown as Prisma.InputJsonObject }
				: {}),
		},
	})
	hub.publishHost(roomId, {
		type: 'code_update',
		code: previousCode,
		versionId: targetId,
		kind: 'undo',
	})
}

export async function skipPoll(roomId: string, hostId: string): Promise<void> {
	const room = await prisma.room.findUnique({ where: { id: roomId } })
	if (!room || room.hostId !== hostId) {
		throw new Error('Room not found or access denied')
	}
	const open = await prisma.poll.findFirst({
		where: { roomId, status: 'open', kind: { not: 'preference' } },
	})
	if (!open) return
	const updated = await prisma.poll.updateMany({
		where: { id: open.id, status: 'open' },
		data: {
			status: 'closed',
			winningOption: null,
			deliveryStatus: 'skipped',
			closedAt: new Date(),
			resolvedAt: new Date(),
		},
	})
	if (updated.count > 0) {
		hub.publishAudience(roomId, { type: 'music_result', pollId: open.id })
	}
}

export async function reportApplyResult(
	roomId: string,
	hostId: string,
	versionId: string,
	ok: boolean,
	error?: string,
): Promise<void> {
	const room = await prisma.room.findUnique({ where: { id: roomId } })
	if (!room || room.hostId !== hostId) {
		throw new Error('Room not found or access denied')
	}

	const version = await prisma.patternVersion.findFirst({
		where: { id: versionId, roomId },
	})
	if (version?.status === 'applied' && ok) return
	if (version?.status === 'rejected' && !ok) return
	if (version?.status !== 'candidate') {
		throw new Error('Version not found or not a candidate')
	}
	const sourcePoll =
		version.source === 'outro'
			? null
			: await prisma.poll.findUnique({ where: { id: version.source } })
	if (ok && version.source !== 'outro') {
		if (
			(sourcePoll && sourcePoll.deliveryStatus !== 'preparing') ||
			(version.baseVersionId &&
				version.baseVersionId !== room.currentVersionId) ||
			room.status !== 'live'
		) {
			const failed = await prisma.$transaction(async (tx) => {
				const rejected = await tx.patternVersion.updateMany({
					where: { id: versionId, status: 'candidate' },
					data: { status: 'rejected' },
				})
				if (rejected.count === 0) return 0
				const pollUpdated = await tx.poll.updateMany({
					where: { id: version.source, deliveryStatus: 'preparing' },
					data: { deliveryStatus: 'failed', resolvedAt: new Date() },
				})
				return pollUpdated.count
			})
			if (failed > 0) {
				hub.publishAudience(roomId, {
					type: 'music_result',
					pollId: version.source,
				})
			}
			throw new Error('Change is no longer current')
		}
	}

	if (ok) {
		const updated = await prisma.$transaction(async (tx) => {
			if (
				version.source !== 'outro' &&
				!(await contextValid(tx, roomId, version.context))
			)
				throw new Error('Contribution withdrawn or disabled')

			const claimed = await tx.patternVersion.updateMany({
				where: { id: versionId, status: 'candidate' },
				data: { status: 'applied', appliedAt: new Date() },
			})
			if (claimed.count === 0) throw new Error('Change was already resolved')
			const context = contributionContextSchema.safeParse(version.context)
			const nextDoc = version.stateDoc as unknown as StateDoc | null
			if (context.success && context.data.momentId && nextDoc?.moment)
				nextDoc.moment.expiresAt = Date.now() + (8 * 240_000) / room.bpm
			const roomUpdated = await tx.room.updateMany({
				where: {
					id: roomId,
					...(version.source !== 'outro' ? { status: 'live' } : {}),
					...(version.baseVersionId
						? { currentVersionId: version.baseVersionId }
						: {}),
				},
				data: {
					currentCode: version.code,
					currentVersionId: version.id,
					...(version.stateDoc
						? { stateDoc: nextDoc as unknown as Prisma.InputJsonObject }
						: {}),
				},
			})
			if (roomUpdated.count === 0)
				throw new Error('Change is no longer current')
			await resolveContributionContext(tx, roomId, version.context, 'applied')
			if (version.source === 'outro') return 0
			const pollUpdated = await tx.poll.updateMany({
				where: { id: version.source, deliveryStatus: 'preparing' },
				data: { deliveryStatus: 'applied', resolvedAt: new Date() },
			})
			if (sourcePoll && pollUpdated.count === 0) {
				throw new Error('Change is no longer current')
			}
			return pollUpdated.count
		})
		if (updated > 0) {
			const fresh = await prisma.room.findUnique({ where: { id: roomId } })
			const moment = (fresh?.stateDoc as unknown as StateDoc)?.moment
			if (moment) wakeScheduler(roomId, moment.expiresAt)
			const recording = await prisma.recording.findFirst({
				where: { roomId, status: 'applied', expiresAt: { not: null } },
			})
			if (recording?.expiresAt)
				wakeScheduler(roomId, recording.expiresAt.getTime())
			hub.publishAudience(roomId, {
				type: 'music_result',
				pollId: version.source,
			})
		}
	} else {
		const rejection = await prisma.$transaction(async (tx) => {
			await resolveContributionContext(tx, roomId, version.context, 'failed')
			const rejected = await tx.patternVersion.updateMany({
				where: { id: versionId, status: 'candidate' },
				data: { status: 'rejected' },
			})
			if (rejected.count === 0) return { rejected: false, pollUpdated: false }
			if (version.source === 'outro')
				return { rejected: true, pollUpdated: false }
			const pollUpdated = await tx.poll.updateMany({
				where: { id: version.source, deliveryStatus: 'preparing' },
				data: { deliveryStatus: 'failed', resolvedAt: new Date() },
			})
			return { rejected: true, pollUpdated: pollUpdated.count > 0 }
		})
		if (rejection.pollUpdated) {
			hub.publishAudience(roomId, {
				type: 'music_result',
				pollId: version.source,
			})
		}
		if (rejection.rejected) {
			hub.publishHost(roomId, {
				type: 'pattern_rejected',
				versionId,
				error: error ?? 'rejected by host',
			})
		}
	}
}

async function cancelPendingUpdates(roomId: string): Promise<void> {
	await prisma.$transaction(async (tx) => {
		for (const update of await tx.poll.findMany({
			where: { roomId, deliveryStatus: 'preparing' },
		}))
			await resolveContributionContext(tx, roomId, update.context, 'failed')
		await tx.poll.updateMany({
			where: { roomId, deliveryStatus: 'preparing' },
			data: { deliveryStatus: 'failed', resolvedAt: new Date() },
		})
		await tx.patternVersion.updateMany({
			where: { roomId, status: 'candidate', source: { not: 'outro' } },
			data: { status: 'rejected' },
		})
	})
	hub.publishAudience(roomId, { type: 'crowd_changed' })
	hub.publishHost(roomId, { type: 'crowd_changed' })
}
