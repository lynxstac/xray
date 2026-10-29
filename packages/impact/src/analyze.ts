import type { CodeGraph } from '@xray/graph';
import { DEFAULT_LANG, splitNodeId, t, type Lang, type GraphEdge, type GraphNode, type Loc, type ParsedFile, type ParsedSymbol } from '@xray/core';
import { parseSource } from '@xray/parser';
import type { DiffResult, FileChange, Range } from '@xray/git';
import { isLeafRoute, isScopeRoute } from '@xray/graph';
import type { AffectedItem, AffectedRoute, ChangedFile, ChangedSymbol, ImpactReport, PathStep, RelatedTest, SymbolChange, UncertainItem } from './types.ts';

export interface ImpactOptions {
  maxDepth?: number; // default 4
  /** Faqat tana o'zgargan (imzo bir xil) symbol uchun tarqalish chuqurligi */
  bodyOnlyDepth?: number; // default 2
  maxNodes?: number; // default 500
  /** Hisobot matnlari tili (default 'uz') */
  lang?: Lang;
}

export interface AnalyzeArgs {
  graph: CodeGraph; // diff'ning "yangi" tomoni
  files: ParsedFile[]; // parse xatolari uchun
  diff: DiffResult;
  /** Eski fayl matni (commit, path) */
  readOld: (commit: string, path: string) => Promise<string | null>;
  /** Eski holat graph'i — faqat o'chirilgan/qayta nomlangan narsalar bo'lsa chaqiriladi */
  buildBaseGraph: () => Promise<CodeGraph>;
  options?: ImpactOptions;
}

const SOURCE_RE = /\.[cm]?[jt]sx?$/;
const SYMBOL_EDGES = ['calls', 'renders', 'references'] as const;

interface Seed {
  id: string;
  graph: 'head' | 'base';
  change: SymbolChange | 'file-level' | 'file-removed';
  maxDepth: number;
}

interface Reached {
  id: string;
  depth: number;
  parent: string | null; // keyingi element (o'zgargan tomonga qarab)
  edge: GraphEdge | null;
  seed: Seed;
  pathConf: 'verified' | 'possible';
}

const isFileNode = (n: GraphNode) => n.kind === 'file' || n.kind === 'test_file';

function rangeLines(r: Range): [number, number] {
  return r.count === 0 ? [r.start, r.start + 1] : [r.start, r.start + r.count - 1];
}

/** Bitta hunk diapazoni uchun eng ichki symbol'lar. */
function innermostHit(symbols: { loc: Loc }[], r: Range): number[] {
  const [a, b] = rangeLines(r);
  const hits: number[] = [];
  symbols.forEach((s, i) => {
    const inside = r.count === 0 ? s.loc.startLine <= r.start && r.start + 1 <= s.loc.endLine : s.loc.startLine <= b && s.loc.endLine >= a;
    if (inside) hits.push(i);
  });
  return hits.filter((i) => !hits.some((j) => j !== i && within(symbols[j]!.loc, symbols[i]!.loc)));
}

function within(inner: Loc, outer: Loc): boolean {
  const startsAfter = inner.startLine > outer.startLine || (inner.startLine === outer.startLine && inner.startCol >= outer.startCol);
  const endsBefore = inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endCol <= outer.endCol);
  const same = inner.startLine === outer.startLine && inner.startCol === outer.startCol && inner.endLine === outer.endLine && inner.endCol === outer.endCol;
  return startsAfter && endsBefore && !same;
}

