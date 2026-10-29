# Architecture

🇺🇿 O'zbekcha: [docs/uz/ARCHITECTURE.md](uz/ARCHITECTURE.md)

> Status: implemented and tested (2026-10-28). The reasons behind the decisions are in `TECHNICAL_DECISIONS.md`.

A **modular monolith**: pnpm workspaces, a single local process. No microservices, no cloud, no vector DB.

```
 repo ─► scanner ─► parser ─► graph ──────────► impact ◄── git
                      (AST)   (TS Program +       │
                               checker, SQLite,    ├─► markdown / JSON
                               incremental)        │
                       │                           │
                       └─► retrieval ─► ai ────────┤
                           (symbol+FTS5  (consent,  ▼
                            +graph)       redact)  server (127.0.0.1+token) ─► web UI · CLI
```

## Packages

| Package | Responsibility | Depends on |
|---|---|---|
| `core` | Types (`Loc`, `GraphNode`, `GraphEdge`, `Confidence`…), `splitNodeId`, `edgeKey` | — |
| `scanner` | File discovery; `.gitignore`/`.xrayignore`; secret/generated/symlink/size filters; **every skipped file is returned with its reason** | core |
| `parser` | `parseSource(path, text)` — AST: imports/exports (all kinds), symbols (function/method/class/component/hook/variable/type), signature, `unresolved` (dynamic, computed-call), syntax errors | core, typescript |
| `graph` | Semantic analysis (type checker), graph model, SQLite store, FTS5, incremental engine | core, scanner, parser |
| `git` | Safe wrapper: diff (working/staged/range), refs, `showFile`, `exportSnapshot` | core |
| `impact` | Diff + graph → `ImpactReport`; Markdown renderer; `runImpact` orchestration | core, graph, git, parser |
| `retrieval` | Question → symbols/FTS/graph → code chunks + facts | core, graph |
| `ai` | `AiProvider` interface (Anthropic, OpenAI-compatible), consent, redaction, citation validation | core, retrieval |
| `server` | Local HTTP API + static web | all |
| `cli` | `xray index/impact/search/ask/serve/ai` | all |
| `apps/web` | React + Vite + Cytoscape SPA | (types only) |
| `bench` | Benchmark scripts | graph, impact |

Rule: dependencies are one-directional; `parser/graph/impact` are independent of React/DOM/HTTP.

## Data model

- **Node ID:** `path` for a file, `path#qualifiedName` for a symbol — no line numbers (stable under edits). A path may contain `#`: the split happens on the *last* `#` (`splitNodeId`).
- **Node kinds:** `file`, `test_file`, `function`, `method`, `class`, `component`, `hook`, `variable`, `type`.
- **Edge kinds:** `imports` (file→file; static/dynamic/require/re-export/type), `calls` (including `new`), `renders` (JSX), `references`, `exports` (file→original declaration; barrels/`export *` are transparent), `tests` (test→imported file; *derived*, not stored).
- **Edge fields:** `confidence`, `count`, `evidence{file,line,col}`, `via` (`type`, `new`, `dynamic`, `require`, `re-export`, `export *`, `member-of-declaration`).
- `depends_on` is not stored separately — it is derived from `imports` (to avoid drift).
- **SQLite** (`node:sqlite`, WAL): `meta`, `files(path, hash, size, parsed JSON)`, `semantic(path, JSON)`, FTS5 `code_fts(name, tokens, body)`. The schema version is kept in `PRAGMA user_version`; the store is a cache and is discarded when stale.

## Semantic analysis (graph/semantic.ts)

