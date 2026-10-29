# Benchmarklar

Hamma raqam `bench/` skriptlari bilan **haqiqatan o'lchangan**. Xom natijalar `bench/results/*.json`ga yoziladi, lekin git'ga kiritilmaydi (muallifning xususiy loyihalaridagi ichki fayl yo'llarini o'z ichiga oladi) — skriptlar bilan qayta hosil qilinadi. Hech narsa taxmin yoki to'qima emas.

## Muhit

| | |
|---|---|
| CPU | AMD Ryzen 5 8645HS (12 oqim) |
| RAM | 15 GB |
| OS | Linux 7.2.9-arch1 |
| Node | v26.11.1, TypeScript 6.0.3 |
| Sana | 2026-10-28 |

Sinov loyihalari: muallifning o'z repolari (private project A, private project B, private project C, private project D, private project E) va **3 ta ochiq Next.js repo** (`shadcn-ui/taxonomy`, `vercel/commerce`, `vercel/platforms`; `--depth 60` klon). ⚠️ Ochiq repolarda `node_modules` o'rnatilmagan (repo kodi bajarilmaydi/o'rnatilmaydi): tashqi paket turlari (masalan React) yo'q, shuning uchun ularda tsserver oracle ham, X-Ray ham faqat repo ichidagi bog'lanishlarni ko'radi.

## 1. Indekslash (sovuq, keshsiz) — `pnpm bench:index`

| Loyiha | Fayl | Node | Edge | Vaqt | Maks. RSS |
|---|---:|---:|---:|---:|---:|
| private project D | 70 | 286 | 1 020 | 0.55 s | 231 MB |
| private project C | 165 | 1 039 | 3 164 | 1.29 s | 300 MB |
| private project B | 257 | 2 096 | 8 471 | 1.70 s | 349 MB |
| private project E | 73 | 459 | 648 | 2.47 s | 384 MB |
| private project A | 1 267 | 5 150 | 15 202 | 3.12 s | 460 MB |
| *ochiq* **dub** (monorepo, Next.js, 2207 fayl) | 2 207 | 7 302 | 26 405 | 5.3 s | 817 MB |
| *ochiq* taxonomy | 129 | 518 | 1 232 | 0.47 s | 220 MB |
| *ochiq* commerce | 66 | 258 | 698 | 0.34 s | 196 MB |
| *ochiq* platforms | 21 | 86 | 172 | 0.20 s | 168 MB |

Izoh: `private project E` 73 fayl uchun nisbatan sekin — manba kodda katta fayllar bor; sababi alohida o'rganilmagan. `generated-bundle` evristikasi qo'shilmaguncha bu repo 427 fayl/10 s ko'rsatgan edi (commit qilingan Vite build'lar).

## 2. Incremental (private project A nusxasi, 1267 fayl) — `bench/incremental-bench.ts`

| Amal | Vaqt | Parse | Semantika qayta hisoblandi |
|---|---:|---:|---:|
| Sovuq (db yozish bilan) | 3.80 s | 1267 | 1267 |
| Hech narsa o'zgarmagan | 0.15 s | 0 | 0 |
| Bitta barg fayl (import qiluvchisi yo'q) | 0.95 s | 1 | 1 |
| Hub fayl (175 ta bevosita importer) | 1.79 s | 1 | 325 |
| To'liq (keshsiz) | 2.79 s | 1267 | 1267 |

Halol izoh: parse va semantik edge'lar faqat kerakli fayllar uchun qayta hisoblanadi, lekin TypeScript `Program` har safar qayta quriladi (≈0.8 s) — shuning uchun barg faylda ham ~1 s. Kelajakda `oldProgram` qayta ishlatish shu vaqtni kamaytirishi mumkin (hali o'lchanmagan).

## 3. Bog'lanish aniqligi — `pnpm bench:accuracy`

