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
import type { WsEvent } from '@shared/realtime/events'
import type { Prisma } from '../../../prisma/generated/client'

// Own the DB: prisma/scheduler-test.db, migrated before connecting. Unique per
// DB-backed test file so the module-load `migrate deploy` runs cannot collide
// under `bun test --parallel` (and the shared client below is the same one the
// services use, so assertions and writes never diverge).
execSync('DATABASE_URL=file:./scheduler-test.db bunx prisma migrate deploy', {
	stdio: 'pipe',
})

const { prisma } = await import('@backend/db/client')

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

/**
 * Fire-and-forget clock: due timers start but are NOT awaited, so a slow
 * closePoll (seconds-long LLM call) runs concurrently with later ticks — the
 * production overlap the fully-awaited fakeClock cannot express.
 */
function createConcurrentClock(start = 0) {
	let time = start
	let nextId = 1
	const timers = new Map<
		number,
		{ at: number; cb: () => void | Promise<void> }
	>()
	const clock = {
		now: (): number => time,
		setTimeout(callback: () => void | Promise<void>, ms: number): number {
			const id = nextId++
			timers.set(id, { at: time + ms, cb: callback })
			return id
		},
		clearTimeout(id: number): void {
			timers.delete(id)
		},
		dropTimersAt(at: number): void {
			for (const [id, timer] of timers) {
				if (timer.at === at) timers.delete(id)
			}
		},
		setTime(next: number): void {
			time = next
		},
		advance(ms: number): void {
			time += ms
		},
		/** Fire every due timer without awaiting it, then let promise chains settle. */
		async settle(rounds = 40): Promise<void> {
			let emptyRounds = 0
			for (let i = 0; i < rounds; i++) {
				const due = [...timers.entries()]
					.filter(([, timer]) => timer.at <= time)
					.sort((a, b) => a[1].at - b[1].at)
				for (const [id, timer] of due) {
					timers.delete(id)
					void Promise.resolve(timer.cb()).catch(() => {})
				}
				await new Promise((resolve) => realSetTimeout(resolve, 0))
				// Keep draining while async chains (prisma I/O, deferred LLM
				// promises) may still register timers or finish writes.
				if (due.length === 0) {
					emptyRounds += 1
					if (emptyRounds >= 5) break
				} else {
					emptyRounds = 0
				}
			}
		},
	}
	return clock
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
		pollOpenSec: number
		status: string
		currentCode: string
	}>,
): Promise<{
	id: string
	createdAt: Date
	pollIntervalSec: number
	pollOpenSec: number
}> {
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
	return room as {
		id: string
		createdAt: Date
		pollIntervalSec: number
		pollOpenSec: number
	}
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
	mockGenerateEvolution.mockClear()
	mockGenerateNextQuestion.mockClear()
	mockGenerateOutro.mockClear()

	mockGenerateEvolution.mockImplementation(async () => ({
		code: 's("bd sd")',
		changeSummary: 'more drums',
	}))
	mockGenerateNextQuestion.mockImplementation(async () => ({
		question: 'More energy?',
		options: ['more energy', 'deeper, darker groove'],
	}))
	mockGenerateOutro.mockImplementation(async () => 's("bd sd")')
})

afterEach(() => {
	globalThis.setTimeout = realSetTimeout
	globalThis.clearTimeout = realClearTimeout
	Date.now = realDateNow
})

