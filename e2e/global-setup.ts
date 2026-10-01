import { rmSync } from 'node:fs'

export default async function globalSetup(): Promise<void> {
	// DB reset is deliberately NOT here: Playwright starts the webServer before
	// globalSetup, so wiping `prisma/test.db` from this hook deletes the file out
	// from under the already-booted server (its next query fails with
	// SQLITE_IOERR_VNODE). It runs in the `webServer.command` instead — see
	// scripts/e2e-reset-db.sh.
	rmSync('/tmp/mino-ssr-cache-e2e', { recursive: true, force: true })
}
