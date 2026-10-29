# X-Ray'ni sinab ko'rish (10 daqiqa)

X-Ray — Git diff'dan boshlab "bu o'zgarish nimalarga ta'sir qilishi mumkin" degan savolga **dalil bilan** javob beradigan lokal vosita (TypeScript/React/Next.js).

## Maxfiylik (avval shuni o'qing)
- Tahlil **faqat sizning kompyuteringizda**. Kodingiz hech qayerga yuborilmaydi.
- Repongizga **hech narsa yozilmaydi** (indeks `~/.cache/xray` ichida), repodagi skript/konfiglar **bajarilmaydi**.
- AI **o'chiq** (default). Uni yoqmasangiz, tarmoqqa umuman chiqilmaydi.

## O'rnatish
Kerak: Node.js 26 (sinalgan), [pnpm](https://pnpm.io), git. Faqat Linux'da sinalgan.

```bash
git clone <repo-manzili> xray && cd xray
pnpm install
pnpm demo        # ichida tayyor namuna: o'zgarish → hisobot (taxminan 5 soniya)
```
`pnpm demo` hisobotda `formatDate` imzosi o'zgargani va ta'sirlangan komponentlarni ko'rsatishi kerak. Ko'rinmasa — shu yerda to'xtang va menga xabar bering.

## O'z loyihangizda
```bash
pnpm xray index  /yo'l/loyiha             # indekslash (1–2 daqiqadan oshmasligi kerak)
pnpm xray impact /yo'l/loyiha             # hozirgi (commit qilinmagan) o'zgarishlar
pnpm xray impact /yo'l/loyiha --base main --head HEAD   # branch/PR
pnpm serve                                # web UI — terminalda chiqqan URL'ni oching
```
Web UI'da: «Repozitoriy» → yo'lni kiriting → «Change Impact» → «Tahlil qilish».

## Sinab ko'rishingiz kerak bo'lgan 3 narsa
1. **Oxirgi PR/commit:** `--base <oldingi> --head <shu>` bilan hisobot oling. «Bevosita» ro'yxati rostdan shu o'zgarishga bog'liqmi?
2. **Imzo o'zgartiring:** biror funksiyaga parametr qo'shing (commit qilmay), `pnpm xray impact` ishga tushiring. Chaqiruvchilarning hammasi chiqdimi?
3. **Next.js bo'lsa:** `layout.tsx` yoki middleware'ni o'zgartiring — «Marshrutlar» tabi to'g'rimi?

Har bir natijani bosing: **dalil yo'li** (qaysi satr, qaysi zanjir) ko'rinadi. `verified` — bog'lanish statik isbotlangan; `possible` — taxminiy. Hisobot hech qachon «buziladi» demaydi.

## Nimani bilmasligi mumkin (oldindan ogohlantiramiz)
Dinamik `import(x)`, framework "sehr"i (Server Actions, redirect/rewrite), satr orqali bog'lanish — ular **«Noaniq»** tabida ochiq ko'rsatiladi, yashirilmaydi. To'liq ro'yxat: `docs/KNOWN_LIMITS.md`.

## Fikringiz
`docs/FEEDBACK_TEMPLATE.md` dagi 6 savolga javob bering (5 daqiqa). Eng muhimi — birinchi savol.
