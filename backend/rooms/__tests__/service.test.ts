process.env.DATABASE_URL = 'file:./rooms-test.db'

import {
	afterAll,
	beforeAll,
	beforeEach,
	expect,
	jest,
	mock,
	test,
} from 'bun:test'
import { execSync } from 'node:child_process'
import { MockLlmProvider } from '@backend/llm/provider'
import {
	generateInitialPattern,
	generateOutro,
	MusicGenError,
} from '@backend/music/engine'
import type { Context } from '@backend/trpc/context'
import type { WsEvent } from '@shared/realtime/events'

// Own the DB: prisma/rooms-test.db, migrated before connecting. Unique per
// DB-backed test file so the module-load `migrate deploy` runs cannot collide
// under `bun test --parallel` (and the shared client below is the same one the
// services use, so assertions and writes never diverge).
execSync('DATABASE_URL=file:./rooms-test.db bunx prisma migrate deploy', {
	stdio: 'pipe',
})

const { prisma } = await import('@backend/db/client')

const createdUserIds: string[] = []
let service: typeof import('@backend/rooms/service')
let roomsRouter: typeof import('@backend/trpc/rooms').roomsRouter
let mockProvider: MockLlmProvider
let mockScheduler: ReturnType<typeof jest.fn>
let hubSpies: {
	publishHost: ReturnType<typeof jest.fn>
	publishAudience: ReturnType<typeof jest.fn>
}

async function makeHost(): Promise<{ id: string; email: string }> {
	const email = `room-svc-host-${crypto.randomUUID()}@example.com`
	const user = await prisma.user.create({ data: { name: 'Host', email } })
	createdUserIds.push(user.id)
	return user
}

beforeAll(async () => {
	mockScheduler = jest.fn()
	hubSpies = {
		publishHost: jest.fn(),
		publishAudience: jest.fn(),
	}
	mock.module('@backend/polls/scheduler', () => ({
		armScheduler: mockScheduler,
		disarmScheduler: jest.fn(),
	}))
	mock.module('@backend/llm/provider', () => ({
		getLlmProvider: () => mockProvider,
	}))
	mock.module('@backend/realtime/hub', () => ({
		hub: hubSpies,
	}))
	service = await import('@backend/rooms/service')
	const roomsMod = await import('@backend/trpc/rooms')
	roomsRouter = roomsMod.roomsRouter
})

beforeEach(() => {
	mockProvider = new MockLlmProvider([
		's("bd sd cp hh")',
		'Sharper drums or warmer chords?\n- sharper drums\n- warmer chords',
		's("bd sd cp hh")',
	])
	mockScheduler.mockClear()
	hubSpies.publishHost.mockClear()
	hubSpies.publishAudience.mockClear()
})

afterAll(async () => {
	// No $disconnect here: `prisma` is the process-wide client every service
	// shares, so closing it would break test files that run later in this process.
	await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
})

const baseInput = () => ({
	bpm: 120,
	lengthMin: 10,
	pollIntervalSec: 120,
	pollOpenSec: 45,
	genre: 'techno',
})

test('createRoom creates lobby with lengthSec = lengthMin * 60', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())

	expect(room.status).toBe('lobby')
	expect(room.lengthSec).toBe(600)
	expect(room.pollOpenSec).toBe(45)
})

test('createRoom persists the per-room poll open window', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, {
		...baseInput(),
		pollOpenSec: 20,
	})

	expect(room.pollOpenSec).toBe(20)
})

test('startRoom: initial generation failure leaves room lobby with zero versions', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())

	await expect(
		service.startRoom(room.id, host.id, {
			generateInitialPattern: async () => {
				throw new Error('initial generation failed')
			},
			generateOutro,
		}),
	).rejects.toThrow('initial generation failed')

	const updated = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updated?.status).toBe('lobby')
	expect(updated?.currentCode).toBeNull()

	const versions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
	})
	expect(versions).toHaveLength(0)

	const polls = await prisma.poll.findMany({ where: { roomId: room.id } })
	expect(polls).toHaveLength(0)
})

