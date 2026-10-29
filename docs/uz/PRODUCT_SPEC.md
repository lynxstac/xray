# X-Ray — Mahsulot spetsifikatsiyasi

> ✅ amalga oshirilgan · 🟡 qisman / o'lchov kutadi · ❌ ataylab tashqarida. Holat: 2026-10-28.

## Bir jumlada
Lokal ishlaydigan code intelligence: TypeScript/React repozitoriysining haqiqiy kod grafigini quradi va Git diff'dan **"nima o'zgardi → nima ta'sirlanishi mumkin → nimani tekshirish kerak"** hisobotini **dalillar bilan** beradi.

## Muammo
Begona yoki katta loyihada bitta funksiya o'zgarganda: kim uni chaqiradi, qaysi sahifa/test unga bog'liq? Bugun javob `grep` + tajriba + qo'lda o'qish. X-Ray shuni deterministik tahlil bilan qisqartiradi.

## Pozitsiyalash
Kod xaritasi va "kod bilan suhbat" mavjud (IDE "find usages", Sourcegraph, dependency-cruiser/madge, AI IDE indekslari…). X-Ray ustunligi gipotezasi: **change-first** (boshlanish nuqtasi diff), **evidence-first** (har natijada yo'l+satr+ishonch), **local-first**, **o'lchanadigan sifat**. ⚠️ Bu gipoteza — foydalanuvchilar bilan tasdiqlanmagan (ROADMAP: "Validatsiya").

## Foydalanuvchilar
Birlamchi: React/Next.js/TS frontend dasturchilar; yangi repoga kirayotganlar; PR ko'rib chiquvchilar. Keyingi: kichik jamoalar, AI-agent ishlatuvchilar (MCP).

## Ishonch modeli ✅
`verified` (statik isbotlangan) · `possible` (kamida bir bo'g'in taxminiy) · `unresolved` (hal qilib bo'lmaydi, **ochiq ko'rsatiladi**). Hisobot hech qachon "buziladi" demaydi (testda tekshiriladi).

## MVP holati

| # | MVP talabi | Holat |
|---|---|---|
| 1 | Lokal TS/React repo ochish | ✅ CLI + web |
| 2 | Xavfsiz skanerlash, parse | ✅ maxfiy/generated/symlink/hajm; xatolar hisobotda |
| 3 | Fayl, symbol, import/export graph (haqiqiy AST+checker) | ✅ 9 node turi, 6 edge turi (`calls/renders/references/exports/imports/tests`) |
| 4 | Interaktiv Graph Explorer | ✅ zoom/pan, qidiruv, filtr, N-hop mahalla, tafsilot |
| 5 | Graph'dan manbaga o'tish | ✅ satr ajratilgan manba ko'rinishi |
| 6 | Git diff tahlili | ✅ working / staged / range (merge-base), rename/delete/untracked |
| 7 | Dalilga asoslangan impact hisoboti | ✅ bevosita/bilvosita, dalil yo'li, `verified/possible`, noaniqliklar |
| 8 | Bog'liq testlar | ✅ `direct-use/transitive/imports-only` + `untested` (qamrov emas) |
| 9 | AI Q&A manbalar bilan, aniq sozlama ortida | ✅ rozilik, redaction, iqtibos validatsiyasi, `evidence-only`; 🟡 real LLM sifati o'lchanmagan |
| 10 | Testlar, hujjat, takrorlanadigan demo | ✅ 147 + 30 E2E; hujjatlar; `pnpm demo`; demo video (`docs/demo.mp4`) |
| — | Next.js marshrutlari (qaysi marshrutlar ta'sirlanadi) | ✅ App/Pages Router, layout/middleware ta'siri |
| — | Incremental indekslash | ✅ `incremental ≡ full` isbotlangan |
| — | Local-first maxfiylik | ✅ `SECURITY.md` |

## Qabul mezonlari — natijalar
- Fixture graph `expected-graph.json` bilan: **aynan moslik** (6 tur). Impact 6 ssenariy: **P = R = 1.0** (qo'lda ground truth).
- Real 7 loyiha (3414 symbol), mustaqil oracle: `verified` **P = R = 1.0**; barcha edge'lar P ≥ 0.992 (farq — ataylab `possible`).
- Real tarixda 90 commit Impact (7 repo): 0 xato; 3 ta ochiq Next.js repoda ham `verified` P = R = 1.0.
- ❌ Inson-belgilagan Impact ground truth va katta ochiq monorepolarda sinov — bajarilmagan (`KNOWN_LIMITS` #8, #9).

## Tashqarida (ataylab) ❌
Cloud/akkaunt/billing, hamkorlik, enterprise, boshqa tillar (Tree-sitter — keyin), avtonom kod tahriri, VS Code kengaytmasi, MCP server, runtime/trace tahlili, vektor DB, API endpoint/DB jadval node'lari, Tauri desktop (qaror: avval web; desktop core o'zgarishsiz keyin).
