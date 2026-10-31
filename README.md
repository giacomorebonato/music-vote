# music-vote

Crowd-guided AI live music. A host opens a room at a venue, picks a vibe, and
plays music from the host's browser into the PA. Phones join by scanning a QR
code, with no login or app. Seven persistent questions — energy, rhythm, mood, bass, melody, texture and
space — show the room's preferences on phones and the host screen. Answer any
question, clear it, and change your mind anytime; each phone's latest answer counts once.

There are no winners, voting deadlines or majority decisions. Live counts are
for fun. Every 10 seconds the server checks for a changed crowd distribution
and sends the complete snapshot to the music agent. The agent can evolve the groove with an audible transition or hold it when it
already fits. Updates are serialized through host playback confirmation;
answers collected in the meantime feed the next snapshot. An AI outro closes
the set, and phones retain the final crowd distribution. The server owns room
state; the host browser is the audio engine.

## Crowd contributions

Listeners can keep one editable text direction, such as “bouncy bass, but keep the
drums chilled.” Review its interpretation before activating it. The server maps
text to the available musical controls; raw audience text never enters generated
code. Replacing a direction replaces its influence. Clearing it withdraws it.
Directions are private to their author and the host. Received, held, failed, and
included-in-a-confirmed-update are separate outcomes.

The host's **Crowd contributions** controls enable recorded sounds and audience
moments, both initially off. **Approve sounds first** is initially on. A listener
can record up to three seconds, preview it, trim it, and submit it as percussion,
a chopped hook, or atmosphere. The host can audition, approve, or remove clips;
audition uses the browser's output, including the PA. A listener can withdraw a
clip. Approved clips enter a bounded queue and play as a separate accompaniment
on the host's four-bar musical clock for eight bars. The original sound is heard
first; later hits can become rhythmic slices. Reload recovers the remaining
lifetime, and undo never resurrects expired or withdrawn sounds.

Recording requires microphone permission and HTTPS (localhost also works).
Install **FFmpeg** for local development (`brew install ffmpeg` on macOS); the
production image and CI install it. The server processes one clip at a time into
mono WAV, with duration/size limits, peak control, and short fades. Audio files
live in `.recordings/` locally and `/data/recordings` in production. The model
never loads arbitrary sample URLs or produces sample-loading code. A trusted
Web Audio layer owns sample placement and expiry independently of generation.

Optional audience **Build up**, **Drop**, and **Strip back** requests are one-shot
moments, with one outstanding request per phone and a room cooldown. They restore
the underlying groove after a bounded section. Host lock pauses new automatic
contributions while people keep editing. Ending the set closes contribution input.

Automated tests cover real browser recording with a simulated microphone and
WAV/WebM/MP4 processing. Physical iOS/Android capture near a PA and real-model
musical quality still need a venue rehearsal before enabling recordings at an event.

## Performing live

The host console includes **Build up**, **Drop**, and **Strip back**. These
prepared transformations keep the current musical material and tempo and wait
for the next four-bar phrase on the host's audio clock. Build up thins the bass
and adds a snare roll; Drop restores the full groove with a kick and clap accent;
Strip back creates a filtered breakdown. Repeated actions replace the previous
performance layer. Undo restores the preceding confirmed pattern.

**Lock this groove** pauses automatic crowd evolution while phones keep voting.
The lock survives reloads and Undo. **Release groove** lets the next crowd check
use the latest answers. Manual performance controls work while locked.

**Steer the music** turns one short host note ("the kick is buried — bring the
drums forward") into a regeneration of the current pattern. It works while the
set is live, including with the groove locked, and waits when another change is
preparing. The note applies once and is never stored server-side; a held result
means the model kept the current groove, and a failed generation leaves the
note in the box for an adjust-and-retry.

**Performance view** fills the projector with a beat-synchronized visual, live
crowd preferences and a QR code. Reveal code shows the playing Strudel pattern;
Escape or Exit performance returns to the console without stopping audio.

The host preloads the demo drum palette (`bd`, `sd`, `cp`, `hh`, `ho`, index 0)
and displays **Demo sounds ready** when every sample has loaded. Retry sounds
rechecks failed downloads. Opening and crowd prompts use that palette plus
synthesized bass, hooks and harmony, with house, techno and funk opening anchors.
Generated music still benefits from a rehearsal with the chosen model and PA.

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
