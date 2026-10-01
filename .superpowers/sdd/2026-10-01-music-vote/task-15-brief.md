### Task 15: Deploy config, docs, license

**Files:**
- Create: `LICENSE` (AGPL-3.0), `docs/agents/music-vote.md`
- Modify: `.env.example`, `fly.toml` (verify from starter), `README.md`

**Steps:**
- [ ] **Step 1: LICENSE** — full AGPL-3.0 text (spec decision: repo public).
- [ ] **Step 2: docs/agents/music-vote.md** — env vars (`OLLAMA_*`, `LLM_*`), deploy steps (`fly deploy`, secrets: `OLLAMA_API_KEY`, `BETTER_AUTH_SECRET`), ops notes (single-machine rooms, restart behavior per spec failure table), known limitations (host disconnect = music stops).
- [ ] **Step 3: README** — replace starter blurb: one-paragraph product story + quickstart + link to spec + docs/agents/music-vote.md.
- [ ] **Step 4: Verify** — `bun run check` green; `fly deploy --dry-run` (if machine configured; else document).
- [ ] **Step 5: Commit** — `git commit -m "docs: license, deploy + ops docs, product README"`.