afterAll(async () => {
	// No $disconnect here: `prisma` is the process-wide client every service
	// shares, so closing it would break test files that run later in this process.
	await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
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

test('evolution close feeds the winning option label to the LLM and queues change options', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id)
	const poll = await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: 1,
			kind: 'evolution',
			question: 'Sharper drums or warmer chords?',
			options: [
				{ key: 'sharper-drums', label: 'sharper drums' },
				{ key: 'warmer-chords', label: 'warmer chords' },
			],
			status: 'queued',
		},
	})

	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)
	await vote(poll.id, 'warmer-chords', 'v1')
	await fakeClock.tick(5000)

	const closed = await prisma.poll.findUnique({ where: { id: poll.id } })
	expect(closed?.winningOption).toBe('warmer-chords')

	// The evolution prompt receives the human-readable change, not the storage key.
	const evolutionCall = mockGenerateEvolution.mock.calls[0] as unknown[]
	expect(evolutionCall[3]).toBe('warmer chords')

	// The next queued poll carries the LLM's change options, never yes/no.
	const next = await prisma.poll.findFirst({
		where: { roomId: room.id, seq: 2 },
	})
	expect(next?.options).toEqual([
		{ key: 'more-energy', label: 'more energy' },
		{ key: 'deeper-darker-groove', label: 'deeper, darker groove' },
	])

	scheduler.disarmScheduler(room.id)
})

test('generated candidates do not change confirmed musical history', async () => {
	// Production shape: poll2 closes while poll1's evolution LLM call is still
	// pending. closePoll reads `room` once and, without a refresh, poll1's
	// late updateRoomDoc would write back a snapshot that predates poll2's
	// entry and clobber it.
	const clock = createConcurrentClock()
	scheduler.setSchedulerClock(clock)
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 10 })
	clock.setTime(room.createdAt.getTime())

	try {
		const poll1 = await makePoll(room.id, 1, { question: 'First change?' })
		await makePoll(room.id, 2, { question: 'Second change?' })

		scheduler.armScheduler(room.id)
		await clock.settle() // poll1 opens, closes at +5s (fast mode window)
		await vote(poll1.id, 'yes', 'v1')

		let resolveEvolution: (value: {
			code: string
			changeSummary: string
		}) => void = () => {}
		const pendingEvolution = new Promise<{
			code: string
			changeSummary: string
		}>((resolve) => {
			resolveEvolution = resolve
		})
		mockGenerateEvolution.mockImplementationOnce(() => pendingEvolution)

		clock.advance(5_000)
		await clock.settle() // closePoll(poll1) starts and parks on the LLM call
		const parked = await prisma.poll.findUnique({ where: { id: poll1.id } })
		expect(parked?.status).toBe('closed')

		clock.advance(5_000)
		await clock.settle() // tick at +10s opens poll2; it closes at +15s
		const openPoll2 = await prisma.poll.findFirst({
			where: { roomId: room.id, status: 'open' },
		})
		expect(openPoll2?.question).toBe('Second change?')
		if (!openPoll2) throw new Error('poll2 never opened')
		await vote(openPoll2.id, 'yes', 'v2')

		clock.advance(5_000)
		await clock.settle() // closePoll(poll2) completes fully
		const midHistory = await prisma.room.findUnique({ where: { id: room.id } })
		const midDoc = (midHistory?.stateDoc ?? {
			history: [] as { question: string }[],
		}) as { history?: { question: string }[] }
		expect(midDoc.history ?? []).toHaveLength(0)

		// poll1's evolution finally lands — its stateDoc write must not clobber
		// poll2's history entry with the pre-LLM snapshot.
		resolveEvolution({ code: 's("bd hh")', changeSummary: 'first change' })
		await clock.settle()

		const after = await prisma.room.findUnique({ where: { id: room.id } })
		const afterDoc = (after?.stateDoc ?? {
			history: [] as { question: string }[],
		}) as { history?: { question: string }[] }
		const questions = (afterDoc.history ?? []).map((entry) => entry.question)
		expect(questions).toHaveLength(0)
	} finally {
		scheduler.disarmScheduler(room.id)
		// Leave no live room behind: later tests call restoreSchedulers(),
		// which arms every live room and would close this room's polls into
		// their spies.
		await prisma.room.update({
			where: { id: room.id },
			data: { status: 'ended' },
		})
	}
})

