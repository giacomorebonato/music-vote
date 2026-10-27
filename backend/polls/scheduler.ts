import { prisma } from '@backend/db/client'
import { getLlmProvider } from '@backend/llm/provider'
import { generateCrowdEvolution } from '@backend/music/engine'
import type { StateDoc } from '@backend/music/state-doc'
import { hub } from '@backend/realtime/hub'
import {
	ensurePreferenceQuestions,
	readCrowdQuestions,
} from '@backend/votes/preferences'
import {
	crowdSnapshotSchema,
	type CrowdSnapshot,
} from '@shared/schemas/preferences'
import type { Prisma, Room } from '../../prisma/generated/client'

const CHECK_MS = 10_000
const DELIVERY_TIMEOUT_MS = 60_000

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
let clock = defaultClock
export function setSchedulerClock(next: SchedulerClock): void {
	clock = next
}

type Scheduler = {
	roomId: string
	tick?: unknown
	end?: unknown
	generating: boolean
}
const active = new Map<string, Scheduler>()

export function disarmScheduler(roomId: string): void {
	const scheduler = active.get(roomId)
	if (!scheduler) return
	if (scheduler.tick !== undefined) clock.clearTimeout(scheduler.tick)
	if (scheduler.end !== undefined) clock.clearTimeout(scheduler.end)
	active.delete(roomId)
}
export function isSchedulerArmed(roomId: string): boolean {
	return active.has(roomId)
}

export function armScheduler(roomId: string): void {
	disarmScheduler(roomId)
	const scheduler: Scheduler = { roomId, generating: false }
	active.set(roomId, scheduler)
	scheduler.tick = clock.setTimeout(async () => {
		try {
			const room = await prisma.room.findUnique({ where: { id: roomId } })
			if (active.get(roomId) !== scheduler) return
			if (room?.status === 'outro') {
				const version = await prisma.patternVersion.findFirst({
					where: { roomId, source: 'outro' },
					orderBy: { appliedAt: 'desc' },
				})
				const remaining =
					room.pollIntervalSec * 1000 -
					(version?.appliedAt ? clock.now() - version.appliedAt.getTime() : 0)
				scheduler.end = clock.setTimeout(
					() => finalizeOutroRoom(roomId),
					Math.max(0, remaining),
				)
				return
			}
			if (room?.status !== 'live') {
				disarmScheduler(roomId)
				return
			}
			await ensurePreferenceQuestions(roomId)
			const endAt =
				(room.startedAt ?? room.createdAt).getTime() + room.lengthSec * 1000
			scheduler.end = clock.setTimeout(
				() => endLiveRoom(room),
				Math.max(0, endAt - clock.now()),
			)
			notify(roomId)
			scheduleTick(scheduler)
		} catch (error) {
			console.error(`Crowd scheduler bootstrap failed for ${roomId}`, error)
			if (active.get(roomId) === scheduler)
				scheduler.tick = clock.setTimeout(() => armScheduler(roomId), CHECK_MS)
		}
	}, 0)
}

function scheduleTick(scheduler: Scheduler): void {
	if (active.get(scheduler.roomId) !== scheduler) return
	scheduler.tick = clock.setTimeout(async () => {
		try {
			await checkCrowd(scheduler)
		} catch (error) {
			console.error(`Crowd update failed for ${scheduler.roomId}`, error)
		} finally {
			scheduleTick(scheduler)
		}
	}, CHECK_MS)
}

async function endLiveRoom(room: Room): Promise<void> {
	const { endRoom } = await import('@backend/rooms/service')
	await endRoom(room.id, room.hostId)
}

function notify(roomId: string): void {
	hub.publishAudience(roomId, { type: 'crowd_changed' })
	hub.publishHost(roomId, { type: 'crowd_changed' })
}

async function failUpdate(id: string, roomId: string): Promise<void> {
	await prisma.$transaction(async (tx) => {
		await tx.poll.updateMany({
			where: { id, deliveryStatus: 'preparing' },
			data: { deliveryStatus: 'failed', resolvedAt: new Date(clock.now()) },
		})
		await tx.patternVersion.updateMany({
			where: { source: id, status: 'candidate' },
			data: { status: 'rejected' },
		})
	})
	notify(roomId)
}