export async function analyzeImpact(args: AnalyzeArgs): Promise<ImpactReport> {
  const t0 = performance.now();
  const { graph, diff } = args;
  const maxDepth = args.options?.maxDepth ?? 4;
  const bodyOnlyDepth = Math.min(args.options?.bodyOnlyDepth ?? 2, maxDepth);
  const maxNodes = args.options?.maxNodes ?? 500;
  const lang: Lang = args.options?.lang ?? DEFAULT_LANG;

  const uncertain: UncertainItem[] = [];
  const changed: ChangedFile[] = [];
  const seeds: Seed[] = [];
  const changedPaths = new Set<string>();
  const parsedByPath = new Map(args.files.map((f) => [f.path, f]));

  // ---- 1) Nima o'zgardi ----
  for (const fc of diff.files) {
    changedPaths.add(fc.path);
    const srcish = SOURCE_RE.test(fc.path) || (fc.oldPath !== undefined && SOURCE_RE.test(fc.oldPath));
    if (!srcish) {
      uncertain.push({ kind: 'not-analyzed', file: fc.path, message: t(lang, 'imp.notSource') });
      continue;
    }
    if (fc.binary) {
      uncertain.push({ kind: 'not-analyzed', file: fc.path, message: t(lang, 'imp.binary') });
      continue;
    }
    changed.push(await detectChanges(fc, graph, diff.baseCommit, args.readOld, uncertain, lang));
  }

  let needBase = false;
  for (const cf of changed) {
    for (const s of cf.symbols) {
      const bodyOnly = s.change === 'modified';
      if (s.change === 'removed') needBase = true;
      if (s.inGraph === 'head' && (s.change === 'modified' || s.change === 'signature-changed')) {
        seeds.push({ id: s.id, graph: 'head', change: s.change, maxDepth: bodyOnly ? bodyOnlyDepth : maxDepth });
      } else if (s.change === 'removed') {
        seeds.push({ id: s.id, graph: 'base', change: 'removed', maxDepth });
      }
    }
    if (cf.fileLevelLines.length && cf.status !== 'D' && graph.nodes.has(cf.path)) {
      // Symbol'ga tegmagan o'zgarish faqat bevosita importerlarga ta'sir qilishi mumkin — chuqurroq tarqatilmaydi.
      seeds.push({ id: cf.path, graph: 'head', change: 'file-level', maxDepth: 1 });
    }
    if (cf.status === 'D' || (cf.status === 'R' && cf.oldPath)) {
      needBase = true;
      seeds.push({ id: cf.status === 'D' ? cf.path : cf.oldPath!, graph: 'base', change: 'file-removed', maxDepth: 1 });
    }
  }

  let baseGraph: CodeGraph | undefined;
  if (needBase) {
    try {
      baseGraph = await args.buildBaseGraph();
    } catch (e) {
      uncertain.push({ kind: 'warning', message: t(lang, 'imp.baseFailed', { err: e instanceof Error ? e.message : String(e) }) });
    }
  }

  // ---- 2) Tarqalish (teskari BFS) ----
  let truncated = false;
  const reachedHead = new Map<string, Reached>();
  const reachedBase = new Map<string, Reached>();
  const run = (g: CodeGraph, list: Seed[], out: Map<string, Reached>) => {
    const queue: Reached[] = [];
    for (const s of list) {
      if (!g.nodes.has(s.id)) continue;
      const r: Reached = { id: s.id, depth: 0, parent: null, edge: null, seed: s, pathConf: 'verified' };
      if (!out.has(s.id)) {
        out.set(s.id, r);
        queue.push(r);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi]!;
      if (cur.depth >= cur.seed.maxDepth) continue;
      const node = g.nodes.get(cur.id)!;
      if (node.kind === 'test_file') continue; // test — barg
      const incoming: GraphEdge[] = g.incoming(cur.id, SYMBOL_EDGES);
      // Fayl darajasidagi o'zgarish/ishlatish: modul import qiluvchilari (taxminiy)
      const viaImports = isFileNode(node) ? g.incoming(cur.id, ['imports']) : [];
      for (const e of [...incoming, ...viaImports]) {
        if (out.has(e.from)) continue;
        if (out.size >= maxNodes) {
          truncated = true;
          break;
        }
        const stepConf = e.kind === 'imports' ? 'possible' : e.confidence === 'verified' ? 'verified' : 'possible';
        const r: Reached = {
          id: e.from,
          depth: cur.depth + 1,
          parent: cur.id,
          edge: e,
          seed: cur.seed,
          pathConf: cur.pathConf === 'verified' && stepConf === 'verified' ? 'verified' : 'possible',
        };
        out.set(e.from, r);
        queue.push(r);
      }
    }
  };
  run(graph, seeds.filter((s) => s.graph === 'head'), reachedHead);
  if (baseGraph) run(baseGraph, seeds.filter((s) => s.graph === 'base'), reachedBase);

  // ---- 3) Hisobot elementlari ----
  const build = (g: CodeGraph, reached: Map<string, Reached>, which: 'head' | 'base') => {
    const items: AffectedItem[] = [];
    const tests: RelatedTest[] = [];
    for (const r of reached.values()) {
      if (r.depth === 0) continue;
      const node = g.nodes.get(r.id)!;
      const path = pathOf(reached, r);
      if (node.kind === 'test_file') {
        const last = path[0];
        const direct = r.depth === 1 && last && last.kind !== 'imports';
        tests.push({
          file: node.file,
          relevance: direct ? 'direct-use' : last?.kind === 'imports' ? 'imports-only' : 'transitive',
          because: t(lang, direct ? 'imp.testDirect' : 'imp.testChain', { src: shortId(r.seed.id), chg: r.seed.change }),
          path,
        });
        continue;
      }
      // O'zgargan faylning o'z fayl-node'i (top-level `export default x` kabi) — foydali ma'lumot emas, shovqin.
      if (isFileNode(node) && node.file === splitNodeId(r.seed.id).file) continue;
      // Base graph'dagi dependent hozir ham mavjudmi (o'chirilmaganmi)? Baribir ko'rsatamiz, lekin joyi eski.
      const head = which === 'base' ? graph.nodes.get(r.id) : node;
      items.push({
        id: r.id,
        kind: node.kind,
        name: node.name,
        file: node.file,
        loc: (head ?? node).loc,
        depth: r.depth,
        tier: r.depth === 1 ? 'direct' : 'indirect',
        confidence: r.pathConf,
        cause: { id: r.seed.id, change: r.seed.change },
        path,
        reason: explain(node, r, g, lang),
        alsoChanged: changedPaths.has(node.file),
      });
    }
    return { items, tests };
  };
  const h = build(graph, reachedHead, 'head');
  const b = baseGraph ? build(baseGraph, reachedBase, 'base') : { items: [], tests: [] };

  const byId = new Map<string, AffectedItem>();
  for (const it of [...h.items, ...b.items]) {
    const old = byId.get(it.id);
    if (!old || it.depth < old.depth) byId.set(it.id, it);
  }
  const order = (a: AffectedItem, c: AffectedItem) => a.depth - c.depth || (a.confidence === c.confidence ? 0 : a.confidence === 'verified' ? -1 : 1) || a.id.localeCompare(c.id);
  const all = [...byId.values()].sort(order);
  const direct = all.filter((i) => i.tier === 'direct');
  const indirect = all.filter((i) => i.tier === 'indirect');

  // ---- 4) Testlar ----
  const testMap = new Map<string, RelatedTest>();
  const rank = { 'direct-use': 0, transitive: 1, 'imports-only': 2 } as const;
  const putTest = (t: RelatedTest) => {
    const old = testMap.get(t.file);
    if (!old || rank[t.relevance] < rank[old.relevance]) testMap.set(t.file, t);
  };
  [...h.tests, ...b.tests].forEach(putTest);
  // O'zgargan va ta'sirlangan fayllarni import qiluvchi testlar (zaif aloqa)
  const touchedFiles = new Set<string>([...changed.filter((c) => c.status !== 'D').map((c) => c.path), ...all.map((i) => i.file)]);
  for (const f of touchedFiles) {
    for (const e of graph.incoming(f, ['tests'])) {
      const tf = graph.nodes.get(e.from)!;
      if (!testMap.has(tf.file)) {
        putTest({ file: tf.file, relevance: 'imports-only', because: t(lang, 'imp.testImports', { file: f }), path: [step(e)] });
      }
    }
  }
  const relatedTests = [...testMap.values()].sort((a, c) => rank[a.relevance] - rank[c.relevance] || a.file.localeCompare(c.file));

  // O'zgargan symbol'lar uchun test qamrovi: testga yetib boradigan seed'lar
  const testedSeeds = new Set<string>([...h.tests, ...b.tests].filter((t) => t.relevance !== 'imports-only').map((t) => causeOf(t)));
  const untested: ImpactReport['untested'] = [];
  for (const cf of changed) {
    for (const s of cf.symbols) {
      if (s.change === 'added' || s.change === 'removed') continue;
      if (!testedSeeds.has(s.id)) untested.push({ id: s.id, file: cf.path, name: s.name });
    }
  }

  // ---- 4b) Next.js marshrutlari ----
  const routes = computeRoutes(graph, changed, all, lang);
  const ROUTE_CAP = 300;

  // ---- 5) Noaniqliklar ----
  const reportFiles = new Set<string>([...changed.map((c) => c.path), ...all.map((i) => i.file)]);
  for (const u of graph.unresolved) {
    if (!reportFiles.has(u.file)) continue;
    if (u.reason === 'unresolved-module') {
      uncertain.push({ kind: 'broken-import', file: u.file, line: u.loc.startLine, message: t(lang, 'imp.brokenImport', { spec: u.snippet }) });
    } else {
      uncertain.push({ kind: 'unresolved-dynamic', file: u.file, line: u.loc.startLine, message: t(lang, 'imp.unresolvedDyn', { reason: u.reason, snippet: u.snippet }) });
    }
  }
  for (const f of changed) {
    for (const e of parsedByPath.get(f.path)?.errors ?? []) {
      uncertain.push({ kind: 'parse-error', file: f.path, line: e.loc.startLine, message: t(lang, 'imp.parseError', { msg: e.message }) });
    }
  }
  if (routes.length > ROUTE_CAP) uncertain.push({ kind: 'truncated', message: t(lang, 'imp.routesCut', { cap: ROUTE_CAP, total: routes.length }) });
  if (truncated) uncertain.push({ kind: 'truncated', message: t(lang, 'imp.cut', { max: maxNodes }) });
  if (diff.spec.kind === 'staged') uncertain.push({ kind: 'warning', message: t(lang, 'imp.staged') });

  const changedSymbols = changed.reduce((n, c) => n + c.symbols.length, 0);
  return {
    spec: diff.spec,
    baseCommit: diff.baseCommit,
    changed,
    direct,
    indirect,
    tests: relatedTests,
    routes: routes.slice(0, ROUTE_CAP),
    untested,
    uncertain,
    options: { maxDepth, bodyOnlyDepth, maxNodes },
    stats: { changedFiles: changed.length, changedSymbols, direct: direct.length, indirect: indirect.length, tests: relatedTests.length, routes: routes.length, ms: Math.round(performance.now() - t0), truncated },
  };
}

