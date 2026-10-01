# Knip setup design

## Goal

Add [Knip](https://knip.dev) to detect unused dependencies, files, and exports, enforce it in CI, and document it in `AGENTS.md`.

## Constraints

- Project uses Bun, not Node.
- Frontend is bundled through Bun's HTML bundler (`frontend/index.html` → `frontend/app.css` + `frontend/main.tsx`).
- Production build stubs TanStack devtools via a Bun plugin that redirects four package specifiers to `frontend/components/devtools-stub.ts`.
- Tailwind v4 + daisyUI are configured in CSS only (`frontend/app.css`); there is no `tailwind.config.*`.
- Prisma client is generated to `prisma/generated/` and imported with `runtime = "bun"`.
- Auto-enabled Knip plugins: Bun, Playwright, Prisma, Tailwind, Biome, TypeScript.

## Approach

Single root-level `knip.json`. Path aliases are read from `tsconfig.json`. Auto plugins cover Playwright specs, Prisma schema, and tooling config. Explicit `entry` covers Bun-specific entry points the plugins cannot know about.

## Configuration

### New dev dependencies

- `knip`
- `@types/node` (peer dependency; kept out of `tsconfig` `types` so Bun types stay primary)

### New `package.json` script

```json
"knip": "knip"
```

### `knip.json`

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "entry": [
    "frontend/index.html",
    "frontend/main.tsx",
    "frontend/router.tsx",
    "frontend/routes/*.tsx",
    "frontend/app.css",
    "frontend/components/devtools-stub.ts",
    "backend/server.ts",
    "backend/auth/auth.ts",
    "backend/trpc/*.ts",
    "backend/__tests__/*.test.ts",
    "e2e/global-setup.ts",
    "scripts/build.ts",
    "scripts/prod-css.ts",
    "playwright.config.ts"
  ],
  "project": ["frontend/**/*", "backend/**/*", "shared/**/*", "e2e/**/*", "scripts/**/*"],
  "ignoreFiles": ["dist/**", "test-results/**", ".pi-subagents/**", ".superpowers/**"],
  "ignoreDependencies": ["@prisma/client", "@tailwindcss/cli", "daisyui"],
  "includeEntryExports": true,
  "treatConfigHintsAsErrors": true
}
```

Rationale for explicit entries:

- `frontend/index.html`, `frontend/app.css`, `frontend/components/devtools-stub.ts` are not reachable from TS imports alone because Bun's HTML bundler resolves them.
- `scripts/build.ts` and `scripts/prod-css.ts` are invoked from `package.json` scripts.
- `backend/auth/auth.ts` is imported by server and frontend auth client, but including it as an entry guarantees it is analyzed even if a refactor changes importers.

Rationale for ignores:

- `@prisma/client`: used internally by the generated Prisma client, not directly by project source.
- `@tailwindcss/cli`: invoked inside `scripts/prod-css.ts` via `bunx`, not as a JS import.
- `daisyui`: consumed by Tailwind v4 CSS `@plugin`, not a JS import.
- `dist/`, `test-results/`, `.pi-subagents/`, `.superpowers/` are build/artifact/agent directories.

### CI change

Add after `bunx prisma generate` in `.github/workflows/ci.yml`:

```yaml
- run: bun run knip
```

`prisma generate` must run first so imports of `@backend/db/client` → `prisma/generated/client` resolve.

### `AGENTS.md` change

In the **Scripts** section, add:

```markdown
- `bun run knip` — detect unused dependencies, files, and exports (enforced in CI)
```

In the **Lint/format** bullet, mention that Knip is part of the CI check sequence.

## Acceptance criteria

- `bun install` adds Knip.
- `bun run knip` exits 0 locally.
- `bun run knip` exits non-zero when an unused dependency, file, or export is introduced.
- CI runs Knip and fails on violations.
- `AGENTS.md` documents the new script and CI enforcement.
