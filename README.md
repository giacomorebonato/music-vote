# music-vote

Crowd-voted AI live music. A host opens a room at a venue, picks a vibe, and
the music starts playing from the host's browser into the PA. Phones join by
scanning a QR code — no login, no app — and vote yes/no on musical directions
("should this sound more 80s?"). Each winning answer is turned into new
live-coded Strudel by an LLM, validated server-side, applied at the next cycle
boundary, and the set keeps evolving until an AI outro closes it with a
timeline of every vote that shaped the performance. The server conducts and
owns the room state; the host browser is the audio engine; phones only vote.

## Quick start

```sh
bun run bootstrap    # deps + skills/MCP + prisma generate + migrate + git hooks
cp .env.example .env # set BETTER_AUTH_SECRET (openssl rand -base64 32)
bun run dev          # http://localhost:3000
```

Requires Bun 1.4.2+ (see `.bun-version`).

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

- `bun run check` — biome + typecheck + knip + unit tests. Run before claiming work done.
- `bun run check:full` — adds Playwright E2E (the full democratic-music cycle). Run for UI/auth/route changes.
- `bun run premerge` — `check` then fast-forward merge → main and push.

Git hooks (`.githooks/`, wired by `bootstrap`) run biome + typecheck at commit
and the full gate at push.

## License

AGPL-3.0 — see [`LICENSE`](LICENSE). The repo is public because it embeds
Strudel (`@strudel/web`, `@strudel/transpiler`), which is AGPL-3.0.
