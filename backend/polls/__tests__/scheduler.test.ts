process.env.DATABASE_URL = 'file:./scheduler-test.db'
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
import { initialStateDoc } from '@backend/music/state-doc'
import type { CrowdSnapshot } from '@shared/schemas/preferences'

execSync(
	'DATABASE_URL=file:./scheduler-test.db bun x --no-install prisma migrate deploy',
	{ stdio: 'pipe' },
)
const { prisma } = await import('@backend/db/client')
const { ensurePreferenceQuestions } = await import('@backend/votes/preferences')
const userIds: string[] = []
const roomIds: string[] = []
let scheduler: typeof import('@backend/polls/scheduler')
let service: typeof import('@backend/rooms/service')
const generate = jest.fn()
const publishHost = jest.fn()
const publishAudience = jest.fn()
let time = 1_000_000
let nextId = 0
let timers = new Map<
	number,
	{ at: number; callback: () => void | Promise<void> }
>()
const fakeClock = {
	now: () => time,
	setTimeout(callback: () => void | Promise<void>, ms: number) {
		const id = ++nextId
		timers.set(id, { at: time + ms, callback })
		return id
	},
	clearTimeout(handle: unknown) {
		timers.delete(handle as number)
	},
}
async function advance(ms: number) {
	time += ms
	for (const [id, timer] of [...timers]) {
		if (timer.at <= time) {
			timers.delete(id)
			await timer.callback()
		}
	}
	await settle()
}
async function settle() {
	for (let i = 0; i < 12; i++)
		await new Promise((resolve) => setTimeout(resolve, 0))
}
async function makeRoom() {
	const host = await prisma.user.create({
		data: { name: 'Host', email: `${crypto.randomUUID()}@example.com` },
	})
	userIds.push(host.id)
	const room = await prisma.room.create({
		data: {
			hostId: host.id,
			status: 'live',
			bpm: 120,
			genre: 'house',
			lengthSec: 600,
			pollIntervalSec: 60,
			startedAt: new Date(time),
			createdAt: new Date(time - 600_000),
			currentCode: 's("bd")',
			stateDoc: initialStateDoc({ genre: 'house', bpm: 120 }),
		},
	})
	roomIds.push(room.id)
	const initial = await prisma.patternVersion.create({
		data: {
			roomId: room.id,
			source: 'initial',
			code: 's("bd")',
			status: 'applied',
			appliedAt: new Date(time),
		},
	})
	await prisma.room.update({
		where: { id: room.id },
		data: { currentVersionId: initial.id },
	})
	await ensurePreferenceQuestions(room.id)
	const questions = await prisma.poll.findMany({
		where: { roomId: room.id },
		orderBy: { seq: 'asc' },
	})
	return { ...room, currentVersionId: initial.id, questions }
}
async function answer(pollId: string, choice = 'mellow', token = 'a') {
	await prisma.vote.upsert({
		where: { pollId_sessionToken: { pollId, sessionToken: token } },
		create: { pollId, sessionToken: token, choice },
		update: { choice },
	})
}
async function boot(roomId: string) {
	scheduler.armScheduler(roomId)
	await advance(0)
}
async function updates(roomId: string) {
	return prisma.poll.findMany({
		where: { roomId, kind: 'crowd' },
		orderBy: { seq: 'asc' },
	})
}

beforeAll(async () => {
	mock.module('@backend/music/engine', () => ({
		generateCrowdEvolution: generate,
		generateInitialPattern: jest.fn(),
		generateOutro: jest.fn(async () => 's("bd")'),
	}))
	mock.module('@backend/llm/provider', () => ({
		getLlmProvider: () => ({ chat: jest.fn() }),
	}))
	mock.module('@backend/realtime/hub', () => ({
		hub: { publishHost, publishAudience },
	}))
	scheduler = await import('@backend/polls/scheduler')
	service = await import('@backend/rooms/service')
})
beforeEach(() => {
	time = 1_000_000
	timers = new Map()
	scheduler.setSchedulerClock(fakeClock)
	generate.mockReset().mockResolvedValue({ code: 's("bd sd")' })
	publishHost.mockClear()
	publishAudience.mockClear()
})
afterEach(() => {
	for (const id of roomIds) scheduler.disarmScheduler(id)
})
afterAll(async () => {
	await prisma.user.deleteMany({ where: { id: { in: userIds } } })
})

test('seven stable questions stay open indefinitely, with no deadline or end poll', async () => {
	const room = await makeRoom()
	await boot(room.id)
	await advance(100_000)
	expect(generate).not.toHaveBeenCalled()
	const questions = await prisma.poll.findMany({ where: { roomId: room.id } })
	expect(questions).toHaveLength(7)
	expect(
		questions.every(
			(question) =>
				question.status === 'open' &&
				question.closesAt === null &&
				question.winningOption === null,
		),
	).toBe(true)
})

