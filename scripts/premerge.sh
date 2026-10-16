#!/usr/bin/env bash
# Local quick-merge: run the shared check gate, and if green, fast-forward
# merge the current branch into main and push it. Returns you to your branch.
#
#   bun run premerge
#
# Requires a clean working tree and `origin/main` to not have diverged.
set -euo pipefail

branch=$(git branch --show-current)
if [ -z "$branch" ]; then
	echo "Could not detect current branch (detached HEAD?)." >&2
	exit 1
fi
if [ "$branch" = "main" ]; then
	echo "Already on main — nothing to merge." >&2
	exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
	echo "Working tree not clean. Commit or stash first." >&2
	git status --short
	exit 1
fi

echo "Running pre-merge checks on '$branch'..."
bun run verify

echo
echo "Checks green. Merging '$branch' → main..."
git checkout main
# Pull only if main tracks a remote; otherwise proceed.
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
	git pull --ff-only
fi
git merge --ff-only "$branch"
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
	git push
fi
git checkout "$branch"
echo
printf '\033[32m✓ merged %s → main and pushed. Back on %s.\033[0m\n' "$branch" "$branch"
