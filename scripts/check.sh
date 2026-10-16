#!/usr/bin/env bash
# Shared pre-merge gate. Used by both `bun run premerge` (local) and CI.
# Runs: Biome check (lint + format, verify-only), typecheck, knip, unit tests.
# E2E runs in check:full, required by the merge and main-push gates.
# Requires the Prisma client to be generated (`bunx prisma generate`, runs on postinstall).
set -euo pipefail

if [ "$#" -gt 0 ]; then
	exec bash "$(dirname "$0")/quality.sh" check "$@"
fi

step() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }

step 'biome check (lint + format, verify-only)'
bunx biome check .

step 'typecheck'
bun run typecheck

step 'knip'
DATABASE_URL="${DATABASE_URL:-file:./dev.db}" bun run knip

step 'test'
bun run test --parallel

printf '\n\033[32m✓ all checks passed\033[0m\n'
