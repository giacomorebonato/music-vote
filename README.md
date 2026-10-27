# music-vote

Crowd-guided AI live music. A host opens a room at a venue, picks a vibe, and
plays music from the host's browser into the PA. Phones join by scanning a QR
code, with no login or app. Three persistent questions — energy, rhythm and
mood — show the room's preferences on phones and the host screen. Answer any
question and change your mind anytime; each phone's latest answer counts once.

There are no winners, voting deadlines or majority decisions. Live counts are
for fun. Every 10 seconds the server checks for a changed crowd distribution
and sends the complete snapshot to the music agent. The agent can gently evolve
the groove or hold it. Updates are serialized through host playback confirmation;
answers collected in the meantime feed the next snapshot. An AI outro closes
the set, and phones retain the final crowd distribution. The server owns room
state; the host browser is the audio engine.

## Quick start

```sh
bun run bootstrap    # deps + skills/MCP + prisma generate + migrate + git hooks
cp .env.example .env # set BETTER_AUTH_SECRET (openssl rand -base64 32)
bun run dev          # http://localhost:3000
```

Development requires Bun canary (see `.bun-version`) for native `bun lint` and `bun fmt`. The production runtime remains Bun 1.4.2.

## Run locally with the mock LLM

Real generation needs an Ollama endpoint, but the whole loop is runnable
offline with scripted responses:

```sh
# in .env
LLM_PROVIDER=mock
LLM_MOCK_SCRIPT=e2e/fixtures/llm-script.json
```

Then sign up, create a room, and start it. Each LLM operation builds a fresh
provider that re-reads that file from index 0 and pops responses in order, so
the flow is deterministic for demos and tests. Opening and outro prompts use
`responses`; crowd prompts use optional `crowdResponses` (falling back to
`responses`). A fresh provider starts each queue from index 0.

For real musicality set `LLM_PROVIDER=ollama`, `OLLAMA_MODEL=<tag>` and point
`OLLAMA_BASE_URL` at a local Ollama (`http://localhost:11434`) or at
`https://ollama.com` with `OLLAMA_API_KEY` — `OLLAMA_MODEL` is required on that
path.

## Docs

- **Spec:** [`docs/superpowers/specs/2026-10-01-music-vote-design.md`](docs/superpowers/specs/2026-10-01-music-vote-design.md) — product design, room lifecycle, failure table.
- **Plan:** [`docs/superpowers/plans/2026-10-01-music-vote.md`](docs/superpowers/plans/2026-10-01-music-vote.md) — the task-by-task build.
- **Env, deploy, ops:** [`docs/agents/music-vote.md`](docs/agents/music-vote.md) — env vars, `fly deploy`, single-machine/SQLite constraints, known limitations.
- **Agent context:** [`AGENTS.md`](AGENTS.md) — stack, scripts, conventions; [`docs/agents/`](docs/agents/) covers commands, deployment, Prisma, bot SSR, and React Compiler in depth.
- **Placement rules:** [`.agents/skills/project-structure/SKILL.md`](.agents/skills/project-structure/SKILL.md).

## Verification

- `bun check` — native TypeScript type checking.
- `bun lint` — native lint checks; use `--fix` to apply fixes.
- `bun fmt` — native formatting; use `--check` to verify without writing.
- `bun run verify` — native checks + knip + all unit tests and both Playwright suites.
- `bun run premerge` — `verify`, then fast-forward merge → main and push.

Git hooks (`.githooks/`, wired by `bootstrap`) require native checks at commit
and unit tests at push; merges and pushes to main require the complete `verify` gate.

## License

AGPL-3.0 — see [`LICENSE`](LICENSE). The repo is public because it embeds
Strudel (`@strudel/web`, `@strudel/transpiler`), which is AGPL-3.0.
