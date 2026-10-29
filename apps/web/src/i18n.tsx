import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * UI tarjimalari (uz/en). Tilni tanlash: localStorage → brauzer tili (uz* → uz, aks holda en).
 * Server matnlari (hisobot sabablari, xatolar, AI) uchun har so'rovga `x-xray-lang` sarlavhasi qo'shiladi (api.ts).
 */

export type Lang = 'uz' | 'en';
type P = Record<string, string | number>;

const uz = {
  // hero
  'hero.title': "O'zgarishingiz nimalarga ta'sir qiladi?", 'hero.sub': "Repozitoriyni oching, Git diff'ni tanlang — nimalarga ta'sir qilishi mumkinligini dalil bilan ko'ring.",
  'hero.p1': "Lokal: kodingiz hech qayerga yuklanmaydi va bajarilmaydi", 'hero.p2': "Har natijada dalil: satr, zanjir, ishonch darajasi", 'hero.p3': "Halol: o'tkazib yuborilgan va hal bo'lmaganlar ochiq ko'rsatiladi",

  // umumiy
  'nav.repo': 'Repozitoriy', 'nav.explorer': 'Graph Explorer', 'nav.impact': 'Change Impact', 'nav.ask': 'Savol',
  'app.fatalTitle': "Serverga ulanib bo'lmadi", 'app.fatalHint': "X-Ray terminalda chop etgan to'liq URL'ni (`?token=…` bilan) oching.",
  'app.loading': 'Yuklanmoqda…', 'app.aiOff': "AI: o'chiq", 'app.aiOn': 'AI: {provider}', 'app.lang': 'Til',
  'common.none': "Yo'q.", 'common.more': '… yana {n} ta', 'common.close': 'Yopish', 'common.loading': 'yuklanmoqda…',

  // repozitoriy
  'repo.title': 'Repozitoriy',
  'repo.intro': "Lokal papka tanlang. Tahlil to'liq kompyuteringizda bajariladi; repoga hech narsa yozilmaydi (indeks `~/.cache/xray` ichida).",
  'repo.pathLabel': "Repo yo'li", 'repo.pathPh': '/home/siz/project', 'repo.open': 'Ochish va indekslash', 'repo.indexing': 'Indekslanmoqda…',
  'repo.none': "Hali repozitoriy ochilmagan. Yo'lni kiriting va «Ochish»ni bosing.",
  'repo.files': 'Fayllar', 'repo.nodes': "Node'lar", 'repo.edges': "Bog'lanishlar", 'repo.unresolved': "Hal bo'lmagan", 'repo.syntax': 'Sintaksis xatosi',
  'repo.modeLine': "Rejim: **{mode}** — {reason} · {reparsed} fayl qayta parse, {sem} fayl semantikasi qayta hisoblandi · {ms} ms",
  'repo.reason.forced': "full so'raldi", 'repo.reason.first': 'birinchi indekslash', 'repo.reason.config': "tsconfig/jsconfig o'zgargan",
  'repo.reason.structure': "fayl qo'shildi/o'chirildi (+{added}/-{deleted}): resolve o'zgarishi mumkin", 'repo.reason.noop': "o'zgarish yo'q", 'repo.reason.incremental': "{n} fayl o'zgargan",
  'repo.full': "to'liq qayta indekslash", 'repo.kinds': 'Node turlari', 'repo.skipped': "O'tkazib yuborilgan", 'repo.notHidden': '(yashirilmaydi)',
  'repo.nothing': 'Hech narsa.', 'repo.skipMore': '… yana {n} ta (indeks hisobotida; birinchi 200 ta saqlangan)',
  'repo.unresolvedH': "Statik hal qilib bo'lmaydigan", 'repo.syntaxH': 'Sintaksis xatolari',
  'skip.sensitive': 'maxfiy fayl (indekslanmaydi)', 'skip.ignored-dir': 'generated/dependency papka', 'skip.gitignore': '.gitignore / .xrayignore',
  'skip.generated-bundle': "bundler natijasi (hash'li nom)", 'skip.declaration-file': '.d.ts', 'skip.too-large': 'juda katta', 'skip.minified': 'minified',
  'skip.symlink-escape': 'repo tashqarisiga symlink', 'skip.symlink': 'symlink', 'skip.unreadable': "o'qib bo'lmadi",

  // explorer
  'exp.panelSearch': 'Qidiruv', 'exp.panelDetail': 'Tafsilot', 'exp.searchPh': 'Symbol yoki fayl qidirish…', 'exp.searchLabel': 'Qidiruv', 'exp.clear': 'Tozalash',
  'exp.topFiles': "Eng ko'p import qilinadigan fayllar", 'exp.noFiles': "Fayllar yo'q.", 'exp.noResults': "«{q}» bo'yicha hech narsa topilmadi.", 'exp.results': '{n} natija',
  'exp.filters': 'Filtrlar', 'exp.off': "{n} o'chiq", 'exp.edgeKinds': "Bog'lanish turlari", 'exp.nodeKinds': 'Node turlari', 'exp.hops': 'Qadam (hop)', 'exp.hopsLabel': 'Qadamlar soni',
  'exp.noNode': 'Node tanlanmagan.', 'exp.emptyA': "Graph — faqat tanlangan node atrofi ko'rsatiladi.", 'exp.emptyB': 'Chapdan fayl yoki symbol tanlang.',
  'exp.back': 'Orqaga', 'exp.forward': 'Oldinga', 'exp.stats': "{nodes} node · {edges} bog'lanish",
  'exp.truncated': 'Natija cheklangan (120 node) — filtrlarni toraytiring yoki qadamni kamaytiring.', 'exp.noEdges': "Bu node'ning tanlangan turdagi bog'lanishlari yo'q.",
  'exp.legendNote': '· punktir = taxminiy', 'exp.exported': 'exported', 'exp.basis': 'aniqlash asosi: {basis}', 'exp.externals': 'tashqi paketlar: {list}',
  'exp.unresolvedInFile': 'Fayldagi aniqlanmagan joylar:', 'exp.unresolvedItem': '{reason} — `{snippet}` (satr {line})',
  'exp.incoming': 'Kiruvchi', 'exp.outgoing': 'Chiquvchi', 'exp.source': 'Manba',

  // impact
  'imp.title': 'Change Impact', 'imp.panelEvidence': 'Dalil', 'imp.evidenceEmpty': "Natija elementini bosing — nima uchun kiritilgani (dalil yo'li) shu yerda ko'rinadi.",
  'imp.notGit': 'Bu papka Git repozitoriy emas — Impact tahlili Git diff talab qiladi.', 'imp.specLabel': 'Diff manbasi',
  'imp.working': 'Ishchi katalog (HEAD ↔ hozir)', 'imp.staged': 'Staged', 'imp.range': "Branch/commit oralig'i", 'imp.basePh': 'base (masalan main)', 'imp.headPh': 'head',
  'imp.run': 'Tahlil qilish', 'imp.running': 'Tahlil…', 'imp.tabsLabel': "Hisobot bo'limlari",
  'imp.tabChanged': "O'zgardi", 'imp.tabDirect': 'Bevosita', 'imp.tabIndirect': 'Bilvosita', 'imp.tabRoutes': 'Marshrutlar', 'imp.tabTests': 'Testlar', 'imp.tabUncertain': 'Noaniq',
  'imp.statLine': "{symbols} symbol · {ms} ms · chuqurlik ≤ {max} (tana ≤ {body})", 'imp.mdDownload': 'Markdown ↓', 'imp.jsonDownload': 'JSON ↓',
  'imp.emptyA': "Nima o'zgardi → nima ta'sirlanishi mumkin → nimani tekshirish kerak.", 'imp.emptyB': "Diff manbasini tanlang va «Tahlil qilish»ni bosing.",
  'imp.emptyC': "Hisobot hech qachon «buziladi» demaydi — faqat dalil bilan «ta'sirlanishi mumkin».",
  'imp.noChanges': "Tahlil qilinadigan manba o'zgarishi yo'q.", 'imp.fileLevel': 'fayl darajasi (satr {line}…)', 'imp.noSymbolChange': "symbol o'zgarishi yo'q",
  'imp.filterLabel': 'Filtr', 'imp.filterPh': "Nom yoki yo'l bo'yicha filtr…", 'imp.confLabel': 'Ishonch darajasi', 'imp.confAll': 'Hammasi',
  'imp.noMatch': "Filtrga mos element yo'q.", 'imp.showMore': "Yana {n} ta ko'rsatish (jami {total})", 'imp.alsoChanged': 'diff ichida ham',
  'imp.routesNote': "Faqat **ta'sirlanishi mumkin** bo'lgan marshrutlar. Layout/middleware o'zgarsa, uning ostidagi hamma sahifa kiradi.", 'imp.openExplorer': "Explorer'da ochish",
  'imp.testCmd': "Ta'sirlangan testlarni ishga tushirish", 'imp.copy': 'Nusxalash', 'imp.copied': 'Nusxalandi ✓',
  'imp.noTests': 'Hech qanday test topilmadi.', 'imp.untested': "**Testga yetib bormagan o'zgarishlar** (qo'lda tekshirish tavsiya): {names}", 'imp.noUncertain': "Noaniq joylar yo'q.",
  'imp.evidencePath': "Dalil yo'li", 'imp.source': 'Manba', 'imp.tier': '{tier} · chuqurlik {depth}',
  'imp.tier.direct': 'bevosita', 'imp.tier.indirect': 'bilvosita',

  // ask
  'ask.title': "Kod bazasidan so'rash", 'ask.intro': "Javob faqat indekslangan koddan olingan dalillarga tayanadi. Dalil yetmasa — shuni aytadi.",
  'ask.aiOn': "AI yoqilgan: **{provider}** / {model}. Savol bergan paytingizda tanlangan kod parchalari shu provayderga yuboriladi.",
  'ask.aiOff': "AI o'chiq — hech narsa tashqariga yuborilmaydi. Faqat lokal dalillar ko'rsatiladi.", 'ask.questionLabel': 'Savol',
  'ask.questionPh': 'Masalan: `fetchArticle` qayerdan chaqiriladi?   (Ctrl+Enter — yuborish)', 'ask.submit': "So'rash", 'ask.searching': 'Qidirilmoqda…',
  'ask.dryLabel': "Faqat nima yuborilishini ko'rsat (yubormasdan)", 'ask.citeOk': "Manbani ko'rish", 'ask.citeBad': 'Yaroqsiz: {problem}',
  'ask.citeStats': "Iqtiboslar: {ok} yaroqli, {bad} yaroqsiz", 'ask.unsupported': " · asossiz ulushi {pct}%",
  'ask.dryResult': "Yuborilmadi (dry-run). Yuboriladi: **{provider}/{model}**, {chunks} parcha, {chars} belgi, {red} maxfiy qiymat olib tashlangan. Fayllar: {files}",
  'ask.evidenceOnly': 'Faqat lokal dalillar (AI chaqirilmadi).', 'ask.sentLine': "Yuborildi: {provider}/{model} · {files} fayl · {chars} belgi · {red} qiymat olib tashlandi",
  'ask.evidence': 'Dalillar ({n})', 'ask.noEvidence': 'Yetarli dalil topilmadi.', 'ask.facts': 'Graph faktlari',
  'ask.enable': 'AI ni yoqish (ixtiyoriy)', 'ask.provider': 'Provayder', 'ask.optAnthropic': 'Anthropic (Claude)', 'ask.optOpenai': 'OpenAI-compatible (OpenAI, Gemini, Ollama…)',
  'ask.model': 'Model', 'ask.keyEnv': "API kalit env o'zgaruvchisi", 'ask.baseUrl': 'Base URL',
  'ask.keyNote': "Kalit faylga yozilmaydi: server ishga tushgan terminalda `{env}` o'rnatilgan bo'lishi kerak.", 'ask.consentCheck': 'Yuqoridagini o‘qidim va roziman',
  'ask.consentSave': 'Rozilik berish va saqlash', 'ask.saved': 'Saqlandi.',

  // panel maketi, graf, manba
  'split.width': '{title} paneli kengligi', 'split.handleTitle': "Sudrang · ← → · ikki marta bosing: asl o'lcham", 'split.collapse': '{title} panelini yopish', 'split.expand': '{title} panelini ochish',
  'graph.aria': 'Kod grafigi', 'graph.fit': "Sig'dirish", 'graph.zoomIn': 'Yaqinlashtirish', 'graph.zoomOut': 'Uzoqlashtirish',
  'src.failed': "Manba o'qilmadi: {err}", 'src.loading': 'Yuklanmoqda…',
} as const;

