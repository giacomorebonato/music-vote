process.env.DATABASE_URL = 'file:./votes-test.db'

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
import type { Context } from '@backend/trpc/context'
import type { WsEvent } from '@shared/realtime/events'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'

// Own the DB: prisma/votes-test.db, migrated before connecting. Unique per
// DB-backed test file so the module-load `migrate deploy` runs cannot collide
// under `bun test --parallel` (and the shared client below is the same one the
// services use, so assertions and writes never diverge).
execSync('DATABASE_URL=file:./votes-test.db bunx prisma migrate deploy', {
	stdio: 'pipe',
})

const { prisma } = await import('@backend/db/client')

const createdUserIds: string[] = []
let service: typeof import('@backend/votes/service')
let votingRouter: typeof import('@backend/trpc/voting').votingRouter
let appRouter: typeof import('@backend/trpc/root').appRouter
let createContext: typeof import('@backend/trpc/context').createContext
let TrpcEndpoint: string
let hubSpies: {
	publishHost: ReturnType<typeof jest.fn>
	publishAudience: ReturnType<typeof jest.fn>
}

async function makeHost(): Promise<{ id: string }> {
	const email = `vote-host-${crypto.randomUUID()}@example.com`
	const user = await prisma.user.create({ data: { name: 'Host', email } })
	createdUserIds.push(user.id)
	return user
}

async function makeRoom(
	status = 'live',
): Promise<{ id: string; hostId: string }> {
	const host = await makeHost()
	return prisma.room.create({
		data: {
			hostId: host.id,
			bpm: 120,
			lengthSec: 600,
			pollIntervalSec: 60,
			genre: 'techno',
			status,
			stateDoc: {},
		},
	})
}

async function makePoll(
	roomId: string,
	overrides?: Partial<{
		seq: number
		status: string
		closesAt: Date | null
		options: { key: string; label: string }[]
		winningOption: string | null
	}>,
) {
	return prisma.poll.create({
		data: {
			roomId,
			seq: 1,
			kind: 'evolution',
			question: 'More drums?',
			options: [
				{ key: 'yes', label: 'Yes' },
				{ key: 'no', label: 'No' },
			],
			status: 'open',
			...overrides,
		},
	})
}

function callerCtx(opts?: {
	headers?: HeadersInit
	resHeaders?: Headers
}): Context {
	return {
		prisma,
		session: null,
		req: new Request('http://localhost/api/trpc', {
			headers: opts?.headers,
		}),
		resHeaders: opts?.resHeaders ?? new Headers(),
	} as Context
}

beforeAll(async () => {
	hubSpies = {
		publishHost: jest.fn(),
		publishAudience: jest.fn(),
	}
	mock.module('@backend/realtime/hub', () => ({ hub: hubSpies }))
	service = await import('@backend/votes/service')
	votingRouter = (await import('@backend/trpc/voting')).votingRouter
	appRouter = (await import('@backend/trpc/root')).appRouter
	createContext = (await import('@backend/trpc/context')).createContext
	TrpcEndpoint = (await import('@backend/normalize-trpc-request')).TRPC_ENDPOINT
})

beforeEach(() => {
	hubSpies.publishHost.mockClear()
	hubSpies.publishAudience.mockClear()
})

afterAll(async () => {
	// No $disconnect here: `prisma` is the process-wide client every service
	// shares, so closing it would break test files that run later in this process.
	await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
})

test('claimSession returns a token and sets the mv_session cookie header', async () => {
	const resHeaders = new Headers()
	const caller = votingRouter.createCaller(callerCtx({ resHeaders }))

	const result = await caller.claimSession()

	expect(typeof result.token).toBe('string')
	expect(result.token.length).toBeGreaterThan(0)

	const cookie = resHeaders.getSetCookie().join(';')
	expect(cookie).toContain('mv_session=')
	expect(cookie).toContain('HttpOnly')
	expect(cookie).toContain('SameSite=Lax')
	expect(cookie).toContain('Max-Age=86400')
	expect(cookie).toContain('Path=/')
})

test('claimSession over the fetch adapter emits Set-Cookie on the response', async () => {
	const res = await fetchRequestHandler({
		endpoint: TrpcEndpoint,
		req: new Request(`http://localhost${TrpcEndpoint}/voting.claimSession`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({}),
		}),
		router: appRouter,
		createContext,
	})

	expect(res.status).toBe(200)
	expect(res.headers.getSetCookie().join(';')).toContain('mv_session=')
})

test('toPollOptions slugs labels into stable unique keys', () => {
	const options = service.toPollOptions(['Sharper drums', 'Warmer chords'])

	expect(options).toEqual([
		{ key: 'sharper-drums', label: 'Sharper drums' },
		{ key: 'warmer-chords', label: 'Warmer chords' },
	])
})

test('toPollOptions deduplicates colliding keys', () => {
	const options = service.toPollOptions(['More energy!', 'More energy?'])

	expect(options.map((option) => option.key)).toEqual([
		'more-energy',
		'more-energy-2',
	])
})

test('toPollOptions keeps a usable key for labels without letters', () => {
	const options = service.toPollOptions(['!!!', '???'])

	expect(options.map((option) => option.key)).toEqual(['option', 'option-2'])
})

test('castVote rejects a poll that is not open', async () => {
	const room = await makeRoom()
	const poll = await makePoll(room.id, { status: 'closed' })

	await expect(service.castVote(poll.id, 'token-a', 'yes')).rejects.toThrow(
		/not open/i,
	)
	expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)
})

test('castVote rejects a vote cast after closesAt', async () => {
	const room = await makeRoom()
	const poll = await makePoll(room.id, {
		status: 'open',
		closesAt: new Date(Date.now() - 1000),
	})

	await expect(service.castVote(poll.id, 'token-a', 'yes')).rejects.toThrow(
		/closed/i,
	)
	expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)
})