// ---- yordamchilar ----

function shortId(id: string): string {
  const { file, symbol } = splitNodeId(id);
  return symbol ? `${symbol} @ ${file}` : id;
}

function step(e: GraphEdge): PathStep {
  return { from: e.from, to: e.to, kind: e.kind, confidence: e.confidence, evidence: e.evidence, via: e.via };
}

function pathOf(reached: Map<string, Reached>, r: Reached): PathStep[] {
  const out: PathStep[] = [];
  for (let cur: Reached | undefined = r; cur && cur.edge; cur = cur.parent ? reached.get(cur.parent) : undefined) out.push(step(cur.edge));
  return out;
}

function causeOf(t: RelatedTest): string {
  const last = t.path[t.path.length - 1];
  return last ? last.to : '';
}

function explain(node: GraphNode, r: Reached, g: CodeGraph, lang: Lang): string {
  const e = r.edge!;
  const target = g.nodes.get(e.to);
  const tn = target ? (isFileNode(target) ? target.file : target.name) : e.to;
  const chgKey = { 'file-level': 'imp.chg.fileLevel', 'file-removed': 'imp.chg.fileRemoved', added: 'imp.chg.added', removed: 'imp.chg.removed', modified: 'imp.chg.modified', 'signature-changed': 'imp.chg.signatureChanged' } as const;
  const verb = t(lang, `imp.verb.${e.kind}` as 'imp.verb.calls');
  const hop = r.depth === 1 ? t(lang, 'imp.hop1', { target: tn, verb, loc: `${e.evidence.file}:${e.evidence.startLine}` }) : t(lang, 'imp.hopN', { target: tn, n: r.depth, verb });
  return t(lang, 'imp.explain', { name: node.name, hop, src: shortId(r.seed.id), chg: t(lang, chgKey[r.seed.change]) });
}

