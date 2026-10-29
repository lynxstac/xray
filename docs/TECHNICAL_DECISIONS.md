# Technical Decision Log (ADR)

🇺🇿 O'zbekcha: [docs/uz/TECHNICAL_DECISIONS.md](uz/TECHNICAL_DECISIONS.md)

✅ implemented and confirmed · 🟡 provisional / awaiting measurement. Date: 2026-10-28.

## Environment
Node v26.11, pnpm 12, git 2.56; disk space was tight — so dependencies are kept minimal and real repos were not copied (only a small copy for the incremental measurement).

## Core decisions

**ADR-1 ✅ TypeScript monorepo (pnpm workspaces).** Analysis and UI in one language.

**ADR-2 ✅ Pin `typescript@~6.0` — not TS 7.** `typescript@7` (the current `latest`) is the native Go compiler; `require('typescript')` does not expose the classic Compiler API (only `typescript/unstable/*`). X-Ray is independent of the analyzed project's TS version (it uses its own copy). It sits behind the parser/graph interface, so swapping it out once the TS 7 API stabilizes is a local change. `ts-morph` was not used (it bundles its own TS copy; the raw API is useful for learning).

**ADR-3 ✅ UI: Vite + React SPA + local HTTP server (not Next.js).** SSR/routing/deploy are not needed; a Node server is required for the file system anyway. Proven by E2E.

**ADR-4 ✅ Graph visualization: Cytoscape.js.** Hundreds of nodes, filtering, neighborhoods, path highlighting; canvas; layouts included. React Flow is for editors/diagrams and React inside nodes is not needed. 🟡 Stress: the neighborhood is capped at 500 nodes on the server; anything larger has not been measured.

**ADR-5 ✅ Storage: `node:sqlite` (WAL + FTS5).** Spike: FTS5 worked; no additional native dependency. `better-sqlite3` was not needed.

**ADR-6 ✅ Git: CLI + `execFile`.** `--unified=0`, `-M60%`, `--relative`, `-z` name-status. Protections: `SECURITY.md`. `git worktree` is not used (it modifies repo metadata) — a `git archive | tar -x` snapshot is used instead.

**ADR-7 ✅ Tests: Vitest + Playwright (system Chrome, `channel: 'chrome'`).** No browser download required.

**ADR-8 ✅ Node IDs have no line numbers; `#` may appear in a path** (`splitNodeId` splits on the last `#` — tested with `we#ird.ts`).

**ADR-9 ✅ `calls` only when type-resolved.** No guessed-by-name edges are created; `obj[expr]()` → `computed-call` (unresolved).

**ADR-10 ✅ `depends_on` is not stored** — it is derived from `imports`.

**ADR-11 ✅ Server: raw `node:http`** (not Hono/Fastify). ~12 routes, no dependencies; the security boundaries stay visible.

**ADR-12 ✅ AI is off by default; consent + redaction + citation checking; no vector DB.** Whether FTS5 + graph search is sufficient is not yet decided — there is no real-LLM measurement (🟡).

## Decisions made from measurements and real repos

**ADR-13 ✅ Group by nearest tsconfig/jsconfig + `references` delegation + import-closure extra roots.** Reason (a real finding): in the Vite template `paths` lives in `tsconfig.app.json`; reading only `tsconfig.json` silently turned 160+ of the `@/…` imports into "external packages" (private project C: 1385 → 3164 edges). Monorepo: even when a workspace symlink is `isExternalLibraryImport`, the real file is inside the repo — it is now an edge.

**ADR-14 ✅ Unresolved alias-like imports (`@/`, `~/`, `#`) become `unresolved-module`, not a silent "external package".** The "don't hide anything" principle from the specification.

**ADR-15 ✅ Minimal lib (`lib.es2022.d.ts`), not `noLib`.** Real finding: with `noLib` the `Promise` type is missing → relationships through `await import()` destructuring and `.then(m => m.X)` were dropped (24 lost in private project C; cost ≈ +150 ms).

**ADR-16 ✅ Shorthand `{ foo }` and `const { foo } = …` are also `references`.** Found by the oracle comparison (the second private project: 3 missed).

**ADR-17 ✅ An object-member reference → `possible` (`member-of-declaration`).** The member is not a node in the graph; it is attributed to the enclosing declaration and not claimed as `verified`.

**ADR-18 ✅ Impact depth policy.** Body-only ≤ 2 (behavioral impact does not travel far — reduces noise), signature/deletion ≤ 4, file-level = 1. In the first version a file-level change would spread to importers of importers — scenario S6 caught this.

**ADR-19 ✅ The "hole" left by a deleted symbol is not a file-level change.** Caught by scenario S3 (otherwise it produced `index.ts` and 5 false items).

**ADR-20 ✅ Incremental = reverse transitive import closure of changed files; file add/remove or config change → full.** Proven by mutation: if the closure is cut down to just the changed file, the test where a new name appears two steps away through an `export *` barrel fails.

**ADR-21 ✅ The index is not stored inside the repo** (`~/.cache/xray/<hash>/`). The repo stays clean (confirmed by a test).

