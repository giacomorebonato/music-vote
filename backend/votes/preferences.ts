import { prisma } from '@backend/db/client'
import {
	preferenceQuestions,
	type CrowdQuestion,
} from '@shared/schemas/preferences'

/** Reuse durable poll/vote storage; preference polls never have deadlines. */
export async function ensurePreferenceQuestions(roomId: string): Promise<void> {
	await prisma.$transaction(async (tx) => {
		const existing = await tx.poll.count({
			where: { roomId, kind: 'preference' },
		})
		if (existing > 0) return
		const room = await tx.room.findUnique({ where: { id: roomId } })
		if (room?.status !== 'live') return
		// Older live rooms switch to continuous input on scheduler recovery.
		await tx.poll.updateMany({
			where: { roomId, status: { in: ['open', 'queued'] } },
			data: {
				status: 'closed',
				winningOption: null,
				deliveryStatus: 'unchanged',
				resolvedAt: new Date(),
			},
		})
		await tx.poll.updateMany({
			where: { roomId, deliveryStatus: 'preparing' },
			data: { deliveryStatus: 'failed', resolvedAt: new Date() },
		})
		await tx.patternVersion.updateMany({
			where: { roomId, status: 'candidate', source: { not: 'outro' } },
			data: { status: 'rejected' },
		})
		const last = await tx.poll.findFirst({
			where: { roomId },
			orderBy: { seq: 'desc' },
		})
		await tx.poll.createMany({
			data: preferenceQuestions.map((question, index) => ({
				roomId,
				seq: (last?.seq ?? 0) + index + 1,
				kind: 'preference',
				question: question.question,
				options: question.options,
				status: 'open',
				openedAt: new Date(),
			})),
		})
	})
}

/** A single database read gives counts and saved selections a consistent view. */
export async function readCrowdQuestions(
	roomId: string,
	token: string | null = null,
): Promise<CrowdQuestion[]> {
	const questions = await prisma.poll.findMany({
		where: { roomId, kind: 'preference' },
		orderBy: { seq: 'asc' },
		include: { votes: true },
	})
	return questions.map((poll) => {
		const options = poll.options as { key: string; label: string }[]
		const counts: Record<string, number> = Object.fromEntries(
			options.map((option) => [option.key, 0]),
		)
		for (const vote of poll.votes) {
			if (Object.hasOwn(counts, vote.choice)) counts[vote.choice] += 1
		}
		return {
			id: poll.id,
			question: poll.question,
			options,
			counts,
			choice:
				poll.votes.find((vote) => vote.sessionToken === token)?.choice ?? null,
		}
	})
}
