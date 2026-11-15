# Portless + Tailscale dev sharing — Design

Date: 2026-11-15 · Status: approved (approach A picked in conversation; AGENTS.md
note requested)

## Intent

`bun run dev:net` runs the dev server through portless with `--tailscale`, so a
development branch (typically a git worktree) is reachable at a stable HTTPS URL
on the tailnet — teammates and phone browsers can vote on the branch under test
without port juggling or a broken auth URL.

## Why

music-vote's voters are physical phones. Today a dev branch is reachable only
at `http://localhost:3000`, so sharing a branch means handing out an IP:port,
and better-auth breaks the moment the public URL differs from
`BETTER_AUTH_URL`. Portless already prefixes the worktree branch
(`https://<branch>.music-vote.localhost`) and with `--tailscale` root-mounts
`https://<node>.<tailnet>.ts.net` (port 443, then 8443, 8444, … per concurrent
app), handing the child process `PORT`, `PORTLESS_URL`, and
`PORTLESS_TAILSCALE_URL`. WebSockets (H1 upgrade and H2) and HMR are proxied.

## Goals

- `bun run dev:net` = `portless run --tailscale`: branch-prefixed `.localhost`
  URL plus a ts.net URL; auth works out of the box on both.
- `bun run dev` unchanged; plain dev keeps no portless dependency at runtime.
- Machine prerequisites documented (portless ≥ 0.17, one-time `portless trust`,
  tailnet with HTTPS certificates enabled).

## Non-goals

- No Tailscale Funnel or any public-internet exposure.
- No CI / `bun run verify` changes — Playwright keeps its own ports.
- No proxy idle-timeout tuning; WS liveness across a poll interval is a manual
  dev check, documented.
- No auto-wrapping of `bun run dev`.

## Constraints

- Bun everywhere; knip fails the gate on unused dependencies or exports
  (`treatConfigHintsAsErrors`); unit tests co-located in `__tests__/`; named
  exports; kebab-case filenames; root dir limited to root configs
  (`portless.json` qualifies).

## Approaches

- **A — opt-in script (picked).** `"dev:net": "portless run --tailscale"` +
  `portless.json` + a tiny auth URL-resolution change. `bun run dev` untouched;
  portless stays opt-in.
- **B — auto-wrap `dev` on non-main branches.** Rejected: portless becomes a
  hard dependency for all branch dev and `bun run dev` gains magic.
- **C — docs only (run `portless … --tailscale` manually).** Rejected: the
  server-side auth baseURL stays stale and the ts.net URL 403s on auth POSTs.

## Decided how

- New `backend/auth/base-url.ts`, pure functions, unit tested:
  - `resolveAuthBaseURL()` — first **non-empty** of `PORTLESS_TAILSCALE_URL`,
    `PORTLESS_URL`, `BETTER_AUTH_URL`, else `'http://localhost:3000'`. Empty
    strings count as unset (a `??` chain would let `''` win).
  - `resolveAuthTrustedOrigins()` — `[PORTLESS_URL]` when set, else `[]`, so a
    host browser on the `.localhost` origin is not origin-rejected while phones
    use the ts.net URL.
  - `backend/auth/auth.ts` wires both into `betterAuth({ baseURL,
    trustedOrigins })`; behavior with no portless env is byte-identical to
  today.
- `portless.json`: `{ "name": "music-vote" }` (worktree branch prefix stays
  automatic). `portless` added as a devDependency; a global portless CLI also
  works.
- Script: `"dev:net": "portless run --tailscale"`.
- Docs: `AGENTS.md` script bullet (requested), `docs/agents/commands.md`,
  `docs/agents/music-vote.md` (prerequisites + WS liveness check), and a
  `.env.example` note that `BETTER_AUTH_URL` applies only to plain
  `bun run dev`.

## Left to the builder

Portless version pinning, exact test cases, and knip's reaction to
`portless.json` (if knip hints at it, prefer dropping the file — the name is
also inferred from `package.json` — over widening knip config).