1. Files are grouped by their **nearest tsconfig/jsconfig**; if `tsconfig.json` only provides `references` (the Vite template), a file takes the config of the referenced project it belongs to.
2. **Import edges** (`ts.resolveModuleName`, with the group's options): `paths`/`baseUrl`/`.js→.ts`/workspace symlinks; a real file inside the repo → edge; `node_modules` → external package; unresolved alias-like specifiers (`@/`, `~/`, `#`) → `unresolved-module`; assets (`.css`, `.svg`…) → skipped.
3. One **`ts.Program`** per group (`noResolve`, `types: []`, `lib: es2022`) plus the import closure from other groups (extra roots, not analyzed). Repo code is never executed.
4. Each file's AST is walked: `calls` (callee identifier), `renders` (JSX tag), `references` (remaining identifiers, including shorthand and destructuring). The target is resolved via `checker.getSymbolAtLocation` → `getAliasedSymbol` if it is an alias → declaration → our node (the innermost symbol, by position). An exact match = `verified`; merely being contained within (an object member) = `possible`.
5. `exports`: `getExportsOfModule` → original declaration (re-export and `export *` chains are transparent automatically).
6. Files that crashed the parser are not added to the Program; a group-level failure is isolated with `analysis-failed`.

## Incremental (graph/engine.ts)

`full` | `incremental` | `noop`. If a file's hash (sha256) differs → re-parse. Semantics: the **reverse transitive import closure** of the changed files is recomputed (a file's result depends only on the files in its own import closure — which is why this is correct). **Full** rebuild when: first run, tsconfig/jsconfig changed, a file was added or removed. Invariant: `incremental ≡ full` (tests, including mutation testing).

## Impact (impact/analyze.ts)

1. **What changed:** `git diff -M60% --unified=0 --relative` (plus untracked files in the working directory). Hunks are intersected with symbols (innermost); the old file is read via `git show base:path` → parsed → symbols are compared: `added | removed | modified (body only) | signature-changed`. A hunk that falls in no symbol is a file-level change (the "hole" left by a deleted symbol is not counted).
2. **Seeds and depth:** body change ≤ 2; signature change/deletion ≤ 4; file-level change = 1 (direct importers only); deleted/moved file = 1 (importers).
3. **Reverse BFS** along `calls | renders | references`; if a file node is reached (top-level use), it continues to the importers (`possible`); a test file is a leaf. The evidence chain is reconstructed using path pointers. Limit: `maxNodes` (flagged when truncated).
4. **The old-state graph** (a `git archive` snapshot) is built only when something was deleted/moved. In `range` mode the "new" side is also a commit snapshot, not the working directory.
5. **Tests:** `direct-use` | `transitive` | `imports-only`; `untested` = no test reaches the changed symbol.
6. **Uncertain:** `unresolved`/`broken-import`/`parse-error`/`not-analyzed`/`truncated`/warnings.
7. `confidence` = the evidence for a relationship (the entire path is statically proven → `verified`), not the probability of being wrong.

## Retrieval and AI

Retrieval: (1) exact identifier match from the question, (2) FTS5 (name/path/body), (3) graph neighbors of the top-scoring symbols → chunks (real source lines) + facts (`A calls B [file:line]`). AI: `AiProvider.complete()`; consent gate → redaction → wrapped prompt → response → citation check (`unsupportedRate`). No provider/no consent → `evidence-only`.

## Server API (127.0.0.1, token)

`GET /api/state` · `POST /api/open|reindex` · `GET /api/files|search|node|neighborhood|source|refs` · `POST /api/impact|ask` · `GET /api/ai/consent-text` · `POST /api/ai/enable`. Errors: `HttpError`, `GitError`→400. The security table is in `SECURITY.md`.

## UI

Three main screens plus a question screen: Repository (index report: skipped files / unresolved items / syntax errors are shown openly), Graph Explorer (search, filter, N-hop neighborhood ≤ 500 nodes, details, source), Change Impact (diff source, direct/indirect/tests/uncertain, evidence-path graph + source, Markdown/JSON export), Ask (evidence, citations `ok/bad`, "what is sent", consent flow). Loading/empty/error/partial states exist (verified by E2E).

## Runtime

There is no build step: Node runs TypeScript directly (type-stripping). That is why `erasableSyntaxOnly` is enabled (constructor parameter properties, enums and namespaces are forbidden — the typecheck catches them). Only the web app runs `vite build`.
