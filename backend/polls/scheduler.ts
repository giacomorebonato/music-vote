import { prisma } from '@backend/db/client'
import { getLlmProvider } from '@backend/llm/provider'
import { generateEvolution, generateNextQuestion } from '@backend/music/engine'
import { applyChange, type StateDoc } from '@backend/music/state-doc'
import { compileCheck } from '@backend/music/validate'
import { hub } from '@backend/realtime/hub'
import { toPollOptions } from '@backend/votes/service'
import type { WsEvent } from '@shared/realtime/events'
import type { Prisma, Room } from '../../prisma/generated/client'

/**
 * Poll scheduler for a live music-vote room.
 *
 * The scheduler uses an injected clock so tests can run deterministically
 * without real sleeps. The default clock delegates to the real timers.
 *
 * When MV_E2E_FAST=1 the poll open window shrinks to 5s and the interval clamps
 * to a minimum of 10s so end-to-end tests can run a real cycle quickly.
 *
 * Dev quick-testing: setting MV_TEST_INTERVAL_SECS=<s> compresses every room's
 * interval DOWN to at most <s> seconds (regardless of the schema minimum),
 * so poll results land ~ every <s> + open-window seconds. Setting
 * MV_TEST_POLL_OPEN_SECS=<s> overrides the per-room poll open window (the
 * create-room form default is 20s), for example `MV_TEST_POLL_OPEN_SECS=10 bun
 * run dev` gives a 10s countdown after voting in every room. Dev-only: unset
 * env leaves per-room timings untouched, and MV_E2E_FAST keeps precedence
 * (its 5s window must stay stable for E2E).
 */

const DEFAULT_POLL_OPEN_SECS = 20
const MIN_INTERVAL_SECS = process.env.MV_E2E_FAST === '1' ? 10 : 0

function parseTestInterval(): number | null {
	const raw = Number.parseInt(process.env.MV_TEST_INTERVAL_SECS ?? '', 10)
	return Number.isInteger(raw) && raw > 0 ? raw : null
}

function parseTestPollOpenSecs(): number | null {
	const raw = Number.parseInt(process.env.MV_TEST_POLL_OPEN_SECS ?? '', 10)
	return Number.isInteger(raw) && raw > 0 ? raw : null
}

/**
 * Poll open window in ms. Fast mode hard-codes the 5s window; otherwise the
 * dev-only MV_TEST_POLL_OPEN_SECS override wins, defaulting to the per-room
 * `pollOpenSec` (create-room field, 20s default).
 */
export function pollOpenMs(roomPollOpenSec = DEFAULT_POLL_OPEN_SECS): number {
	if (process.env.MV_E2E_FAST === '1') return 5_000
	const secs = parseTestPollOpenSecs() ?? roomPollOpenSec
	return secs * 1000
}

/**
 * Effective room interval in seconds. Compression (dev MV_TEST_INTERVAL_SECS)
 * lowers the interval; it never RAISES it — the fast-mode 10s floor is applied
 * by the tick-site callers that historically had it (raw pollIntervalSec on
 * outro-finalize sites keeps its shorter semantics).
 */
export function roomIntervalSec(pollIntervalSec: number): number {
	let secs = pollIntervalSec
	const testInterval = parseTestInterval()
	if (testInterval) secs = Math.min(secs, testInterval)
	return secs
}

/** Room interval for live ticks: compression + fast-mode floor. */
function tickIntervalMSec(pollIntervalSec: number): number {
	return Math.max(roomIntervalSec(pollIntervalSec), MIN_INTERVAL_SECS) * 1000
}

/** Check readiness frequently; the configured interval is the rest duration. */
function maintenanceTickMs(pollIntervalSec: number): number {
	const intervalMs = tickIntervalMSec(pollIntervalSec)
	return process.env.MV_E2E_FAST === '1'
		? intervalMs
		: Math.min(intervalMs, 5000)
}

