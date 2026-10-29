import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_LANG, t, type Lang, type ParsedFile, type ScanResult } from '@xray/core';
import { scanRepository, type ScanOptions } from '@xray/scanner';
import { parseSource } from '@xray/parser';
import { assemble, buildNodes, nodesByFile } from './assemble.ts';
import { detectNextRoots, detectWorkspacePackages } from './routes.ts';
import { computeSemantic, type FileSemantic } from './semantic.ts';
import { splitIdent, XrayStore, type FtsRow, type StoredFile } from './store.ts';
import type { CodeGraph } from './model.ts';

export type IndexMode = 'full' | 'incremental' | 'noop';

export interface IndexOptions {
  /** SQLite fayl yo'li. Berilmasa — saqlanmaydi (xotirada). */
  dbPath?: string;
  scan?: ScanOptions;
  /** Keshni e'tiborsiz qoldirib to'liq qayta quradi. */
  full?: boolean;
  /** `stats.reason` matni tili (default 'uz'); `reasonCode` esa tildan mustaqil */
  lang?: Lang;
}

export interface IndexResult {
  root: string;
  scan: ScanResult;
  files: ParsedFile[];
  failed: { path: string; error: string }[];
  graph: CodeGraph;
  stats: {
    mode: IndexMode;
    reason: string;
    /** Tildan mustaqil kod (UI o'z tilida matn yasaydi) */
    reasonCode: 'forced' | 'first' | 'config' | 'structure' | 'noop' | 'incremental';
    reasonArgs: Record<string, number>;
    scanned: number;
    parsed: number;
    reparsed: number;
    semanticRecomputed: number;
    withSyntaxErrors: number;
    failed: number;
    nodes: number;
    edges: number;
    unresolved: number;
    ms: number;
  };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Resolve'ga ta'sir qiladigan config fayllar (eng yaqin tsconfig/jsconfig) hash'i. `extends` zanjiri kuzatilmaydi (--full). */
async function configFingerprint(root: string, files: readonly string[]): Promise<string> {
  const dirs = new Set<string>(['']);
  for (const f of files) {
    let d = path.dirname(f);
    while (d !== '.' && !dirs.has(d)) {
      dirs.add(d);
      d = path.dirname(d);
    }
  }
  const h = createHash('sha256');
  for (const d of [...dirs].sort()) {
    let names: string[] = [];
    try {
      names = (await fs.readdir(path.join(root, d))).filter((n) => /^(ts|js)config(\..+)?\.json$/.test(n)).sort(); // tsconfig.app.json kabilar ham
    } catch {
      /* o'qib bo'lmadi */
    }
    for (const n of names) {
      try {
        h.update(`${d}/${n}\0${await fs.readFile(path.join(root, d, n), 'utf8')}\0`);
      } catch {
        /* yo'q */
      }
    }
  }
  return h.digest('hex');
}

function ftsRows(pf: ParsedFile, text: string): FtsRow[] {
  const lines = text.split('\n');
  const rows: FtsRow[] = [
    { id: pf.path, file: pf.path, name: pf.path.split('/').pop() ?? pf.path, tokens: splitIdent(pf.path), body: '' },
  ];
  for (const s of pf.symbols) {
    const body = lines.slice(s.loc.startLine - 1, Math.min(s.loc.endLine, s.loc.startLine + 39)).join('\n');
    rows.push({ id: `${pf.path}#${s.qualifiedName}`, file: pf.path, name: s.name, tokens: `${splitIdent(s.qualifiedName)} ${splitIdent(pf.path)}`, body });
  }
  return rows;
}

/** Fayl o'zgarsa, shu faylga (tranzitiv) bog'liq barcha fayllar semantikasi eskirishi mumkin: teskari import yopilmasi. */
function reverseClosure(changed: ReadonlySet<string>, prevSemantic: ReadonlyMap<string, FileSemantic>): Set<string> {
  const rev = new Map<string, string[]>();
  for (const [from, sem] of prevSemantic) {
    for (const e of sem.edges) {
      if (e.kind !== 'imports') continue;
      let l = rev.get(e.to);
      if (!l) rev.set(e.to, (l = []));
      l.push(from);
    }
  }
  const out = new Set(changed);
  const stack = [...changed];
  while (stack.length) {
    for (const dep of rev.get(stack.pop()!) ?? []) {
      if (!out.has(dep)) {
        out.add(dep);
        stack.push(dep);
      }
    }
  }
  return out;
}

export async function indexProject(rootInput: string, opts: IndexOptions = {}): Promise<IndexResult> {
  const t0 = performance.now();
  const scan = await scanRepository(rootInput, opts.scan);
  const root = scan.root;
  const store = opts.dbPath ? new XrayStore(opts.dbPath) : undefined;

  try {
    // 1) O'qish + hash
    const texts = new Map<string, string>();
    const hashes = new Map<string, string>();
    const failed: IndexResult['failed'] = [];
    for (const f of scan.files) {
      try {
        const t = await fs.readFile(path.join(root, f.path), 'utf8');
        texts.set(f.path, t);
        hashes.set(f.path, sha(t));
      } catch (e) {
        failed.push({ path: f.path, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const current = [...hashes.keys()];
    const nextRoots = await detectNextRoots(root, current);
    // Next.js ildizlari ro'yxati ham fingerprint'ga kiradi (package.json'ga `next` qo'shilsa/olinsa marshrutlar o'zgaradi)
    const workspacePackages = await detectWorkspacePackages(root, current);
    const cfgHash = sha((await configFingerprint(root, current)) + '|next:' + nextRoots.join(',') + '|ws:' + workspacePackages.map((w) => `${w.name}=${w.dir}`).join(','));

    // 2) Oldingi holat
    const prevFiles = store ? store.loadFiles() : new Map<string, StoredFile>();
    const prevSem = store ? store.loadSemantic() : new Map<string, FileSemantic>();
    const prevCfg = store?.getMeta('config');
    const added = current.filter((p) => !prevFiles.has(p));
    const deleted = [...prevFiles.keys()].filter((p) => !hashes.has(p));
    const modified = current.filter((p) => prevFiles.has(p) && prevFiles.get(p)!.hash !== hashes.get(p));

    const lang: Lang = opts.lang ?? DEFAULT_LANG;
    let mode: IndexMode;
    let reasonCode: IndexResult['stats']['reasonCode'];
    let reasonArgs: Record<string, number> = {};
    if (opts.full) [mode, reasonCode] = ['full', 'forced'];
    else if (prevFiles.size === 0) [mode, reasonCode] = ['full', 'first'];
    else if (prevCfg !== cfgHash) [mode, reasonCode] = ['full', 'config'];
    else if (added.length || deleted.length) [mode, reasonCode, reasonArgs] = ['full', 'structure', { added: added.length, deleted: deleted.length }];
    else if (modified.length === 0) [mode, reasonCode] = ['noop', 'noop'];
    else [mode, reasonCode, reasonArgs] = ['incremental', 'incremental', { n: modified.length }];
    const reason = t(lang, `idx.${reasonCode}` as 'idx.first', reasonArgs);

    // 3) Parse
    const parsedMap = new Map<string, ParsedFile>();
    const toParse = mode === 'full' ? current : modified;
    for (const p of current) {
      if (mode !== 'full' && !toParse.includes(p)) parsedMap.set(p, prevFiles.get(p)!.parsed);
    }
    for (const p of toParse) {
      try {
        parsedMap.set(p, parseSource(p, texts.get(p)!));
      } catch (e) {
        // Parser ichki xatosi (masalan, juda chuqur ichma-ich ifoda) butun indekslashni to'xtatmasligi kerak — lekin YASHIRILMAYDI.
        const msg = e instanceof Error ? e.message : String(e);
        failed.push({ path: p, error: msg });
        parsedMap.set(p, { path: p, isTestFile: false, lineCount: 1, symbols: [], imports: [], exports: [], unresolved: [], parseFailed: true, errors: [{ message: `Parser xatosi: ${msg}`, loc: { file: p, startLine: 1, startCol: 1, endLine: 1, endCol: 1 } }] });
      }
    }
    const files = current.map((p) => parsedMap.get(p)!);
    const nodes = buildNodes(files, nextRoots);

    // 4) Semantika
    let semantic: Map<string, FileSemantic>;
    let recomputed = 0;
    if (mode === 'noop') {
      semantic = prevSem;
    } else {
      const only = mode === 'full' ? undefined : reverseClosure(new Set(modified), prevSem);
      const fresh = computeSemantic({ root, files, nodesByFile: nodesByFile(nodes), only, workspacePackages });
      recomputed = fresh.size;
      semantic = mode === 'full' ? fresh : new Map([...prevSem, ...fresh]);
    }

    // 5) Saqlash
    if (store && mode !== 'noop') {
      const saveFiles = new Map<string, StoredFile>();
      const fts = new Map<string, FtsRow[]>();
      for (const p of toParse) {
        saveFiles.set(p, { hash: hashes.get(p)!, size: texts.get(p)!.length, parsed: parsedMap.get(p)! });
        fts.set(p, ftsRows(parsedMap.get(p)!, texts.get(p)!));
      }
      store.save({
        deleted,
        files: saveFiles,
        semantic: mode === 'full' ? semantic : new Map([...semantic].filter(([p]) => semantic.get(p) !== prevSem.get(p))),
        fts,
        meta: { config: cfgHash, root, indexedAt: new Date().toISOString() },
        resetAll: mode === 'full',
      });
    }

    const graph = assemble(nodes, semantic);
    const stats = {
      mode,
      reason,
      reasonCode,
      reasonArgs,
      scanned: scan.files.length,
      parsed: files.length,
      reparsed: mode === 'noop' ? 0 : toParse.length,
      semanticRecomputed: recomputed,
      withSyntaxErrors: files.filter((f) => f.errors.length > 0).length,
      failed: failed.length,
      nodes: graph.nodes.size,
      edges: graph.edges.length,
      unresolved: graph.unresolved.length,
      ms: Math.round(performance.now() - t0),
    };
    return { root, scan, files, failed, graph, stats };
  } finally {
    store?.close();
  }
}

/** Saqlangan indeksdan qidiruv uchun store ochish (server/CLI). */
export function openStore(dbPath: string): XrayStore {
  return new XrayStore(dbPath);
}
