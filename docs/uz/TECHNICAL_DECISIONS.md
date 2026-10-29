# Texnik qarorlar jurnali (ADR)

✅ amalga oshirilgan va tasdiqlangan · 🟡 vaqtinchalik / o'lchov kutadi. Sana: 2026-10-28.

## Muhit
Node v26.11, pnpm 12, git 2.56; disk joyi kam edi — shu sababli bog'liqliklar minimal, real repolar nusxalanmadi (faqat kichik nusxa incremental o'lchovi uchun).

## Asosiy qarorlar

**ADR-1 ✅ TypeScript monorepo (pnpm workspaces).** Tahlil va UI bir tilda.

**ADR-2 ✅ `typescript@~6.0` pin — TS 7 emas.** `typescript@7` (hozirgi `latest`) Go'dagi native kompilyator; `require('typescript')` klassik Compiler API bermaydi (faqat `typescript/unstable/*`). X-Ray tahlil qilinayotgan loyihaning TS versiyasidan mustaqil (o'z nusxasini ishlatadi). Parser/graph interfeysi ortida — TS 7 API barqarorlashganda almashtirish lokal. `ts-morph` ishlatilmadi (o'z TS nusxasini bundle qiladi; xom API o'rganish uchun foydali).

**ADR-3 ✅ UI: Vite + React SPA + lokal HTTP server (Next.js emas).** SSR/routing/deploy kerak emas; fayl tizimi uchun Node server baribir kerak. E2E bilan isbotlangan.

**ADR-4 ✅ Graph vizualizatsiya: Cytoscape.js.** Yuzlab node, filtr, mahalla, yo'lni yoritish; canvas; layout'lar ichida. React Flow — editor/diagramma uchun, node ichida React kerak emas. 🟡 Stress: mahalla serverda 500 node bilan cheklangan; undan kattasi o'lchanmagan.

**ADR-5 ✅ Saqlash: `node:sqlite` (WAL + FTS5).** Spike: FTS5 ishladi; qo'shimcha native bog'liqlik yo'q. `better-sqlite3` kerak bo'lmadi.

**ADR-6 ✅ Git: CLI + `execFile`.** `--unified=0`, `-M60%`, `--relative`, `-z` name-status. Himoya: `SECURITY.md`. `git worktree` ishlatilmaydi (repo metama'lumotini o'zgartiradi) — o'rniga `git archive | tar -x` snapshot.

**ADR-7 ✅ Test: Vitest + Playwright (tizim Chrome'i, `channel: 'chrome'`).** Brauzer yuklash shart emas.

**ADR-8 ✅ Node ID'lar satr raqamisiz; `#` yo'lda bo'lishi mumkin** (`splitNodeId` oxirgi `#`dan bo'ladi — testda `we#ird.ts`).

**ADR-9 ✅ `calls` faqat type-resolve bo'lsa.** Nom bo'yicha taxmin edge'i yaratilmaydi; `obj[expr]()` → `computed-call` (unresolved).

**ADR-10 ✅ `depends_on` saqlanmaydi** — `imports`dan hosil bo'ladi.

**ADR-11 ✅ Server: xom `node:http`** (Hono/Fastify emas). ~12 marshrut, dependensiyasiz; xavfsizlik chegaralari ko'rinib turadi.

**ADR-12 ✅ AI default o'chiq; rozilik + redaction + iqtibos tekshiruvi; vektor DB yo'q.** FTS5 + graph qidiruvi yetarlimi — real LLM o'lchovi yo'q ⇒ hali hal qilinmagan (🟡).

## O'lchov va real repolar natijasida qabul qilingan qarorlar

**ADR-13 ✅ Eng yaqin tsconfig/jsconfig bo'yicha guruhlash + `references` delegatsiyasi + import-yopilma extra root'lari.** Sabab (real topilma): Vite shablonida `paths` `tsconfig.app.json`da; faqat `tsconfig.json`ni o'qish `@/…` import'larining 160+ tasini jimgina "tashqi paket" qilib yuborgan (private project C: 1385 → 3164 edge). Monorepo: workspace symlink `isExternalLibraryImport` bo'lsa ham haqiqiy fayl repo ichida — endi edge.

**ADR-14 ✅ Alias-ga o'xshash hal bo'lmagan import (`@/`, `~/`, `#`) jim "tashqi paket" emas, `unresolved-module`.** Spetsifikatsiyadagi "yashirmang" tamoyili.