**Oracle:** TypeScript `LanguageService.findReferences` (tsserver'ning o'zi). **Namuna:** loyihadagi eksport qilingan funksiya/komponent/hook/class/variable'larning *hammasi* (test fayllaridan tashqari). **Taqqoslash darajasi:** fayl — "bu symbol'ni qaysi *boshqa* fayllar ishlatadi?" (import/export specifier'lar oracle'dan chiqarib tashlangan).

| Loyiha | Symbol | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|
| private project A — barcha edge'lar | 1 770 | 4 024 | 33 | 0 | 0.9919 | 1.0000 |
| private project A — **faqat `verified`** | 1 770 | 4 024 | **0** | 0 | **1.0000** | **1.0000** |
| private project B — barcha | 860 | 2 186 | 3 | 0 | 0.9986 | 1.0000 |
| private project B — **`verified`** | 860 | 2 186 | **0** | 0 | **1.0000** | **1.0000** |
| private project C | 301 | 720 | 0 | 0 | 1.0000 | 1.0000 |
| private project D | 52 | 186 | 0 | 0 | 1.0000 | 1.0000 |
| *ochiq* taxonomy | 271 | 289 | 0 | 0 | 1.0000 | 1.0000 |
| *ochiq* commerce | 109 | 127 | 0 | 0 | 1.0000 | 1.0000 |
| *ochiq* platforms | 51 | 44 | 0 | 0 | 1.0000 | 1.0000 |

**FP lar nima?** Hammasi `possible` deb belgilangan: obyekt literali a'zosiga (`OPTIONS.x`) murojaat e'lon qilingan o'zgaruvchiga bog'lanadi (`via: member-of-declaration`). Oracle bunday murojaatni o'zgaruvchining o'ziga emas, a'zoga hisoblaydi. Bu ataylab: ular `verified` emas, `possible` deb ko'rsatiladi.

**Nazorat tajribasi (harness sezgirmi?):** graph'dan `renders` va `references` ataylab olib tashlansa (`XRAY_CONTROL=calls-only`), private project A namunasida recall **0.287** ga tushdi — demak o'lchov haqiqatan nuqsonni ushlaydi.