export type SchedulerClock = {
	now(): number
	setTimeout(callback: () => void | Promise<void>, ms: number): unknown
	clearTimeout(handle: unknown): void
}

const defaultClock: SchedulerClock = {
	now: () => Date.now(),
	setTimeout: (callback, ms) =>
		globalThis.setTimeout(callback as () => void, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
}

let clock: SchedulerClock = defaultClock

export function setSchedulerClock(next: SchedulerClock): void {
	clock = next
}

type PollOption = {
	key: string
	label: string
	intent?: 'hold' | 'change'
}

type RoomScheduler = {
	roomId: string
	bootHandle?: unknown
	endHandle?: unknown
	endPollHandle?: unknown
	intervalHandle?: unknown
	pollCloseHandle?: unknown
	outroHandle?: unknown
	continuing?: boolean
}

const active = new Map<string, RoomScheduler>()

export function disarmScheduler(roomId: string): void {
	const scheduler = active.get(roomId)
	if (!scheduler) return
	for (const key of [
		'bootHandle',
		'endHandle',
		'endPollHandle',
		'intervalHandle',
		'pollCloseHandle',
		'outroHandle',
	] as const) {
		const handle = scheduler[key]
		if (handle !== undefined) clock.clearTimeout(handle)
	}
	active.delete(roomId)
}

export function isSchedulerArmed(roomId: string): boolean {
	return active.has(roomId)
}

export function armScheduler(roomId: string): void {
	disarmScheduler(roomId)
	const scheduler: RoomScheduler = { roomId }
	active.set(roomId, scheduler)
	scheduler.bootHandle = clock.setTimeout(async () => {
		await bootstrap(roomId)
	}, 0)
}

async function bootstrap(roomId: string): Promise<void> {
	const scheduler = active.get(roomId)
	if (!scheduler) return
	if (scheduler.bootHandle !== undefined) {
		clock.clearTimeout(scheduler.bootHandle)
		scheduler.bootHandle = undefined
	}

	const room = await prisma.room.findUnique({ where: { id: roomId } })
	if (!room) {
		disarmScheduler(roomId)
		return
	}

	if (room.status === 'live') {
		await armLive(room)
	} else if (room.status === 'outro') {
		await armOutro(room)
	} else {
		disarmScheduler(roomId)
	}
}

async function armLive(room: Room): Promise<void> {
	const scheduler = active.get(room.id)
	if (!scheduler) return

	const now = clock.now()
	const endAt =
		(room.startedAt ?? room.createdAt).getTime() + room.lengthSec * 1000
	if (endAt <= now) {
		await triggerEndRoom(room.id, room.hostId)
		disarmScheduler(room.id)
		return
	}

	scheduler.endHandle = clock.setTimeout(async () => {
		await endRoomAndDisarm(room.id, room.hostId)
	}, endAt - now)

	const insertAt =
		(room.startedAt ?? room.createdAt).getTime() +
		Math.floor(room.lengthSec * 750)
	if (insertAt <= now) {
		await ensureEndPoll(room.id)
		await openNextQueuedPoll(room.id)
	} else {
		scheduler.endPollHandle = clock.setTimeout(async () => {
			await ensureEndPollAndOpen(room.id)
		}, insertAt - now)
	}

	const tickMs = maintenanceTickMs(room.pollIntervalSec)
	scheduler.intervalHandle = clock.setTimeout(async () => {
		await liveTick(room.id, tickMs)
	}, tickMs)

	await openNextQueuedPoll(room.id)
	await armExistingPollClose(room.id)
}

async function armExistingPollClose(roomId: string): Promise<void> {
	const scheduler = active.get(roomId)
	if (!scheduler || scheduler.pollCloseHandle !== undefined) return

	const openPoll = await prisma.poll.findFirst({
		where: { roomId, status: 'open' },
	})
	if (!openPoll?.closesAt) return

	const remaining = openPoll.closesAt.getTime() - clock.now()
	if (remaining <= 0) {
		await closePoll(openPoll.id, roomId)
		return
	}

	scheduler.pollCloseHandle = clock.setTimeout(async () => {
		await closePoll(openPoll.id, roomId)
	}, remaining)
}

async function liveTick(roomId: string, tickMs: number): Promise<void> {
	const scheduler = active.get(roomId)
	if (!scheduler) return
	scheduler.intervalHandle = undefined

	const room = await prisma.room.findUnique({ where: { id: roomId } })
	if (room?.status !== 'live') {
		disarmScheduler(roomId)
		return
	}

	const now = clock.now()
	if (
		now >=
		(room.startedAt ?? room.createdAt).getTime() + room.lengthSec * 1000
	) {
		await triggerEndRoom(roomId, room.hostId)
		disarmScheduler(roomId)
		return
	}

	try {
		await healPollChain(roomId, room, now)
	} catch (error) {
		console.error(`Poll tick maintenance failed in room ${roomId}`, error)
	}
	scheduler.intervalHandle = clock.setTimeout(async () => {
		await liveTick(roomId, tickMs)
	}, tickMs)
}

/**
 * Keep a live room's poll chain moving on every tick.
 *
 * A lost close timer (crash mid-close, hot reload) leaves an overdue open poll
 * that blocks openNextQueuedPoll forever, and a failed close can leave the room
 * with no open and no queued poll at all — the vote page then waits forever and
 * the set silently stops evolving. Close the overdue poll first, then open the
 * next queued one, and rebuild the queue when nothing is pending (the guards
 * inside queueNextEvolution keep the rebuild a no-op past the end-poll insert
 * point).
 */
async function healPollChain(
	roomId: string,
	room: Room,
	now: number,
): Promise<void> {
	const stale = await prisma.poll.findFirst({
		where: { roomId, status: 'open' },
	})
	if (stale?.closesAt && stale.closesAt.getTime() <= now) {
		await closePoll(stale.id, roomId)
	}
	await openNextQueuedPoll(roomId)
	const openPoll = await prisma.poll.findFirst({
		where: { roomId, status: 'open' },
	})
	if (openPoll) return
	const queuedPoll = await prisma.poll.findFirst({
		where: { roomId, status: 'queued' },
	})
	if (queuedPoll) return
	const latestClosed = await prisma.poll.findFirst({
		where: { roomId, kind: 'evolution', status: 'closed' },
		orderBy: { seq: 'desc' },
	})
	if (
		latestClosed?.deliveryStatus === 'preparing' &&
		process.env.MV_E2E_FAST !== '1'
	)
		return
	try {
		await queueNextEvolution(roomId, room)
	} catch (error) {
		console.error(`Poll chain rebuild failed for ${roomId}`, error)
	}
	await openNextQueuedPoll(roomId)
}

async function armOutro(room: Room): Promise<void> {
	const scheduler = active.get(room.id)
	if (!scheduler) return

	const version = await prisma.patternVersion.findFirst({
		where: { roomId: room.id, source: 'outro', status: 'candidate' },
		orderBy: { appliedAt: 'desc' },
	})

	const now = clock.now()
	let remaining = roomIntervalSec(room.pollIntervalSec) * 1000
	if (version?.appliedAt) {
		remaining -= now - version.appliedAt.getTime()
	}

	if (remaining <= 0) {
		await finalizeOutroRoom(room.id)
		disarmScheduler(room.id)
		return
	}

	scheduler.outroHandle = clock.setTimeout(async () => {
		await finalizeOutroAndDisarm(room.id)
	}, remaining)
}

async function endRoomAndDisarm(roomId: string, hostId: string): Promise<void> {
	await triggerEndRoom(roomId, hostId)
	disarmScheduler(roomId)
}

async function finalizeOutroAndDisarm(roomId: string): Promise<void> {
	await finalizeOutroRoom(roomId)
	disarmScheduler(roomId)
}

async function triggerEndRoom(roomId: string, hostId: string): Promise<void> {
	const { endRoom } = await import('@backend/rooms/service')
	await endRoom(roomId, hostId)
}

async function ensureEndPollAndOpen(roomId: string): Promise<void> {
	const scheduler = active.get(roomId)
	if (scheduler) scheduler.endPollHandle = undefined
	await ensureEndPoll(roomId)
	await openNextQueuedPoll(roomId)
}

async function ensureEndPoll(roomId: string): Promise<void> {
	const existing = await prisma.poll.findFirst({
		where: { roomId, kind: 'end' },
	})
	if (existing) return

	const last = await prisma.poll.findFirst({
		where: { roomId },
		orderBy: { seq: 'desc' },
	})
	const seq = (last?.seq ?? 0) + 1
	await prisma.poll.create({
		data: {
			roomId,
			seq,
			kind: 'end',
			question: 'End the set?',
			options: [
				{ key: 'wrap', label: 'Wrap it up' },
				{ key: 'continue', label: 'Keep going' },
			],
			status: 'queued',
		},
	})
}

async function openNextQueuedPoll(roomId: string): Promise<void> {
	const openPoll = await prisma.poll.findFirst({
		where: { roomId, status: 'open' },
	})
	if (openPoll) return

	const room = await prisma.room.findUnique({
		where: { id: roomId },
		select: { pollOpenSec: true },
	})

	let queued = await prisma.poll.findFirst({
		where: { roomId, status: 'queued' },
		orderBy: { seq: 'asc' },
	})
	if (!queued) return
	const endPoll = await prisma.poll.findFirst({
		where: { roomId, kind: 'end', status: 'queued' },
	})
	if (endPoll && queued.kind === 'evolution') {
		await prisma.poll.update({
			where: { id: queued.id },
			data: {
				status: 'closed',
				deliveryStatus: 'unchanged',
				closedAt: new Date(clock.now()),
				resolvedAt: new Date(clock.now()),
			},
		})
		queued = endPoll
	}
	if (queued.kind === 'evolution' && process.env.MV_E2E_FAST !== '1') {
		const lastClosed = await prisma.poll.findFirst({
			where: { roomId, kind: 'evolution', status: 'closed' },
			orderBy: { seq: 'desc' },
		})
		if (lastClosed) {
			if (lastClosed.deliveryStatus === 'preparing') {
				if (
					lastClosed.closedAt &&
					clock.now() - lastClosed.closedAt.getTime() >= 30_000
				) {
					await markFailed(lastClosed.id, roomId)
				} else return
			}
			const roomInterval = roomIntervalSec(
				(await prisma.room.findUnique({ where: { id: roomId } }))
					?.pollIntervalSec ?? 60,
			)
			const restUntil =
				(lastClosed.resolvedAt ?? lastClosed.closedAt)?.getTime() ?? 0
			if (clock.now() < restUntil + roomInterval * 1000) return
		}
	}

	const now = new Date(clock.now())
	const openMs = pollOpenMs(room?.pollOpenSec)
	const closesAt = new Date(now.getTime() + openMs)
	await prisma.poll.update({
		where: { id: queued.id },
		data: { status: 'open', openedAt: now, closesAt },
	})

	const options = parseOptions(queued.options)
	const opened: WsEvent = {
		type: 'poll_opened',
		poll: {
			id: queued.id,
			question: queued.question,
			options: options.map((option) => option.label),
			closesAt: closesAt.toISOString(),
		},
	}
	hub.publishAudience(roomId, opened)
	// Host console follows the live poll (question + bars), including a poll
	// that opens with zero votes; audience publication is unchanged.
	hub.publishHost(roomId, opened)

	const scheduler = active.get(roomId)
	if (scheduler) {
		if (scheduler.pollCloseHandle !== undefined) {
			clock.clearTimeout(scheduler.pollCloseHandle)
		}
		scheduler.pollCloseHandle = clock.setTimeout(async () => {
			await closePoll(queued.id, roomId)
		}, openMs)
	}
}

async function closePoll(pollId: string, roomId: string): Promise<void> {
	const poll = await prisma.poll.findUnique({
		where: { id: pollId },
	})
	if (poll?.status !== 'open') return

	const room = await prisma.room.findUnique({ where: { id: roomId } })
	if (!room) return

	const scheduler = active.get(roomId)
	if (scheduler) scheduler.pollCloseHandle = undefined

	const options = parseOptions(poll.options)
	const outcome = await prisma.$transaction(async (tx) => {
		const claimed = await tx.poll.updateMany({
			where: { id: pollId, status: 'open' },
			data: { status: 'closed' },
		})
		if (claimed.count === 0) return null
		const votes = await tx.vote.findMany({ where: { pollId } })
		const winner = pickWinner(options, votes)
		const hold =
			options.find((option) => option.key === winner)?.intent === 'hold'
		const needsMusic = winner !== null && !hold && poll.kind === 'evolution'
		await tx.poll.update({
			where: { id: pollId },
			data: {
				winningOption: winner,
				deliveryStatus: needsMusic ? 'preparing' : 'unchanged',
				closedAt: new Date(clock.now()),
				resolvedAt: needsMusic ? null : new Date(clock.now()),
			},
		})
		return { winner, hold, needsMusic }
	})
	if (!outcome) return
	const { winner, hold, needsMusic } = outcome

	const closed: WsEvent = {
		type: 'poll_closed',
		pollId: poll.id,
		winningOption: winner,
	}
	hub.publishAudience(roomId, closed)
	hub.publishHost(roomId, closed)

	if (winner && !hold)
		await applyPollOutcome(roomId, room, poll, options, winner)

	if (
		poll.kind === 'evolution' &&
		(!needsMusic || process.env.MV_E2E_FAST === '1')
	) {
		await queueNextEvolutionAfterClose(roomId, room)
	}
}

/**
 * Act on a closed poll's winning option. A crash anywhere in here (LLM outage,
 * DB busy) must not kill the close: it is logged, the host is warned that the
 * music is unchanged, and the poll chain heals on the next liveTick.
 */
async function applyPollOutcome(
	roomId: string,
	room: Room,
	poll: { id: string; kind: string; question: string },
	options: PollOption[],
	winner: string,
): Promise<void> {
	const winnerLabel =
		options.find((option) => option.key === winner)?.label ?? winner
	try {
		if (poll.kind === 'end') {
			await applyEndPollOutcome(roomId, room, winner)
		} else if (poll.kind === 'evolution') {
			// The prompt needs the human-readable change, not the storage key.
			await runEvolution(room, poll, winnerLabel)
		}
	} catch (error) {
		console.error(`Poll ${poll.id} winner handling crashed`, error)
		hub.publishHost(roomId, {
			type: 'warning',
			message: 'Evolution poll failed; music unchanged',
		})
		if (poll.kind === 'evolution') await markFailed(poll.id, roomId)
	}
}

async function markFailed(pollId: string, roomId: string): Promise<void> {
	await prisma.patternVersion.updateMany({
		where: { source: pollId, status: 'candidate' },
		data: { status: 'rejected' },
	})
	await prisma.poll.update({
		where: { id: pollId },
		data: { deliveryStatus: 'failed', resolvedAt: new Date(clock.now()) },
	})
	hub.publishAudience(roomId, { type: 'music_result', pollId })
}

async function applyEndPollOutcome(
	roomId: string,
	room: Room,
	winner: string,
): Promise<void> {
	if (winner === 'wrap') {
		await triggerEndRoom(roomId, room.hostId)
		return
	}
	if (winner === 'continue') {
		const current = active.get(roomId)
		if (current) current.continuing = true
		await queueNextEvolution(roomId, room, { afterContinue: true })
		await openNextQueuedPoll(roomId)
	}
}

/**
 * Timing guards for the next evolution question. Rooms only poll before the
 * end-poll insert point (75% of the set); a "keep going" win suspends that
 * limit for the rest of the set, but never past the room's end time.
 */
function shouldQueueNextEvolution(
	roomId: string,
	room: Room,
	opts?: { afterContinue?: boolean },
): boolean {
	const now = clock.now()
	const insertAt =
		(room.startedAt ?? room.createdAt).getTime() + room.lengthSec * 750
	const intervalMs = tickIntervalMSec(room.pollIntervalSec)

	const scheduler = active.get(roomId)
	if (scheduler?.continuing) {
		const endAt =
			(room.startedAt ?? room.createdAt).getTime() + room.lengthSec * 1000
		return now + intervalMs < endAt
	}
	if (opts?.afterContinue) return true
	return now < insertAt && now + intervalMs < insertAt
}

async function queueNextEvolutionAfterClose(
	roomId: string,
	room: Room,
): Promise<void> {
	try {
		await queueNextEvolution(roomId, room)
	} catch (error) {
		console.error(`Failed to queue the next evolution for ${roomId}`, error)
		// The next liveTick's self-heal retries the queue rebuild.
	}
}

async function runEvolution(
	room: Room,
	poll: { id: string; question: string },
	winner: string,
): Promise<void> {
	const provider = getLlmProvider()
	// Overlapping closes are the norm (a poll can close while the previous
	// evolution's LLM call is still pending), so the room snapshot taken at
	// closePoll time can be stale. Re-read for the prompt so history reflects
	// every applied change, not just the ones this close happened to see.
	const fresh = await prisma.room.findUnique({ where: { id: room.id } })
	const doc =
		(fresh?.stateDoc as unknown as StateDoc | undefined) ??
		(room.stateDoc as unknown as StateDoc)
	const result = await generateEvolution(
		provider,
		doc,
		poll.question,
		winner,
		fresh?.currentCode ?? room.currentCode ?? '',
	)
	const stillOpen = await prisma.poll.findUnique({ where: { id: poll.id } })
	if (stillOpen?.deliveryStatus !== 'preparing') return
	const latestRoom = await prisma.room.findUnique({ where: { id: room.id } })
	if (
		latestRoom?.status !== 'live' ||
		latestRoom.currentVersionId !== fresh?.currentVersionId
	) {
		await markFailed(poll.id, room.id)
		return
	}

	if (!result || !compileCheck(result.code).ok) {
		console.info(`Poll ${poll.id} no change`)
		hub.publishHost(room.id, {
			type: 'warning',
			message: 'Evolution generation failed; music unchanged',
		})
		await markFailed(poll.id, room.id)
		return
	}

	const version = await prisma.patternVersion.create({
		data: {
			roomId: room.id,
			code: result.code,
			stateDoc: applyChange(
				doc,
				poll.question,
				winner,
				result.changeSummary,
			) as unknown as Prisma.InputJsonObject,
			baseVersionId: fresh?.currentVersionId,
			source: poll.id,
			status: 'candidate',
		},
	})
	hub.publishHost(room.id, {
		type: 'code_update',
		code: result.code,
		versionId: version.id,
		kind: 'evolution',
	})
}

async function queueNextEvolution(
	roomId: string,
	room: Room,
	opts?: { afterContinue?: boolean },
): Promise<void> {
	const existingEnd = await prisma.poll.findFirst({
		where: {
			roomId,
			kind: 'end',
			status: { in: ['queued', 'open'] },
		},
	})
	if (existingEnd) return

	if (!shouldQueueNextEvolution(roomId, room, opts)) return

	const last = await prisma.poll.findFirst({
		where: { roomId },
		orderBy: { seq: 'desc' },
	})
	const seq = (last?.seq ?? 0) + 1
	const provider = getLlmProvider()
	// Fresh stateDoc for the question: polls overlap, so the Room snapshot
	// from closePoll time can predate a concurrent evolution's history entry —
	// the question must not describe a change that already landed.
	const fresh = await prisma.room.findUnique({ where: { id: roomId } })
	const doc =
		(fresh?.stateDoc as unknown as StateDoc | undefined) ??
		(room.stateDoc as unknown as StateDoc)
	const generated = await generateNextQuestion(provider, doc)
	const options =
		seq % 4 === 0
			? [
					{ key: 'stay-here', label: 'Stay here', intent: 'hold' },
					{ ...toPollOptions([generated.options[0]])[0], intent: 'change' },
				]
			: toPollOptions(generated.options)
	await prisma.poll.create({
		data: {
			roomId,
			seq,
			kind: 'evolution',
			question: generated.question,
			options,
			status: 'queued',
		},
	})
}

async function finalizeOutroRoom(roomId: string): Promise<void> {
	await prisma.room.update({ where: { id: roomId }, data: { status: 'ended' } })
	hub.publishAudience(roomId, { type: 'room_ended' })
	hub.publishHost(roomId, { type: 'room_status', status: 'ended' })
}

export async function restoreSchedulers(): Promise<void> {
	const now = clock.now()

	const liveRooms = await prisma.room.findMany({ where: { status: 'live' } })
	for (const room of liveRooms) {
		const overdue = await prisma.poll.findFirst({
			where: {
				roomId: room.id,
				status: 'open',
				closesAt: { lte: new Date(now) },
			},
		})
		if (overdue) {
			await prisma.poll.update({
				where: { id: overdue.id },
				data: {
					status: 'closed',
					winningOption: null,
					deliveryStatus: 'unchanged',
					closedAt: new Date(now),
					resolvedAt: new Date(now),
				},
			})
			const closed: WsEvent = {
				type: 'poll_closed',
				pollId: overdue.id,
				winningOption: null,
			}
			hub.publishAudience(room.id, closed)
			hub.publishHost(room.id, closed)
			// A crash while a poll was open leaves the queue empty (the design only
			// keeps a question behind an open poll), so the overdue close has to
			// replenish it like closePoll does or evolution polls stop for the set.
			if (overdue.kind === 'evolution') {
				await queueNextEvolution(room.id, room)
			}
		}
		armScheduler(room.id)
	}

	const outroRooms = await prisma.room.findMany({ where: { status: 'outro' } })
	for (const room of outroRooms) {
		const version = await prisma.patternVersion.findFirst({
			where: { roomId: room.id, source: 'outro', status: 'candidate' },
			orderBy: { appliedAt: 'desc' },
		})
		let remaining = roomIntervalSec(room.pollIntervalSec) * 1000
		if (version?.appliedAt) {
			remaining -= now - version.appliedAt.getTime()
		}
		if (remaining <= 0) {
			await finalizeOutroRoom(room.id)
		} else {
			disarmScheduler(room.id)
			armScheduler(room.id)
		}
	}
}

function parseOptions(options: unknown): PollOption[] {
	if (Array.isArray(options)) return options as PollOption[]
	return []
}

function tallyVotes(
	votes: { choice: string }[],
	options: PollOption[],
): Map<string, number> {
	const counts = new Map<string, number>()
	const validKeys = new Set(options.map((option) => option.key))
	for (const option of options) {
		counts.set(option.key, 0)
	}
	for (const vote of votes) {
		if (validKeys.has(vote.choice)) {
			counts.set(vote.choice, (counts.get(vote.choice) ?? 0) + 1)
		}
	}
	return counts
}

export function pickWinner(
	options: PollOption[],
	votes: { choice: string }[],
): string | null {
	const counts = tallyVotes(votes, options)
	const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
	if (total === 0) return null
	return (
		options.find((option) => (counts.get(option.key) ?? 0) > total / 2)?.key ??
		null
	)
}