test('startRoom makes room live, applies initial version, sets currentCode, arms scheduler', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())

	await service.startRoom(room.id, host.id)

	const updated = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updated?.status).toBe('live')
	expect(updated?.currentCode).toBe('s("bd sd cp hh")')

	const versions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
		orderBy: { id: 'asc' },
	})
	expect(versions).toHaveLength(1)
	expect(versions[0].source).toBe('initial')
	expect(versions[0].status).toBe('applied')

	const polls = await prisma.poll.findMany({ where: { roomId: room.id } })
	expect(polls).toHaveLength(3)
	expect(
		polls.every(
			(poll) =>
				poll.kind === 'preference' &&
				poll.status === 'open' &&
				poll.closesAt === null &&
				poll.winningOption === null,
		),
	).toBe(true)
	expect(polls.map((poll) => poll.question)).toContain(
		'What energy feels right?',
	)

	expect(mockScheduler.mock.calls.length).toBe(1)
	expect(mockScheduler.mock.calls[0][0]).toBe(room.id)

	const hostEvents = hubSpies.publishHost.mock.calls as [string, WsEvent][]
	expect(hostEvents).toHaveLength(1)
	expect(hostEvents[0][0]).toBe(room.id)
	expect(hostEvents[0][1]).toMatchObject({
		type: 'code_update',
		code: 's("bd sd cp hh")',
		kind: 'initial',
	})
	expect((hostEvents[0][1] as { versionId: string }).versionId).toBe(
		versions[0].id,
	)
})

test('undoLastChange reverts current code and marks version reverted', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())
	await service.startRoom(room.id, host.id)

	const candidate = await prisma.patternVersion.create({
		data: {
			roomId: room.id,
			code: 'note("c2").s("sawtooth")',
			source: 'evolution',
			status: 'candidate',
		},
	})
	await service.reportApplyResult(room.id, host.id, candidate.id, true)

	await service.undoLastChange(room.id, host.id)

	const updated = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updated?.currentCode).toBe('s("bd sd cp hh")')

	const versions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
		orderBy: { appliedAt: 'asc' },
	})
	expect(versions).toHaveLength(2)
	expect(versions[0].status).toBe('applied')
	expect(versions[1].status).toBe('reverted')

	const hostEvents = hubSpies.publishHost.mock.calls as [string, WsEvent][]
	const undoEvent = hostEvents.find(
		([, event]) => event.type === 'code_update' && event.kind === 'undo',
	)
	expect(undoEvent).toBeDefined()
	if (!undoEvent) throw new Error('undo event missing')
	expect(undoEvent[1]).toMatchObject({
		type: 'code_update',
		code: 's("bd sd cp hh")',
		kind: 'undo',
	})
	expect((undoEvent[1] as { versionId: string }).versionId).toBe(versions[0].id)
})

test('undoLastChange is a no-op when there is no applied version', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())

	await service.undoLastChange(room.id, host.id)

	const updated = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updated?.currentCode).toBeNull()
})

test('endRoom while poll open closes poll with null winner and no evolution version', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())
	await service.startRoom(room.id, host.id)

	const openPoll = await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: 10,
			kind: 'evolution',
			question: 'More drums?',
			options: [
				{ key: 'yes', label: 'Yes' },
				{ key: 'no', label: 'No' },
			],
			status: 'open',
		},
	})

	const beforeVersions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
	})

	await service.endRoom(room.id, host.id)

	const closedPoll = await prisma.poll.findUnique({
		where: { id: openPoll.id },
	})
	expect(closedPoll?.status).toBe('closed')
	expect(closedPoll?.winningOption).toBeNull()

	const afterVersions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
		orderBy: { id: 'asc' },
	})
	expect(afterVersions.length).toBe(beforeVersions.length + 1)
	expect(afterVersions.at(-1)?.source).toBe('outro')

	const hostEvents = hubSpies.publishHost.mock.calls as [string, WsEvent][]
	const outroEvent = hostEvents.find(
		([, event]) => event.type === 'code_update' && event.kind === 'outro',
	)
	expect(outroEvent).toBeDefined()
	if (!outroEvent) throw new Error('outro event missing')
	expect(outroEvent[1]).toMatchObject({
		type: 'code_update',
		code: 's("bd sd cp hh")',
		kind: 'outro',
	})
	expect((outroEvent[1] as { versionId: string }).versionId).toBe(
		afterVersions.at(-1)?.id ?? '',
	)
})

test('endRoom from lobby skips outro and ends immediately', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())

	await service.endRoom(room.id, host.id)

	const updated = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updated?.status).toBe('ended')

	const audienceEvents = hubSpies.publishAudience.mock.calls as [
		string,
		WsEvent,
	][]
	const hostEvents = hubSpies.publishHost.mock.calls as [string, WsEvent][]
	expect(
		audienceEvents.filter(([, event]) => event.type === 'room_ended'),
	).toHaveLength(1)
	expect(hostEvents).toContainEqual([
		room.id,
		{ type: 'room_status', status: 'ended' },
	])
})

