# Known limits

🇺🇿 O'zbekcha: [docs/uz/KNOWN_LIMITS.md](uz/KNOWN_LIMITS.md)

This list is deliberately open: every item is something the analysis **does not see** or **does not prove**. Things that have been fixed are in [`docs/TECHNICAL_DECISIONS.md`](TECHNICAL_DECISIONS.md).

## Relationships static analysis does not see

1. **Hidden framework wiring.** Next.js routes (App/Pages Router, layout, middleware) are **modeled** from the file path (Impact: "routes that may be affected"). Not modeled: `use client`/`use server` boundaries, the specific behavior of parallel/intercepting routes (inferred from the URL only), `generateStaticParams`/`revalidate`, Server Actions calls, `next.config` redirects/rewrites, Remix/Nuxt/SvelteKit and other frameworks. A layout is assumed to apply to "all pages" (taking nested layouts into account, but `loading`/`error` boundaries are not precise).
2. **Dynamic/string-based relationships.** `import(expr)`, `require(expr)`, `obj[key]()` are **marked** as `unresolved` (not hidden). Event names, DI containers, i18n keys, CSS classes, route strings, `eval` are not tracked and not flagged.
3. **Bundler-only aliases.** Aliases defined only in `vite.config.ts`/webpack (not in tsconfig/jsconfig) are not resolved: those of the form `@/…`, `~/…`, `#…` are reported as `unresolved-module`. We do not read configs by executing them (security).
4. **Package `exports`/build output.** Workspace packages are resolved from the `package.json` `name` (first `src/`, then the folder itself; the `exports` map is not taken into account). A package whose source is not in `src/` (only in `dist` or in a non-standard location) stays external. Real npm packages (`node_modules`) are never analyzed.
5. **Files in languages other than TS/JS.** `.vue`, `.svelte`, `.astro`, `.mdx` are not parsed (imports of them are skipped as "asset").

## Accuracy limits

6. **Object member → `possible`.** A reference like `OPTIONS.x` is linked to the declared variable and marked `possible` (the member is not a separate node in the graph). Object-literal methods and class property arrows are not separate symbols — calls inside them are attributed to the enclosing symbol.
7. **The accuracy measurement is not fully independent.** The oracle (tsserver `findReferences`) also relies on the TypeScript checker; it measures the completeness of **extraction**, not the language's analysis boundaries. File level, exported symbols only.
8. **No human-labeled ground truth for Impact results** (on real projects). On real repos only stability (no crashes, evidence path present) and reference accuracy were measured.
9. **Testing on open-source repos is small:** 3 open-source Next.js repos (taxonomy, commerce, platforms; 21–129 files in total) were tested without `node_modules`. Large open-source monorepos (such as Cal.com or Next.js itself) have not been tested.
10. **Change-kind heuristic.** Signature = parameters + return type text; a difference = "signature changed". A format-only change appears as `modified`; a renamed symbol = `removed` + `added`. A moved symbol (with its name unchanged in a file rename) is matched.
11. **Body-only change depth ≤ 2** (configurable). That is, the behavioral effect of a body change is not propagated 3+ steps away — this is a quality/noise trade-off; it can be changed, but noise increases.
12. **Tests.** "Related test" = the test code imports/uses the changed element. This is **not coverage**. `untested` = "no test found within the depth limit".
13. **Staged mode** builds the graph from the working directory (the report contains a warning). Taking an index snapshot would require writing to the Git object database (which conflicts with the read-only rule).

## Scale and performance

14. **Large repos.** The largest tested is 2207 files (open-source `dub` monorepo: 817 MB RSS, 5.3 s). A 10k+ file monorepo has not been tested (RSS grows roughly linearly with file count: ~0.37 MB/file) — a single `ts.Program` for a group takes a lot of memory. Safeguards: file limit 1 MB, diff limit 3000 files, impact results truncated at 500 items (marked as such).
15. **Incremental** recomputes parsing and semantics partially, but the `Program` is rebuilt every time (~0.8 s). When a file is **added/removed** — a full rebuild (resolution may change). A change in the `tsconfig` `extends` chain does not invalidate the cache → `--full`.
16. **Graph UI** has not been measured on neighborhoods larger than 500 nodes (the server caps at 500). No separate stress test was run for Cytoscape.

## AI

17. **Quality has not been measured with a real LLM provider.** Tests use a local fake provider: what is sent, the consent gate, redaction, and citation validation were verified; the *quality* of answers and the share of unsupported claims have not been measured on a real model.
18. **Redaction is pattern-based** (key/token/JWT/private key/URL password/`secret = "..."`). It is not a 100% guarantee; a secret in a different form may slip through.
19. **Citation validation** checks whether the file and line range *match the provided context*, not whether the claim is *true*.
20. **No vector DB.** Retrieval = name matching + FTS5 + graph neighbors. Semantic (meaning-based) search is weak: if a word does not appear in the code, it will not be found.

## Platform

21. Tested on Linux only (path separators, `tar`, `git archive`). Operation on Windows/macOS has not been verified.
22. A demo video exists (`docs/demo.mp4`), but it is silent and covers a single commit in the open-source `taxonomy` repo.
23. The **phone** (390 px) layout has been checked (E2E), but the graph is cramped on a small screen; it has not been tested on a real device.
25. **The server does not respond while indexing.** Indexing is mostly synchronous CPU work (the TypeScript Program) — during this time (~5 s on a large repo) other requests wait in the queue. The UI shows "Indexing…"; the proper fix is `worker_threads` (not yet done). `open` is atomic: if the new index fails, the old repo keeps working.
26. **Protection limits:** a folder with more than 50,000 source files or 600,000 entries is rejected with a clear error (wrong folder: `~`, `/`); file 1 MB, diff 3000 files, impact 500 items.
24. Route detection is based on **path convention**; if the `app`/`pages` folder is in a non-standard location (`distDir`/custom `pageExtensions` in `next.config`), it is not detected.