test('liveTick closes an overdue open poll whose close timer was lost', async () => {
	// A lost close timer leaves the poll open past its deadline. The maintenance
	// tick must close it and keep the chain moving.
	const clock = createConcurrentClock()
	scheduler.setSchedulerClock(clock)
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 10 })
	const poll = await makePoll(room.id, 1)

	try {
		scheduler.armScheduler(room.id)
		await clock.settle() // poll opens, closes at +5s
		await vote(poll.id, 'yes', 'v1')

		clock.dropTimersAt(clock.now() + 5_000)
		clock.advance(5_000)
		await clock.settle()

		const overdue = await prisma.poll.findUnique({ where: { id: poll.id } })
		expect(overdue?.status).toBe('open')

		clock.advance(5_000)
		await clock.settle() // tick at +10s must close the overdue poll and continue

		const closed = await prisma.poll.findUnique({ where: { id: poll.id } })
		expect(closed?.status).toBe('closed')
		// The vote that landed before the crashed close still decides.
		expect(closed?.winningOption).toBe('yes')

		const next = await prisma.poll.findFirst({
			where: { roomId: room.id, status: 'open' },
		})
		expect(next?.seq).toBe(2)
	} finally {
		scheduler.disarmScheduler(room.id)
		// Leave no live room behind: later tests call restoreSchedulers(),
		// which arms every live room and would close this room's polls into
		// their spies.
		await prisma.room.update({
			where: { id: room.id },
			data: { status: 'ended' },
		})
	}
})

test('stalled chain self-heals: a tick re-queues and opens a poll when nothing is pending', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, { lengthSec: 300, pollIntervalSec: 10 })
	// Crash aftermath: a closed poll, nothing queued, fresh timers.
	await makePoll(room.id, 1, { status: 'closed' })

	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)

	// At the first tick the queue rebuild kicks in (nothing open, nothing queued).
	await fakeClock.tick(10000)

	const open = await prisma.poll.findFirst({
		where: { roomId: room.id, status: 'open' },
	})
	expect(open?.kind).toBe('evolution')
	expect(open?.question).toBe('More energy?')
	expect(open?.seq).toBe(2)

	scheduler.disarmScheduler(room.id)
})

test('evolution crash publishes a warning and the next tick rebuilds the poll', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 10 })
	const poll = await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: 1,
			kind: 'evolution',
			question: 'Sharper drums or warmer chords?',
			options: [
				{ key: 'sharper-drums', label: 'sharper drums' },
				{ key: 'warmer-chords', label: 'warmer chords' },
			],
			status: 'queued',
		},
	})
	mockGenerateEvolution.mockImplementationOnce(async () => {
		throw new Error('LLM exploded')
	})

	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)
	await vote(poll.id, 'sharper-drums', 'v1')
	await fakeClock.tick(5000)

	const closed = await prisma.poll.findUnique({ where: { id: poll.id } })
	expect(closed?.status).toBe('closed')
	expect(closed?.winningOption).toBe('sharper-drums')

	const warning = hostEvents().find((e) => e[1].type === 'warning')
	expect(warning?.[0]).toBe(room.id)
	expect(warning?.[1]).toMatchObject({ type: 'warning' })

	// The room does not silently stall: the next tick rebuilds the chain and
	// opens the following evolution poll.
	await fakeClock.tick(10000)
	const next = await prisma.poll.findFirst({
		where: { roomId: room.id, status: 'open' },
	})
	expect(next?.seq).toBeGreaterThan(closed?.seq ?? 0)

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

