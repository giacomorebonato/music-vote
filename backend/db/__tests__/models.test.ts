import { afterAll, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createRoomSchema } from '@shared/schemas/room'
import { PrismaBunSqlite } from 'prisma-adapter-bun-sqlite'
import { PrismaClient } from '../../../prisma/generated/client'

// Unit tests run against a real, migrated SQLite file (prisma/test.db) instead of
// the dev DB: CI runs `bun run check` without applying migrations to dev.db, so
// the test applies the committed migrations to test.db itself before connecting.
const testDbPath = resolve(
	import.meta.dir,
	'..',
	'..',
	'..',
	'prisma',
	'test.db',
)

execSync('DATABASE_URL=file:./test.db bunx prisma migrate deploy', {
	stdio: 'pipe',
})

const prisma = new PrismaClient({
	adapter: new PrismaBunSqlite({ url: `file:${testDbPath}` }),
})

const hostEmail = `host-${crypto.randomUUID()}@example.com`

afterAll(async () => {
	await prisma.user.deleteMany({ where: { email: hostEmail } })
	await prisma.$disconnect()
})

test('vote dedup: second vote same token+poll throws P2002', async () => {
	const host = await prisma.user.create({
		data: { name: 'Host', email: hostEmail },
	})
	const room = await prisma.room.create({
		data: {
			hostId: host.id,
			bpm: 120,
			lengthSec: 600,
			pollIntervalSec: 120,
			genre: 'techno',
			status: 'lobby',
			stateDoc: {},
		},
	})
	const poll = await prisma.poll.create({
		data: {
			roomId: room.id,
			seq: 0,
			kind: 'evolution',
			question: 'More energy?',
			options: ['yes', 'no'],
			status: 'open',
		},
	})
	await prisma.vote.create({
		data: { pollId: poll.id, sessionToken: 'token-1', choice: 'yes' },
	})

	let code: string | undefined
	try {
		await prisma.vote.create({
			data: { pollId: poll.id, sessionToken: 'token-1', choice: 'no' },
		})
	} catch (error) {
		code = (error as { code?: string }).code
	}

	expect(code).toBe('P2002')
})

test('createRoomSchema rejects bpm 59 and 201', () => {
	const base = { lengthMin: 10, pollIntervalSec: 120, genre: 'techno' }
	expect(createRoomSchema.safeParse({ ...base, bpm: 59 }).success).toBe(false)
	expect(createRoomSchema.safeParse({ ...base, bpm: 201 }).success).toBe(false)
	expect(createRoomSchema.safeParse({ ...base, bpm: 60 }).success).toBe(true)
	expect(createRoomSchema.safeParse({ ...base, bpm: 200 }).success).toBe(true)
})