**ADR-15 ✅ Minimal lib (`lib.es2022.d.ts`), `noLib` emas.** Real topilma: `noLib` bilan `Promise` turi yo'q → `await import()` destrukturizatsiyasi va `.then(m => m.X)` orqali bog'lanishlar tushib qolgan (private project C'da 24 ta yo'qotish; narxi ≈ +150 ms).

**ADR-16 ✅ Shorthand `{ foo }` va `const { foo } = …` ham `references`.** Oracle taqqoslashi topdi (the second private project: 3 yo'qotish).

**ADR-17 ✅ Obyekt a'zosi murojaati → `possible` (`member-of-declaration`).** a'zo graph'da node emas; o'rab turgan e'londa chiqariladi, `verified` deb da'vo qilinmaydi.

**ADR-18 ✅ Impact chuqurlik siyosati.** Tana-faqat ≤ 2 (xulq ta'siri uzoqqa ketmaydi — shovqinni kamaytirish), imzo/o'chirish ≤ 4, fayl-darajasi = 1. Birinchi variantda fayl-darajasi o'zgarish importerlarning importerlariga tarqalar edi — S6 ssenariysi buni ushladi.

**ADR-19 ✅ O'chirilgan symbol qoldirgan "teshik" fayl-darajasi o'zgarish emas.** S3 ssenariysi ushlagan (aks holda `index.ts` va 5 ta soxta element chiqardi).

**ADR-20 ✅ Incremental = o'zgargan fayllarning teskari tranzitiv import yopilmasi; fayl qo'shish/o'chirish yoki config o'zgarishi → to'liq.** Mutatsiya bilan isbotlangan: yopilma faqat o'zgargan faylga qisqartirilsa, `export *` barrel orqali ikki qadam narida yangi nom paydo bo'lish testi yiqiladi.

**ADR-21 ✅ Indeks repo ichida emas** (`~/.cache/xray/<hash>/`). Repo toza qoladi (test bilan tasdiqlangan).

**ADR-22 ✅ Parser/Program xatosi jarayonni qulatmaydi, lekin yashirilmaydi** (`parseFailed`, `analysis-failed`). Real topilma: 60 000 qavatli fayl `ts.createProgram` ichida stack overflow berib butun guruhni yiqitgan.

**ADR-23 ✅ Aniqlik mustaqil oracle bilan o'lchanadi (tsserver `findReferences`)**, nazorat tajribasi bilan (graph buzilsa recall 0.29). Chegaralari `BENCHMARKS.md`da.

**ADR-24 ✅ Build'siz runtime** (Node type-stripping) + `erasableSyntaxOnly`. Vitest parameter-property'larni yutardi, oddiy `node` yutmasdi — CLI ishga tushganda aniqlandi; endi typecheck ushlaydi.

**ADR-25 ✅ Next.js marshrutlari yo'l konventsiyasidan (kod bajarilmaydi).** Faqat Next.js loyihasida (`next` dependency / `next.config.*`) — aks holda `src/pages/` (React Router) noto'g'ri marshrut bo'lardi (testda tekshirilgan). Layout/middleware ta'siri: layout faqat o'z papkasi ostidagi **sahifalar**ga (route handler'ga emas), middleware hammasiga. Natija **dedup** qilinadi (bir marshrut fayli — bir marta, eng kuchli sabab bilan): birinchi variantda bir sahifa bir necha layout orqali takror sanalib, 14 sahifali repoda 45 "marshrut" chiqqan.

**ADR-26 ✅ Panel maketi: o'zimiz yozgan `SplitLayout` (kutubxonasiz).** Pointer capture + klaviatura + localStorage + tor ekranda drawer; markaz minimumi. Yangi dependency kerak bo'lmadi.

**ADR-27 ✅ `oldProgram` qayta ishlatilmadi.** Ko'rib chiqildi: foyda faqat uzoq yashaydigan server jarayonida (CLI'da yo'q) va `SourceFile` keshini ham talab qiladi; hozirgi o'lchov (leaf o'zgarish ≈ 0.9 s) uchun murakkablikka arzimaydi. Foydalanuvchi shikoyat qilsa qayta ko'riladi.

**ADR-28 ✅ Workspace paketlari `package.json` `name` → `paths` orqali (`src/` birinchi, so'ng papka).** Real topilma (`dub`): `node_modules` yo'q va `main` → `dist` bo'lgani uchun 1100+ cross-package import "tashqi" bo'lib, paketlararo graph yo'q edi. Mavjud tsconfig `paths` yozuvlari ustun; `baseUrl` QO'YILMAYDI (bare import'larni repo ildiziga siljitadi — testda tekshirilgan), o'rniga `pathsBasePath`. Workspace ro'yxati cache fingerprint'iga kiradi.

**ADR-29 ✅ Nom bo'yicha "maxfiy" qoidasi faqat manba bo'lmagan fayllarga.** `secret.ts`/`credentials.ts` real kod (webhook secret generatori kabi); ularni tashlab yuborish graph'dan kod yo'qotadi. Qiymatlar redaksiya orqali himoyalanadi (AI), `.env*`/kalit/sertifikat fayllari esa har doim indekslanmaydi.

**ADR-30 ✅ i18n: kutubxonasiz ikki katalog.** Backend (`core/i18n.ts`): kalit + `{param}`; hisobot/xato matnlari so'rov tilida yasaladi (UI har so'rovga `x-xray-lang` qo'shadi). Tildan **mustaqil kodlar** (`reasonCode`, `GitError.code`, `ScanLimitError.code`) — UI/server matnni o'z tilida yasaydi. Rozilik matni serverda **ikkala tilda** qabul qilinadi. UI (`apps/web/src/i18n.tsx`): ikki katalog `Record<UIKey,string>` bilan (kalit yetishmasa — kompilyatsiya xatosi), `` `kod` `` va `**qalin**` belgilari xavfsiz renderlanadi (HTML yo'q). Testlar: katalog paritet (kalit + `{placeholder}`), inglizchada o'zbekcha so'z yo'qligi (barcha ekran/tab bo'yicha E2E), til almashganda server matnlari qayta yasalishi. Standart til `uz` — mavjud testlar/CLI buzilmasligi uchun (bir konstantani o'zgartirib `en`ga o'tkaziladi).

**ADR-31 ✅ Video: o'z kadr yig'uvchi (CDP screencast + ffmpeg), `recordVideo` emas.** Playwright `recordVideo` past bitrate VP8, `page.screencast` esa kadrni CSS o'lchamida beradi (DSF e'tiborga olinmaydi) → matn yumshoq. Chrome `--force-device-scale-factor=2` + CDP `Page.startScreencast` 2560×1440 JPEG beradi; kadrlar ffmpeg'ga 30 fps "pacer" bilan yuboriladi (video davomiyligi devor soatiga aniq → ovoz bilan sinxron). Har sahna **ovoz uzunligiga bog'langan** (avval ovoz sintez qilinadi, keyin yozuv shunga moslanadi). Render: YouTube — 2560→1920 lanczos (supersampling); Reels — har sahna uchun alohida yaqinlashtirilgan kesim + IG xavfsiz zonalari + kuyilgan izohlar. Musiqa **doimiy daraja** (ducking yo'q), ikki o'tishli loudnorm −14 LUFS. Sifat: yakuniy aralashma Whisper'dan o'tkazildi (0.0% xato).

## Spetsifikatsiyaga dastlabki tanqidning holati

| Dastlabki xavf | Holat |
|---|---|
| Juda ambitsiyali (6+6 tur, incremental, AI, 3 ekran) | Hammasi qilindi, lekin tartib o'zgartirildi: Impact(CLI) → UI → AI |
| Changed-symbol (hunk↔AST) noaniq | Qilindi: eng ichki symbol, imzo/tana farqi; format-only/rename cheklovi `KNOWN_LIMITS` |
| "Test intelligence" overclaim | `direct-use/transitive/imports-only` + "qamrov emas" izohi |
| Monorepo, Next.js `app/` router, `import type`, ko'p tsconfig | Hammasi ✅ (Next.js marshrutlari: ADR-25; qolgan framework tafsilotlari `KNOWN_LIMITS` #1) |
| Eskirgan indeks | Hash + config fingerprint; stale aniqlash UI'da "reindex" |
| Natijalarni eksport | Markdown + JSON ✅ |
| Performance (bitta Program) | O'lchandi: 1267 fayl 3 s/460 MB; 10k+ sinalmagan |
| Xavfsizlik | `SECURITY.md`, har bir band testlangan |
