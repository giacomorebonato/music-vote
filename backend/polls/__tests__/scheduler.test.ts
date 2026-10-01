process.env.DATABASE_URL = 'file:./scheduler-test.db'
process.env.MV_E2E_FAST = '1'

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	jest,
	mock,
	test,
} from 'bun:test'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { WsEvent } from '@shared/realtime/events'
import { PrismaBunSqlite } from 'prisma-adapter-bun-sqlite'
import { type Prisma, PrismaClient } from '../../../prisma/generated/client'

const testDbPath = resolve(
	import.meta.dir,
	'..',
	'..',
	'..',
	'prisma',
	'scheduler-test.db',
)

execSync('DATABASE_URL=file:./scheduler-test.db bunx prisma migrate deploy', {
	stdio: 'pipe',
})

const prisma = new PrismaClient({
	adapter: new PrismaBunSqlite({ url: `file:${testDbPath}` }),
})

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realDateNow = Date.now

type FakeClock = {
	now: () => number
	setTimeout: (callback: () => void | Promise<void>, ms: number) => number
	clearTimeout: (id: number) => void
	tick: (ms: number) => Promise<void>
	setTime: (time: number) => void
}

type MockFn = ReturnType<typeof jest.fn>

function createFakeClock(start = 0): FakeClock {
	let time = start
	type Timer = { id: number; at: number; cb: () => void | Promise<void> }
	let timers: Timer[] = []
	let nextId = 1

	function now(): number {
		return time
	}

	function setTimeout(callback: () => void, ms: number): number {
		const id = nextId++
		timers.push({ id, at: time + ms, cb: callback })
		return id
	}

	function clearTimeout(id: number): void {
		timers = timers.filter((timer) => timer.id !== id)
	}

	async function tick(ms: number): Promise<void> {
		time += ms
		const seen = new Set<number>()
		const due = timers
			.filter((timer) => timer.at <= time)
			.sort((a, b) => a.at - b.at)

		while (due.length > 0) {
			const timer = due.shift()
			if (!timer || seen.has(timer.id)) continue
			seen.add(timer.id)
			timers = timers.filter((t) => t.id !== timer.id)
			await timer.cb()
			const newly = timers.filter((t) => t.at <= time && !seen.has(t.id))
			due.push(...newly)
			due.sort((a, b) => a.at - b.at)
		}
	}

	function setTime(next: number): void {
		time = next
	}

	return { now, setTimeout, clearTimeout, tick, setTime }
}

const createdUserIds: string[] = []
let scheduler: typeof import('@backend/polls/scheduler')
let service: typeof import('@backend/rooms/service')
let mockGenerateEvolution: MockFn
let mockGenerateNextQuestion: MockFn
let mockGenerateOutro: MockFn
let hubSpies: {
	publishHost: ReturnType<typeof jest.fn>
	publishAudience: ReturnType<typeof jest.fn>
}
let fakeClock: FakeClock

async function makeHost(): Promise<{ id: string; email: string }> {
	const email = `sched-host-${crypto.randomUUID()}@example.com`
	const user = await prisma.user.create({ data: { name: 'Host', email } })
	createdUserIds.push(user.id)
	return user
}

function baseStateDoc(): Prisma.InputJsonObject {
	return {
		genre: 'techno',
		bpm: 120,
		elements: {
			drums: false,
			bass: false,
			melody: false,
			harmony: false,
			soundDesign: [],
		},
		history: [],
		polledDimensions: [],
	} as unknown as Prisma.InputJsonObject
}

async function makeRoom(
	hostId: string,
	overrides?: Partial<{
		lengthSec: number
		pollIntervalSec: number
		status: string
		currentCode: string
	}>,
): Promise<{ id: string; createdAt: Date; pollIntervalSec: number }> {
	const room = await prisma.room.create({
		data: {
			hostId,
			bpm: 120,
			lengthSec: 300,
			pollIntervalSec: 60,
			genre: 'techno',
			status: 'live',
			currentCode: 's("bd")',
			stateDoc: baseStateDoc(),
			...overrides,
		},
	})
	fakeClock.setTime(room.createdAt.getTime())
	return room as { id: string; createdAt: Date; pollIntervalSec: number }
}