test('normal cadence gives the room dance time after a result', async () => {
	delete process.env.MV_E2E_FAST
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 10, pollOpenSec: 20 })
	await makePoll(room.id, 1)
	try {
		scheduler.armScheduler(room.id)
		await fakeClock.tick(0)
		await fakeClock.tick(20_000)
		const result = await prisma.poll.findFirst({
			where: { roomId: room.id, seq: 1 },
		})
		expect(result?.deliveryStatus).toBe('unchanged')
		const next = await prisma.poll.findFirst({
			where: { roomId: room.id, seq: 2 },
		})
		expect(next?.status).toBe('queued')
		await fakeClock.tick(5_000)
		const resting = await prisma.poll.findFirst({
			where: { roomId: room.id, seq: 2 },
		})
		expect(resting?.status).toBe('queued')
		await fakeClock.tick(5_000)
		const opened = await prisma.poll.findFirst({
			where: { roomId: room.id, seq: 2 },
		})
		expect(opened?.status).toBe('open')
	} finally {
		process.env.MV_E2E_FAST = '1'
		scheduler.disarmScheduler(room.id)
	}
})

test('normal cadence waits for host confirmation before asking the next question', async () => {
	delete process.env.MV_E2E_FAST
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 10, pollOpenSec: 15 })
	const poll = await makePoll(room.id, 1)
	try {
		scheduler.armScheduler(room.id)
		await fakeClock.tick(0)
		await vote(poll.id, 'yes', 'dancer')
		await fakeClock.tick(15_000)
		const pending = await prisma.poll.findUniqueOrThrow({
			where: { id: poll.id },
		})
		expect(pending.deliveryStatus).toBe('preparing')
		expect(
			await prisma.poll.count({ where: { roomId: room.id, seq: 2 } }),
		).toBe(0)
		const candidate = await prisma.patternVersion.findFirstOrThrow({
			where: { roomId: room.id, source: poll.id, status: 'candidate' },
		})
		const { reportApplyResult } = await import('@backend/rooms/service')
		await reportApplyResult(room.id, host.id, candidate.id, true)
		await fakeClock.tick(5_000)
		const next = await prisma.poll.findFirst({
			where: { roomId: room.id, seq: 2 },
		})
		if (!next) throw new Error('next question was not queued')
		expect(['queued', 'open']).toContain(next.status)
	} finally {
		process.env.MV_E2E_FAST = '1'
		scheduler.disarmScheduler(room.id)
	}
})

test('host channel receives poll_opened and poll_closed alongside the audience', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id)
	const poll = await makePoll(room.id, 1)

	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)

	// The host console must follow the current poll without any vote landing:
	// a projector has to show a freshly opened poll even at zero votes.
	const hostOpened = hostEvents().find((e) => e[1].type === 'poll_opened')
	expect(hostOpened?.[0]).toBe(room.id)
	expect(hostOpened?.[1]).toMatchObject({
		type: 'poll_opened',
		poll: { id: poll.id, question: 'More drums?' },
	})
	const audienceOpened = audienceEvents().find(
		(e) => e[1].type === 'poll_opened',
	)
	expect(audienceOpened?.[1]).toEqual(hostOpened?.[1])

	await fakeClock.tick(5000)

	const hostClosed = hostEvents().find((e) => e[1].type === 'poll_closed')
	expect(hostClosed?.[0]).toBe(room.id)
	expect(hostClosed?.[1]).toMatchObject({
		type: 'poll_closed',
		pollId: poll.id,
		winningOption: null,
	})
	const audienceClosed = audienceEvents().find(
		(e) => e[1].type === 'poll_closed',
	)
	expect(audienceClosed?.[1]).toEqual(hostClosed?.[1])

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

test('tie keeps the current groove without a winner', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id)

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
	expect(winnerA).toBeNull()

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
	expect(winnerB).toBeNull()

	scheduler.disarmScheduler(room.id)
})

test('a plurality is not a majority', () => {
	const options = [
		{ key: 'bass', label: 'Bass' },
		{ key: 'drums', label: 'Drums' },
		{ key: 'synth', label: 'Synth' },
	]
	const votes = [
		...Array.from({ length: 4 }, () => ({ choice: 'bass' })),
		...Array.from({ length: 3 }, () => ({ choice: 'drums' })),
		...Array.from({ length: 3 }, () => ({ choice: 'synth' })),
	]
	expect(scheduler.pickWinner(options, votes)).toBeNull()
	expect(
		scheduler.pickWinner(options, [
			...votes,
			{ choice: 'bass' },
			{ choice: 'bass' },
			{ choice: 'bass' },
		]),
	).toBe('bass')
})