**Bu o'lchov nimani isbotlamaydi:**
- Oracle ham TypeScript binder/checker'iga tayanadi → u X-Ray'ning *yig'ish va xaritalash mantig'i* (identifikatorlarni kezish, alias/barrel, deklaratsiya→node moslash) to'liqligini tekshiradi; TypeScript'ning o'zi ko'rmaydigan narsalarni (dinamik, framework, satr orqali bog'lanish) emas.
- Fayl darajasi — symbol-darajadagi evidence satrlarini emas.
- private project E'da tsconfig yo'q — oracle uchun ishlatilmadi.

## 4. Real Git tarixida Impact (barqarorlik) — `pnpm bench:replay`

Har loyihaning oxirgi 15 ta (merge'siz) commit'i, har biri `sha~1...sha` (ikki snapshot + indeks + tahlil):

| Loyiha | Commit | Xato | Median | Maks. | Kesilgan | Buzuq yo'l |
|---|---:|---:|---:|---:|---:|---:|
| private project A | 15 | 0 | 3.41 s | 6.74 s | 0 | 0 |
| private project B | 15 | 0 | 1.27 s | 1.82 s | 0 | 0 |
| private project C | 15 | 0 | 1.08 s | 2.30 s | 0 | 0 |
| *ochiq* taxonomy | 15 | 0 | 0.28 s | 1.02 s | 0 | 0 |
| *ochiq* commerce | 15 | 0 | 0.19 s | 0.68 s | 0 | 0 |
| *ochiq* platforms | 15 | 0 | 0.22 s | 0.83 s | 0 | 0 |

Bu **aniqlik emas**, barqarorlik sinovi: real o'zgarishlarda qulash/xato bo'lmadi va har bir natija elementi o'z dalil yo'liga ega. Impact natijalari (qaysi fayllar ta'sirlanadi) uchun insonlar tomonidan belgilangan ground truth hali yo'q — bu qiymat yuqoridagi reference-aniqligi va fixture testlari bilan *bilvosita* tasdiqlangan.

## 4b. Next.js marshrutlari — `find` bilan solishtirish

Ochiq repolarda aniqlangan marshrut fayllari soni mustaqil `find` bilan solishtirildi (bir xil): taxonomy 14 `page` / 8 `layout` / 6 `route` / 1 `pages/api`; commerce 5 / 3 / 1; platforms 3 / 1 / 0 (+ `proxy.ts` middleware). Fixture (`fixtures/next-app`) uchun qo'lda yozilgan marshrut jadvali (11 fayl) va 6 ta ta'sir ssenariysi (nested/root layout, middleware, `pages/_app`, o'zgargan sahifa) aynan mos.

### Masshtab: ochiq monorepo `dubinc/dub` (2207 fayl, `apps/web` + 9 paket)

- Indeks: 5.3 s, 817 MB RSS (ikki marta o'lchandi: 5.35 / 5.23 s). Skaner `git ls-files` bilan aynan teng (2207).
- Marshrutlar `find` bilan aynan mos: 77 `page`, 23 `layout`, 210 `route.ts`, 5 `loading`, 1 `not-found`, 1 middleware.
- **Cross-package bog'lanish:** `node_modules` o'rnatilmagan va paketlar `main`i `dist`ga ishora qiladi; workspace paketlari `package.json` `name`idan `src/`ga resolve qilinmaguncha `@dub/utils` (756 fayl) va `@dub/ui` (404 fayl) "tashqi" hisoblangan, paketlararo import edge'i atigi 1 ta edi → hozir 1191 ta (jami edge 21 503 → 26 405).
- Impact (scratch klonda `cn()` qaytish turi qo'shildi, keyin tiklandi): 399 bevosita (apps/web 258, packages/ui 141), 92 marshrut, ~5 s; natija 500 elementda kesildi va **bunday deb belgilandi** (`truncated`).
- Bu loyihada aniqlik (oracle) o'lchanmadi: `node_modules`siz paket turlari yo'q, oracle ham ko'r.

### Skaner topilmasi (dub'da)
`lib/webhook/secret.ts`, `utils/secrets.ts` kabi **manba fayllar** faqat nomi sababli "maxfiy" deb o'tkazib yuborilgan edi. Endi nom bo'yicha qoida faqat manba bo'lmagan fayllarga (`secrets.json`, `credentials.yml`, kengaytmasiz) qo'llanadi; `.env*`, `*.pem`, `*.key`, `id_rsa*` va h.k. har doim maxfiy. Kod ichidagi qiymatlarni AI redaksiyasi tutadi.

## 5. Qo'lda yozilgan ground truth (fixture)

- `fixtures/react-app/expected-graph.json`: imports, calls, renders, references, tests, exports — 6 turning hammasida **aynan moslik** (yetishmaydigan ham, ortiqcha ham yo'q).
- Impact: 6 ssenariy (tana o'zgarishi, imzo o'zgarishi, o'chirish, siklik fayl o'chirish, fayl-darajasi o'zgarish, qayta nomlash): **precision = recall = 1.0**.
- Halol izoh: ssenariylarning ikkitasi (S3, S6) birinchi yurishda yiqildi; ikkalasida ham aybdor kodning dizayn xatosi edi (o'chirishdan qolgan "teshik" fayl-darajasi o'zgarish deb sanalgan; fayl-darajasi o'zgarish importerlarning importerlariga tarqalgan) — kutilgan ro'yxat o'zgartirilmadi, kod tuzatildi.

## 6. Test hajmi

147 unit/integratsiya testi (15 fayl) + 30 brauzer E2E. `pnpm check`.

## Qanday takrorlash

```bash
pnpm bench:index  <papka>/<repo> ...
pnpm bench:accuracy <papka>/<repo> <tsconfig> 5000
pnpm bench:replay <papka>/<repo> 15
node bench/incremental-bench.ts <repo-nusxasi>
```
