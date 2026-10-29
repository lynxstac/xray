# Ma'lum cheklovlar

Bu ro'yxat ataylab ochiq yozilgan: har bir band — tahlil nimani **ko'rmasligi** yoki nimani **isbotlamasligi**. Tuzatilgan narsalar `docs/TECHNICAL_DECISIONS.md`da.

## Statik tahlil ko'rmaydigan bog'lanishlar

1. **Framework yashirin ulanishlari.** Next.js marshrutlari (App/Pages Router, layout, middleware) fayl yo'lidan **modellashtirilgan** (Impact: "ta'sirlanishi mumkin marshrutlar"). Modellashtirilmagan: `use client`/`use server` chegaralari, parallel/intercepting route'larning o'ziga xos xulqi (faqat URL'dan chiqariladi), `generateStaticParams`/`revalidate`, Server Actions chaqiruvlari, `next.config` redirect/rewrite'lari, Remix/Nuxt/SvelteKit va boshqa frameworklar. Layout "hamma sahifaga" qo'llanadi deb hisoblanadi (nested layout'larni inobatga olib, lekin `loading`/`error` chegaralari aniq emas).
2. **Dinamik/satr orqali bog'lanish.** `import(expr)`, `require(expr)`, `obj[key]()` — `unresolved` sifatida **belgilanadi** (yashirilmaydi). Hodisa nomlari, DI konteynerlari, i18n kalitlari, CSS class'lari, route satrlari, `eval` — kuzatilmaydi va belgilanmaydi.
3. **Bundler-only alias.** Faqat `vite.config.ts`/webpack'da aniqlangan alias (tsconfig/jsconfig'da yo'q) hal bo'lmaydi: `@/…`, `~/…`, `#…` ko'rinishidagilar `unresolved-module` bo'lib hisobotga tushadi. Config'ni bajarib o'qimaymiz (xavfsizlik).
4. **Paket `exports`/build natijasi.** Workspace paketlari `package.json` `name`idan resolve qilinadi (avval `src/`, so'ng papkaning o'zi; `exports` xaritasi hisobga olinmaydi). Manbasi `src/`da emas (faqat `dist`da yoki nostandart joyda) paket tashqi deb qoladi. Haqiqiy npm paketlar (`node_modules`) hech qachon tahlil qilinmaydi.
5. **TS/JS fayllar tilidan boshqasi.** `.vue`, `.svelte`, `.astro`, `.mdx` parse qilinmaydi (ularga import "asset" sifatida o'tkazib yuboriladi).

## Aniqlik haqidagi cheklovlar

6. **Obyekt a'zosi → `possible`.** `OPTIONS.x` kabi murojaat e'lon qilingan o'zgaruvchiga bog'lanadi va `possible` belgilanadi (a'zo graph'da alohida node emas). Obyekt-literal metodlari va class property-arrow'lar alohida symbol emas — ichidagi chaqiruvlar o'rab turgan symbol'ga yoziladi.
7. **Aniqlik o'lchovi mustaqil emas to'liq.** Oracle (tsserver `findReferences`) ham TypeScript checker'iga tayanadi; u **ekstraksiya** to'liqligini o'lchaydi, tilning tahlil chegaralarini emas. Fayl darajasida, faqat eksport qilingan symbol'lar.
8. **Impact natijalari uchun inson-belgilagan ground truth yo'q** (real loyihalarda). Real repolarda faqat barqarorlik (qulamaslik, dalil yo'lining mavjudligi) va reference-aniqligi o'lchangan.
9. **Ochiq repolarda sinov kichik:** 3 ta ochiq Next.js repo (taxonomy, commerce, platforms; jami 21–129 fayl) `node_modules`siz sinalgan. Katta ochiq monorepolar (Cal.com, Next.js'ning o'zi kabi) sinalmagan.
10. **O'zgarish turi evristikasi.** Imzo = parametrlar + qaytish turi matni; farq = "imzo o'zgargan". Format-only o'zgarish `modified` bo'lib ko'rinadi; qayta nomlangan symbol = `removed` + `added`. Ko'chirilgan symbol (fayl rename'ida nomi o'zgarmasa) mos keltiriladi.
11. **Tana-faqat o'zgarish chuqurligi ≤ 2** (konfiguratsiya qilinadi). Ya'ni tana o'zgarishining 3+ qadamdagi xulq ta'siri tarqatilmaydi — bu sifat/shovqin kelishuvi; o'zgartirish mumkin, lekin shovqin oshadi.
12. **Testlar.** "Bog'liq test" = test kodi o'zgargan elementni import/ishlatadi. Bu **qamrov** emas. `untested` = "chuqurlik chegarasida test topilmadi".
13. **Staged rejimi** graph'ni ishchi katalogdan quradi (hisobotda ogohlantirish bor). Index snapshot'ini olish Git obyekt bazasiga yozishni talab qilardi (read-only qoidasiga zid).

