# Arxitektura

> Holat: amalga oshirilgan va testlangan (2026-10-28). Qarorlar sabablari — `TECHNICAL_DECISIONS.md`.

**Modulli monolit**, pnpm workspaces, bitta lokal jarayon. Mikroservis/cloud/vektor DB yo'q.

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

## Paketlar

| Paket | Vazifa | Bog'liqligi |
|---|---|---|
| `core` | Tiplar (`Loc`, `GraphNode`, `GraphEdge`, `Confidence`…), `splitNodeId`, `edgeKey` | — |
| `scanner` | Fayl topish; `.gitignore`/`.xrayignore`; maxfiy/generated/symlink/hajm filtrlari; **har bir o'tkazib yuborilgan fayl sababi bilan qaytariladi** | core |
| `parser` | `parseSource(path, text)` — AST: import/export (barcha turlar), symbol'lar (function/method/class/component/hook/variable/type), imzo, `unresolved` (dynamic, computed-call), sintaksis xatolari | core, typescript |
| `graph` | Semantik tahlil (type-checker), graph model, SQLite store, FTS5, incremental engine | core, scanner, parser |
| `git` | Xavfsiz wrapper: diff (working/staged/range), refs, `showFile`, `exportSnapshot` | core |
| `impact` | Diff + graph → `ImpactReport`; Markdown renderer; `runImpact` orkestratsiyasi | core, graph, git, parser |
| `retrieval` | Savol → symbol/FTS/graph → kod parchalari + faktlar | core, graph |
| `ai` | `AiProvider` interfeysi (Anthropic, OpenAI-compatible), consent, redaction, iqtibos validatsiyasi | core, retrieval |
| `server` | Lokal HTTP API + statik web | hammasi |
| `cli` | `xray index/impact/search/ask/serve/ai` | hammasi |
| `apps/web` | React + Vite + Cytoscape SPA | (faqat tiplar) |
| `bench` | Benchmark skriptlari | graph, impact |

Qoida: bog'liqlik bir yo'nalishli; `parser/graph/impact` React/DOM/HTTP'dan mustaqil.

## Ma'lumotlar modeli

- **Node ID:** fayl uchun `path`, symbol uchun `path#qualifiedName` — satr raqamisiz (tahrirda barqaror). Yo'lda `#` bo'lishi mumkin: bo'lish *oxirgi* `#` bo'yicha (`splitNodeId`).
- **Node turlari:** `file`, `test_file`, `function`, `method`, `class`, `component`, `hook`, `variable`, `type`.
- **Edge turlari:** `imports` (file→file; static/dynamic/require/re-export/type), `calls` (`new` ham), `renders` (JSX), `references`, `exports` (file→asl deklaratsiya; barrel/`export *` shaffof), `tests` (test→import qilingan fayl; *hosila*, saqlanmaydi).
- **Edge maydonlari:** `confidence`, `count`, `evidence{file,line,col}`, `via` (`type`, `new`, `dynamic`, `require`, `re-export`, `export *`, `member-of-declaration`).
- `depends_on` alohida saqlanmaydi — `imports` dan hosil bo'ladi (drift bo'lmasligi uchun).
- **SQLite** (`node:sqlite`, WAL): `meta`, `files(path, hash, size, parsed JSON)`, `semantic(path, JSON)`, FTS5 `code_fts(name, tokens, body)`. Sxema versiyasi `PRAGMA user_version`; keshdir, eskirsa tashlanadi.

## Semantik tahlil (graph/semantic.ts)