test('castVote rejects a choice that is not one of the poll options', async () => {
	const room = await makeRoom()
	const poll = await makePoll(room.id, {
		status: 'open',
		closesAt: new Date(Date.now() + 60_000),
	})

	await expect(service.castVote(poll.id, 'token-a', 'maybe')).rejects.toThrow(
		/INVALID_CHOICE/,
	)
	expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0)
})

test('a second vote from the same session surfaces ALREADY_VOTED and inserts once', async () => {
	const room = await makeRoom()
	const poll = await makePoll(room.id, {
		status: 'open',
		closesAt: new Date(Date.now() + 60_000),
	})

	await service.castVote(poll.id, 'token-a', 'yes')

	await expect(service.castVote(poll.id, 'token-a', 'no')).rejects.toThrow(
		/ALREADY_VOTED/,
	)
	expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1)
})

test('a successful vote pushes vote_count with the DB per-option counts', async () => {
	const room = await makeRoom()
	const poll = await makePoll(room.id, {
		status: 'open',
		closesAt: new Date(Date.now() + 60_000),
	})

	await service.castVote(poll.id, 'token-a', 'yes')
	await service.castVote(poll.id, 'token-b', 'no')
	await service.castVote(poll.id, 'token-c', 'yes')

	const events = hubSpies.publishHost.mock.calls as [string, WsEvent][]
	expect(events.at(-1)?.[0]).toBe(room.id)
	expect(events.at(-1)?.[1]).toEqual({
		type: 'vote_count',
		pollId: poll.id,
		counts: { yes: 2, no: 1 },
	})
	expect(hubSpies.publishAudience).not.toHaveBeenCalled()
})

test('an end-style poll pushes wrap/continue counts, not yes/no zeroes', async () => {
	const room = await makeRoom()
	const poll = await makePoll(room.id, {
		status: 'open',
		closesAt: new Date(Date.now() + 60_000),
		options: [
			{ key: 'wrap', label: 'Wrap it up' },
			{ key: 'continue', label: 'Keep going' },
		],
	})

	await service.castVote(poll.id, 'token-a', 'wrap')
	await service.castVote(poll.id, 'token-b', 'continue')
	await service.castVote(poll.id, 'token-c', 'wrap')

	const events = hubSpies.publishHost.mock.calls as [string, WsEvent][]
	expect(events.at(-1)?.[1]).toEqual({
		type: 'vote_count',
		pollId: poll.id,
		counts: { wrap: 2, continue: 1 },
	})
	expect(hubSpies.publishAudience).not.toHaveBeenCalled()
})

test('currentPoll returns null poll with lobby roomStatus', async () => {
	const room = await makeRoom('lobby')
	const caller = votingRouter.createCaller(callerCtx())

	const result = await caller.currentPoll({ roomId: room.id })

	expect(result).toEqual({ poll: null, roomStatus: 'lobby' })
})

test('currentPoll returns null poll with ended roomStatus', async () => {
	const room = await makeRoom('ended')
	const caller = votingRouter.createCaller(callerCtx())

	const result = await caller.currentPoll({ roomId: room.id })

	expect(result).toEqual({ poll: null, roomStatus: 'ended' })
})

test('currentPoll returns the open poll with options and closesAt', async () => {
	const room = await makeRoom('live')
	const closesAt = new Date(Date.now() + 30_000)
	const poll = await makePoll(room.id, { status: 'open', closesAt })
	const caller = votingRouter.createCaller(callerCtx())

	const result = await caller.currentPoll({ roomId: room.id })

	expect(result.roomStatus).toBe('live')
	expect(result.poll).toEqual({
		id: poll.id,
		question: 'More drums?',
		options: [
			{ key: 'yes', label: 'Yes' },
			{ key: 'no', label: 'No' },
		],
		closesAt,
	})
})

test('castVote procedure reads the mv_session cookie from the request', async () => {
	const room = await makeRoom()
	const poll = await makePoll(room.id, {
		status: 'open',
		closesAt: new Date(Date.now() + 60_000),
	})

	const missing = votingRouter.createCaller(callerCtx())
	await expect(
		missing.castVote({ pollId: poll.id, choice: 'yes' }),
	).rejects.toThrow(/SESSION_REQUIRED/)

	const withCookie = votingRouter.createCaller(
		callerCtx({ headers: { cookie: 'mv_session=token-a' } }),
	)
	await withCookie.castVote({ pollId: poll.id, choice: 'yes' })

	const votes = await prisma.vote.findMany({ where: { pollId: poll.id } })
	expect(votes).toHaveLength(1)
	expect(votes[0].sessionToken).toBe('token-a')
})

test('summary returns polls with winners, applied flags, and versions', async () => {
	const room = await makeRoom('ended')
	const applied = await makePoll(room.id, {
		seq: 1,
		status: 'closed',
		winningOption: 'yes',
	})
	await makePoll(room.id, {
		seq: 2,
		status: 'closed',
		winningOption: 'no',
	})
	const appliedAt = new Date()
	await prisma.patternVersion.create({
		data: {
			roomId: room.id,
			code: 's("bd sd")',
			source: applied.id,
			status: 'applied',
			appliedAt,
		},
	})
	const caller = votingRouter.createCaller(callerCtx())

	const result = await caller.summary({ roomId: room.id })

	expect(result.polls).toEqual([
		{ question: 'More drums?', winningOption: 'yes', applied: true },
		{ question: 'More drums?', winningOption: 'no', applied: false },
	])
	expect(result.versions).toHaveLength(1)
	expect(result.versions[0]).toEqual({
		code: 's("bd sd")',
		appliedAt,
		source: applied.id,
	})
})