async function detectChanges(
  fc: FileChange,
  graph: CodeGraph,
  baseCommit: string | null,
  readOld: AnalyzeArgs['readOld'],
  uncertain: UncertainItem[],
  lang: Lang,
): Promise<ChangedFile> {
  const out: ChangedFile = { path: fc.path, oldPath: fc.oldPath, status: fc.status, symbols: [], fileLevelLines: [] };
  const newSyms = fc.status === 'D' ? [] : graph.nodesInFile(fc.path).filter((n) => !isFileNode(n));
  const oldPath = fc.oldPath ?? fc.path;

  let oldSyms: ParsedSymbol[] = [];
  if (fc.status !== 'A') {
    if (!baseCommit) {
      uncertain.push({ kind: 'warning', file: fc.path, message: t(lang, 'imp.noBase') });
    } else {
      const text = await readOld(baseCommit, oldPath);
      if (text === null) uncertain.push({ kind: 'warning', file: fc.path, message: t(lang, 'imp.noOldText') });
      else oldSyms = parseSource(oldPath, text).symbols;
    }
  }
  const oldByName = new Map(oldSyms.map((s) => [s.qualifiedName, s]));

  const mk = (n: GraphNode, change: SymbolChange): ChangedSymbol => ({ id: n.id, name: n.name, kind: n.kind, change, inGraph: 'head', loc: n.loc });

  if (fc.status === 'A') {
    for (const n of newSyms) out.symbols.push(mk(n, 'added'));
    return out;
  }
  if (fc.status === 'D') {
    for (const s of oldSyms) {
      out.symbols.push({ id: `${oldPath}#${s.qualifiedName}`, name: s.name, kind: s.kind, change: 'removed', inGraph: 'base', loc: s.loc });
    }
    return out;
  }

  // M / R
  const hitByRange = new Set<number>();
  const symLocs = newSyms.map((n) => ({ loc: n.loc }));
  const newNamesAll = new Set(newSyms.map((n) => n.qualifiedName));
  const removedOld = oldSyms.filter((s) => !newNamesAll.has(s.qualifiedName));
  for (let ri = 0; ri < fc.newRanges.length; ri++) {
    const r = fc.newRanges[ri]!;
    const hits = innermostHit(symLocs, r);
    // Sof o'chirish hunk'i (yangi tomonda 0 satr) to'liq o'chirilgan symbol'ga to'g'ri kelsa — u allaqachon `removed` deb qayd etiladi.
    const o = fc.oldRanges[ri];
    const explainedByRemoval =
      r.count === 0 && o !== undefined && removedOld.some((s) => s.loc.startLine <= o.start + o.count - 1 && s.loc.endLine >= o.start);
    if (hits.length === 0 && !explainedByRemoval) {
      const [a, b] = rangeLines(r);
      for (let l = a; l <= Math.min(b, a + 200); l++) out.fileLevelLines.push(l);
    }
    hits.forEach((i) => hitByRange.add(i));
  }
  newSyms.forEach((n, i) => {
    const old = oldByName.get(n.qualifiedName);
    if (!old) {
      if (baseCommit) out.symbols.push(mk(n, 'added'));
      return;
    }
    if (old.signature !== n.signature || old.exported !== n.exported || old.kind !== n.kind) out.symbols.push(mk(n, 'signature-changed'));
    else if (hitByRange.has(i)) out.symbols.push(mk(n, 'modified'));
  });
  const newNames = new Set(newSyms.map((n) => n.qualifiedName));
  for (const s of oldSyms) {
    if (!newNames.has(s.qualifiedName)) out.symbols.push({ id: `${oldPath}#${s.qualifiedName}`, name: s.name, kind: s.kind, change: 'removed', inGraph: 'base', loc: s.loc });
  }
  return out;
}

