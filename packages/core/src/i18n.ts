// Backend matnlari (hisobot, sabablar, xatolar, AI) uchun ikki tilli katalog. UI o'z katalogiga ega (apps/web/src/i18n.ts).
// Standart til — 'uz' (barcha mavjud testlar/CLI shunga tayanadi); `en` har joyda tanlanadi: CLI `--lang en`, `XRAY_LANG=en`, UI `x-xray-lang`.

export type Lang = 'uz' | 'en';
export const LANGS: readonly Lang[] = ['uz', 'en'];
export const DEFAULT_LANG: Lang = 'uz';

export function parseLang(x: unknown): Lang {
  return x === 'en' || x === 'uz' ? x : DEFAULT_LANG;
}

type Params = Record<string, string | number>;

const uz = {
  // ---- impact ----
  'imp.notSource': "Manba kod fayli emas — graph bu o'zgarishni tahlil qilmaydi",
  'imp.binary': 'Binar fayl',
  'imp.baseFailed': "Eski holat graph'i qurilmadi ({err}); o'chirilgan elementlarning bog'liqliklari ko'rsatilmaydi",
  'imp.testDirect': "to'g'ridan-to'g'ri ishlatadi: {src} ({chg})",
  'imp.testChain': "zanjir orqali bog'langan: {src} ({chg})",
  'imp.testImports': '{file} faylini import qiladi (qamrov isbotlanmagan)',
  'imp.brokenImport': "Import hal bo'lmadi: '{spec}'",
  'imp.unresolvedDyn': "Statik hal qilib bo'lmaydi ({reason}): {snippet}",
  'imp.parseError': 'Sintaksis xatosi: {msg}',
  'imp.routesCut': "Marshrutlar ro'yxati {cap} tada kesildi (jami {total})",
  'imp.cut': "Natija {max} elementda kesildi — tahlil to'liq emas",
  'imp.staged': "Staged rejimi: graph ishchi katalogdan qurilgan (staged bo'lmagan o'zgarishlar ham hisobga olingan bo'lishi mumkin)",
  'imp.noBase': "Eski holat (commit) yo'q — imzo o'zgarishi aniqlanmadi",
  'imp.noOldText': "Eski fayl matni o'qilmadi",
  'imp.verb.calls': 'chaqiradi',
  'imp.verb.renders': 'render qiladi',
  'imp.verb.references': 'ishlatadi',
  'imp.verb.imports': 'modulni import qiladi',
  'imp.chg.fileLevel': "fayl darajasida o'zgargan",
  'imp.chg.fileRemoved': "o'chirilgan/ko'chirilgan",
  'imp.chg.added': "qo'shilgan",
  'imp.chg.removed': "o'chirilgan",
  'imp.chg.modified': "tanasi o'zgargan",
  'imp.chg.signatureChanged': "imzosi o'zgargan",
  'imp.hop1': '{target} ni {verb} ({loc})',
  'imp.hopN': '{target} orqali ({n} qadam): {verb}',
  'imp.explain': '{name} {hop}; manba {src} — {chg}',
  'imp.touchChanged': "fayl diff'da o'zgargan",
  'imp.touchAffected': "{name} ta'sirlangan ({tier}); manba {src}",
  'imp.stChanged': "o'zgargan",
  'imp.stAffected': "ta'sirlangan",
  'imp.routeVia': "{role} {scope}({file}) {state} — shu marshrutga qo'llanadi",

  // ---- markdown ----
  'md.title': 'X-Ray Impact Report',
  'md.working': 'working tree vs HEAD',
  'md.disclaimer': "Bu hisobot **ta'sirlanishi mumkin** bo'lgan kodni ko'rsatadi, xato bo'lishini kafolatlamaydi. `verified` — bog'lanish statik isbotlangan; `possible` — kamida bir bo'g'in taxminiy.",
  'md.s1': "## 1. Nima o'zgardi ({files} fayl, {symbols} symbol)",
  'md.noChanges': "Tahlil qilinadigan manba o'zgarishi yo'q.",
  'md.fileLevel': "fayl darajasidagi o'zgarish (symbol'siz): satrlar {lines}",
  'md.s2': "## 2. Bevosita bog'liq ({n})",
  'md.s3': "## 3. Bilvosita bog'liq ({n})",
  'md.none': "Yo'q.",
  'md.routes': "## Ta'sirlanishi mumkin marshrutlar ({n})",
  'md.moreRoutes': "… yana {n} ta (JSON'da to'liq)",
  'md.s4': "## 4. Bog'liq testlar ({n})",
  'md.noTests': "Hech qanday test topilmadi.",
  'md.testCmd': "Bog'liq testlarni ishga tushirish:",
  'md.untested': "**Testga yetib bormagan o'zgarishlar** (qo'lda tekshirish tavsiya):",
  'md.s5': '## 5. Noaniq / tahlil qilinmagan ({n})',
  'md.alsoChanged': " · (diff ichida ham o'zgargan)",
  'md.path': "yo'l",
  'md.footer': "chuqurlik ≤ {max} (faqat tana o'zgarishi uchun ≤ {body}) · {ms} ms",

  // ---- retrieval ----
  'ret.nameMatch': "nomi savoldagi '{name}' bilan mos",
  'ret.fts': 'lexical moslik (FTS)',
  'ret.uses': '{name} ishlatadi',
  'ret.usedBy': '{name} ni ishlatadi',
  'ret.tentative': ' [taxminiy]',

  // ---- ai ----
  'ai.notConfigured': "AI sozlanmagan (~/.config/xray/ai.json yo'q). Faqat dalillar rejimi ishlaydi.",
  'ai.noConsent': 'AI uchun rozilik berilmagan. `xray ai enable` ni ishga tushiring.',
  'ai.consentMismatch': "Rozilik '{was}' uchun berilgan, hozirgi provayder '{now}'. Qayta rozilik kerak.",
  'ai.noKey': "API kalit topilmadi: {env} env o'zgaruvchisi bo'sh.",
  'ai.consent':
    'Savol bergan paytingizda tanlangan kod parchalari (fayl yo\'li, satr raqamlari va ~60 qatorgacha kod bo\'laklari), savolingiz va graph bog\'lanishlari "{p}" provayderiga internet orqali yuboriladi. Maxfiy fayllar indekslanmaydi va kalit/token ko\'rinishidagi qiymatlar yuborishdan oldin olib tashlanadi, lekin bu 100% kafolat emas. Hech narsa avtomatik yuborilmaydi — faqat siz savol berganingizda.',

  // ---- index reasons ----
  'idx.forced': "full so'raldi",
  'idx.first': 'birinchi indekslash',
  'idx.config': "tsconfig/jsconfig o'zgargan",
  'idx.structure': "fayl qo'shildi/o'chirildi (+{added}/-{deleted}): resolve o'zgarishi mumkin",
  'idx.noop': "o'zgarish yo'q",
  'idx.incremental': "{n} fayl o'zgargan",

  // ---- server / errors ----
  'srv.folderNotFound': "Papka topilmadi yoki o'qib bo'lmaydi: {path}",
  'srv.openFirst': 'Avval repozitoriyni oching (POST /api/open)',
  'srv.contentType': 'Content-Type: application/json kerak',
  'srv.tooBig': "So'rov juda katta",
  'srv.badJson': "JSON noto'g'ri",
  'srv.badSpec': 'spec: {kind:"working"|"staged"} yoki {kind:"range", base, head}',
  'srv.hostDenied': 'Host ruxsat etilmagan',
  'srv.tokenNeeded': 'Token kerak',
  'srv.originDenied': 'Origin ruxsat etilmagan',
  'srv.pathNeeded': 'path kerak',
  'srv.nodeNotFound': 'node topilmadi',
  'srv.notIndexed': "Bu fayl indeksda yo'q",
  'srv.outsideRepo': 'Repo tashqarisiga chiqish mumkin emas',
  'srv.questionBad': 'question (1..2000 belgi) kerak',
  'srv.consentExact': "Rozilik matni aynan ko'rsatilganidek qabul qilinishi kerak",
  'srv.aiFields': 'model va apiKeyEnv (ENV_NOMI) kerak',
  'srv.unknownRoute': "Noma'lum yo'l",
  'err.scanEntries': "Papka juda katta: {n} dan ortiq yozuv ko'rildi. Butun disk/uy papkasi emas, aniq loyiha papkasini tanlang.",
  'err.scanFiles': "Papka juda katta: {n} dan ortiq manba fayl. Aniq loyiha papkasini tanlang yoki .xrayignore bilan keraksizlarini chiqaring.",
  'err.badRef': "Noto'g'ri ref nomi: {ref}",
  'err.unsafePath': "Xavfli yo'l: {path}",
  'err.diffTooBig': 'Diff juda katta: {n} fayl (limit {max})',
  'err.notRepo': 'Bu papka Git repozitoriy emas',
} as const;

