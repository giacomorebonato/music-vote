process.env.DATABASE_URL = 'file:./models-test.db'

import { afterAll, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { createRoomSchema } from '@shared/schemas/room'

// Unit tests run against a real, migrated SQLite file (prisma/models-test.db)
// instead of the dev DB: CI runs `bun run check` without applying migrations to
// dev.db, and a cold checkout has no DB at all.
//
// Every DB-backed test file owns its own `prisma/<name>-test.db` and migrates it
// itself before connecting. Unique paths are what make these module-load
// migrations race-free: `bun test --parallel` runs the files in separate worker
// processes, and two `prisma migrate deploy` runs against the same fresh SQLite
// file deadlock (`database is locked`) and leave it schema-less. The migrate is
// idempotent, so it is also what makes a bare `bun test` work on a cold tree.
//
// The client comes from the shared singleton the services use, so writes and
// assertions can never diverge onto two different files.
execSync('DATABASE_URL=file:./models-test.db bunx prisma migrate deploy', {
	stdio: 'pipe',
})

const { prisma } = await import('@backend/db/client')

const hostEmail = `host-${crypto.randomUUID()}@example.com`

afterAll(async () => {
	// No $disconnect here: `prisma` is the process-wide client every service
	// shares, so closing it would break test files that run later in this process.
	await prisma.user.deleteMany({ where: { email: hostEmail } })
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
	const base = {
		lengthMin: 10,
		pollIntervalSec: 120,
		pollOpenSec: 45,
		genre: 'techno',
	}
	expect(createRoomSchema.safeParse({ ...base, bpm: 59 }).success).toBe(false)
	expect(createRoomSchema.safeParse({ ...base, bpm: 201 }).success).toBe(false)
	expect(createRoomSchema.safeParse({ ...base, bpm: 60 }).success).toBe(true)
	expect(createRoomSchema.safeParse({ ...base, bpm: 200 }).success).toBe(true)
})