// ---- Next.js marshrutlari ----

/** `app/` yoki `pages/` ildizigacha bo'lgan prefiks: bir xil Next.js ilovasiga tegishlilikni taxminan aniqlash (monorepo). */
const appBase = (file: string): string => /^(.*?)(?:src\/)?(?:app|pages)\//.exec(file)?.[1] ?? '';

function computeRoutes(graph: CodeGraph, changed: ChangedFile[], items: AffectedItem[], lang: Lang): AffectedRoute[] {
  const routeNodes = [...graph.nodes.values()].filter((n) => n.route);
  if (routeNodes.length === 0) return [];
  const leaves = routeNodes.filter((n) => isLeafRoute(n.route!));

  const touched = new Map<string, { reason: 'changed' | 'affected'; because: string }>();
  for (const c of changed) if (c.status !== 'D') touched.set(c.path, { reason: 'changed', because: t(lang, 'imp.touchChanged') });
  for (const i of items) if (!touched.has(i.file)) touched.set(i.file, { reason: 'affected', because: t(lang, 'imp.touchAffected', { name: i.name, tier: i.tier, src: shortId(i.cause.id) }) });

  // Bitta marshrut fayli faqat BIR marta: bir nechta layout/ta'sir orqali kelsa, eng kuchli sabab qoldiriladi.
  const strength = { changed: 0, affected: 1, 'via-layout': 2, 'via-middleware': 3 } as const;
  const out = new Map<string, AffectedRoute>();
  const put = (r: AffectedRoute) => {
    const k = `${r.route}|${r.file}`;
    const old = out.get(k);
    if (!old || strength[r.reason] < strength[old.reason]) out.set(k, r);
  };
  for (const [file, why] of touched) {
    const node = graph.nodes.get(file);
    const route = node?.route;
    if (!node || !route) continue;
    if (isLeafRoute(route)) {
      put({ route: route.path, role: route.role, router: route.router, file, reason: why.reason, because: why.because });
    } else if (isScopeRoute(route)) {
      const base = appBase(file);
      const scope = route.path;
      const prefix = scope === '/' || scope === '*' ? '' : scope;
      const isMw = route.role === 'middleware';
      for (const l of leaves) {
        if (appBase(l.file) !== base) continue;
        // middleware hamma marshrutga (handler'lar ham); layout/_app esa faqat shu router'dagi SAHIFALARga qo'llanadi
        if (!isMw && (l.route!.router !== route.router || l.route!.role !== 'page')) continue;
        if (prefix && l.route!.path !== prefix && !l.route!.path.startsWith(prefix + '/')) continue;
        put({
          route: l.route!.path, role: l.route!.role, router: l.route!.router, file: l.file,
          reason: route.role === 'middleware' ? 'via-middleware' : 'via-layout',
          because: t(lang, 'imp.routeVia', { role: route.role, scope: scope === '*' ? '' : scope + ' ', file, state: t(lang, why.reason === 'changed' ? 'imp.stChanged' : 'imp.stAffected') }),
        });
      }
      // Layout/middleware'ning o'zi ham marshrut qatlami sifatida ko'rsatiladi
      put({ route: route.path, role: route.role, router: route.router, file, reason: why.reason, because: why.because });
    }
  }
  const rank = { changed: 0, affected: 1, 'via-layout': 2, 'via-middleware': 3 } as const;
  return [...out.values()].sort((a, b) => rank[a.reason] - rank[b.reason] || a.route.localeCompare(b.route) || a.file.localeCompare(b.file));
}
