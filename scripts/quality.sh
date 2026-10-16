#!/usr/bin/env bash
# Verify only. Staged mode checks an isolated copy of the index, never unstaged edits.
set -euo pipefail
cd "$(dirname "$0")/.."

command_name=${1:?Expected check, lint, or fmt}
shift
case "$command_name" in check|lint|fmt) ;; *) echo "Unknown check: $command_name" >&2; exit 2 ;; esac
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--staged" ]; }; then
	echo "Usage: bun $command_name [--staged]" >&2
	exit 2
fi

paths=(.)
if [ "$#" -eq 1 ]; then
	paths=()
	while IFS= read -r -d '' path; do
		paths+=("./$path")
	done < <(git diff --cached --name-only --diff-filter=ACMR -z)
	# Deletions still require project-wide type/unused-code checks.
	if git diff --cached --quiet; then
		exit 0
	fi
	repo_root=$PWD
	snapshot=$(mktemp -d "${TMPDIR:-/tmp}/music-vote-index.XXXXXX")
	trap 'rm -rf "$snapshot"' EXIT
	git checkout-index --all --prefix="$snapshot/"
	# Dependencies and generated Prisma code are local setup artifacts, not source.
	ln -s "$repo_root/node_modules" "$snapshot/node_modules"
	if [ -d "$repo_root/prisma/generated" ]; then
		mkdir -p "$snapshot/prisma"
		ln -s "$repo_root/prisma/generated" "$snapshot/prisma/generated"
	fi
	cd "$snapshot"
fi

if [ "${#paths[@]}" -gt 0 ]; then
	case "$command_name" in
		check) bun x --no-install biome check --no-errors-on-unmatched "${paths[@]}" ;;
		lint) bun x --no-install biome lint --no-errors-on-unmatched "${paths[@]}" ;;
		fmt) bun x --no-install biome format --no-errors-on-unmatched "${paths[@]}" ;;
	esac
fi
if [ "$command_name" = check ]; then
	# TypeScript and Knip need the project graph, even for a single staged file.
	bun run typecheck
	DATABASE_URL="${DATABASE_URL:-file:./dev.db}" bun run knip
fi