test('checks at 10 seconds and sends every count, including an even split and unanswered dimensions', async () => {
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await answer(room.questions[0]!.id, 'intense', 'b')
	await boot(room.id)
	await advance(9999)
	expect(generate).not.toHaveBeenCalled()
	await advance(1)
	expect(generate).toHaveBeenCalledTimes(1)
	const snapshot = generate.mock.calls[0]![2] as CrowdSnapshot
	expect(snapshot).toHaveLength(7)
	expect(snapshot[0]!.counts).toEqual({ mellow: 1, balanced: 0, intense: 1 })
	expect(snapshot[1]!.counts).toEqual({ steady: 0, flowing: 0, busy: 0 })
	expect(JSON.stringify(snapshot)).not.toContain('sessionToken')
	expect((await updates(room.id))[0]!.winningOption).toBeNull()
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(1)
})

test('waits for host confirmation, then submits the newest distribution once', async () => {
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await boot(room.id)
	await advance(10_000)
	await answer(room.questions[0]!.id, 'balanced')
	await answer(room.questions[0]!.id, 'intense')
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(1)
	const version = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'candidate' },
	})
	expect(
		(await prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
			.currentCode,
	).toBe('s("bd")')
	await service.reportApplyResult(room.id, room.hostId, version.id, true)
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(2)
	expect((generate.mock.calls[1]![2] as CrowdSnapshot)[0]!.counts).toEqual({
		mellow: 0,
		balanced: 0,
		intense: 1,
	})
	expect(generate.mock.calls[1]![4]).toBeUndefined()
	expect(generate.mock.calls[1]![3]).toBe('s("bd sd")')
})

test('unchanged aggregate, including swapped personal answers, produces no extra call', async () => {
	generate.mockResolvedValue('hold')
	const room = await makeRoom()
	await answer(room.questions[0]!.id, 'mellow', 'a')
	await answer(room.questions[0]!.id, 'intense', 'b')
	await boot(room.id)
	await advance(10_000)
	await answer(room.questions[0]!.id, 'intense', 'a')
	await answer(room.questions[0]!.id, 'mellow', 'b')
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(1)
	expect((await updates(room.id))[0]!.deliveryStatus).toBe('unchanged')
})

test('answers during slow generation are coalesced without overlapping calls', async () => {
	let finish!: (value: { code: string }) => void
	generate.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await boot(room.id)
	await advance(10_000)
	await answer(room.questions[0]!.id, 'intense')
	await advance(20_000)
	expect(generate).toHaveBeenCalledTimes(1)
	finish({ code: 's("bd sd")' })
	await settle()
	expect(
		await prisma.patternVersion.count({
			where: { roomId: room.id, status: 'candidate' },
		}),
	).toBe(1)
})

test('failed generation keeps playback and does not repeat unchanged input', async () => {
	generate.mockResolvedValue(null)
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await boot(room.id)
	await advance(10_000)
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(1)
	expect((await updates(room.id))[0]!.deliveryStatus).toBe('failed')
	expect(
		(await prisma.room.findUniqueOrThrow({ where: { id: room.id } }))
			.currentCode,
	).toBe('s("bd")')
})

test('host rejection releases delivery for the next changed snapshot', async () => {
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await boot(room.id)
	await advance(10_000)
	const version = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'candidate' },
	})
	await service.reportApplyResult(
		room.id,
		room.hostId,
		version.id,
		false,
		'Audio unavailable',
	)
	await answer(room.questions[0]!.id, 'intense')
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(2)
})

test('delivery timeout rejects the candidate and late acknowledgement', async () => {
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await boot(room.id)
	await advance(10_000)
	const version = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'candidate' },
	})
	await advance(60_000)
	expect((await updates(room.id))[0]!.deliveryStatus).toBe('failed')
	await expect(
		service.reportApplyResult(room.id, room.hostId, version.id, true),
	).rejects.toThrow()
})

test('an undo while generation is pending prevents the late result from playing', async () => {
	let finish!: (value: { code: string }) => void
	generate.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await boot(room.id)
	await advance(10_000)
	await service.undoLastChange(room.id, room.hostId)
	finish({ code: 's("bd sd")' })
	await settle()
	expect(
		await prisma.patternVersion.count({
			where: { roomId: room.id, status: 'candidate' },
		}),
	).toBe(0)
})

test('restart preserves questions and last submitted snapshot without replaying generation', async () => {
	generate.mockResolvedValue('hold')
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await boot(room.id)
	await advance(10_000)
	scheduler.disarmScheduler(room.id)
	await scheduler.restoreSchedulers()
	await advance(0)
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(1)
	expect(
		await prisma.poll.count({ where: { roomId: room.id, kind: 'preference' } }),
	).toBe(7)
})