test('endRoom on live room goes outro then ended after pollIntervalSec', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, {
		...baseInput(),
		pollIntervalSec: 5,
	})
	await service.startRoom(room.id, host.id)

	jest.useFakeTimers()
	await service.endRoom(room.id, host.id)

	let updated = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updated?.status).toBe('outro')

	jest.advanceTimersByTime(5000)
	for (let i = 0; i < 20; i++) {
		await Promise.resolve()
		updated = await prisma.room.findUnique({ where: { id: room.id } })
		if (updated?.status === 'ended') break
	}

	expect(updated?.status).toBe('ended')
	jest.useRealTimers()
})

test('reportApplyResult(false) rejects version', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())
	const candidate = await prisma.patternVersion.create({
		data: {
			roomId: room.id,
			code: 'note("c2").s("sawtooth")',
			source: 'evolution',
			status: 'candidate',
		},
	})

	await service.reportApplyResult(
		room.id,
		host.id,
		candidate.id,
		false,
		'too harsh',
	)

	const version = await prisma.patternVersion.findUnique({
		where: { id: candidate.id },
	})
	expect(version?.status).toBe('rejected')

	const hostEvents = hubSpies.publishHost.mock.calls as [string, WsEvent][]
	expect(hostEvents).toHaveLength(1)
	expect(hostEvents[0][1]).toEqual({
		type: 'pattern_rejected',
		versionId: candidate.id,
		error: 'too harsh',
	})
})

test('legacy skip does not close persistent questions', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())
	await service.startRoom(room.id, host.id)
	await service.skipPoll(room.id, host.id)
	const questions = await prisma.poll.findMany({ where: { roomId: room.id } })
	expect(questions).toHaveLength(3)
	expect(
		questions.every(
			(question) =>
				question.status === 'open' && question.winningOption === null,
		),
	).toBe(true)
})

test('host confirmation applies the candidate and informs listeners', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())
	await service.startRoom(room.id, host.id)
	const liveRoom = await prisma.room.findUniqueOrThrow({
		where: { id: room.id },
	})
	const poll = await prisma.poll.findFirstOrThrow({
		where: { roomId: room.id },
	})
	await prisma.poll.update({
		where: { id: poll.id },
		data: {
			status: 'closed',
			winningOption: 'sharper-drums',
			deliveryStatus: 'preparing',
			closedAt: new Date(),
		},
	})
	const candidate = await prisma.patternVersion.create({
		data: {
			roomId: room.id,
			code: 's("bd*2")',
			source: poll.id,
			status: 'candidate',
			baseVersionId: liveRoom.currentVersionId,
			stateDoc: { marker: 'confirmed change' },
		},
	})
	await service.reportApplyResult(room.id, host.id, candidate.id, true)
	await service.reportApplyResult(room.id, host.id, candidate.id, true)
	const applied = await prisma.room.findUniqueOrThrow({
		where: { id: room.id },
	})
	const result = await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })
	expect(applied.currentCode).toBe('s("bd*2")')
	expect(applied.currentVersionId).toBe(candidate.id)
	expect(applied.stateDoc).toEqual({ marker: 'confirmed change' })
	expect(result.deliveryStatus).toBe('applied')
	const audienceEvents = hubSpies.publishAudience.mock.calls as [
		string,
		WsEvent,
	][]
	expect(
		audienceEvents.filter(([, event]) => event.type === 'music_result'),
	).toHaveLength(1)
	expect(audienceEvents.at(-1)?.[1]).toEqual({
		type: 'music_result',
		pollId: poll.id,
	})
})

test('late confirmation cannot replace a newer version', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())
	await service.startRoom(room.id, host.id)
	const liveRoom = await prisma.room.findUniqueOrThrow({
		where: { id: room.id },
	})
	const poll = await prisma.poll.findFirstOrThrow({
		where: { roomId: room.id },
	})
	await prisma.poll.update({
		where: { id: poll.id },
		data: { status: 'closed', deliveryStatus: 'preparing' },
	})
	const candidate = await prisma.patternVersion.create({
		data: {
			roomId: room.id,
			code: 's("bd*2")',
			source: poll.id,
			status: 'candidate',
			baseVersionId: liveRoom.currentVersionId,
		},
	})
	await prisma.room.update({
		where: { id: room.id },
		data: { currentVersionId: 'newer' },
	})
	await expect(
		service.reportApplyResult(room.id, host.id, candidate.id, true),
	).rejects.toThrow('no longer current')
	const after = await prisma.room.findUniqueOrThrow({ where: { id: room.id } })
	const rejected = await prisma.patternVersion.findUniqueOrThrow({
		where: { id: candidate.id },
	})
	expect(after.currentCode).toBe(liveRoom.currentCode)
	expect(rejected.status).toBe('rejected')
})