async function checkCrowd(scheduler: Scheduler): Promise<void> {
	const room = await prisma.room.findUnique({ where: { id: scheduler.roomId } })
	if (room?.status !== 'live') {
		disarmScheduler(scheduler.roomId)
		return
	}
	if (
		clock.now() >=
		(room.startedAt ?? room.createdAt).getTime() + room.lengthSec * 1000
	) {
		await endLiveRoom(room)
		return
	}
	const pending = await prisma.poll.findFirst({
		where: { roomId: room.id, deliveryStatus: 'preparing' },
		orderBy: { seq: 'desc' },
	})
	if (pending) {
		if (
			pending.closedAt &&
			clock.now() - pending.closedAt.getTime() >= DELIVERY_TIMEOUT_MS
		)
			await failUpdate(pending.id, room.id)
		else return
	}
	if (scheduler.generating) return
	// Personal selections are deliberately excluded from snapshots and model prompts.
	const snapshot: CrowdSnapshot = (await readCrowdQuestions(room.id)).map(
		({ choice: _choice, ...question }) => question,
	)
	if (
		!snapshot.some((question) =>
			Object.values(question.counts).some((count) => count > 0),
		)
	)
		return
	const last = await prisma.poll.findFirst({
		where: { roomId: room.id, kind: 'crowd' },
		orderBy: { seq: 'desc' },
	})
	const previous = crowdSnapshotSchema.safeParse(last?.options)
	if (
		previous.success &&
		JSON.stringify(previous.data) === JSON.stringify(snapshot)
	)
		return
	const latest = await prisma.poll.findFirst({
		where: { roomId: room.id },
		orderBy: { seq: 'desc' },
	})
	const update = await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: (latest?.seq ?? 0) + 1,
			kind: 'crowd',
			question: 'Crowd preferences',
			// Internal delivery record stores the complete distribution, never a winner.
			options: snapshot,
			status: 'closed',
			deliveryStatus: 'preparing',
			closedAt: new Date(clock.now()),
		},
	})
	scheduler.generating = true
	notify(room.id)
	void prepareUpdate(scheduler, room, update.id, snapshot)
		.catch(async (error: unknown) => {
			console.error(`Crowd generation failed for ${room.id}`, error)
			await failUpdate(update.id, room.id)
		})
		.finally(() => {
			scheduler.generating = false
		})
}

async function prepareUpdate(
	scheduler: Scheduler,
	room: Room,
	updateId: string,
	snapshot: CrowdSnapshot,
): Promise<void> {
	const result = await generateCrowdEvolution(
		getLlmProvider(),
		room.stateDoc as unknown as StateDoc,
		snapshot,
		room.currentCode ?? '',
	)
	// The transaction protects against end, undo, timeout and scheduler replacement.
	const version = await prisma.$transaction(async (tx) => {
		const fresh = await tx.room.findUnique({ where: { id: room.id } })
		const update = await tx.poll.findUnique({ where: { id: updateId } })
		if (
			active.get(room.id) !== scheduler ||
			fresh?.status !== 'live' ||
			fresh.currentVersionId !== room.currentVersionId ||
			update?.deliveryStatus !== 'preparing'
		)
			return null
		if (result === 'hold' || !result) {
			await tx.poll.update({
				where: { id: updateId },
				data: {
					deliveryStatus: result === 'hold' ? 'unchanged' : 'failed',
					resolvedAt: new Date(clock.now()),
				},
			})
			return null
		}
		return tx.patternVersion.create({
			data: {
				roomId: room.id,
				code: result.code,
				source: updateId,
				status: 'candidate',
				baseVersionId: room.currentVersionId,
				stateDoc: {
					...(room.stateDoc as unknown as StateDoc),
					crowdHistory: [
						...(
							(room.stateDoc as unknown as StateDoc).crowdHistory ?? []
						).slice(-19),
						{ at: clock.now(), snapshot },
					],
				} as unknown as Prisma.InputJsonObject,
			},
		})
	})
	if (version)
		hub.publishHost(room.id, {
			type: 'code_update',
			code: version.code,
			versionId: version.id,
			kind: 'evolution',
		})
	else {
		// A stale base must release the delivery slot without touching played music.
		const unresolved = await prisma.poll.findUnique({ where: { id: updateId } })
		if (unresolved?.deliveryStatus === 'preparing')
			await failUpdate(updateId, room.id)
	}
	notify(room.id)
}

async function finalizeOutroRoom(roomId: string): Promise<void> {
	await prisma.room.updateMany({
		where: { id: roomId, status: 'outro' },
		data: { status: 'ended' },
	})
	hub.publishAudience(roomId, { type: 'room_ended' })
	hub.publishHost(roomId, { type: 'room_status', status: 'ended' })
	disarmScheduler(roomId)
}

export async function restoreSchedulers(): Promise<void> {
	const rooms = await prisma.room.findMany({
		where: { status: { in: ['live', 'outro'] } },
	})
	for (const room of rooms) armScheduler(room.id)
}