test('recovery converts a legacy room and retires its timed polls', async () => {
	const room = await makeRoom()
	await prisma.poll.deleteMany({ where: { roomId: room.id } })
	const legacy = await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: 1,
			kind: 'evolution',
			question: 'Old question?',
			options: [],
			status: 'open',
			closesAt: new Date(time + 20_000),
		},
	})
	await boot(room.id)
	expect(
		(await prisma.poll.findUniqueOrThrow({ where: { id: legacy.id } })).status,
	).toBe('closed')
	expect(
		await prisma.poll.count({
			where: { roomId: room.id, kind: 'preference', status: 'open' },
		}),
	).toBe(7)
})

test('disarm prevents a late generation from publishing music', async () => {
	let finish!: (value: { code: string }) => void
	generate.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await boot(room.id)
	await advance(10_000)
	scheduler.disarmScheduler(room.id)
	finish({ code: 's("bd sd")' })
	await settle()
	expect(
		await prisma.patternVersion.count({
			where: { roomId: room.id, status: 'candidate' },
		}),
	).toBe(0)
	expect(scheduler.isSchedulerArmed(room.id)).toBe(false)
})

test('the set deadline ends input and starts one outro even when the maintenance tick is also due', async () => {
	const room = await makeRoom()
	await boot(room.id)
	await advance(600_000)
	expect(
		(await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status,
	).toBe('outro')
	expect(
		await prisma.poll.count({
			where: { roomId: room.id, kind: 'preference', status: 'open' },
		}),
	).toBe(0)
	expect(
		await prisma.patternVersion.count({
			where: { roomId: room.id, source: 'outro' },
		}),
	).toBe(1)
	expect(scheduler.isSchedulerArmed(room.id)).toBe(false)
})

test('restart restores the remaining outro time and announces the end', async () => {
	const room = await makeRoom()
	await prisma.room.update({
		where: { id: room.id },
		data: { status: 'outro' },
	})
	await prisma.patternVersion.create({
		data: {
			roomId: room.id,
			source: 'outro',
			status: 'candidate',
			code: 's("bd")',
			appliedAt: new Date(time - 50_000),
		},
	})
	await boot(room.id)
	await advance(9999)
	expect(
		(await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status,
	).toBe('outro')
	await advance(1)
	expect(
		(await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).status,
	).toBe('ended')
	expect(publishAudience).toHaveBeenCalledWith(room.id, { type: 'room_ended' })
})

test('ending during generation rejects the late crowd result', async () => {
	let finish!: (value: { code: string }) => void
	generate.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await boot(room.id)
	await advance(10_000)
	await service.endRoom(room.id, room.hostId)
	finish({ code: 's("bd sd")' })
	await settle()
	expect(
		await prisma.patternVersion.count({
			where: { roomId: room.id, source: { not: 'outro' }, status: 'candidate' },
		}),
	).toBe(0)
	expect((await updates(room.id))[0]!.deliveryStatus).toBe('failed')
})

test('groove lock keeps collecting answers and release submits the latest mix', async () => {
	const room = await makeRoom()
	await boot(room.id)
	await service.setGrooveLock(room.id, room.hostId, true)
	await answer(room.questions[0]!.id, 'intense')
	await advance(10_000)
	expect(generate).not.toHaveBeenCalled()
	await answer(room.questions[0]!.id, 'balanced')
	await service.setGrooveLock(room.id, room.hostId, false)
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(1)
	const snapshot = generate.mock.calls[0]![2] as CrowdSnapshot
	expect(snapshot[0]!.counts.balanced).toBe(1)
	expect(snapshot[0]!.counts.intense).toBe(0)
})

test('locking during generation prevents its late result even after release', async () => {
	let finish!: (value: { code: string }) => void
	generate.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	const room = await makeRoom()
	await answer(room.questions[0]!.id)
	await boot(room.id)
	await advance(10_000)
	await service.setGrooveLock(room.id, room.hostId, true)
	await service.setGrooveLock(room.id, room.hostId, false)
	finish({ code: 's("bd sd")' })
	await settle()
	expect(
		await prisma.patternVersion.count({
			where: { roomId: room.id, status: 'candidate' },
		}),
	).toBe(0)
})

test('performance candidate blocks crowd generation until host confirms it', async () => {
	const room = await makeRoom()
	await boot(room.id)
	await answer(room.questions[0]!.id)
	await service.perform(room.id, room.hostId, 'build')
	await advance(10_000)
	expect(generate).not.toHaveBeenCalled()
	const version = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'candidate' },
	})
	await service.reportApplyResult(room.id, room.hostId, version.id, true)
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(1)
})

