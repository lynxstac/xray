import type { Confidence, EdgeKind, GraphNode, Loc } from '@xray/core';
import type { DiffSpec } from '@xray/git';

export type SymbolChange = 'added' | 'removed' | 'modified' | 'signature-changed';

export interface ChangedSymbol {
  id: string;
  name: string;
  kind: GraphNode['kind'];
  change: SymbolChange;
  /** Qaysi graph'da joylashgan: removed -> 'base' (eski holat) */
  inGraph: 'head' | 'base';
  loc: Loc;
}

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: 'A' | 'M' | 'D' | 'R';
  symbols: ChangedSymbol[];
  /** Hech bir symbol'ga to'g'ri kelmagan o'zgarishlar (import'lar, top-level kod...) */
  fileLevelLines: number[];
}

export interface PathStep {
  from: string;
  to: string;
  kind: EdgeKind;
  confidence: Confidence;
  evidence: Loc;
  via?: string;
}

export interface AffectedItem {
  id: string;
  kind: GraphNode['kind'];
  name: string;
  file: string;
  loc: Loc;
  depth: number;
  tier: 'direct' | 'indirect';
  /** Bog'lanish dalili sifatiga ko'ra. 'verified' = butun yo'l statik isbotlangan; 'possible' = kamida bir bo'g'in taxminiy. XATO bo'lishini anglatmaydi. */
  confidence: Confidence;
  /** Qaysi o'zgargan element sabab */
  cause: { id: string; change: SymbolChange | 'file-level' | 'file-removed' };
  /** affected -> ... -> o'zgargan element yo'li */
  path: PathStep[];
  reason: string;
  /** Bu element ham diff ichida o'zgartirilgan */
  alsoChanged: boolean;
}

export interface RelatedTest {
  file: string;
  /** direct-use: o'zgargan/ta'sirlangan element testda to'g'ridan-to'g'ri ishlatiladi; transitive: zanjir orqali; imports-only: faqat fayl import qiladi */
  relevance: 'direct-use' | 'transitive' | 'imports-only';
  because: string;
  path: PathStep[];
}

export interface UncertainItem {
  kind: 'unresolved-dynamic' | 'parse-error' | 'not-analyzed' | 'truncated' | 'warning' | 'broken-import';
  file?: string;
  line?: number;
  message: string;
}

/** Next.js marshruti, o'zgarish ta'sir qilishi mumkin bo'lgan */
export interface AffectedRoute {
  route: string;
  role: string;
  router: 'app' | 'pages';
  file: string;
  /** changed: marshrut fayli diff'da; affected: u ta'sirlangan element; via-layout/via-middleware: ota qatlam o'zgargan/ta'sirlangan */
  reason: 'changed' | 'affected' | 'via-layout' | 'via-middleware';
  because: string;
}

export interface ImpactReport {
  spec: DiffSpec;
  baseCommit: string | null;
  changed: ChangedFile[];
  direct: AffectedItem[];
  indirect: AffectedItem[];
  tests: RelatedTest[];
  /** Ta'sirlangan testlarni ishga tushirish buyrug'i (vitest/jest aniqlansa) */
  testCommand?: string;
  /** Faqat Next.js loyihalarida: ta'sirlanishi mumkin marshrutlar (bo'sh bo'lishi mumkin) */
  routes: AffectedRoute[];
  /** O'zgargan symbol'lar, ularga hech qanday test yetib bormaydi */
  untested: { id: string; file: string; name: string }[];
  uncertain: UncertainItem[];
  options: { maxDepth: number; bodyOnlyDepth: number; maxNodes: number };
  stats: { changedFiles: number; changedSymbols: number; direct: number; indirect: number; tests: number; routes: number; ms: number; truncated: boolean };
}
