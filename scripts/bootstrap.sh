#!/usr/bin/env bash
# One-command setup for a fresh clone of music-vote.
# Idempotent — safe to re-run.
#
# Installs Bun deps, APM skills + MCP, generates the Prisma client,
# applies migrations, and wires the checked-in git hooks.
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }

step 'bun install'
bun install

step 'apm install (skills + MCP declared in apm.yml)'
if command -v apm >/dev/null 2>&1; then
	apm install
else
	printf '\033[33mapm not found — skipping skills/MCP.\033[0m\n' \
		'Install: https://microsoft.github.io/apm/ then run `apm install`.\n' >&2
fi

step 'prisma generate (postinstall also does this; run again to be safe)'
bunx prisma generate

step 'db migrate (dev)'
bun run db:migrate

step 'git hooks (core.hooksPath = .githooks)'
git config core.hooksPath .githooks

printf '\n\033[32m✓ bootstrap complete. Run `bun run dev`.\033[0m\n'