async function makePoll(
	roomId: string,
	seq: number,
	overrides?: Partial<{
		kind: string
		question: string
		status: string
	}>,
) {
	return prisma.poll.create({
		data: {
			roomId,
			seq,
			kind: 'evolution',
			question: 'More drums?',
			options: [
				{ key: 'yes', label: 'Yes' },
				{ key: 'no', label: 'No' },
			],
			status: 'queued',
			...overrides,
		},
	})
}

async function vote(
	pollId: string,
	choice: string,
	sessionToken?: string,
): Promise<void> {
	await prisma.vote.create({
		data: {
			pollId,
			choice,
			sessionToken: sessionToken ?? crypto.randomUUID(),
		},
	})
}

function hostEvents(): [string, WsEvent][] {
	return hubSpies.publishHost.mock.calls as [string, WsEvent][]
}

function audienceEvents(): [string, WsEvent][] {
	return hubSpies.publishAudience.mock.calls as [string, WsEvent][]
}

beforeAll(async () => {
	hubSpies = {
		publishHost: jest.fn(),
		publishAudience: jest.fn(),
	}
	mock.module('@backend/realtime/hub', () => ({ hub: hubSpies }))
	mock.module('@backend/llm/provider', () => ({
		getLlmProvider: jest.fn(() => ({ chat: jest.fn(async () => '') })),
	}))
	mock.module('@backend/music/engine', () => ({
		generateEvolution: jest.fn(),
		generateNextQuestion: jest.fn(),
		generateInitialPattern: jest.fn(),
		generateOutro: jest.fn(),
	}))

	scheduler = await import('@backend/polls/scheduler')
	const engineMod = (await import('@backend/music/engine')) as unknown as {
		generateEvolution: MockFn
		generateNextQuestion: MockFn
		generateInitialPattern: MockFn
		generateOutro: MockFn
	}
	mockGenerateEvolution = engineMod.generateEvolution
	mockGenerateNextQuestion = engineMod.generateNextQuestion
	mockGenerateOutro = engineMod.generateOutro
	service = await import('@backend/rooms/service')
})

beforeEach(() => {
	fakeClock = createFakeClock(0)
	scheduler.setSchedulerClock(fakeClock)
	globalThis.setTimeout =
		fakeClock.setTimeout as unknown as typeof realSetTimeout
	globalThis.clearTimeout =
		fakeClock.clearTimeout as unknown as typeof realClearTimeout
	Date.now = fakeClock.now

	hubSpies.publishHost.mockClear()
	hubSpies.publishAudience.mockClear()

	mockGenerateEvolution.mockImplementation(async () => ({
		code: 's("bd sd")',
		changeSummary: 'more drums',
	}))
	mockGenerateNextQuestion.mockImplementation(async () => 'More energy?')
	mockGenerateOutro.mockImplementation(async () => 's("bd sd")')
})

afterEach(() => {
	globalThis.setTimeout = realSetTimeout
	globalThis.clearTimeout = realClearTimeout
	Date.now = realDateNow
})

afterAll(async () => {
	await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
	await prisma.$disconnect()
})

