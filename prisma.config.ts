import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

// Prisma ORM v7: connection URLs moved out of schema.prisma into prisma.config.ts.
//
// Prisma CLI v6 resolved relative `file:./` URLs against the schema directory
// (prisma/). The v7 config file resolves them against the CWD instead, which
// would point at a different file than the driver adapter in backend/db/client.ts
// (which anchors relative URLs on the prisma dir). Normalize relative paths to
// absolute, anchored on the prisma dir, so migrate writes to the same DB the
// runtime adapter reads. Absolute URLs (e.g. prod `file:/data/prod.db`) pass
// through unchanged. Mirrors resolveDbUrl() in backend/db/client.ts.
function resolveDbUrl(raw: string): string {
	if (!raw.startsWith('file:./')) return raw
	const rel = raw.slice('file:'.length)
	return `file:${resolve(fileURLToPath(new URL('.', import.meta.url)), 'prisma', rel)}`
}

export default defineConfig({
	datasource: {
		url: resolveDbUrl(env('DATABASE_URL')),
	},
})
