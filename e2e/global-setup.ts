import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'

export default async function globalSetup(): Promise<void> {
	rmSync('/tmp/mino-ssr-cache-e2e', { recursive: true, force: true })
	// Fresh test DB each run without `prisma migrate reset` (which Prisma's
	// AI-agent guard blocks when run under an agent). Deleting the SQLite file
	// + `migrate deploy` (idempotent, non-interactive, non-destructive) gives the
	// same clean-slate result and works in any environment.
	rmSync('prisma/test.db', { force: true })
	rmSync('prisma/test.db-journal', { force: true })
	execSync('DATABASE_URL=file:./test.db bunx prisma migrate deploy', {
		stdio: 'inherit',
	})
}