test('full cycle: open poll, tally votes, create candidate version', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id)
	const poll = await makePoll(room.id, 1)

	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)

	expect(scheduler.isSchedulerArmed(room.id)).toBe(true)
	const opened = audienceEvents().find((e) => e[1].type === 'poll_opened')
	expect(opened).toBeDefined()
	if (!opened) throw new Error('poll_opened missing')
	expect(opened[0]).toBe(room.id)
	expect(opened[1]).toMatchObject({
		type: 'poll_opened',
		poll: { id: poll.id, question: 'More drums?' },
	})

	await vote(poll.id, 'yes', 'voter-1')
	await vote(poll.id, 'yes', 'voter-2')
	await vote(poll.id, 'no', 'voter-3')

	await fakeClock.tick(5000)

	const closedPoll = await prisma.poll.findUnique({ where: { id: poll.id } })
	expect(closedPoll?.status).toBe('closed')
	expect(closedPoll?.winningOption).toBe('yes')

	const versions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
	})
	expect(versions).toHaveLength(1)
	expect(versions[0].source).toBe(poll.id)
	expect(versions[0].status).toBe('candidate')

	const closed = audienceEvents().find((e) => e[1].type === 'poll_closed')
	expect(closed?.[1]).toMatchObject({
		type: 'poll_closed',
		pollId: poll.id,
		winningOption: 'yes',
	})

	const codeUpdate = hostEvents().find(
		(e) => e[1].type === 'code_update' && e[1].kind === 'evolution',
	)
	expect(codeUpdate?.[1]).toMatchObject({
		type: 'code_update',
		code: 's("bd sd")',
		kind: 'evolution',
	})

	const nextPolls = await prisma.poll.findMany({
		where: { roomId: room.id, status: 'queued' },
	})
	expect(nextPolls).toHaveLength(1)
	expect(nextPolls[0].seq).toBe(2)

	scheduler.disarmScheduler(room.id)
})

test('zero votes: null winner, no version, next poll armed', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 10 })
	const poll = await makePoll(room.id, 1)

	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)
	await fakeClock.tick(5000)

	const closedPoll = await prisma.poll.findUnique({ where: { id: poll.id } })
	expect(closedPoll?.status).toBe('closed')
	expect(closedPoll?.winningOption).toBeNull()

	const versions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
	})
	expect(versions).toHaveLength(0)

	const closed = audienceEvents().find((e) => e[1].type === 'poll_closed')
	expect(closed?.[1]).toMatchObject({
		type: 'poll_closed',
		pollId: poll.id,
		winningOption: null,
	})

	const queued = await prisma.poll.findMany({
		where: { roomId: room.id, status: 'queued' },
	})
	expect(queued).toHaveLength(1)

	// Next interval opens the queued poll
	await fakeClock.tick(5000)
	const opened = audienceEvents().find(
		(e) => e[1].type === 'poll_opened' && e[1].poll.id === queued[0].id,
	)
	expect(opened?.[1]).toMatchObject({
		type: 'poll_opened',
		poll: { id: queued[0].id },
	})

	scheduler.disarmScheduler(room.id)
})

test('end poll appears at 75% length and wrap wins triggers endRoom', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, {
		lengthSec: 60,
		pollIntervalSec: 20,
	})
	const poll1 = await makePoll(room.id, 1)

	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)

	// First evolution poll lifecycle: 0 -> open, 5s -> close -> queue seq2
	await vote(poll1.id, 'yes', 'v1')
	await fakeClock.tick(5000)

	let polls = await prisma.poll.findMany({ where: { roomId: room.id } })
	expect(polls).toHaveLength(2)

	// 20s: open seq2, 25s: close -> no more evolutions queued (75% near)
	await fakeClock.tick(15000)
	const polls2 = await prisma.poll.findMany({ where: { roomId: room.id } })
	const poll2 = polls2.find((p) => p.seq === 2)
	expect(poll2?.status).toBe('open')
	if (!poll2) throw new Error('seq 2 poll missing')
	await vote(poll2.id, 'yes', 'v2')
	await fakeClock.tick(5000)

	// 45s: end poll should be inserted and opened
	await fakeClock.tick(20000)

	polls = await prisma.poll.findMany({ where: { roomId: room.id } })
	const endPoll = polls.find((p) => p.kind === 'end')
	expect(endPoll).toBeDefined()
	expect(endPoll?.status).toBe('open')
	if (!endPoll) throw new Error('end poll missing')
	await vote(endPoll.id, 'wrap', 'v3')
	await fakeClock.tick(5000)

	const updatedRoom = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updatedRoom?.status).toBe('outro')

	scheduler.disarmScheduler(room.id)
})

