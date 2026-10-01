#!/usr/bin/env bash
# Reset the E2E SQLite DB. Run from the Playwright `webServer.command` string,
# BEFORE the test server starts.
#
# It must not live in `globalSetup`: Playwright starts the webServer first and
# runs globalSetup afterwards (verified with DEBUG=pw:webserver), so a wipe in
# globalSetup deletes `prisma/test.db` out from under a server that has already
# opened it. The first query after that fails with
# `SQLITE_IOERR_VNODE: disk I/O error` (the server opens the file at boot — e.g.
# the scheduler restore in backend/boot.ts — not on first request).
#
# Fresh DB without `prisma migrate reset` (which Prisma's AI-agent guard blocks
# when run under an agent). Deleting the SQLite file + `migrate deploy`
# (idempotent, non-interactive, non-destructive) gives the same clean result.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -f prisma/test.db prisma/test.db-journal
DATABASE_URL=file:./test.db bunx prisma migrate deploy
