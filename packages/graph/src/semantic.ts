import ts from 'typescript';
import path from 'node:path';
import type { Confidence, EdgeKind, GraphEdge, GraphNode, GraphUnresolved, Loc, ParsedFile } from '@xray/core';
import { edgeKey } from '@xray/core';
import { locContains } from './model.ts';

/** Bitta fayl uchun semantik natija: shu fayldan CHIQADIGAN edge'lar. Keshlanadi (incremental). */
export interface FileSemantic {
  edges: GraphEdge[];
  unresolved: GraphUnresolved[];
  externals: string[];
}

export interface SemanticInput {
  root: string; // realpath
  files: ParsedFile[];
  /** fayl yo'li -> shu fayldagi node'lar (file node + symbol'lar) */
  nodesByFile: Map<string, GraphNode[]>;
  /** Faqat shu fayllar uchun hisoblanadi (yo'q bo'lsa — hammasi). */
  only?: ReadonlySet<string>;
  /** Monorepo workspace paketlari (name -> papka); `paths` ga qo'shiladi */
  workspacePackages?: readonly { name: string; dir: string }[];
}

const ASSET_EXT = new Set([
  '.css', '.scss', '.sass', '.less', '.styl', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.webm', '.wav', '.glb', '.gltf', '.json',
  '.md', '.mdx', '.txt', '.wasm', '.html', '.vue', '.svelte',
]);

const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];

function pkgName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}

interface Group {
  configPath: string | null;
  options: ts.CompilerOptions;
  files: string[]; // repo-relative
}

/** Konfigni o'qiydi, lekin hech narsa bajarmaydi va papkalarni aylanmaydi (readDirectory o'chirilgan). */
function loadOptions(configPath: string | null): ts.CompilerOptions {
  let base: ts.CompilerOptions = {};
  if (configPath) {
    try {
      const raw = ts.readConfigFile(configPath, ts.sys.readFile);
      if (!raw.error) {
        const host: ts.ParseConfigHost = { ...ts.sys, readDirectory: () => [] };
        base = ts.parseJsonConfigFileContent(raw.config, host, path.dirname(configPath), undefined, configPath).options;
      }
    } catch {
      /* buzuq config — default bilan davom etamiz */
    }
  }
  return {
    ...base,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    lib: ['lib.es2022.d.ts'], // Promise/Array turlari kerak: `await import()` va `.then(m => m.X)` orqali tur oqadi
    plugins: undefined, // tsconfig plugin'lari hech qachon yuklanmaydi
    jsx: base.jsx ?? ts.JsxEmit.Preserve,
    moduleResolution: base.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
    module: base.module ?? ts.ModuleKind.ESNext,
    target: base.target ?? ts.ScriptTarget.ES2022,
  };
}

function nearestConfig(rootAbs: string, fileRel: string, cache: Map<string, string | null>): string | null {
  let dir = path.dirname(fileRel);
  const chain: string[] = [];
  for (;;) {
    const key = dir === '.' ? '' : dir;
    if (cache.has(key)) {
      const v = cache.get(key)!;
      for (const c of chain) cache.set(c, v);
      return v;
    }
    chain.push(key);
    for (const n of CONFIG_NAMES) {
      const abs = path.join(rootAbs, key, n);
      if (ts.sys.fileExists(abs)) {
        for (const c of chain) cache.set(c, abs);
        return abs;
      }
    }
    if (key === '') break;
    dir = path.dirname(dir);
  }
  for (const c of chain) cache.set(c, null);
  return null;
}