export type MsgKey = keyof typeof uz;

const en: Record<MsgKey, string> = {
  'imp.notSource': 'Not a source file — the graph does not analyse this change',
  'imp.binary': 'Binary file',
  'imp.baseFailed': 'Could not build the base-state graph ({err}); dependents of removed elements are not shown',
  'imp.testDirect': 'uses it directly: {src} ({chg})',
  'imp.testChain': 'connected through a chain: {src} ({chg})',
  'imp.testImports': 'imports {file} (coverage not proven)',
  'imp.brokenImport': "Import could not be resolved: '{spec}'",
  'imp.unresolvedDyn': 'Cannot be resolved statically ({reason}): {snippet}',
  'imp.parseError': 'Syntax error: {msg}',
  'imp.routesCut': 'Route list truncated at {cap} (total {total})',
  'imp.cut': 'Result truncated at {max} items — the analysis is incomplete',
  'imp.staged': 'Staged mode: the graph is built from the working directory (unstaged changes may be included)',
  'imp.noBase': 'No base commit — signature changes were not detected',
  'imp.noOldText': 'Could not read the old file text',
  'imp.verb.calls': 'calls',
  'imp.verb.renders': 'renders',
  'imp.verb.references': 'uses',
  'imp.verb.imports': 'imports the module of',
  'imp.chg.fileLevel': 'changed at file level',
  'imp.chg.fileRemoved': 'deleted/moved',
  'imp.chg.added': 'added',
  'imp.chg.removed': 'removed',
  'imp.chg.modified': 'body changed',
  'imp.chg.signatureChanged': 'signature changed',
  'imp.hop1': '{verb} {target} ({loc})',
  'imp.hopN': '{verb} {target} (chain of {n} steps)',
  'imp.explain': '{name} {hop}; source: {src} — {chg}',
  'imp.touchChanged': 'file changed in the diff',
  'imp.touchAffected': '{name} is affected ({tier}); source {src}',
  'imp.stChanged': 'changed',
  'imp.stAffected': 'affected',
  'imp.routeVia': '{role} {scope}({file}) {state} — applies to this route',

  'md.title': 'X-Ray Impact Report',
  'md.working': 'working tree vs HEAD',
  'md.disclaimer': 'This report shows code that **may be affected**; it does not guarantee a defect. `verified` — the relationship is statically proven; `possible` — at least one link is tentative.',
  'md.s1': '## 1. What changed ({files} files, {symbols} symbols)',
  'md.noChanges': 'No analysable source changes.',
  'md.fileLevel': 'file-level change (no symbol): lines {lines}',
  'md.s2': '## 2. Direct dependents ({n})',
  'md.s3': '## 3. Indirect dependents ({n})',
  'md.none': 'None.',
  'md.routes': '## Routes that may be affected ({n})',
  'md.moreRoutes': '… {n} more (full list in JSON)',
  'md.s4': '## 4. Related tests ({n})',
  'md.noTests': 'No tests found.',
  'md.testCmd': 'Run the related tests:',
  'md.untested': '**Changes no test reaches** (manual check recommended):',
  'md.s5': '## 5. Uncertain / not analysed ({n})',
  'md.alsoChanged': ' · (also changed in the diff)',
  'md.path': 'path',
  'md.footer': 'depth ≤ {max} (body-only changes ≤ {body}) · {ms} ms',

  'ret.nameMatch': "name matches '{name}' in the question",
  'ret.fts': 'lexical match (FTS)',
  'ret.uses': 'used by {name}',
  'ret.usedBy': 'uses {name}',
  'ret.tentative': ' [tentative]',

  'ai.notConfigured': 'AI is not configured (~/.config/xray/ai.json is missing). Only the evidence-only mode works.',
  'ai.noConsent': 'No consent given for AI. Run `xray ai enable`.',
  'ai.consentMismatch': "Consent was given for '{was}', the current provider is '{now}'. Consent is needed again.",
  'ai.noKey': 'API key not found: the {env} environment variable is empty.',
  'ai.consent':
    'When you ask a question, selected code excerpts (file paths, line numbers and up to ~60 lines of code per excerpt), your question and graph relations are sent over the internet to the "{p}" provider. Sensitive files are not indexed and key/token-like values are removed before sending, but this is not a 100% guarantee. Nothing is sent automatically — only when you ask a question.',

  'idx.forced': 'full requested',
  'idx.first': 'first indexing',
  'idx.config': 'tsconfig/jsconfig changed',
  'idx.structure': 'files added/removed (+{added}/-{deleted}): resolution may change',
  'idx.noop': 'no changes',
  'idx.incremental': '{n} files changed',

  'srv.folderNotFound': 'Folder not found or not readable: {path}',
  'srv.openFirst': 'Open a repository first (POST /api/open)',
  'srv.contentType': 'Content-Type: application/json is required',
  'srv.tooBig': 'Request too large',
  'srv.badJson': 'Invalid JSON',
  'srv.badSpec': 'spec: {kind:"working"|"staged"} or {kind:"range", base, head}',
  'srv.hostDenied': 'Host not allowed',
  'srv.tokenNeeded': 'Token required',
  'srv.originDenied': 'Origin not allowed',
  'srv.pathNeeded': 'path is required',
  'srv.nodeNotFound': 'node not found',
  'srv.notIndexed': 'This file is not in the index',
  'srv.outsideRepo': 'Cannot read outside the repository',
  'srv.questionBad': 'question (1..2000 characters) is required',
  'srv.consentExact': 'The consent text must be accepted exactly as shown',
  'srv.aiFields': 'model and apiKeyEnv (ENV_NAME) are required',
  'srv.unknownRoute': 'Unknown route',
  'err.scanEntries': 'Folder too large: more than {n} entries seen. Pick a specific project folder, not a whole disk or home directory.',
  'err.scanFiles': 'Folder too large: more than {n} source files. Pick a specific project folder or exclude the unneeded parts with .xrayignore.',
  'err.badRef': 'Invalid ref name: {ref}',
  'err.unsafePath': 'Unsafe path: {path}',
  'err.diffTooBig': 'Diff too large: {n} files (limit {max})',
  'err.notRepo': 'This folder is not a Git repository',
};

const CATALOG: Record<Lang, Record<MsgKey, string>> = { uz, en };

export function t(lang: Lang, key: MsgKey, params?: Params): string {
  const s = CATALOG[lang][key];
  return params ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : s;
}

/** Barcha tillardagi rozilik matnlari (server tilidan qat'i nazar qabul qilish uchun). */
export const allVariants = (key: MsgKey, params?: Params): string[] => LANGS.map((l) => t(l, key, params));