export type UIKey = keyof typeof uz;

const en: Record<UIKey, string> = {
  'hero.title': 'What will your change affect?', 'hero.sub': 'Open a repository, pick a Git diff — see what may be affected, with evidence.',
  'hero.p1': 'Local: your code is never uploaded or executed', 'hero.p2': 'Evidence for every result: line, chain, confidence', 'hero.p3': 'Honest: skipped and unresolved items are listed openly',

  'nav.repo': 'Repository', 'nav.explorer': 'Graph Explorer', 'nav.impact': 'Change Impact', 'nav.ask': 'Ask',
  'app.fatalTitle': 'Could not connect to the server', 'app.fatalHint': 'Open the full URL that X-Ray printed in the terminal (with `?token=…`).',
  'app.loading': 'Loading…', 'app.aiOff': 'AI: off', 'app.aiOn': 'AI: {provider}', 'app.lang': 'Language',
  'common.none': 'None.', 'common.more': '… {n} more', 'common.close': 'Close', 'common.loading': 'loading…',

  'repo.title': 'Repository',
  'repo.intro': 'Choose a local folder. The analysis runs entirely on your machine; nothing is written to the repo (the index lives in `~/.cache/xray`).',
  'repo.pathLabel': 'Repository path', 'repo.pathPh': '/home/you/project', 'repo.open': 'Open and index', 'repo.indexing': 'Indexing…',
  'repo.none': 'No repository opened yet. Enter a path and press "Open and index".',
  'repo.files': 'Files', 'repo.nodes': 'Nodes', 'repo.edges': 'Relations', 'repo.unresolved': 'Unresolved', 'repo.syntax': 'Syntax errors',
  'repo.modeLine': 'Mode: **{mode}** — {reason} · {reparsed} files re-parsed, {sem} files’ semantics recomputed · {ms} ms',
  'repo.reason.forced': 'full requested', 'repo.reason.first': 'first indexing', 'repo.reason.config': 'tsconfig/jsconfig changed',
  'repo.reason.structure': 'files added/removed (+{added}/-{deleted}): resolution may change', 'repo.reason.noop': 'no changes', 'repo.reason.incremental': '{n} files changed',
  'repo.full': 'full re-index', 'repo.kinds': 'Node kinds', 'repo.skipped': 'Skipped', 'repo.notHidden': '(never hidden)',
  'repo.nothing': 'Nothing.', 'repo.skipMore': '… {n} more (in the index report; the first 200 are kept)',
  'repo.unresolvedH': 'Cannot be resolved statically', 'repo.syntaxH': 'Syntax errors',
  'skip.sensitive': 'sensitive file (not indexed)', 'skip.ignored-dir': 'generated/dependency folder', 'skip.gitignore': '.gitignore / .xrayignore',
  'skip.generated-bundle': 'bundler output (hashed name)', 'skip.declaration-file': '.d.ts', 'skip.too-large': 'too large', 'skip.minified': 'minified',
  'skip.symlink-escape': 'symlink leaving the repo', 'skip.symlink': 'symlink', 'skip.unreadable': 'unreadable',

  'exp.panelSearch': 'Search', 'exp.panelDetail': 'Details', 'exp.searchPh': 'Search a symbol or file…', 'exp.searchLabel': 'Search', 'exp.clear': 'Clear',
  'exp.topFiles': 'Most imported files', 'exp.noFiles': 'No files.', 'exp.noResults': 'Nothing found for “{q}”.', 'exp.results': '{n} results',
  'exp.filters': 'Filters', 'exp.off': '{n} off', 'exp.edgeKinds': 'Relation kinds', 'exp.nodeKinds': 'Node kinds', 'exp.hops': 'Depth (hops)', 'exp.hopsLabel': 'Number of hops',
  'exp.noNode': 'No node selected.', 'exp.emptyA': 'Graph — only the neighbourhood of the selected node is shown.', 'exp.emptyB': 'Pick a file or symbol on the left.',
  'exp.back': 'Back', 'exp.forward': 'Forward', 'exp.stats': '{nodes} nodes · {edges} relations',
  'exp.truncated': 'Result truncated (120 nodes) — narrow the filters or reduce the depth.', 'exp.noEdges': 'This node has no relations of the selected kinds.',
  'exp.legendNote': '· dashed = tentative', 'exp.exported': 'exported', 'exp.basis': 'detected by: {basis}', 'exp.externals': 'external packages: {list}',
  'exp.unresolvedInFile': 'Unresolved spots in this file:', 'exp.unresolvedItem': '{reason} — `{snippet}` (line {line})',
  'exp.incoming': 'Incoming', 'exp.outgoing': 'Outgoing', 'exp.source': 'Source',

  'imp.title': 'Change Impact', 'imp.panelEvidence': 'Evidence', 'imp.evidenceEmpty': 'Click a result — why it is included (the evidence path) appears here.',
  'imp.notGit': 'This folder is not a Git repository — impact analysis needs a Git diff.', 'imp.specLabel': 'Diff source',
  'imp.working': 'Working tree (HEAD ↔ now)', 'imp.staged': 'Staged', 'imp.range': 'Branch/commit range', 'imp.basePh': 'base (e.g. main)', 'imp.headPh': 'head',
  'imp.run': 'Analyse', 'imp.running': 'Analysing…', 'imp.tabsLabel': 'Report sections',
  'imp.tabChanged': 'Changed', 'imp.tabDirect': 'Direct', 'imp.tabIndirect': 'Indirect', 'imp.tabRoutes': 'Routes', 'imp.tabTests': 'Tests', 'imp.tabUncertain': 'Uncertain',
  'imp.statLine': '{symbols} symbols · {ms} ms · depth ≤ {max} (body-only ≤ {body})', 'imp.mdDownload': 'Markdown ↓', 'imp.jsonDownload': 'JSON ↓',
  'imp.emptyA': 'What changed → what may be affected → what to check.', 'imp.emptyB': 'Pick a diff source and press “Analyse”.',
  'imp.emptyC': 'The report never says “it breaks” — only “may be affected”, with evidence.',
  'imp.noChanges': 'No analysable source changes.', 'imp.fileLevel': 'file level (line {line}…)', 'imp.noSymbolChange': 'no symbol changes',
  'imp.filterLabel': 'Filter', 'imp.filterPh': 'Filter by name or path…', 'imp.confLabel': 'Confidence', 'imp.confAll': 'All',
  'imp.noMatch': 'No items match the filter.', 'imp.showMore': 'Show {n} more (of {total})', 'imp.alsoChanged': 'also changed in diff',
  'imp.routesNote': 'Only routes that **may be affected**. If a layout/middleware changes, every page below it is included.', 'imp.openExplorer': 'Open in Explorer',
  'imp.testCmd': 'Run the affected tests', 'imp.copy': 'Copy', 'imp.copied': 'Copied ✓',
  'imp.noTests': 'No tests found.', 'imp.untested': '**Changes no test reaches** (manual check recommended): {names}', 'imp.noUncertain': 'No uncertain spots.',
  'imp.evidencePath': 'Evidence path', 'imp.source': 'Source', 'imp.tier': '{tier} · depth {depth}',
  'imp.tier.direct': 'direct', 'imp.tier.indirect': 'indirect',

  'ask.title': 'Ask the codebase', 'ask.intro': 'Answers rely only on evidence taken from the indexed code. If the evidence is not enough, it says so.',
  'ask.aiOn': 'AI is on: **{provider}** / {model}. When you ask, selected code excerpts are sent to this provider.',
  'ask.aiOff': 'AI is off — nothing is sent anywhere. Only local evidence is shown.', 'ask.questionLabel': 'Question',
  'ask.questionPh': 'For example: where is `fetchArticle` called?   (Ctrl+Enter to send)', 'ask.submit': 'Ask', 'ask.searching': 'Searching…',
  'ask.dryLabel': 'Only show what would be sent (without sending)', 'ask.citeOk': 'View source', 'ask.citeBad': 'Invalid: {problem}',
  'ask.citeStats': 'Citations: {ok} valid, {bad} invalid', 'ask.unsupported': ' · unsupported share {pct}%',
  'ask.dryResult': 'Not sent (dry run). Would send: **{provider}/{model}**, {chunks} excerpts, {chars} chars, {red} secret values removed. Files: {files}',
  'ask.evidenceOnly': 'Local evidence only (AI was not called).', 'ask.sentLine': 'Sent: {provider}/{model} · {files} files · {chars} chars · {red} values removed',
  'ask.evidence': 'Evidence ({n})', 'ask.noEvidence': 'Not enough evidence found.', 'ask.facts': 'Graph facts',
  'ask.enable': 'Enable AI (optional)', 'ask.provider': 'Provider', 'ask.optAnthropic': 'Anthropic (Claude)', 'ask.optOpenai': 'OpenAI-compatible (OpenAI, Gemini, Ollama…)',
  'ask.model': 'Model', 'ask.keyEnv': 'API key environment variable', 'ask.baseUrl': 'Base URL',
  'ask.keyNote': 'The key is never written to a file: `{env}` must be set in the terminal that started the server.', 'ask.consentCheck': 'I have read the above and agree',
  'ask.consentSave': 'Give consent and save', 'ask.saved': 'Saved.',

  'split.width': '{title} panel width', 'split.handleTitle': 'Drag · ← → · double-click to reset', 'split.collapse': 'Collapse the {title} panel', 'split.expand': 'Expand the {title} panel',
  'graph.aria': 'Code graph', 'graph.fit': 'Fit to view', 'graph.zoomIn': 'Zoom in', 'graph.zoomOut': 'Zoom out',
  'src.failed': 'Could not read source: {err}', 'src.loading': 'Loading…',
};

