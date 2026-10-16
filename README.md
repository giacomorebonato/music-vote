# music-vote

Crowd-voted AI live music. A host opens a room at a venue, picks a vibe, and
the music starts playing from the host's browser into the PA. Phones join by
scanning a QR code — no login, no app — and choose between two musical
directions. A strict majority wins; ties and rounds without votes keep the
current groove. Occasional polls let the crowd vote to stay with it. A winning
change is turned into new live-coded Strudel by an LLM, validated server-side,
and sent to the host browser for playback. Phones show the result, whether the
host applied it, and when the next vote is due. The set keeps evolving until
an AI outro closes it with a timeline of the crowd's decisions. The server
conducts and owns the room state; the host browser is the audio engine.

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
the flow is deterministic and safe for demos and tests (a room start consumes
`responses[0]` and `responses[1]`; later calls start over at `responses[0]`).

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