test('a winning hold choice keeps the groove without generating music', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id)
	const poll = await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: 1,
			kind: 'evolution',
			question: 'Stay here or change the drums?',
			options: [
				{ key: 'stay-here', label: 'Stay here', intent: 'hold' },
				{ key: 'more-drums', label: 'More drums', intent: 'change' },
			],
			status: 'queued',
		},
	})
	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)
	await vote(poll.id, 'stay-here', 'dancer')
	await fakeClock.tick(5000)
	const result = await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })
	expect(result.winningOption).toBe('stay-here')
	expect(result.deliveryStatus).toBe('unchanged')
	expect(mockGenerateEvolution).not.toHaveBeenCalled()
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

	await vote(poll.id, 'invalid-choice', 'v1')
	await vote(poll.id, 'invalid-choice', 'v2')
	await vote(poll.id, 'yes', 'v3')

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

test('all-off-option votes close with null winner and no version', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 10 })
	const poll = await makePoll(room.id, 1)

	scheduler.armScheduler(room.id)
	await fakeClock.tick(0)

	await vote(poll.id, 'invalid-choice', 'v1')
	await vote(poll.id, 'other-invalid', 'v2')

	await fakeClock.tick(5000)

	const closed = await prisma.poll.findUnique({ where: { id: poll.id } })
	expect(closed?.status).toBe('closed')
	expect(closed?.winningOption).toBeNull()

	const versions = await prisma.patternVersion.findMany({
		where: { roomId: room.id },
	})
	expect(versions).toHaveLength(0)

	const queued = await prisma.poll.findMany({
		where: { roomId: room.id, status: 'queued' },
	})
	expect(queued).toHaveLength(1)

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

test('end poll continue sustains polling past insertAt', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, {
		lengthSec: 120,
		pollIntervalSec: 5,
	})
	const endPoll = await prisma.poll.create({
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

	await vote(endPoll.id, 'continue', 'v1')
	// close end poll at t=5s, queue evo2, open it immediately
	await fakeClock.tick(5000)

	let queued = await prisma.poll.findMany({
		where: {
			roomId: room.id,
			kind: 'evolution',
			status: { in: ['queued', 'open'] },
		},
	})
	expect(queued).toHaveLength(1)

	// Advance to t=95s (past insertAt=90s). Close first post-continue evolution,
	// then let interval tick queue and open the next one.
	const evo1 = queued[0]
	await vote(evo1.id, 'yes', 'v2')
	await fakeClock.tick(90000)

	let stillLive = await prisma.room.findUnique({ where: { id: room.id } })
	expect(stillLive?.status).toBe('live')

	queued = await prisma.poll.findMany({
		where: {
			roomId: room.id,
			kind: 'evolution',
			status: { in: ['queued', 'open'] },
		},
	})
	expect(queued).toHaveLength(1)
	const evo2 = queued[0]
	expect(evo2.seq).toBeGreaterThan(evo1.seq)

	// Advance to t=100s, drive one more complete post-insertAt cycle.
	await vote(evo2.id, 'yes', 'v3')
	await fakeClock.tick(5000)

	stillLive = await prisma.room.findUnique({ where: { id: room.id } })
	expect(stillLive?.status).toBe('live')

	queued = await prisma.poll.findMany({
		where: {
			roomId: room.id,
			kind: 'evolution',
			status: { in: ['queued', 'open'] },
		},
	})
	expect(queued).toHaveLength(1)
	const evo3 = queued[0]
	expect(evo3.seq).toBeGreaterThan(evo2.seq)

	const outroStarted = hostEvents().some(
		(e) => e[1].type === 'code_update' && e[1].kind === 'outro',
	)
	expect(outroStarted).toBe(false)

	const endPolls = await prisma.poll.findMany({
		where: { roomId: room.id, kind: 'end' },
	})
	expect(endPolls).toHaveLength(1)

	scheduler.disarmScheduler(room.id)
})

