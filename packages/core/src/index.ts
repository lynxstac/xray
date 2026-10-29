// X-Ray core: modullar orasidagi barqaror tiplar. Hech narsaga bog'liq emas.

export type Confidence = 'verified' | 'possible' | 'unresolved';

/** Repo-relative POSIX yo'l, 1-based satr/ustun. */
export interface Loc {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export * from './i18n.ts';

// ---- Scanner ----

export type SkipReason =
  | 'ignored-dir'
  | 'gitignore'
  | 'sensitive'
  | 'too-large'
  | 'symlink-escape'
  | 'symlink'
  | 'declaration-file'
  | 'minified'
  | 'generated-bundle'
  | 'unreadable';

export interface ScannedFile {
  path: string; // repo-relative, POSIX
  size: number;
}

export interface SkippedEntry {
  path: string;
  reason: SkipReason;
}

export interface ScanResult {
  root: string; // realpath
  files: ScannedFile[];
  skipped: SkippedEntry[];
  /** Qo'llab-quvvatlanmaydigan kengaytmali fayllar soni (ro'yxatga olinmaydi). */
  otherFileCount: number;
}

// ---- Parser ----

export type SymbolKind = 'function' | 'method' | 'class' | 'component' | 'hook' | 'variable' | 'type';

export interface ParsedSymbol {
  name: string;
  qualifiedName: string; // Class.method
  kind: SymbolKind;
  exported: boolean;
  loc: Loc;
  /** Nima asosida shu `kind` berildi (dalil). */
  basis: string;
  /** Imzo (parametrlar + qaytish turi; type'lar uchun to'liq matn). O'zgarish turini aniqlash uchun. */
  signature: string;
}

export type ImportKind = 'static' | 'dynamic' | 'require';

export interface ImportBinding {
  kind: 'default' | 'named' | 'namespace';
  imported: string; // 'default' | nom | '*'
  local: string;
  typeOnly: boolean;
}

export interface ParsedImport {
  specifier: string;
  kind: ImportKind;
  typeOnly: boolean;
  bindings: ImportBinding[]; // bo'sh = side-effect import
  loc: Loc;
}

export interface ParsedExport {
  /** Tashqariga ko'rinadigan nom ('default', nom, yoki '*' = export * from) */
  exported: string;
  /** Lokal nom (re-export bo'lsa — manba moduldagi nom, '*' = namespace) */
  local?: string;
  from?: string;
  kind: 'declaration' | 'list' | 'default' | 'reexport' | 'star' | 'namespace-reexport';
  typeOnly: boolean;
  loc: Loc;
}

export type UnresolvedReason = 'dynamic-import' | 'dynamic-require' | 'computed-call' | 'unresolved-module' | 'analysis-failed';

export interface UnresolvedUse {
  reason: UnresolvedReason;
  snippet: string;
  loc: Loc;
}

export interface ParseError {
  message: string;
  loc: Loc;
}

export interface ParsedFile {
  path: string;
  isTestFile: boolean;
  lineCount: number;
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  exports: ParsedExport[];
  unresolved: UnresolvedUse[];
  errors: ParseError[];
  /** Parser ichki xato berdi (sintaksis xatosi emas) — semantik tahlilga kiritilmaydi. */
  parseFailed?: boolean;
}

// ---- Index report ----

export interface IndexReport {
  root: string;
  scan: ScanResult;
  files: ParsedFile[];
  /** Fayl o'qilmadi / parser ichki xato berdi */
  failed: { path: string; error: string }[];
  stats: {
    scanned: number;
    parsed: number;
    withSyntaxErrors: number;
    failed: number;
    symbols: number;
    imports: number;
    exports: number;
    unresolved: number;
    ms: number;
  };
}

// ---- Graph ----

export type NodeKind = 'file' | 'test_file' | SymbolKind;
export type EdgeKind = 'imports' | 'exports' | 'calls' | 'renders' | 'references' | 'tests';

/** Next.js marshrut ma'lumoti (fayl node'ida): framework chaqiradigan kirish nuqtasi. */
export interface RouteInfo {
  /** Masalan `/dashboard/[slug]`; middleware uchun `*` */
  path: string;
  role: 'page' | 'layout' | 'template' | 'loading' | 'error' | 'global-error' | 'not-found' | 'default' | 'route-handler' | 'api' | 'app' | 'document' | 'middleware';
  router: 'app' | 'pages';
}

export interface GraphNode {
  /** Barqaror ID: fayl uchun `path`, symbol uchun `path#qualifiedName` (satr raqamisiz). */
  id: string;
  kind: NodeKind;
  name: string;
  qualifiedName: string;
  file: string;
  loc: Loc;
  exported: boolean;
  basis: string;
  signature: string;
  /** Faqat fayl node'lari uchun, Next.js loyihasida */
  route?: RouteInfo;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  confidence: Confidence;
  /** Shu juftlikdagi takroriy ishlatishlar soni (evidence — birinchisi). */
  count: number;
  evidence: Loc;
  via?: string;
}

export interface GraphUnresolved {
  file: string;
  reason: UnresolvedReason;
  snippet: string;
  loc: Loc;
}

/** Node ID: `path` yoki `path#qualifiedName`. Yo'lda '#' bo'lishi mumkin, shuning uchun OXIRGI '#' dan bo'linadi (symbol nomida '/' bo'lmaydi). */
export function splitNodeId(id: string): { file: string; symbol?: string } {
  const i = id.lastIndexOf('#');
  if (i <= 0) return { file: id };
  const sym = id.slice(i + 1);
  return sym.includes('/') ? { file: id } : { file: id.slice(0, i), symbol: sym };
}

export function edgeKey(e: Pick<GraphEdge, 'from' | 'to' | 'kind'>): string {
  return `${e.kind}|${e.from}|${e.to}`;
}
