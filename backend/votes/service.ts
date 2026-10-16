import { prisma } from '@backend/db/client'
import { hub } from '@backend/realtime/hub'
import { TRPCError } from '@trpc/server'
import { Prisma } from '../../prisma/generated/client'

export type PollOption = {
	key: string
	label: string
}

function slugify(label: string): string {
	const slug = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/g, '')
	return slug.length > 0 ? slug : 'option'
}

/**
 * Turn generated option labels into vote keys. The label is what the audience
 * reads; the key is the stable identifier stored on votes and `winningOption`.
 * Colliding slugs get a numeric suffix so every option stays votable.
 */
export function toPollOptions(labels: string[]): PollOption[] {
	const used = new Set<string>()
	return labels.map((label) => {
		const base = slugify(label)
		let key = base
		let suffix = 2
		while (used.has(key)) {
			key = `${base}-${suffix}`
			suffix += 1
		}
		used.add(key)
		return { key, label }
	})
}

/**
 * Poll.options is untyped Json, so app-layer parsing/validation is the only
 * guard. Mirror the scheduler's shape.
 */
export function parseOptions(options: unknown): PollOption[] {
	if (Array.isArray(options)) return options as PollOption[]
	return []
}

/** Issue a fresh anonymous audience session token. */
export function claimSession(): { token: string } {
	return { token: crypto.randomUUID() }
}

/**
 * Record an audience vote for an open poll.
 *
 * Rejects polls that are not `open` or whose `closesAt` has passed (server
 * time), and choices outside the poll's option keys, so the scheduler's
 * in-option tally never has to discard a row. Duplicate `(pollId, token)`
 * maps to a friendly ALREADY_VOTED error. After a successful insert the
 * current DB counts per option are pushed to the host.
 */
export async function castVote(
	pollId: string,
	token: string,
	choice: string,
): Promise<void> {
	const poll = await prisma.poll.findUnique({ where: { id: pollId } })
	if (!poll) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'Poll not found' })
	}
	if (poll.status !== 'open') {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Poll is not open' })
	}
	if (poll.closesAt && poll.closesAt.getTime() <= Date.now()) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Poll is closed' })
	}

	const options = parseOptions(poll.options)
	if (!options.some((option) => option.key === choice)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_CHOICE' })
	}

	try {
		await prisma.$transaction(async (tx) => {
			const current = await tx.poll.findUnique({ where: { id: pollId } })
			if (
				current?.status !== 'open' ||
				(current.closesAt && current.closesAt.getTime() <= Date.now())
			) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Poll is closed' })
			}
			await tx.vote.create({
				data: { pollId, sessionToken: token, choice },
			})
		})
	} catch (error) {
		if (
			error instanceof Prisma.PrismaClientKnownRequestError &&
			error.code === 'P2002'
		) {
			throw new TRPCError({ code: 'CONFLICT', message: 'ALREADY_VOTED' })
		}
		throw error
	}

	const counts = await countVotes(pollId, options)
	hub.publishHost(poll.roomId, {
		type: 'vote_count',
		pollId,
		counts,
	})
}

async function countVotes(
	pollId: string,
	options: PollOption[],
): Promise<Record<string, number>> {
	const counts: Record<string, number> = {}
	for (const option of options) {
		counts[option.key] = 0
	}
	const rows = await prisma.vote.groupBy({
		by: ['choice'],
		where: { pollId },
		_count: { choice: true },
	})
	for (const row of rows) {
		if (row.choice in counts) counts[row.choice] = row._count.choice
	}
	return counts
}