const CATALOG: Record<Lang, Record<UIKey, string>> = { uz, en };
const STORE = 'xray-lang';

export function detectLang(): Lang {
  try {
    const s = localStorage.getItem(STORE);
    if (s === 'uz' || s === 'en') return s;
  } catch {
    /* ixtiyoriy */
  }
  return typeof navigator !== 'undefined' && /^uz/i.test(navigator.language) ? 'uz' : 'en';
}

/** Hozirgi til (API sarlavhasi uchun komponentdan tashqarida ham o'qiladi) */
let current: Lang = 'en';
export const currentLang = () => current;

export function translate(lang: Lang, key: UIKey, p?: P): string {
  const s = CATALOG[lang][key];
  return p ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(p[k] ?? `{${k}}`)) : s;
}

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: UIKey, p?: P) => string;
  /** `kod` va **qalin** belgilarini render qiladi */
  rich: (key: UIKey, p?: P) => ReactNode;
}
const I18n = createContext<Ctx>({ lang: 'en', setLang: () => undefined, t: (k) => k, rich: (k) => k });

/** Matndagi `kod` va **qalin** segmentlarni JSX'ga aylantiradi (HTML kiritilmaydi — xavfsiz). */
export function richText(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) =>
    part.startsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? detectLang());
  current = lang;
  useEffect(() => {
    current = lang;
    document.documentElement.lang = lang;
    document.title = lang === 'uz' ? 'X-Ray — kod intellekti' : 'X-Ray — code intelligence';
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    current = l;
    setLangState(l);
    try {
      localStorage.setItem(STORE, l);
    } catch {
      /* ixtiyoriy */
    }
  }, []);
  const value = useMemo<Ctx>(
    () => ({ lang, setLang, t: (k, p) => translate(lang, k, p), rich: (k, p) => richText(translate(lang, k, p)) }),
    [lang, setLang],
  );
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useI18n = () => useContext(I18n);