1. Fayllar **eng yaqin tsconfig/jsconfig** bo'yicha guruhlanadi; `tsconfig.json` faqat `references` bersa (Vite shabloni), fayl qaysi ma'lumotnomadagi config'ga tegishli bo'lsa o'shani oladi.
2. **Import edge'lari** (`ts.resolveModuleName`, guruh opsiyalari bilan): `paths`/`baseUrl`/`.js→.ts`/workspace symlink'lar; repo ichidagi haqiqiy fayl → edge; `node_modules` → tashqi paket; alias-ga o'xshash hal bo'lmaganlar (`@/`, `~/`, `#`) → `unresolved-module`; asset (`.css`, `.svg`…) → o'tkazib yuboriladi.
3. Har guruh uchun bitta **`ts.Program`** (`noResolve`, `types: []`, `lib: es2022`) + boshqa guruhlardan import yopilmasi (extra root'lar, tahlil qilinmaydi). Repo kodi hech qachon bajarilmaydi.
4. Har fayl AST'i kezib chiqiladi: `calls` (callee identifikatori), `renders` (JSX tag), `references` (qolgan identifikatorlar, shorthand va destrukturizatsiya ham). Maqsad `checker.getSymbolAtLocation` → alias bo'lsa `getAliasedSymbol` → deklaratsiya → bizning node (eng ichki symbol, joylashuv bo'yicha). Aniq mos = `verified`; faqat ichida joylashgan (obyekt a'zosi) = `possible`.
5. `exports`: `getExportsOfModule` → asl deklaratsiya (re-export va `export *` zanjirlari avtomatik shaffof).
6. Parser yiqitgan fayllar Program'ga kiritilmaydi; guruh darajasidagi xato `analysis-failed` bilan izolyatsiya qilinadi.

## Incremental (graph/engine.ts)

`full` | `incremental` | `noop`. Fayl hash'i (sha256) farq qilsa → qayta parse. Semantika: o'zgargan fayllarning **teskari tranzitiv import yopilmasi** qayta hisoblanadi (fayl natijasi faqat o'z import yopilmasidagi fayllarga bog'liq — shuning uchun to'g'ri). Quyidagilarda **to'liq**: birinchi marta, tsconfig/jsconfig o'zgargan, fayl qo'shilgan/o'chirilgan. Invariant: `incremental ≡ full` (testlar, jumladan mutatsiya bilan).

## Impact (impact/analyze.ts)

1. **Nima o'zgardi:** `git diff -M60% --unified=0 --relative` (+ ishchi katalogda untracked). Hunk ↔ symbol (eng ichki) kesishuvi; eski fayl `git show base:path` → parse → symbol'lar solishtiriladi: `added | removed | modified (faqat tana) | signature-changed`. Symbol'ga tushmagan hunk → fayl darajasidagi o'zgarish (o'chirilgan symbol qoldirgan "teshik" hisobga olinmaydi).
2. **Seed'lar va chuqurlik:** tana o'zgarishi ≤ 2; imzo o'zgarishi/o'chirish ≤ 4; fayl-darajasi o'zgarish = 1 (faqat bevosita importerlar); o'chirilgan/ko'chirilgan fayl = 1 (importerlar).
3. **Teskari BFS** `calls | renders | references` bo'ylab; fayl node'iga yetilsa (top-level ishlatish) importerlarga davom etadi (`possible`); test fayl — barg. Yo'l pointerlari bilan dalil zanjiri tiklanadi. Limit: `maxNodes` (kesilsa belgilanadi).
4. **Eski holat graph'i** (`git archive` snapshot) faqat o'chirilgan/ko'chirilgan narsalar bo'lganda quriladi. `range` rejimida "yangi" tomon ham ishchi katalog emas, commit snapshot'i.
5. **Testlar:** `direct-use` | `transitive` | `imports-only`; `untested` = o'zgargan symbol'ga test yetmagan.
6. **Noaniq:** `unresolved`/`broken-import`/`parse-error`/`not-analyzed`/`truncated`/ogohlantirishlar.
7. `confidence` = bog'lanish dalili (butun yo'l statik isbotlangan → `verified`), xato bo'lish ehtimoli emas.

## Retrieval va AI

Retrieval: (1) savoldagi aniq identifikator mosligi, (2) FTS5 (nom/yo'l/tana), (3) yuqori ballli symbol'larning graph qo'shnilari → chunk'lar (haqiqiy manba satrlari) + faktlar (`A calls B [fayl:satr]`). AI: `AiProvider.complete()`; rozilik darvozasi → redaction → wrapper'li prompt → javob → iqtiboslarni tekshirish (`unsupportedRate`). Provayder yo'q/rozilik yo'q → `evidence-only`.

## Server API (127.0.0.1, token)

`GET /api/state` · `POST /api/open|reindex` · `GET /api/files|search|node|neighborhood|source|refs` · `POST /api/impact|ask` · `GET /api/ai/consent-text` · `POST /api/ai/enable`. Xatolar: `HttpError`, `GitError`→400. Xavfsizlik jadvali — `SECURITY.md`.

## UI

Uch asosiy ekran + savol: Repozitoriy (indeks hisoboti: o'tkazib yuborilganlar/hal bo'lmaganlar/sintaksis xatolari ochiq), Graph Explorer (qidiruv, filtr, N-hop mahalla ≤ 500 node, tafsilot, manba), Change Impact (diff manbasi, bevosita/bilvosita/testlar/noaniq, dalil yo'li grafigi + manba, Markdown/JSON eksport), Savol (dalillar, iqtiboslar `ok/bad`, "nima yuboriladi", rozilik oqimi). Loading/empty/error/partial holatlari mavjud (E2E bilan tekshirilgan).

## Runtime

Build bosqichi yo'q: Node TypeScript'ni to'g'ridan-to'g'ri ishga tushiradi (type-stripping). Shu uchun `erasableSyntaxOnly` yoqilgan (constructor parameter property, enum, namespace taqiqlangan — typecheck ushlaydi). Faqat web `vite build` qiladi.
