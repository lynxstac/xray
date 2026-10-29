# X-Ray — Product Specification

🇺🇿 O'zbekcha: [docs/uz/PRODUCT_SPEC.md](uz/PRODUCT_SPEC.md)

> ✅ implemented · 🟡 partial / awaiting measurement · ❌ deliberately out of scope. Status: 2026-10-28.

## In one sentence
Local code intelligence: it builds a real code graph of a TypeScript/React repository and, from a Git diff, produces a **"what changed → what may be affected → what to check"** report **backed by evidence**.

## Problem
When a single function changes in an unfamiliar or large project: who calls it, and which pages/tests depend on it? Today the answer is `grep` + experience + reading by hand. X-Ray shortens that with deterministic analysis.

## Positioning
Code maps and "chat with your code" already exist (IDE "find usages", Sourcegraph, dependency-cruiser/madge, AI IDE indexes, …). X-Ray's hypothesised edge: **change-first** (the starting point is the diff), **evidence-first** (every result carries path + line + confidence), **local-first**, and **measurable quality**. ⚠️ This is a hypothesis — not yet validated with users (ROADMAP: "User validation").

## Users
Primary: React/Next.js/TS frontend developers; people joining an unfamiliar repo; PR reviewers. Later: small teams, people who use AI agents (MCP).

## Confidence model ✅
`verified` (statically proven) · `possible` (at least one link is approximate) · `unresolved` (cannot be resolved; **shown openly**). The report never says "this will break" (checked in tests).

## MVP status

| # | MVP requirement | Status |
|---|---|---|
| 1 | Open a local TS/React repo | ✅ CLI + web |
| 2 | Safe scanning, parsing | ✅ secrets/generated files/symlinks/size limits; errors are reported in the output |
| 3 | File, symbol, import/export graph (real AST + type checker) | ✅ 9 node types, 6 edge types (`calls/renders/references/exports/imports/tests`) |
| 4 | Interactive Graph Explorer | ✅ zoom/pan, search, filters, N-hop neighbourhood, detail view |
| 5 | Jump from the graph to the source | ✅ source view with the relevant line highlighted |
| 6 | Git diff analysis | ✅ working / staged / range (merge-base), rename/delete/untracked |
| 7 | Evidence-based impact report | ✅ direct/indirect, evidence path, `verified/possible`, uncertainties |
| 8 | Related tests | ✅ `direct-use/transitive/imports-only` + `untested` (not coverage) |
| 9 | AI Q&A with sources, behind explicit configuration | ✅ consent, redaction, citation validation, `evidence-only`; 🟡 quality with a real LLM not measured |
| 10 | Tests, docs, reproducible demo | ✅ 147 + 30 E2E; docs; `pnpm demo`; demo video (`docs/demo.mp4`) |
| — | Next.js routes (which routes may be affected) | ✅ App/Pages Router, layout/middleware impact |
| — | Incremental indexing | ✅ `incremental ≡ full` proven |
| — | Local-first privacy | ✅ `SECURITY.md` |

## Acceptance criteria — results
- Fixture graph vs `expected-graph.json`: **exact match** (6 edge types). Impact, 6 scenarios: **P = R = 1.0** (hand-made ground truth).
- 7 real projects (3414 symbols), independent oracle: `verified` **P = R = 1.0**; all edges P ≥ 0.992 (the gap is deliberate `possible`).
- Impact over 90 commits of real history (7 repos): 0 errors; `verified` P = R = 1.0 on 3 open-source Next.js repos as well.
- ❌ Human-labelled Impact ground truth and testing on large open-source monorepos — not done (`KNOWN_LIMITS` #8, #9).

## Deliberately out of scope ❌
Cloud/accounts/billing, collaboration, enterprise features, other languages (Tree-sitter — later), autonomous code editing, VS Code extension, MCP server, runtime/trace analysis, vector DB, API endpoint/DB table nodes, Tauri desktop (decision: web first; desktop later, with the core unchanged).
