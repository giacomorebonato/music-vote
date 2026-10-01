#!/usr/bin/env bash
# Shared pre-merge gate. Used by both `bun run premerge` (local) and CI.
# Runs: Biome check (lint + format, verify-only), typecheck, knip, unit tests.
# E2E (test:e2e / test:e2e:ssr) is intentionally excluded — run manually.
# Requires the Prisma client to be generated (`bunx prisma generate`, runs on postinstall).
set -euo pipefail

step() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }

step 'biome check (lint + format, verify-only)'
bunx biome check .

step 'typecheck'
bun run typecheck

step 'knip'
bun run knip

step 'test'
bun run test --parallel

printf '\n\033[32m✓ all checks passed\033[0m\n'