test('a text direction alone participates, and unchanged revisions do not repeat generation', async () => {
	generate.mockResolvedValue('hold')
	const room = await makeRoom()
	const intent = {
		kind: 'preference',
		targets: [{ dimension: 'space', choice: 'spacious' }],
	}
	await prisma.direction.create({
		data: {
			roomId: room.id,
			sessionToken: 'private-phone',
			revision: 1,
			text: 'underwater',
			interpretation: JSON.stringify(intent),
		},
	})
	await boot(room.id)
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(1)
	const context = generate.mock.calls[0]?.[4]
	expect(context.directions[0].intent).toEqual(intent)
	expect(JSON.stringify(context)).not.toContain('private-phone')
	expect(JSON.stringify(context)).not.toContain('underwater')
	await advance(10_000)
	expect(generate).toHaveBeenCalledTimes(1)
	expect(
		(await prisma.direction.findFirstOrThrow({ where: { roomId: room.id } }))
			.outcome,
	).toBe('held')
})

test('a cleared then replaced direction cannot revive the revoked in-flight revision', async () => {
	let finish!: (value: { code: string }) => void
	generate.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve
			}),
	)
	const room = await makeRoom()
	const direction = await prisma.direction.create({
		data: {
			roomId: room.id,
			sessionToken: 'phone',
			revision: 1,
			text: 'bouncy',
			interpretation: JSON.stringify({
				kind: 'preference',
				targets: [{ dimension: 'bass', choice: 'bouncy' }],
			}),
		},
	})
	await boot(room.id)
	await advance(10_000)
	await prisma.direction.update({
		where: { id: direction.id },
		data: {
			revokedThrough: 1,
			revision: 2,
			text: 'deep',
			interpretation: JSON.stringify({
				kind: 'preference',
				targets: [{ dimension: 'bass', choice: 'deep' }],
			}),
		},
	})
	finish({ code: 's("bd sd")' })
	await settle()
	expect(
		await prisma.patternVersion.count({
			where: { roomId: room.id, status: 'candidate' },
		}),
	).toBe(0)
})

test('ready recordings use the serialized delivery path and expire without any new answers', async () => {
	const room = await makeRoom()
	await prisma.room.update({
		where: { id: room.id },
		data: { recordingsEnabled: true },
	})
	const recording = await prisma.recording.create({
		data: {
			roomId: room.id,
			sessionToken: 'phone',
			requestId: 'sample',
			use: 'percussion',
			status: 'ready',
			duration: 0.5,
		},
	})
	await boot(room.id)
	await advance(10_000)
	expect(generate).not.toHaveBeenCalled()
	const candidate = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'candidate' },
	})
	expect(candidate.context).toMatchObject({
		recordingId: recording.id,
		directions: [],
	})
	await service.reportApplyResult(room.id, room.hostId, candidate.id, true)
	const played = await prisma.recording.findUniqueOrThrow({
		where: { id: recording.id },
	})
	expect(played.expiresAt!.getTime() - played.appliedAt!.getTime()).toBe(16_000)
	await prisma.recording.update({
		where: { id: recording.id },
		data: { expiresAt: new Date(time + 1000) },
	})
	scheduler.wakeScheduler(room.id, time + 1000)
	await advance(1000)
	expect(
		(await prisma.recording.findUniqueOrThrow({ where: { id: recording.id } }))
			.status,
	).toBe('expired')
	expect(generate).not.toHaveBeenCalled()
})

test('audience moments fire once and restore the underlying groove even while locked', async () => {
	const room = await makeRoom()
	await prisma.room.update({
		where: { id: room.id },
		data: { momentsEnabled: true },
	})
	const moment = await prisma.moment.create({
		data: { roomId: room.id, sessionToken: 'phone', action: 'build' },
	})
	await boot(room.id)
	await advance(10_000)
	const candidate = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'candidate' },
	})
	expect(candidate.code).toContain('music-vote performance')
	await service.reportApplyResult(room.id, room.hostId, candidate.id, true)
	expect(
		(await prisma.moment.findUniqueOrThrow({ where: { id: moment.id } }))
			.status,
	).toBe('applied')
	await prisma.room.update({
		where: { id: room.id },
		data: {
			grooveLocked: true,
			stateDoc: {
				moment: {
					id: moment.id,
					baseCode: 's("bd")',
					expiresAt: time + 16_000,
				},
			},
		},
	})
	scheduler.wakeScheduler(room.id, time + 16_000)
	await advance(16_000)
	const restored = await prisma.patternVersion.findFirstOrThrow({
		where: { roomId: room.id, status: 'candidate' },
	})
	expect(restored.code).toBe('s("bd")')
	expect(generate).not.toHaveBeenCalled()
})