test('outro path through endRoom finalizes after interval', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 5 })

	await service.endRoom(room.id, host.id)

	let updated = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updated?.status).toBe('outro')

	await fakeClock.tick(5000)
	for (let i = 0; i < 20; i++) {
		await Promise.resolve()
		updated = await prisma.room.findUnique({ where: { id: room.id } })
		if (updated?.status === 'ended') break
	}

	expect(updated?.status).toBe('ended')
	const ended = audienceEvents().find((e) => e[1].type === 'room_ended')
	expect(ended?.[1]).toEqual({ type: 'room_ended' })
})

test('restoreSchedulers closes overdue open poll and arms live room', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id)
	const now = new Date(fakeClock.now())
	const poll = await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: 1,
			kind: 'evolution',
			question: 'Overdue?',
			options: [
				{ key: 'yes', label: 'Yes' },
				{ key: 'no', label: 'No' },
			],
			status: 'open',
			openedAt: new Date(now.getTime() - 10000),
			closesAt: new Date(now.getTime() - 1000),
		},
	})

	await scheduler.restoreSchedulers()

	const closed = await prisma.poll.findUnique({ where: { id: poll.id } })
	expect(closed?.status).toBe('closed')
	expect(closed?.winningOption).toBeNull()

	const versions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
	})
	expect(versions).toHaveLength(0)

	expect(scheduler.isSchedulerArmed(room.id)).toBe(true)
	const event = audienceEvents().find((e) => e[1].type === 'poll_closed')
	expect(event?.[1]).toMatchObject({
		type: 'poll_closed',
		pollId: poll.id,
		winningOption: null,
	})

	scheduler.disarmScheduler(room.id)
})

test('restoreSchedulers finalizes outro room older than interval', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 5 })
	await prisma.room.update({
		where: { id: room.id },
		data: { status: 'outro' },
	})
	const now = new Date(fakeClock.now())
	await prisma.patternVersion.create({
		data: {
			roomId: room.id,
			code: 's("bd sd")',
			source: 'outro',
			status: 'candidate',
			appliedAt: new Date(now.getTime() - 6000),
		},
	})

	await scheduler.restoreSchedulers()

	const updated = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updated?.status).toBe('ended')

	const ended = audienceEvents().find((e) => e[1].type === 'room_ended')
	expect(ended?.[1]).toEqual({ type: 'room_ended' })
	const status = hostEvents().find((e) => e[1].type === 'room_status')
	expect(status?.[1]).toEqual({ type: 'room_status', status: 'ended' })

	scheduler.disarmScheduler(room.id)
})

test('tie-break uses same seed deterministically and logs seed', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id)
	const logs: string[] = []
	const realInfo = console.info
	console.info = (message: unknown) => {
		logs.push(String(message))
	}

	async function runTiePoll(pollId: string): Promise<string | null> {
		scheduler.disarmScheduler(room.id)
		scheduler.armScheduler(room.id)
		await fakeClock.tick(0)
		const open = await prisma.poll.findUnique({ where: { id: pollId } })
		if (open?.status !== 'open') throw new Error('poll did not open')
		await vote(pollId, 'yes', 'a')
		await vote(pollId, 'no', 'b')
		await fakeClock.tick(5000)
		const updated = await prisma.poll.findUnique({ where: { id: pollId } })
		return updated?.winningOption ?? null
	}

	const id = `tie-poll-${crypto.randomUUID()}`
	const pollA = await prisma.poll.create({
		data: {
			id,
			roomId: room.id,
			seq: 1,
			kind: 'evolution',
			question: 'Tie?',
			options: [
				{ key: 'yes', label: 'Yes' },
				{ key: 'no', label: 'No' },
			],
			status: 'queued',
		},
	})
	const winnerA = await runTiePoll(pollA.id)
	expect(logs.some((line) => line.includes('tie-break seed='))).toBe(true)

	await prisma.poll.delete({ where: { id: pollA.id } })
	await prisma.vote.deleteMany({ where: { pollId: pollA.id } })

	const pollB = await prisma.poll.create({
		data: {
			id,
			roomId: room.id,
			seq: 1,
			kind: 'evolution',
			question: 'Tie?',
			options: [
				{ key: 'yes', label: 'Yes' },
				{ key: 'no', label: 'No' },
			],
			status: 'queued',
		},
	})
	const winnerB = await runTiePoll(pollB.id)
	expect(winnerA).toBe(winnerB)

	console.info = realInfo
	scheduler.disarmScheduler(room.id)
})

