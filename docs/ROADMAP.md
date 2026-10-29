# Roadmap

🇺🇿 O'zbekcha: [docs/uz/ROADMAP.md](uz/ROADMAP.md)

> No timeline: there is an order and an **exit criterion**. Status: 2026-10-28.

## Done (everything is verified by `pnpm check`)

1. Scanning and parsing (secrets/generated files/symlinks/size limits; syntax errors shown openly).
2. Graph: `imports/exports/calls/renders/references/tests` via the type checker; alias/barrel/`export *`/tsconfig `paths`/`references`/monorepo/workspace symlinks.
3. SQLite storage + FTS5 + **incremental** indexing (`≡ full`).
4. Safe Git layer and **Change Impact** (symbol-level diff, `verified/possible`, evidence path, tests, uncertainties, rename/delete).
5. Retrieval + AI (consent, redaction, citation validation).
6. Local server + web UI (Repository, Explorer, Impact, Question) + CLI.
7. Benchmarks and accuracy: independent oracle, real repos, real history, control experiment.
8. Testing on open-source Next.js repos (3 repos), Next.js route model, phone mockup, demo video.
9. Docs: README, ARCHITECTURE, TECHNICAL_DECISIONS, BENCHMARKS, KNOWN_LIMITS, SECURITY, reproducible demo.

## Next (in priority order, with reasons)

| # | Task | Why | Exit criterion |
|---|---|---|---|
| 1 | **User validation** (5–10 developers, on their own repos) | The biggest uncertainty is whether the product is needed, not the technology | Answers to "What would you do without this, and how long would it take?"; which features solve a real problem |
| 2 | ~~Testing on open-source Next.js repos~~ ✅ (3 small repos). **Remaining:** large open-source monorepos (Cal.com, Next.js itself) | Scale/memory unknown | Measurements on ≥ 1 large repo |
| 3 | **Human-labelled ground truth for Impact** (real PRs, hand-labelled affected files) | Today there is only reference accuracy and fixtures | Impact P/R on real PRs |
| 4 | ~~Next.js route model~~ ✅. **Remaining:** Server Actions, `use client` boundaries, Remix/SvelteKit | Framework details | Fixture + real repo |
| 5 | **AI evaluation with a real LLM** (citation validity, share of unsupported claims) | Today only a fake provider is tested | Measured metrics + a decision on whether embeddings are needed |
| 6 | ~~`oldProgram`~~ — considered, deliberately not done (ADR-27) | — | — |
| 7 | ~~Demo video / GIF~~ ✅ `docs/demo.mp4`, `docs/demo.gif` | — | — |

## Later (no commitment)

- **Desktop (Tauri):** the web UI + the same local server, core unchanged.
- **V1.5** API endpoint / DB table nodes, other languages via Tree-sitter.
- **V2** PR review/CI integration (`xray impact --json` is the foundation), team reports.
- **V3** MCP server / VS Code — exposing the graph and impact to AI agents.
- **V4** self-hosted, audit log, corporate policies.

## Risk register

| Risk | Status | Mitigation |
|---|---|---|
| TS 7 (native) API unstable, 6.x ageing | Active | Pin 6.0.x; parser behind an interface |
| Memory on large monorepos (one Program per group) | Untested (> 1267 files) | Measure; split into chunks if needed |
| Over-reported impact (noise) | Reduced (depth policy, `verified/possible`) | Measure with real ground truth (#3) |
| Product-market fit not confirmed | Open | #1 |
| AI answer quality unknown | Open | #5 |
