#!/usr/bin/env bash
# Share the dev server over the tailnet through portless (`bun run dev:net`).
#
# portless spawns its child with node_modules/.bin first on PATH, where the
# Tailwind plugin's peer `bun` package (an older pinned Bun) shadows the
# developer's Bun. bun's own [run].bun handling (bunfig.toml) keeps nested
# scripts on the invoking Bun, but portless bypasses it by spawning the
# command from PATH — so under a plain `portless run --tailscale` the dev
# server boots on the shadow Bun (1.4.0), whose fetch reports connect
# refusals as `ConnectionRefused` instead of `ECONNREFUSED`, which fails
# the boot-probe in backend/server-bind-check.ts. Run the real Bun
# explicitly (see docs/agents/commands.md, "Scripts").
set -euo pipefail
BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
if [ ! -x "$BUN_BIN" ]; then
	# No Bun at the usual install root — scan PATH for the real one,
	# skipping every node_modules/.bin entry: `bun run` prepends them and
	# the peer-dep Bun there is the shadow this script exists to avoid.
	# BUN_INSTALL wins over PATH by design (CI/Dockerfile pin it).
	BUN_BIN=''
	IFS=: read -r -a path_dirs <<<"$PATH"
	for dir in "${path_dirs[@]}"; do
		case "$dir" in
		'' | */node_modules/.bin | */node_modules/.bin/) continue ;;
		esac
		if [ -x "$dir/bun" ]; then
			BUN_BIN="$dir/bun"
			break
		fi
	done
	if [ -z "$BUN_BIN" ]; then
		echo "dev:net: no usable Bun found — BUN_INSTALL/\$HOME/.bun has none, and every PATH entry either has no bun or is a node_modules/.bin shadow." >&2
		echo "dev:net: install Bun from bun.sh, or set BUN_INSTALL." >&2
		exit 1
	fi
fi
exec "$(command -v portless)" run --tailscale "$BUN_BIN" run dev