test('restoreSchedulers arms close timer for non-overdue open poll', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id)
	const now = new Date(fakeClock.now())
	const poll = await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: 1,
			kind: 'evolution',
			question: 'Mid-window?',
			options: [
				{ key: 'yes', label: 'Yes' },
				{ key: 'no', label: 'No' },
			],
			status: 'open',
			openedAt: now,
			closesAt: new Date(now.getTime() + 3000),
		},
	})
	await vote(poll.id, 'yes', 'v1')

	await scheduler.restoreSchedulers()

	expect(scheduler.isSchedulerArmed(room.id)).toBe(true)

	await fakeClock.tick(3000)

	const closed = await prisma.poll.findUnique({ where: { id: poll.id } })
	expect(closed?.status).toBe('closed')
	expect(closed?.winningOption).toBe('yes')

	const versions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
	})
	expect(versions).toHaveLength(1)

	const codeUpdate = hostEvents().find(
		(e) => e[1].type === 'code_update' && e[1].kind === 'evolution',
	)
	expect(codeUpdate).toBeDefined()

	scheduler.disarmScheduler(room.id)
})

test('off-option votes are ignored and do not crash', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 10 })
	const poll = await makePoll(room.id, 1)

	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)

	await vote(poll.id, 'yes', 'v1')
	await vote(poll.id, 'invalid-choice', 'v2')
	await vote(poll.id, 'no', 'v3')
	await vote(poll.id, 'yes', 'v4')

	await fakeClock.tick(5000)

	const closed = await prisma.poll.findUnique({ where: { id: poll.id } })
	expect(closed?.status).toBe('closed')
	expect(closed?.winningOption).toBe('yes')

	const versions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
	})
	expect(versions).toHaveLength(1)

	scheduler.disarmScheduler(room.id)
})

test('end poll continue queues next evolution and keeps room live', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, {
		lengthSec: 120,
		pollIntervalSec: 20,
	})
	const poll = await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: 1,
			kind: 'end',
			question: 'End the set?',
			options: [
				{ key: 'wrap', label: 'Wrap it up' },
				{ key: 'continue', label: 'Keep going' },
			],
			status: 'queued',
		},
	})

	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)

	const open = await prisma.poll.findUnique({ where: { id: poll.id } })
	expect(open?.status).toBe('open')

	await vote(poll.id, 'continue', 'v1')
	await fakeClock.tick(5000)

	const closed = await prisma.poll.findUnique({ where: { id: poll.id } })
	expect(closed?.status).toBe('closed')
	expect(closed?.winningOption).toBe('continue')

	const updatedRoom = await prisma.room.findUnique({ where: { id: room.id } })
	expect(updatedRoom?.status).toBe('live')

	const nextEvolution = await prisma.poll.findFirst({
		where: {
			roomId: room.id,
			kind: 'evolution',
			status: { in: ['queued', 'open'] },
		},
		orderBy: { seq: 'desc' },
	})
	expect(nextEvolution).toBeDefined()

	const outroStarted = hostEvents().some(
		(e) => e[1].type === 'code_update' && e[1].kind === 'outro',
	)
	expect(outroStarted).toBe(false)

	scheduler.disarmScheduler(room.id)
})
