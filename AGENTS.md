# AGENTS.md

Bun fullstack starter: React 19 SPA (TanStack Router/Query/Form, tRPC, daisyUI v5 + Tailwind v4) on a `Bun.serve` fullstack server with tRPC v11 + better-auth over Prisma/SQLite.

**Bun everywhere** — runtime, package manager, bundler, test runner. Never npm/pnpm/yarn.

- `bun run bootstrap` — fresh-clone setup (idempotent)
- `bun run dev` — dev server with HMR
- `bun run build` — production bundle (React Compiler on)
- `bun run check` — run before claiming work done; `bun run check:full` adds E2E for UI/auth/route changes
- `bun run premerge` — `check`, then fast-forward → main and push

Aliases `@backend/* @frontend/* @shared/*`; unit tests co-located in `__tests__/`; placement rules in `.agents/skills/project-structure/SKILL.md`.

Deep docs: [vertical-slice workflow](docs/agents/vertical-slices.md) · [scripts/env/hooks](docs/agents/commands.md) · [conventions](docs/agents/conventions.md) · [Prisma v7](docs/agents/prisma.md) · [bot SSR](docs/agents/bot-ssr.md) · [React Compiler](docs/agents/react-compiler.md) · [deployment](docs/agents/deployment.md)
