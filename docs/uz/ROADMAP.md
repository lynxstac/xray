# Yo'l xaritasi

> Vaqt jadvali yo'q: tartib va **chiqish mezoni** bor. Holat: 2026-10-28.

## Bajarilgan (hammasi `pnpm check` bilan tasdiqlanadi)

1. Skanerlash va parse (maxfiy/generated/symlink/hajm, sintaksis xatolari ochiq).
2. Graph: type-checker bilan `imports/exports/calls/renders/references/tests`, alias/barrel/`export *`/tsconfig `paths`/`references`/monorepo/workspace symlink.
3. SQLite saqlash + FTS5 + **incremental** (`≡ full`).
4. Xavfsiz Git qatlami va **Change Impact** (symbol-darajali diff, `verified/possible`, dalil yo'li, testlar, noaniqliklar, rename/delete).
5. Retrieval + AI (rozilik, redaction, iqtibos validatsiyasi).
6. Lokal server + web UI (Repozitoriy, Explorer, Impact, Savol) + CLI.
7. Benchmark va aniqlik: mustaqil oracle, real repolar, real tarix, nazorat tajribasi.
8. Ochiq Next.js repolarda sinov (3 repo), Next.js marshrut modeli, telefon maketi, demo video.
9. Hujjatlar: README, ARCHITECTURE, TECHNICAL_DECISIONS, BENCHMARKS, KNOWN_LIMITS, SECURITY, takrorlanadigan demo.

## Keyingi (ustuvorlik tartibida, sababi bilan)

| # | Vazifa | Nima uchun | Chiqish mezoni |
|---|---|---|---|
| 1 | **Foydalanuvchi validatsiyasi** (5–10 dasturchi, o'z repolarida) | Eng katta noaniqlik — mahsulot kerakmi, texnika emas | "Bu bo'lmasa nima qilardingiz, qancha vaqt ketardi?" javoblari; qaysi funksiya real muammo hal qiladi |
| 2 | ~~Ochiq Next.js repolarda sinov~~ ✅ (3 kichik repo). **Qoldi:** katta ochiq monorepolar (Cal.com, Next.js'ning o'zi) | Masshtab/xotira noma'lum | ≥ 1 katta repo o'lchovi |
| 3 | **Impact uchun inson ground truth** (real PR'lar, qo'lda belgilangan ta'sirlangan fayllar) | Hozir faqat reference-aniqlik va fixture | Impact P/R real PR'larda |
| 4 | ~~Next.js route modeli~~ ✅. **Qoldi:** Server Actions, `use client` chegaralari, Remix/SvelteKit | Framework tafsilotlari | Fixture + real repo |
| 5 | **Real LLM bilan AI baholash** (iqtibos validligi, asossiz da'vo ulushi) | Hozir faqat soxta provayder | O'lchangan ko'rsatkich + embedding kerak/kerakmasligi haqida qaror |
| 6 | ~~`oldProgram`~~ — ko'rib chiqildi, ataylab qilinmadi (ADR-27) | — | — |
| 7 | ~~Demo video / GIF~~ ✅ `docs/demo.mp4`, `docs/demo.gif` | — | — |

## Keyinroq (majburiyat emas)

- **Desktop (Tauri):** web UI + o'sha lokal server, core o'zgarishsiz.
- **V1.5** API endpoint / DB jadval node'lari, Tree-sitter orqali boshqa tillar.
- **V2** PR sharhi/CI integratsiyasi (`xray impact --json` poydevor), jamoa hisobotlari.
- **V3** MCP server / VS Code — graph va impact'ni AI agentlarga berish.
- **V4** self-hosted, audit log, korporativ siyosatlar.

## Xavflar reestri

| Xavf | Holat | Chora |
|---|---|---|
| TS 7 (native) API beqaror, 6.x eskiradi | Faol | 6.0.x pin; parser interfeys ortida |
| Katta monorepolarda xotira (bitta Program/guruh) | Sinalmagan (>1267 fayl) | O'lchash; kerak bo'lsa bo'laklash |
| Impact'da ortiqcha ta'sirlanganlar (shovqin) | Kamaytirilgan (chuqurlik siyosati, `verified/possible`) | #3 real ground truth bilan o'lchash |
| Mahsulot-bozor mosligi tasdiqlanmagan | Ochiq | #1 |
| AI javob sifati noma'lum | Ochiq | #5 |