test('reportApplyResult rejects a non-owner and leaves the version untouched', async () => {
	const host = await makeHost()
	const other = await makeHost()
	const room = await service.createRoom(host.id, baseInput())
	const candidate = await prisma.patternVersion.create({
		data: {
			roomId: room.id,
			code: 'note("c2").s("sawtooth")',
			source: 'evolution',
			status: 'candidate',
		},
	})

	await expect(
		service.reportApplyResult(room.id, other.id, candidate.id, true),
	).rejects.toThrow('Room not found or access denied')

	const version = await prisma.patternVersion.findUnique({
		where: { id: candidate.id },
	})
	expect(version?.status).toBe('candidate')

	const updated = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updated?.currentCode).not.toBe(candidate.code)
})

test('router get returns FORBIDDEN for non-owner', async () => {
	const host = await makeHost()
	const other = await makeHost()
	const room = await service.createRoom(host.id, baseInput())

	const caller = roomsRouter.createCaller({
		prisma,
		session: { user: { id: other.id } },
	} as Context)

	let thrown: unknown
	try {
		await caller.get({ roomId: room.id })
	} catch (error) {
		thrown = error
	}

	expect(thrown).toBeDefined()
	expect((thrown as { code?: string }).code).toBe('FORBIDDEN')
})

const outroEngineThatFails = {
	generateInitialPattern,
	generateOutro: async () => {
		throw new MusicGenError('Failed to generate a valid outro after 2 attempts')
	},
}

test('endRoom keeps the current pattern and still ends when outro generation fails', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, {
		...baseInput(),
		pollIntervalSec: 5,
	})
	await service.startRoom(room.id, host.id)
	await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: 10,
			kind: 'evolution',
			question: 'More drums?',
			options: [
				{ key: 'yes', label: 'Yes' },
				{ key: 'no', label: 'No' },
			],
			status: 'open',
		},
	})

	jest.useFakeTimers()
	await service.endRoom(room.id, host.id, outroEngineThatFails)

	let updated = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updated?.status).toBe('outro')
	expect(updated?.currentCode).toBe('s("bd sd cp hh")')

	const versions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
	})
	expect(versions).toHaveLength(1)
	expect(versions[0].source).toBe('initial')

	const hostEvents = hubSpies.publishHost.mock.calls as [string, WsEvent][]
	expect(
		hostEvents.some(
			([, event]) => event.type === 'code_update' && event.kind === 'outro',
		),
	).toBe(false)
	const warning = hostEvents.find(([, event]) => event.type === 'warning')
	expect(warning).toBeDefined()
	if (!warning) throw new Error('warning event missing')
	expect(warning[1]).toEqual({
		type: 'warning',
		message: 'Outro generation failed; music unchanged',
	})

	jest.advanceTimersByTime(5000)
	for (let i = 0; i < 20; i++) {
		await Promise.resolve()
		updated = await prisma.room.findUnique({ where: { id: room.id } })
		if (updated?.status === 'ended') break
	}
	expect(updated?.status).toBe('ended')

	const audienceEvents = hubSpies.publishAudience.mock.calls as [
		string,
		WsEvent,
	][]
	expect(audienceEvents.some(([, event]) => event.type === 'room_ended')).toBe(
		true,
	)
	jest.useRealTimers()
})

test('performance actions require owner and live room, and commit only on playback confirmation', async () => {
	const host = await makeHost()
	const room = await service.createRoom(host.id, baseInput())
	await expect(service.perform(room.id, host.id, 'build')).rejects.toThrow(
		'Live room',
	)
	await service.startRoom(room.id, host.id)
	await service.setGrooveLock(room.id, host.id, true)
	await expect(
		service.perform(room.id, 'someone-else', 'build'),
	).rejects.toThrow('access denied')
	await expect(
		service.setGrooveLock(room.id, 'someone-else', false),
	).rejects.toThrow('access denied')
	const original = await prisma.room.findUniqueOrThrow({
		where: { id: room.id },
	})
	await service.perform(room.id, host.id, 'build')
	const candidate = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'candidate' },
	})
	expect(
		(await prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
			.currentCode,
	).toBe(original.currentCode)
	await expect(service.perform(room.id, host.id, 'drop')).rejects.toThrow(
		'Wait',
	)
	await service.reportApplyResult(room.id, host.id, candidate.id, true)
	expect(
		(await prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
			.currentCode,
	).toBe(candidate.code)
	await service.undoLastChange(room.id, host.id)
	const undone = await prisma.room.findUniqueOrThrow({ where: { id: room.id } })
	expect(undone.currentCode).toBe(original.currentCode)
	expect(undone.grooveLocked).toBe(true)
})
