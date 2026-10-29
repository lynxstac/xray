# Benchmarks

🇺🇿 O'zbekcha: [docs/uz/BENCHMARKS.md](uz/BENCHMARKS.md)

Every number was **actually measured** with the `bench/` scripts. Raw results are written to `bench/results/*.json` but are not committed to git (they contain internal file paths from the author's private projects); they can be regenerated with the scripts. Nothing here is a guess or made up.

## Environment

| | |
|---|---|
| CPU | AMD Ryzen 5 8645HS (12 threads) |
| RAM | 15 GB |
| OS | Linux 7.2.9-arch1 |
| Node | v26.11.1, TypeScript 6.0.3 |
| Date | 2026-10-28 |

Test projects: the author's own repos (private project A, private project B, private project C, private project D, private project E) and **3 open-source Next.js repos** (`shadcn-ui/taxonomy`, `vercel/commerce`, `vercel/platforms`; `--depth 60` clones). ⚠️ `node_modules` is not installed in the open-source repos (repo code is not executed/installed): external package types (e.g. React) are missing, so in them both the tsserver oracle and X-Ray see only relationships inside the repo.

## 1. Indexing (cold, no cache) — `pnpm bench:index`

| Project | Files | Nodes | Edges | Time | Max RSS |
|---|---:|---:|---:|---:|---:|
| private project D | 70 | 286 | 1,020 | 0.55 s | 231 MB |
| private project C | 165 | 1,039 | 3,164 | 1.29 s | 300 MB |
| private project B | 257 | 2,096 | 8,471 | 1.70 s | 349 MB |
| private project E | 73 | 459 | 648 | 2.47 s | 384 MB |
| private project A | 1,267 | 5,150 | 15,202 | 3.12 s | 460 MB |
| *open-source* **dub** (monorepo, Next.js, 2207 files) | 2,207 | 7,302 | 26,405 | 5.3 s | 817 MB |
| *open-source* taxonomy | 129 | 518 | 1,232 | 0.47 s | 220 MB |
| *open-source* commerce | 66 | 258 | 698 | 0.34 s | 196 MB |
| *open-source* platforms | 21 | 86 | 172 | 0.20 s | 168 MB |

Note: `private project E` is relatively slow for 73 files — its source contains large files; the cause has not been investigated separately. Before the `generated-bundle` heuristic was added, this repo showed 427 files / 10 s (committed Vite builds).

## 2. Incremental (copy of private project A, 1267 files) — `bench/incremental-bench.ts`

| Operation | Time | Parsed | Semantics recomputed |
|---|---:|---:|---:|
| Cold (with db write) | 3.80 s | 1267 | 1267 |
| Nothing changed | 0.15 s | 0 | 0 |
| One leaf file (no importers) | 0.95 s | 1 | 1 |
| Hub file (175 direct importers) | 1.79 s | 1 | 325 |
| Full (no cache) | 2.79 s | 1267 | 1267 |

Honest note: parsing and semantic edges are recomputed only for the files that need it, but the TypeScript `Program` is rebuilt every time (≈0.8 s) — which is why even a leaf file takes ~1 s. Reusing `oldProgram` in the future may reduce this time (not yet measured).

## 3. Relationship accuracy — `pnpm bench:accuracy`

**Oracle:** TypeScript `LanguageService.findReferences` (tsserver itself). **Sample:** *all* exported functions/components/hooks/classes/variables in the project (excluding test files). **Comparison level:** file — "which *other* files use this symbol?" (import/export specifiers are excluded from the oracle output).

| Project | Symbols | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|
| private project A — all edges | 1,770 | 4,024 | 33 | 0 | 0.9919 | 1.0000 |
| private project A — **`verified` only** | 1,770 | 4,024 | **0** | 0 | **1.0000** | **1.0000** |
| private project B — all | 860 | 2,186 | 3 | 0 | 0.9986 | 1.0000 |
| private project B — **`verified`** | 860 | 2,186 | **0** | 0 | **1.0000** | **1.0000** |
| private project C | 301 | 720 | 0 | 0 | 1.0000 | 1.0000 |
| private project D | 52 | 186 | 0 | 0 | 1.0000 | 1.0000 |
| *open-source* taxonomy | 271 | 289 | 0 | 0 | 1.0000 | 1.0000 |
| *open-source* commerce | 109 | 127 | 0 | 0 | 1.0000 | 1.0000 |
| *open-source* platforms | 51 | 44 | 0 | 0 | 1.0000 | 1.0000 |

**What are the FPs?** All are marked `possible`: a reference to an object-literal member (`OPTIONS.x`) is linked to the declared variable (`via: member-of-declaration`). The oracle counts such a reference toward the member, not the variable itself. This is deliberate: they are shown as `possible`, not `verified`.

**Control experiment (is the harness sensitive?):** when `renders` and `references` were deliberately removed from the graph (`XRAY_CONTROL=calls-only`), recall on the private project A sample dropped to **0.287** — so the measurement does catch a defect.

**What this measurement does not prove:**
- The oracle also relies on TypeScript's binder/checker → it verifies the completeness of X-Ray's *collection and mapping logic* (walking identifiers, alias/barrel, declaration→node matching), not things TypeScript itself cannot see (dynamic, framework, string-based relationships).
- It is file-level — not symbol-level evidence lines.
- private project E has no tsconfig — it was not used for the oracle.

## 4. Impact on real Git history (stability) — `pnpm bench:replay`

The last 15 (non-merge) commits of each project, each run as `sha~1...sha` (two snapshots + index + analysis):

| Project | Commits | Errors | Median | Max | Truncated | Broken path |
|---|---:|---:|---:|---:|---:|---:|
| private project A | 15 | 0 | 3.41 s | 6.74 s | 0 | 0 |
| private project B | 15 | 0 | 1.27 s | 1.82 s | 0 | 0 |
| private project C | 15 | 0 | 1.08 s | 2.30 s | 0 | 0 |
| *open-source* taxonomy | 15 | 0 | 0.28 s | 1.02 s | 0 | 0 |
| *open-source* commerce | 15 | 0 | 0.19 s | 0.68 s | 0 | 0 |
| *open-source* platforms | 15 | 0 | 0.22 s | 0.83 s | 0 | 0 |

This is a **stability** test, not an accuracy test: no crashes/errors on real changes, and every result item has its own evidence path. There is no human-labeled ground truth yet for Impact results (which files are affected) — this value is confirmed only *indirectly*, through the reference accuracy above and the fixture tests.

## 4b. Next.js routes — comparison with `find`

The number of route files detected in the open-source repos was compared with an independent `find` (identical): taxonomy 14 `page` / 8 `layout` / 6 `route` / 1 `pages/api`; commerce 5 / 3 / 1; platforms 3 / 1 / 0 (+ `proxy.ts` middleware). For the fixture (`fixtures/next-app`), the hand-written route table (11 files) and 6 impact scenarios (nested/root layout, middleware, `pages/_app`, a changed page) match exactly.

### Scale: open-source monorepo `dubinc/dub` (2207 files, `apps/web` + 9 packages)

- Index: 5.3 s, 817 MB RSS (measured twice: 5.35 / 5.23 s). The scanner matches `git ls-files` exactly (2207).
- Routes match `find` exactly: 77 `page`, 23 `layout`, 210 `route.ts`, 5 `loading`, 1 `not-found`, 1 middleware.
- **Cross-package relationships:** `node_modules` is not installed and package `main` fields point to `dist`; until workspace packages were resolved to `src/` via the `package.json` `name`, `@dub/utils` (756 files) and `@dub/ui` (404 files) were treated as "external", and there was only 1 cross-package import edge → now 1191 (total edges 21,503 → 26,405).
- Impact (a return type was added to `cn()` in a scratch clone, then reverted): 399 direct (apps/web 258, packages/ui 141), 92 routes, ~5 s; the result was truncated at 500 items and **marked as such** (`truncated`).
- Accuracy (oracle) was not measured on this project: without `node_modules` there are no package types, and the oracle is blind too.

### Scanner finding (in dub)
**Source files** such as `lib/webhook/secret.ts` and `utils/secrets.ts` had been skipped as "secret" purely because of their names. Now the name-based rule applies only to non-source files (`secrets.json`, `credentials.yml`, no extension); `.env*`, `*.pem`, `*.key`, `id_rsa*` etc. are always secret. Values inside code are caught by the AI redaction.

## 5. Hand-written ground truth (fixture)

- `fixtures/react-app/expected-graph.json`: imports, calls, renders, references, tests, exports — an **exact match** on all 6 kinds (nothing missing, nothing extra).
- Impact: 6 scenarios (body change, signature change, deletion, cyclic file deletion, file-level change, rename): **precision = recall = 1.0**.
- Honest note: two of the scenarios (S3, S6) failed on the first run; in both cases the culprit was a design bug in the code (the "hole" left by a deletion was counted as a file-level change; a file-level change propagated to importers of importers) — the expected list was not changed, the code was fixed.

## 6. Test volume

147 unit/integration tests (15 files) + 30 browser E2E. `pnpm check`.

## How to reproduce

```bash
pnpm bench:index  <folder>/<repo> ...
pnpm bench:accuracy <folder>/<repo> <tsconfig> 5000
pnpm bench:replay <folder>/<repo> 15
node bench/incremental-bench.ts <repo-copy>
```