test('restoreSchedulers overdue close replenishes the queue and the next poll opens', async () => {
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 10 })
	const now = new Date(fakeClock.now())
	const overdue = await prisma.poll.create({
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

	const closed = await prisma.poll.findUnique({ where: { id: overdue.id } })
	expect(closed?.status).toBe('closed')

	// A crash while a poll was open leaves nothing queued (the design only keeps
	// one question behind an open poll), so the restore path must queue the next
	// question exactly like a normal closePoll does.
	const queued = await prisma.poll.findMany({
		where: { roomId: room.id, status: 'queued' },
	})
	expect(queued).toHaveLength(1)
	expect(queued[0].kind).toBe('evolution')
	expect(queued[0].seq).toBeGreaterThan(closed?.seq ?? 0)

	// Restoring the host channel publication keeps the host console in sync.
	const hostClosed = hostEvents().find((e) => e[1].type === 'poll_closed')
	expect(hostClosed?.[0]).toBe(room.id)
	expect(hostClosed?.[1]).toEqual({
		type: 'poll_closed',
		pollId: overdue.id,
		winningOption: null,
	})
	const audienceClosed = audienceEvents().find(
		(e) => e[1].type === 'poll_closed',
	)
	expect(audienceClosed?.[1]).toEqual(hostClosed?.[1])

	// And that queued poll really opens, so evolution polls keep coming.
	await fakeClock.tick(0)
	const opened = audienceEvents().find(
		(e) => e[1].type === 'poll_opened' && e[1].poll.id === queued[0].id,
	)
	expect(opened?.[0]).toBe(room.id)
	expect(opened?.[1]).toMatchObject({
		type: 'poll_opened',
		poll: { id: queued[0].id, question: 'More energy?' },
	})

	scheduler.disarmScheduler(room.id)
})

test('MV_TEST_INTERVAL_SECS compresses room interval for quick dev testing', () => {
	process.env.MV_TEST_INTERVAL_SECS = '10'
	expect(scheduler.roomIntervalSec(60)).toBe(10)
	expect(scheduler.roomIntervalSec(600)).toBe(10)
	expect(scheduler.roomIntervalSec(10)).toBe(10)
	expect(scheduler.roomIntervalSec(5)).toBe(5)

	delete process.env.MV_TEST_INTERVAL_SECS
	// Hook off: unchanged semantics (fast-mode 10s floor applies in this file,
	// so a 5s room interval still floors to 10s here).
	expect(scheduler.roomIntervalSec(5)).toBe(5)
})

test('MV_TEST_INTERVAL_SECS invalid values ignored', () => {
	process.env.MV_TEST_INTERVAL_SECS = '0'
	expect(scheduler.roomIntervalSec(60)).toBe(60)
	process.env.MV_TEST_INTERVAL_SECS = 'bogus'
	expect(scheduler.roomIntervalSec(60)).toBe(60)
	process.env.MV_TEST_INTERVAL_SECS = '-5'
	expect(scheduler.roomIntervalSec(60)).toBe(60)
	delete process.env.MV_TEST_INTERVAL_SECS
})