## Masshtab va ishlash

14. **Katta repolar.** Eng kattasi sinalgan: 2207 fayl (ochiq `dub` monorepo: 817 MB RSS, 5.3 s). 10k+ fayllik monorepo sinalmagan (RSS taxminan fayl soniga chiziqli o'sadi: ~0.37 MB/fayl) — bitta `ts.Program` guruh uchun xotirani ko'p oladi. Himoya: fayl limiti 1 MB, diff limiti 3000 fayl, impact natijasi 500 elementda kesiladi (belgilanadi).
15. **Incremental** parse va semantikani qisman qayta hisoblaydi, lekin `Program` har safar qayta quriladi (~0.8 s). Fayl **qo'shilsa/o'chirilsa** — to'liq qayta qurish (resolve o'zgarishi mumkin). `tsconfig` `extends` zanjiridagi o'zgarish keshni bekor qilmaydi → `--full`.
16. **Graph UI** 500 node'dan katta mahallada o'lchanmagan (server 500 bilan cheklaydi). Cytoscape uchun alohida stress sinov o'tkazilmagan.

## AI

17. **Haqiqiy LLM provayder bilan sifat o'lchanmagan.** Testlar lokal soxta provayder bilan: yuboriladigan narsa, rozilik darvozasi, redaction, iqtibos validatsiyasi tekshirilgan; javob *sifati* va asossiz da'vo ulushi real modelda o'lchanmagan.
18. **Redaction naqsh asosida** (kalit/token/JWT/private key/URL parol/`secret = "..."`). 100% kafolat emas; maxfiy ma'lumot boshqa ko'rinishda bo'lsa o'tib ketishi mumkin.
19. **Iqtibos validatsiyasi** fayl va satr diapazonining *berilgan kontekstga mosligini* tekshiradi, da'voning *haqiqiyligini* emas.
20. **Vektor DB yo'q.** Retrieval = nom mosligi + FTS5 + graph qo'shnilari. Semantik (ma'no bo'yicha) qidiruv zaif: so'z kodda uchramasa topilmaydi.

## Platforma

21. Faqat Linux'da sinalgan (yo'l ajratgichlari, `tar`, `git archive`). Windows/macOS'da ishlashi tekshirilmagan.
22. Demo video bor (`docs/demo.mp4`), lekin ovozsiz va ochiq `taxonomy` repo'sida bitta commit bo'yicha.
23. **Telefon** (390 px) maketi tekshirilgan (E2E), lekin graf kichik ekranda siqiq; real qurilmada sinalmagan.
25. **Server indekslash paytida javob bermaydi.** Indekslash asosan sinxron CPU ishi (TypeScript Program) — shu vaqtda (katta repoda ~5 s) boshqa so'rovlar navbatda turadi. UI "Indekslanmoqda…" ko'rsatadi; to'g'ri yechim — `worker_threads` (hali qilinmagan). `open` atomik: yangi indeks xato bersa eski repo ishlashda qoladi.
26. **Himoya chegaralari:** 50 000 manba fayl yoki 600 000 yozuvdan katta papka aniq xato bilan rad etiladi (noto'g'ri papka: `~`, `/`); fayl 1 MB, diff 3000 fayl, impact 500 element.
24. Marshrut aniqlash **yo'l konventsiyasi** asosida; `app`/`pages` papkasi nostandart joyda (`next.config`da `distDir`/custom `pageExtensions`) bo'lsa aniqlanmaydi.
