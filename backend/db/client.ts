import { resolve } from 'node:path'
import { PrismaBunSqlite } from 'prisma-adapter-bun-sqlite'
import { PrismaClient } from '../../prisma/generated/client'

// Prisma CLI resolves relative `file:./` URLs against the schema directory
// (prisma/). bun:sqlite resolves them against the CWD instead, which would
// point at a different (empty) file in dev/test. Normalize relative paths to
// absolute, anchored on the prisma dir, so the adapter reads the same DB the
// migrations were applied to. Absolute URLs (e.g. prod `file:/data/prod.db`)
// are passed through unchanged.
function resolveDbUrl(raw: string): string {
	if (!raw.startsWith('file:./')) return raw
	const rel = raw.slice('file:'.length)
	return `file:${resolve(import.meta.dir, '..', '..', 'prisma', rel)}`
}

const prisma = new PrismaClient({
	adapter: new PrismaBunSqlite({
		url: resolveDbUrl(process.env.DATABASE_URL ?? 'file:./dev.db'),
	}),
})

export { prisma }
