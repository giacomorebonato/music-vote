import { prisma } from '@backend/db/client'
import { getLlmProvider } from '@backend/llm/provider'
import {
	generateInitialPattern,
	generateNextQuestion,
	generateOutro,
} from '@backend/music/engine'
import type { StateDoc } from '@backend/music/state-doc'
import { armScheduler, disarmScheduler } from '@backend/polls/scheduler'
import { hub } from '@backend/realtime/hub'
import type { createRoomSchema } from '@shared/schemas/room'
import type { z } from 'zod'
import type { Prisma, Room } from '../../prisma/generated/client'

type CreateRoomInput = z.infer<typeof createRoomSchema>

type EngineDeps = {
	generateInitialPattern: typeof generateInitialPattern
	generateNextQuestion: typeof generateNextQuestion
	generateOutro: typeof generateOutro
}

const defaultEngine: EngineDeps = {
	generateInitialPattern,
	generateNextQuestion,
	generateOutro,
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
	const question = await engine.generateNextQuestion(provider, doc)
	const now = new Date()
	const version = await prisma.patternVersion.create({
		data: {
			roomId,
			code,
			source: 'initial',
			status: 'applied',
			appliedAt: now,
		},
	})
	await prisma.room.update({
		where: { id: roomId },
		data: {
			currentCode: code,
			stateDoc: doc as unknown as Prisma.InputJsonObject,
			status: 'live',
		},
	})
	hub.publishHost(roomId, {
		type: 'code_update',
		code,
		versionId: version.id,
		kind: 'initial',
	})
	await prisma.poll.create({
		data: {
			roomId,
			seq: 1,
			kind: 'evolution',
			question,
			options: [
				{ key: 'yes', label: 'Yes' },
				{ key: 'no', label: 'No' },
			],
			status: 'queued',
		},
	})
	armScheduler(roomId)
}

async function closeOpenPoll(roomId: string): Promise<void> {
	await prisma.poll.updateMany({
		where: { roomId, status: 'open' },
		data: { status: 'closed', winningOption: null },
	})
}

async function finalizeRoomEnd(roomId: string): Promise<void> {
	await prisma.room.update({
		where: { id: roomId },
		data: { status: 'ended' },
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
		// biome-ignore lint/suspicious/noConsole: scheduler logs no-change polls
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

	const current = await prisma.patternVersion.findFirst({
		where: { roomId, status: 'applied' },
		orderBy: { appliedAt: 'desc' },
	})
	if (!current) {
		return
	}

	await prisma.patternVersion.update({
		where: { id: current.id },
		data: { status: 'reverted' },
	})

	const previous = await prisma.patternVersion.findFirst({
		where: { roomId, status: 'applied', appliedAt: { not: null } },
		orderBy: { appliedAt: 'desc' },
	})
	if (!previous) {
		return
	}

	await prisma.room.update({
		where: { id: roomId },
		data: { currentCode: previous.code },
	})
	hub.publishHost(roomId, {
		type: 'code_update',
		code: previous.code,
		versionId: previous.id,
		kind: 'undo',
	})
}

export async function skipPoll(roomId: string, hostId: string): Promise<void> {
	const room = await prisma.room.findUnique({ where: { id: roomId } })
	if (!room || room.hostId !== hostId) {
		throw new Error('Room not found or access denied')
	}
	await prisma.poll.updateMany({
		where: { roomId, status: 'open' },
		data: { status: 'closed', winningOption: null },
	})
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
	if (version?.status !== 'candidate') {
		throw new Error('Version not found or not a candidate')
	}

	if (ok) {
		await prisma.patternVersion.update({
			where: { id: versionId },
			data: { status: 'applied', appliedAt: new Date() },
		})
		await prisma.room.update({
			where: { id: roomId },
			data: { currentCode: version.code },
		})
	} else {
		await prisma.patternVersion.update({
			where: { id: versionId },
			data: { status: 'rejected' },
		})
		hub.publishHost(roomId, {
			type: 'pattern_rejected',
			versionId,
			error: error ?? 'rejected by host',
		})
	}
}
