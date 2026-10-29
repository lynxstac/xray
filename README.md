<div align="center">

# X-Ray

**See what a Git change can break — with evidence.**

Local-first code intelligence for TypeScript / React / Next.js.
Open a repo, get its real code graph, and ask the question that matters in review:
*what changed → what may be affected → what should I check?*

[Watch the 90-second demo](https://github.com/lynxstac/xray/releases/download/v0.1.0/xray-youtube-1080p.mp4) · [Quick start](#quick-start) · [Docs](#documentation) · [🇺🇿 O'zbekcha](README.uz.md)

<a href="https://github.com/lynxstac/xray/releases/download/v0.1.0/xray-youtube-1080p.mp4"><img src="docs/demo.gif" alt="X-Ray demo: one commit changes env.mjs, X-Ray lists the affected functions, routes and tests with evidence" width="800"></a>

</div>

> The demo analyses one real commit in the open-source [`taxonomy`](https://github.com/shadcn-ui/taxonomy) Next.js app: `env.mjs` changed. A voiced preview is in [`docs/demo.mp4`](docs/demo.mp4); full-quality YouTube and Reels cuts are attached to the [release](https://github.com/lynxstac/xray/releases).

| Repository | Graph Explorer |
|---|---|
| ![Repository overview](docs/screenshots/1-repository.png) | ![Graph explorer](docs/screenshots/2-explorer.png) |
| **Change Impact** | **Ask (AI optional)** |
| ![Change impact with evidence path](docs/screenshots/3-impact.png) | ![Ask with cited sources](docs/screenshots/4-ask.png) |

## Why X-Ray

When one function changes in a project you do not know well, the answer to "who depends on this?" is usually `grep` plus experience. X-Ray makes that answer deterministic and inspectable.

- **Change-first** — the starting point is the diff, not a graph you have to stare at.
- **Evidence-first** — every result carries `file:line`, the chain that connects it to the change, and a confidence level.
- **Local-first** — analysis and index stay on your machine; nothing is written to the repo, and repo code is **never executed**.
- **Measured** — accuracy is checked against an independent oracle ([results below](#accuracy)) and limitations are written down ([KNOWN_LIMITS](docs/KNOWN_LIMITS.md)).

## Features

- **Code graph** from the real TypeScript program + type checker: 9 node types (file, function, component, hook, class, type, variable, …) and 6 edge types (`calls`, `renders`, `references`, `exports`, `imports`, `tests`). Incremental indexing is proven equal to a full re-index.
- **Change Impact** for the working tree, staged changes, or any `base...head` range (merge-base aware; renames, deletes and untracked files handled). Direct and indirect dependents, evidence paths, and an explicit *uncertain* list.
- **Related tests** classified as `direct-use`, `transitive`, `imports-only` — plus `untested` — and a **ready-to-run command** (Vitest / Jest detected from `package.json`) for just the affected test files.
- **Next.js routes** — pages, layouts, route handlers and middleware have no importers (the framework calls them), so X-Ray derives routes from file paths (App Router groups/slots, Pages Router, `middleware`/`proxy`, monorepos) and lists which **routes** a change may affect. A changed layout covers everything beneath it.
- **Interactive Graph Explorer** — zoom/pan, search, filters, N-hop neighbourhood, and a source view that jumps to the exact line.
- **MCP server** — `xray mcp` lets AI agents (Claude Code, Cursor, …) query impact, search and nodes over stdio. Read-only. [Setup](docs/MCP.md).
- **Ask** — optional Q&A over the graph with validated citations. **Off by default**; needs explicit consent, redacts secrets, and falls back to `evidence-only` answers.
- **Bilingual** — UI, reports, errors and CLI in English and Uzbek (`--lang`, `XRAY_LANG`, EN/UZ switch).

## Quick start

Requirements: Node ≥ 24 (tested on **v26.11**; needs type-stripping and `node:sqlite`), pnpm, git, tar. Tested on Linux only.

```bash
git clone https://github.com/lynxstac/xray.git && cd xray
pnpm install

pnpm demo                                   # reproducible demo: fixture repo + signature change + report
pnpm xray index  <path/to/repo>             # index (incremental; cache in ~/.cache/xray)
pnpm xray impact <path/to/repo>             # working tree vs HEAD
pnpm xray impact <path/to/repo> --base main --head feature --md
pnpm xray search <path/to/repo> useArticle
pnpm serve                                  # local web UI (URL + token printed in the terminal)
```

Set `XRAY_LANG=en` (or pass `--lang en`) for English CLI output.

### Use it from an AI agent (MCP)

```json
{
  "mcpServers": {
    "xray": { "command": "node", "args": ["/path/to/xray/packages/cli/src/main.ts", "mcp"] }
  }
}
```

Tools: `xray_impact`, `xray_search`, `xray_node`, `xray_index`. See [docs/MCP.md](docs/MCP.md).

## Confidence model

| Level | Meaning |
|---|---|
| `verified` | A link proven by static analysis (TypeScript type checker). |
| `possible` | At least one link is approximate (through an object member, a file-level change, …). |
| `unresolved` | Cannot be resolved statically (`import(expr)`, `obj[key]()`, unresolved alias, …) — **never hidden**, listed separately. |

`verified` is about the *link*, not about whether something breaks. Reports say "may be affected" — never "will break" (enforced by tests).

## Accuracy

Independent oracle = TypeScript LanguageService `findReferences`, file level, exported symbols, **7 real projects (3,414 symbols)**: four private codebases and three open-source Next.js apps.

| Project | Symbols | `verified` precision | `verified` recall | All-edges precision |
|---|---:|---:|---:|---:|
| private project A (1,267 files) | 1,770 | 1.000 | 1.000 | 0.992 |
| private project B | 860 | 1.000 | 1.000 | 0.999 |
| private project C | 301 | 1.000 | 1.000 | 1.000 |
| private project D | 52 | 1.000 | 1.000 | 1.000 |
| *open source:* taxonomy / commerce / platforms | 271 / 109 / 51 | 1.000 | 1.000 | 1.000 |

⚠️ The oracle also uses the TypeScript checker, so this measures **extraction completeness**, not dynamic or framework-level links. Remaining gaps are in [KNOWN_LIMITS](docs/KNOWN_LIMITS.md); human-labelled impact ground truth is not done yet. Performance: 1,267 files ≈ 3 s (460 MB RSS) cold, 0.15 s to reopen unchanged, 1–2 s after a one-file change. Details: [BENCHMARKS](docs/BENCHMARKS.md).

## Architecture

```
 scanner ─► parser ─► graph (TS Program + checker, SQLite, incremental) ─► impact ◄─ git
                         │                                                  │
                         └──► retrieval (symbol + FTS5 + graph) ─► ai ──────┤
                                                                            ▼
                                        server (127.0.0.1, token) ─► web UI · CLI · MCP
```

A modular monolith in a pnpm workspace; analysis packages do not depend on React, the DOM or HTTP. See [ARCHITECTURE](docs/ARCHITECTURE.md) and [TECHNICAL_DECISIONS](docs/TECHNICAL_DECISIONS.md).

## Security & privacy

Local-only server bound to `127.0.0.1` with a token; protection against DNS rebinding and CSRF; Git argument and `core.fsmonitor` vectors closed; symlink escape blocked; secret files never indexed; prompt-injection and redaction tests for the optional AI path; no network code runs without explicit consent. See [SECURITY](docs/SECURITY.md).

## Testing

`pnpm check` = typecheck + **156 unit/integration tests** + **30 browser E2E tests** (Playwright, Chrome), including exact match against a hand-written `expected-graph.json`, six impact scenarios with hand-computed ground truth, `incremental ≡ full`, and the security cases above.

## Documentation

[PRODUCT_SPEC](docs/PRODUCT_SPEC.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [TECHNICAL_DECISIONS](docs/TECHNICAL_DECISIONS.md) · [BENCHMARKS](docs/BENCHMARKS.md) · [KNOWN_LIMITS](docs/KNOWN_LIMITS.md) · [SECURITY](docs/SECURITY.md) · [ROADMAP](docs/ROADMAP.md) · [MCP](docs/MCP.md) · [TRY_IT](docs/TRY_IT.md) · [Video pipeline](video/README.md)

Feedback is very welcome — see [FEEDBACK_TEMPLATE](docs/FEEDBACK_TEMPLATE.md).

## License

[MIT](LICENSE)
