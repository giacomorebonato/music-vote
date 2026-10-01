# Superpowers — specs & plans

Brainstorm → spec → plan → implement workflow. Specs are the agreed design;
plans are the task-by-task implementation derived from a spec. Both are kept
so agents working later can recover the *why* behind a feature.

## Specs (`specs/`)

| Date | Spec | Status |
|------|------|--------|
| 2026-07-20 | [mino-starter design](specs/2026-07-20-mino-starter-design.md) | Implemented |
| 2026-07-28 | [Knip setup](specs/2026-07-28-knip-design.md) | Implemented |
| 2026-07-28 | [TanStack Form + unified devtools](specs/2026-07-28-tanstack-form-and-devtools-design.md) | Implemented |
| 2026-07-30 | [Bot-triggered SSR via Lightpanda](specs/2026-07-30-bot-ssr-design.md) | Implemented |
| 2026-07-31 | [Responsive daisyUI drawer layout](specs/2026-07-31-drawer-layout-design.md) | Implemented |

## Plans (`plans/`)

| Date | Plan | Implements spec |
|------|------|-----------------|
| 2026-07-20 | [mino-starter](plans/2026-07-20-mino-starter.md) | starter design |
| 2026-07-28 | [Knip setup](plans/2026-07-28-knip-setup.md) | Knip design |
| 2026-07-30 | [Bot SSR via Lightpanda](plans/2026-07-30-bot-ssr.md) | Bot SSR design |
| 2026-07-31 | [Drawer layout](plans/2026-07-31-drawer-layout.md) | Drawer layout design |

## Adding a new spec/plan

1. Brainstorm with the user (see `brainstorming-tasks.md` for the checklist).
2. Write spec to `specs/<YYYY-MM-DD>-<slug>-design.md`.
3. User reviews spec.
4. Invoke the `writing-plans` skill → plan lands in `plans/<YYYY-MM-DD>-<slug>.md`.
5. Implement with `subagent-driven-development` or `executing-plans`.
6. Add a row to both tables above.