test('MV_TEST_POLL_OPEN_SECS overrides the poll open window in dev', () => {
	try {
		process.env.MV_TEST_POLL_OPEN_SECS = '10'
		delete process.env.MV_E2E_FAST
		// Global dev override wins over the per-room value.
		expect(scheduler.pollOpenMs(20)).toBe(10_000)
		// Unset: the per-room value wins (default fallback 45s).
		delete process.env.MV_TEST_POLL_OPEN_SECS
		expect(scheduler.pollOpenMs(20)).toBe(20_000)
		expect(scheduler.pollOpenMs()).toBe(20_000)
		// Invalid values are ignored (per-room value still wins).
		process.env.MV_TEST_POLL_OPEN_SECS = 'bogus'
		expect(scheduler.pollOpenMs(15)).toBe(15_000)
		process.env.MV_TEST_POLL_OPEN_SECS = '-5'
		expect(scheduler.pollOpenMs(15)).toBe(15_000)
		// Fast mode wins over both the room value and a dev override (E2E stability).
		process.env.MV_TEST_POLL_OPEN_SECS = '3'
		process.env.MV_E2E_FAST = '1'
		expect(scheduler.pollOpenMs(20)).toBe(5_000)
	} finally {
		delete process.env.MV_TEST_POLL_OPEN_SECS
		process.env.MV_E2E_FAST = '1'
	}
})

test('dev compressor: room with 60s interval ticks at 10s while env set', async () => {
	process.env.MV_TEST_INTERVAL_SECS = '10'
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 60 })
	const poll = await makePoll(room.id, 1)

	try {
		scheduler.armScheduler(room.id)
		await fakeClock.tick(0)
		await vote(poll.id, 'yes', 'v1')
		await fakeClock.tick(5_000)

		const closed = await prisma.poll.findUnique({ where: { id: poll.id } })
		expect(closed?.status).toBe('closed')

		// Without the compressor the next tick would land 60s (pollIntervalSec)
		// after the close; with it the interval is 10s, so seq2 opens here.
		await fakeClock.tick(10_000)
		const seq2 = await prisma.poll.findFirst({
			where: { roomId: room.id, seq: 2 },
		})
		expect(seq2?.status).toBe('open')
	} finally {
		delete process.env.MV_TEST_INTERVAL_SECS
		scheduler.disarmScheduler(room.id)
	}
})

test('dev compressor: poll closes after MV_TEST_POLL_OPEN_SECS (dev, fast off)', async () => {
	process.env.MV_TEST_POLL_OPEN_SECS = '10'
	delete process.env.MV_E2E_FAST
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 60 })
	const poll = await makePoll(room.id, 1)

	try {
		scheduler.armScheduler(room.id)
		await fakeClock.tick(0)
		let row = await prisma.poll.findUnique({ where: { id: poll.id } })
		expect(row?.status).toBe('open')

		// The 45s default would not close the poll at 5s; the override makes
		// the close timer fire at exactly 10s.
		await fakeClock.tick(5_000)
		row = await prisma.poll.findUnique({ where: { id: poll.id } })
		expect(row?.status).toBe('open')

		await fakeClock.tick(5_000)
		row = await prisma.poll.findUnique({ where: { id: poll.id } })
		expect(row?.status).toBe('closed')
	} finally {
		delete process.env.MV_TEST_POLL_OPEN_SECS
		process.env.MV_E2E_FAST = '1'
		scheduler.disarmScheduler(room.id)
	}
})

test('dev: poll closes after the room pollOpenSec (fast off, no global override)', async () => {
	delete process.env.MV_E2E_FAST
	const host = await makeHost()
	const room = await makeRoom(host.id, { pollIntervalSec: 60, pollOpenSec: 20 })
	const poll = await makePoll(room.id, 1)

	try {
		scheduler.armScheduler(room.id)
		await fakeClock.tick(0)
		let row = await prisma.poll.findUnique({ where: { id: poll.id } })
		expect(row?.status).toBe('open')

		// Neither the 45s default nor the 5s fast-mode window: the per-room
		// value drives the close timer (closesAt = openedAt + 20s).
		await fakeClock.tick(20_000)
		row = await prisma.poll.findUnique({ where: { id: poll.id } })
		expect(row?.status).toBe('closed')
		expect(row?.closesAt?.getTime()).toBe(room.createdAt.getTime() + 20_000)
	} finally {
		process.env.MV_E2E_FAST = '1'
		scheduler.disarmScheduler(room.id)
	}
})