**ADR-22 ✅ A parser/Program error does not crash the process, but is not hidden** (`parseFailed`, `analysis-failed`). Real finding: a file nested 60,000 levels deep caused a stack overflow inside `ts.createProgram` and took down the whole group.

**ADR-23 ✅ Accuracy is measured against an independent oracle (tsserver `findReferences`)**, with a control experiment (recall 0.29 when the graph is broken). Limits are in `BENCHMARKS.md`.

**ADR-24 ✅ No-build runtime** (Node type-stripping) + `erasableSyntaxOnly`. Vitest would swallow parameter properties while plain `node` would not — discovered when the CLI was first run; the typecheck now catches it.

**ADR-25 ✅ Next.js routes come from path conventions (no code is executed).** Only in a Next.js project (`next` dependency / `next.config.*`) — otherwise `src/pages/` (React Router) would become a false route (verified in a test). Layout/middleware impact: a layout affects only the **pages** under its own folder (not route handlers), while middleware affects everything. Results are **deduplicated** (one route file — once, with the strongest reason): the first version counted one page several times through multiple layouts, yielding 45 "routes" in a 14-page repo.

**ADR-26 ✅ Panel layout: our own `SplitLayout` (no library).** Pointer capture + keyboard + localStorage + a drawer on narrow screens; center minimum. No new dependency was needed.

**ADR-27 ✅ `oldProgram` is not reused.** Considered: the benefit exists only in a long-lived server process (not in the CLI) and also requires a `SourceFile` cache; at the current measurement (leaf change ≈ 0.9 s) it is not worth the complexity. To be revisited if users complain.

**ADR-28 ✅ Workspace packages via `package.json` `name` → `paths` (`src/` first, then the folder).** Real finding (`dub`): with no `node_modules` and `main` → `dist`, 1100+ cross-package imports were treated as "external" and there was no cross-package graph. Existing tsconfig `paths` entries take precedence; `baseUrl` is NOT set (it shifts bare imports to the repo root — verified in a test); `pathsBasePath` is used instead. The workspace list is part of the cache fingerprint.

**ADR-29 ✅ The by-name "secret" rule applies only to non-source files.** `secret.ts`/`credentials.ts` are real code (such as a webhook secret generator); dropping them would lose code from the graph. Values are protected by redaction (AI), while `.env*`/key/certificate files are always left unindexed.

**ADR-30 ✅ i18n: two catalogs, no library.** Backend (`core/i18n.ts`): key + `{param}`; report/error texts are built in the request's language (the UI adds `x-xray-lang` to every request). **Language-independent codes** (`reasonCode`, `GitError.code`, `ScanLimitError.code`) — the UI/server builds the text in its own language. The consent text is accepted by the server in **both languages**. UI (`apps/web/src/i18n.tsx`): two catalogs typed as `Record<UIKey,string>` (a missing key is a compile error), and `` `code` `` and `**bold**` markers are rendered safely (no HTML). Tests: catalog parity (keys + `{placeholder}`), no Uzbek words in English (E2E across all screens/tabs), server texts are rebuilt when the language changes. The default language is `uz` (configurable via `DEFAULT_LANG` in `packages/core/src/i18n.ts`) so that existing tests/CLI don't break (switching to `en` is a one-constant change).

**ADR-31 ✅ Video: our own frame collector (CDP screencast + ffmpeg), not `recordVideo`.** Playwright `recordVideo` produces low-bitrate VP8, and `page.screencast` delivers frames at CSS size (DSF is ignored) → soft text. Chrome `--force-device-scale-factor=2` + CDP `Page.startScreencast` yields 2560×1440 JPEG; frames are fed to ffmpeg through a 30 fps "pacer" (video duration matches wall-clock time exactly → in sync with the audio). Each scene is **bound to the audio length** (the voice-over is synthesized first, then the recording is fitted to it). Rendering: YouTube — 2560→1920 lanczos (supersampling); Reels — a separate zoomed crop per scene + IG safe zones + burned-in captions. Music is at a **constant level** (no ducking), two-pass loudnorm −14 LUFS. Quality: the final mix was run through Whisper (0.0% error).

## Status of the initial critique of the specification

| Initial risk | Status |
|---|---|
| Too ambitious (6+6 kinds, incremental, AI, 3 screens) | Everything was built, but the order was changed: Impact (CLI) → UI → AI |
| Changed-symbol (hunk↔AST) is ambiguous | Done: innermost symbol, signature/body diff; format-only/rename limitation in `KNOWN_LIMITS` |
| "Test intelligence" overclaim | `direct-use/transitive/imports-only` + a "not coverage" note |
| Monorepo, Next.js `app/` router, `import type`, multiple tsconfigs | All ✅ (Next.js routes: ADR-25; remaining framework details in `KNOWN_LIMITS` #1) |
| Stale index | Hash + config fingerprint; stale detection shows "reindex" in the UI |
| Exporting results | Markdown + JSON ✅ |
| Performance (a single Program) | Measured: 1267 files 3 s/460 MB; 10k+ untested |
| Security | `SECURITY.md`, every item tested |