export function computeSemantic(input: SemanticInput): Map<string, FileSemantic> {
  const { root, nodesByFile, only } = input;
  const workspace = input.workspacePackages ?? [];
  // Parser ichki xatosi bergan fayllar Program'ga kiritilmaydi (ts.createProgram ham qulab tushishi mumkin).
  const files = input.files.filter((f) => !f.parseFailed);
  const fileSet = new Set(files.map((f) => f.path));
  const targets = files.filter((f) => !only || only.has(f.path));
  const result = new Map<string, FileSemantic>();
  if (targets.length === 0) return result;

  // 1) Fayllarni eng yaqin tsconfig/jsconfig bo'yicha guruhlaymiz.
  const cfgCache = new Map<string, string | null>();
  const refCache = new Map<string, { path: string; files: Set<string> }[]>();

  /** `tsconfig.json` faqat `references` bersa (Vite shabloni), fayl qaysi ma'lumotnomadagi config'ga tegishli bo'lsa — o'shani olamiz. */
  const referenced = (cfg: string): { path: string; files: Set<string> }[] => {
    const hit = refCache.get(cfg);
    if (hit) return hit;
    const out: { path: string; files: Set<string> }[] = [];
    try {
      const raw = ts.readConfigFile(cfg, ts.sys.readFile);
      const refs = (raw.config?.references ?? []) as { path?: string }[];
      const own = raw.config as { files?: unknown[]; include?: unknown[] } | undefined;
      const delegates = refs.length > 0 && ((own?.files?.length ?? 0) === 0) && !own?.include;
      if (delegates) {
        for (const r of refs) {
          if (!r.path) continue;
          let rp = path.resolve(path.dirname(cfg), r.path);
          if (!rp.endsWith('.json')) rp = path.join(rp, 'tsconfig.json');
          const rr = ts.readConfigFile(rp, ts.sys.readFile);
          if (rr.error) continue;
          const parsed = ts.parseJsonConfigFileContent(rr.config, ts.sys, path.dirname(rp), undefined, rp);
          out.push({ path: rp, files: new Set(parsed.fileNames.map((f) => path.normalize(f))) });
        }
      }
    } catch {
      /* buzuq config */
    }
    refCache.set(cfg, out);
    return out;
  };
  const configFor = (fileRel: string): string | null => {
    const base = nearestConfig(root, fileRel, cfgCache);
    if (!base) return null;
    const abs = path.normalize(path.join(root, fileRel));
    for (const r of referenced(base)) if (r.files.has(abs)) return r.path;
    return base;
  };
  const optCache = new Map<string, ts.CompilerOptions>();
  /**
   * Workspace paketlarini `paths` ga qo'shamiz (config'da shu nomli yozuv bo'lmasa). Maqsad `src/` — chunki `main/types` odatda
   * hali build qilinmagan `dist`ga ishora qiladi. Mavjud tsconfig `paths` yozuvlari ustun.
   */
  const withWorkspace = (o: ts.CompilerOptions): ts.CompilerOptions => {
    if (workspace.length === 0) return o;
    const paths: Record<string, string[]> = { ...(o.paths ?? {}) };
    for (const p of workspace) {
      const abs = path.join(root, p.dir);
      if (!(p.name in paths)) paths[p.name] = [path.join(abs, 'src'), abs];
      if (!(`${p.name}/*` in paths)) paths[`${p.name}/*`] = [path.join(abs, 'src', '*'), path.join(abs, '*')];
    }
    const next = { ...o, paths } as ts.CompilerOptions & { pathsBasePath?: string };
    if (!next.baseUrl && !next.pathsBasePath) next.pathsBasePath = root; // baseUrl QO'YILMAYDI: bare import'larni buzadi
    return next;
  };
  const optionsFor = (cfg: string | null) => {
    const k = cfg ?? '';
    let o = optCache.get(k);
    if (!o) optCache.set(k, (o = withWorkspace(loadOptions(cfg))));
    return o;
  };
  const groups = new Map<string, Group>();
  for (const f of files) {
    const cfg = configFor(f.path);
    const key = cfg ?? '';
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { configPath: cfg, options: optionsFor(cfg), files: [] }));
    g.files.push(f.path);
  }

  const resolutionCache = new Map<string, ts.ModuleResolutionCache>();

  // 2) Import/re-export edge'lar (type-checker kerak emas)
  const resolveSpec = (spec: string, fromRel: string, opts: ts.CompilerOptions, cacheKey: string) => {
    const ext = path.extname(spec).toLowerCase();
    if (ASSET_EXT.has(ext)) return { kind: 'asset' as const };
    let cache = resolutionCache.get(cacheKey);
    if (!cache) resolutionCache.set(cacheKey, (cache = ts.createModuleResolutionCache(root, (s) => s, opts)));
    const r = ts.resolveModuleName(spec, path.join(root, fromRel), opts, ts.sys, cache);
    const rm = r.resolvedModule;
    if (rm) {
      const rf = rm.resolvedFileName;
      const rel = path.relative(root, rf).split(path.sep).join('/');
      // Workspace paketlari node_modules orqali symlink bilan keladi (`isExternalLibraryImport`), lekin HAQIQIY fayl repo ichida — tashqi emas.
      if (!rel.startsWith('..') && !rel.split('/').includes('node_modules')) {
        return fileSet.has(rel) ? { kind: 'file' as const, path: rel } : { kind: 'ignored' as const };
      }
      return { kind: 'external' as const, pkg: pkgName(spec) };
    }
    if (spec.startsWith('/')) return { kind: 'external' as const, pkg: '(absolute-path)' };
    // `@/x`, `~/x`, `#x` — paket emas, alias. Config'da yo'q bo'lsa jimgina "tashqi paket" deb ATAMAYMIZ.
    if (spec.startsWith('.') || /^(@\/|~\/|#)/.test(spec)) return { kind: 'unresolved' as const };
    return { kind: 'external' as const, pkg: pkgName(spec) };
  };

  const fileNodeId = (p: string) => p;

  const nodeAt = (file: string, line: number, col: number): GraphNode | undefined => {
    let best: GraphNode | undefined;
    let bestSpan = Infinity;
    for (const n of nodesByFile.get(file) ?? []) {
      if (n.kind === 'file' || n.kind === 'test_file') continue;
      if (!locContains(n.loc, line, col)) continue;
      const span = (n.loc.endLine - n.loc.startLine) * 100000 + (n.loc.endCol - n.loc.startCol);
      if (span < bestSpan) {
        best = n;
        bestSpan = span;
      }
    }
    return best;
  };

  // Import edge'lari hamma fayl uchun hisoblanadi (guruhlararo bog'liqlik grafi kerak); natija faqat `targets` uchun saqlanadi.
  const importTargets = new Map<string, string[]>();
  for (const pf of files) {
    const edges = new Map<string, GraphEdge>();
    const unresolved: GraphUnresolved[] = pf.unresolved.map((u) => ({ file: pf.path, reason: u.reason, snippet: u.snippet, loc: u.loc }));
    const externals = new Set<string>();
    const cfg = configFor(pf.path);
    const opts = optionsFor(cfg);
    const cacheKey = cfg ?? '';

    const add = (e: GraphEdge) => {
      if (e.from === e.to) return;
      const k = edgeKey(e);
      const old = edges.get(k);
      if (!old) {
        edges.set(k, e);
        return;
      }
      old.count += e.count;
      if (old.confidence !== 'verified' && e.confidence === 'verified') old.confidence = 'verified';
      if (old.via === 'type' && e.via !== 'type') old.via = e.via;
    };

    const importLike: { spec: string; via?: string; loc: Loc }[] = [
      ...pf.imports.map((i) => ({ spec: i.specifier, via: i.typeOnly ? 'type' : i.kind === 'static' ? undefined : i.kind, loc: i.loc })),
      ...pf.exports.filter((e) => e.from).map((e) => ({ spec: e.from!, via: 're-export', loc: e.loc })),
    ];
    for (const il of importLike) {
      const r = resolveSpec(il.spec, pf.path, opts, cacheKey);
      if (r.kind === 'file') {
        add({ from: fileNodeId(pf.path), to: fileNodeId(r.path), kind: 'imports', confidence: 'verified', count: 1, evidence: il.loc, via: il.via });
      } else if (r.kind === 'external') {
        externals.add(r.pkg);
      } else if (r.kind === 'unresolved') {
        unresolved.push({ file: pf.path, reason: 'unresolved-module', snippet: il.spec, loc: il.loc });
      }
    }
    importTargets.set(pf.path, [...edges.values()].filter((e) => e.kind === 'imports').map((e) => e.to));
    if (!only || only.has(pf.path)) result.set(pf.path, { edges: [...edges.values()], unresolved, externals: [...externals].sort() });
  }

  // 3) Type-checker edge'lar (calls / renders / references / exports) — guruh bo'yicha bitta Program.
  for (const g of groups.values()) {
    const groupTargets = g.files.filter((p) => !only || only.has(p));
    if (groupTargets.length === 0) continue;

    try {
      // Boshqa guruhdagi (masalan, qo'shni paketdagi) fayllarga import qilinsa, ularsiz symbol resolve bo'lmaydi:
      // import yopilmasini qo'shimcha root sifatida Program'ga qo'shamiz (lekin ularni TAHLIL qilmaymiz).
      const own = new Set(g.files);
      const extra = new Set<string>();
      const queue = [...g.files];
      for (let qi = 0; qi < queue.length && extra.size < 4000; qi++) {
        for (const t of importTargets.get(queue[qi]!) ?? []) {
          if (!own.has(t) && !extra.has(t)) {
            extra.add(t);
            queue.push(t);
          }
        }
      }
      const program = ts.createProgram({
        rootNames: [...g.files, ...extra].map((p) => path.join(root, p)),
        options: { ...g.options, noResolve: true },
      });
      const checker = program.getTypeChecker();
      const relOf = (abs: string) => path.relative(root, abs).split(path.sep).join('/');

      const declCache = new Map<ts.Node, { node: GraphNode; exact: boolean } | null>();
      const targetOfDecl = (d: ts.Declaration) => {
        const hit = declCache.get(d);
        if (hit !== undefined) return hit;
        let out: { node: GraphNode; exact: boolean } | null = null;
        const sf = d.getSourceFile();
        if (!ts.isSourceFile(d) && !sf.isDeclarationFile) {
          const rel = relOf(sf.fileName);
          if (nodesByFile.has(rel)) {
            const lc = sf.getLineAndCharacterOfPosition(d.getStart(sf));
            const n = nodeAt(rel, lc.line + 1, lc.character + 1);
            if (n) out = { node: n, exact: n.loc.startLine === lc.line + 1 && n.loc.startCol === lc.character + 1 };
          }
        }
        declCache.set(d, out);
        return out;
      };
      const resolveSym = (sym: ts.Symbol | undefined): ts.Symbol | undefined => {
        if (!sym) return undefined;
        if (sym.flags & ts.SymbolFlags.Alias) {
          try {
            return checker.getAliasedSymbol(sym);
          } catch {
            return undefined;
          }
        }
        return sym;
      };
      const targetOfSymbol = (raw: ts.Symbol | undefined) => {
        const sym = resolveSym(raw);
        for (const d of sym?.declarations ?? []) {
          const t = targetOfDecl(d);
          if (t) return t;
        }
        return undefined;
      };
      const targetOf = (n: ts.Node) => targetOfSymbol(checker.getSymbolAtLocation(n));

      for (const rel of groupTargets) {
        const sf = program.getSourceFile(path.join(root, rel));
        const sem = result.get(rel);
        if (!sf || !sem) continue;
        const edges = new Map<string, GraphEdge>(sem.edges.map((e) => [edgeKey(e), e]));
        const add = (e: GraphEdge) => {
          if (e.from === e.to) return;
          const k = edgeKey(e);
          const old = edges.get(k);
          if (!old) {
            edges.set(k, e);
            return;
          }
          old.count += e.count;
          if (old.confidence !== 'verified' && e.confidence === 'verified') old.confidence = 'verified';
        };
        const locOf = (n: ts.Node): Loc => {
          const s = sf.getLineAndCharacterOfPosition(n.getStart(sf));
          const e = sf.getLineAndCharacterOfPosition(n.getEnd());
          return { file: rel, startLine: s.line + 1, startCol: s.character + 1, endLine: e.line + 1, endCol: e.character + 1 };
        };
        const enclosing = (n: ts.Node): GraphNode | undefined => {
          const lc = sf.getLineAndCharacterOfPosition(n.getStart(sf));
          return nodeAt(rel, lc.line + 1, lc.character + 1) ?? (nodesByFile.get(rel) ?? []).find((x) => x.id === rel);
        };
        const inTypePosition = (n: ts.Node): boolean => {
          for (let p: ts.Node | undefined = n.parent, i = 0; p && i < 8; p = p.parent, i++) {
            if (ts.isTypeNode(p) && !ts.isExpressionWithTypeArguments(p)) return true;
            if (ts.isStatement(p) || ts.isBlock(p)) return false;
          }
          return false;
        };

        const link = (kind: EdgeKind, nameNode: ts.Node, evidenceNode: ts.Node, via?: string, target?: ReturnType<typeof targetOf>) => {
          const t = target ?? targetOf(nameNode);
          if (!t) return;
          const from = enclosing(evidenceNode);
          if (!from) return;
          const typePos = kind === 'references' && inTypePosition(nameNode);
          const confidence: Confidence = t.exact ? 'verified' : 'possible';
          add({
            from: from.id,
            to: t.node.id,
            kind,
            confidence,
            count: 1,
            evidence: locOf(evidenceNode),
            via: typePos ? 'type' : t.exact ? via : 'member-of-declaration',
          });
        };

        const handled = new Set<ts.Node>();
        const isDeclName = (n: ts.Identifier): boolean => {
          const p = n.parent as (ts.Node & { name?: ts.Node }) | undefined;
          if (!p) return false;
          if (ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) return false; // `a.b` dagi b — reference
          return p.name === n;
        };

        const visit = (n: ts.Node): void => {
          if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isImportEqualsDeclaration(n)) return;
          if (ts.isJsxClosingElement(n)) return; // `</Foo>` — ochuvchi teg allaqachon hisoblangan
          if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
            const c = n.expression;
            const nameNode = ts.isIdentifier(c) ? c : ts.isPropertyAccessExpression(c) ? c.name : undefined;
            if (nameNode) {
              handled.add(nameNode);
              link('calls', nameNode, n, ts.isNewExpression(n) ? 'new' : undefined);
            }
          } else if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
            const tag = n.tagName;
            const nameNode = ts.isIdentifier(tag) ? tag : ts.isPropertyAccessExpression(tag) ? tag.name : undefined;
            if (nameNode && !/^[a-z]/.test(nameNode.text) /* <div> kabi intrinsic'lar emas */) {
              handled.add(nameNode);
              link('renders', nameNode, n);
            } else if (nameNode) handled.add(nameNode);
          } else if (ts.isShorthandPropertyAssignment(n)) {
            // `{ foo }` — foo o'zgaruvchisiga haqiqiy ishlatish
            link('references', n.name, n.name, undefined, targetOfSymbol(checker.getShorthandAssignmentValueSymbol(n)));
          } else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && !n.propertyName && ts.isIdentifier(n.name)) {
            // `const { foo } = await import('./m')` — manba obyektning `foo` xossasiga murojaat
            const prop = checker.getTypeAtLocation(n.parent).getProperty(n.name.text);
            link('references', n.name, n.name, undefined, targetOfSymbol(prop));
          } else if (ts.isIdentifier(n) && !handled.has(n) && !isDeclName(n)) {
            link('references', n, n);
          }
          ts.forEachChild(n, visit);
        };
        visit(sf);

        // exports: modul eksportlari (re-export va `export *` shaffof) -> asl deklaratsiya node'lari
        const modSym = checker.getSymbolAtLocation(sf);
        if (modSym) {
          const fileId = fileNodeId(rel);
          for (const ex of checker.getExportsOfModule(modSym)) {
            const isAlias = !!(ex.flags & ts.SymbolFlags.Alias);
            const target = resolveSym(ex);
            const decl = target?.declarations?.map(targetOfDecl).find(Boolean);
            if (!decl) continue;
            const here = ex.declarations?.find((d) => d.getSourceFile() === sf);
            let via: string | undefined;
            let evidence: Loc;
            if (here) {
              evidence = locOf(here);
              via = isAlias && decl.node.file !== rel ? 're-export' : undefined;
            } else {
              const star = sf.statements.find((s): s is ts.ExportDeclaration => ts.isExportDeclaration(s) && !s.exportClause);
              evidence = locOf(star ?? sf);
              via = 'export *';
            }
            add({ from: fileId, to: decl.node.id, kind: 'exports', confidence: decl.exact || decl.node.kind !== 'variable' ? 'verified' : 'possible', count: 1, evidence, via });
          }
        }

        result.set(rel, { ...sem, edges: [...edges.values()] });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const rel of groupTargets) {
        const sem = result.get(rel);
        sem?.unresolved.push({ file: rel, reason: 'analysis-failed', snippet: msg.slice(0, 120), loc: { file: rel, startLine: 1, startCol: 1, endLine: 1, endCol: 1 } });
      }
    }
  }

  return result;
}
