# Knip Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Knip to detect unused dependencies, files, and exports; enforce it in CI; document it in `AGENTS.md`.

**Architecture:** Single root `knip.json` with explicit entries for Bun-specific entry points (HTML bundle, CSS, devtools stub) plus auto-enabled Knip plugins (Bun, Playwright, Prisma, Tailwind, Biome, TypeScript). Path aliases read from `tsconfig.json`.

**Tech Stack:** Bun, Knip v6, TypeScript, GitHub Actions.

## Global Constraints

- Runtime/package manager: Bun.
- Biome style: no semicolons, trailing comma all, single quotes.
- Path aliases: `@backend/*`, `@frontend/*`, `@shared/*` (from `tsconfig.json`).
- Prisma client is generated to `prisma/generated/` (gitignored); `bunx prisma generate` must run before Knip so imports resolve.
- CI workflow: `.github/workflows/ci.yml`.
- `AGENTS.md` is the only agent-instructions file (no vendor-specific files).
- Spec: `docs/superpowers/specs/2026-07-28-knip-design.md`.

---

## File Structure

- **Create:** `knip.json` — Knip configuration (entries, project, ignores, strict flags).
- **Modify:** `package.json` — add `knip` dev dependency, `@types/node` dev dependency, `knip` script.
- **Modify:** `.github/workflows/ci.yml` — add `bun run knip` step after `prisma generate`.
- **Modify:** `AGENTS.md` — document the `knip` script and CI enforcement.
- **Read-only verification:** `bun run knip`, `bun run lint`, `bun run typecheck`.

---

### Task 1: Install Knip and add the script

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `bun run knip` script; `knip` and `@types/node` in `devDependencies`.

- [ ] **Step 1: Install Knip and @types/node**

Run:
```bash
bun add -d knip @types/node
```
Expected: `package.json` `devDependencies` gains `knip` and `@types/node`; `bun.lock` updated.

- [ ] **Step 2: Add the knip script**

Edit `package.json` `scripts` to add (keep Biome style; insert after `"typecheck": "tsc --noEmit"`):
```json
"knip": "knip",
```

- [ ] **Step 3: Verify script is wired**

Run:
```bash
bun run knip --help
```
Expected: Knip help output (exits 0). No "script not found" error.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add knip dev dependency and script"
```

---

### Task 2: Create `knip.json`

**Files:**
- Create: `knip.json`

**Interfaces:**
- Produces: `knip.json` with entries, project, ignoreFiles, ignoreDependencies, `includeEntryExports: true`, `treatConfigHintsAsErrors: true`.

- [ ] **Step 1: Write `knip.json`**

Create `knip.json`:
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

- [ ] **Step 2: Ensure Prisma client is generated**

Run:
```bash
bunx prisma generate
```
Expected: `prisma/generated/` exists; `@backend/db/client` import resolves.

- [ ] **Step 3: Run Knip**

Run:
```bash
bun run knip
```
Expected: exit 0. If Knip reports unused items:
- For real unused items, remove them.
- For false positives caused by Bun/CSS/build-tool usage, add the exact name to `ignoreDependencies` or the file to `ignoreFiles` (not blanket `ignore`).
Re-run until `bun run knip` exits 0.

- [ ] **Step 4: Commit**

```bash
git add knip.json
git commit -m "chore: add knip configuration"
```

---

### Task 3: Add Knip to CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `bun run knip` script from Task 1, `knip.json` from Task 2.
- Produces: CI fails on unused dependencies/files/exports.

- [ ] **Step 1: Add the Knip step**

In `.github/workflows/ci.yml`, insert after `- run: bunx prisma generate` and before `- run: DATABASE_URL=file:./ci.db bunx prisma migrate reset --force --skip-generate`:
```yaml
      - run: bun run knip
```

- [ ] **Step 2: Verify YAML locally**

Run:
```bash
bun run lint
```
Expected: Biome exits 0 (no YAML issues).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run knip in CI"
```

---

### Task 4: Document Knip in `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `bun run knip` script, CI step.

- [ ] **Step 1: Add the script bullet**

In `AGENTS.md`, under `## Scripts`, after the `bun run typecheck` bullet, add:
```markdown
- `bun run knip` — detect unused dependencies, files, and exports (enforced in CI)
```

- [ ] **Step 2: Add CI context**

In `AGENTS.md`, under `## Lint/format` bullet in the **Conventions** section, add a line:
```markdown
- Knip (`bun run knip`) runs in CI and fails on unused dependencies, files, or exports. Run it locally before pushing.
```
If a `## Lint/format` section does not exist, add it as a new section under `## Conventions`:
```markdown
## Lint/format

- Biome check (`bun run lint`) and Knip (`bun run knip`) both run in CI. Knip fails on unused dependencies, files, or exports. Run `bun run knip` locally before pushing.
```

- [ ] **Step 3: Verify formatting**

Run:
```bash
bun run lint
bun run typecheck
```
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document knip in AGENTS.md"
```

---

### Task 5: Final verification

**Files:**
- None (read-only).

- [ ] **Step 1: Run the full local check sequence**

Run:
```bash
bunx prisma generate
bun run lint
bun run typecheck
bun run knip
```
Expected: all exit 0.

- [ ] **Step 2: Confirm CI workflow is coherent**

Run:
```bash
sed -n '1,40p' .github/workflows/ci.yml
```
Expected: `bun run knip` appears after `bunx prisma generate`.

- [ ] **Step 3: Confirm docs and config are committed**

Run:
```bash
git status --short
```
Expected: clean tree (or only pre-existing unrelated changes).