import type { GraphEdge, GraphNode, ParsedFile } from '@xray/core';
import { CodeGraph } from './model.ts';
import { nearestNextRoot, routeForFile } from './routes.ts';
import type { FileSemantic } from './semantic.ts';

/** ParsedFile'lardan node'lar (file + symbol). ID'lar satr raqamisiz — barqaror. */
export function buildNodes(files: readonly ParsedFile[], nextRoots: readonly string[] = []): GraphNode[] {
  const out: GraphNode[] = [];
  for (const f of files) {
    const nr = f.isTestFile ? undefined : nearestNextRoot(f.path, nextRoots);
    const route = nr === undefined ? undefined : routeForFile(f.path, nr);
    out.push({
      id: f.path,
      kind: f.isTestFile ? 'test_file' : 'file',
      name: f.path.split('/').pop() ?? f.path,
      qualifiedName: f.path,
      file: f.path,
      loc: { file: f.path, startLine: 1, startCol: 1, endLine: f.lineCount, endCol: 1 },
      exported: false,
      basis: f.isTestFile ? 'test-file-pattern' : 'source-file',
      signature: '',
      ...(route ? { route } : {}),
    });
    for (const s of f.symbols) {
      out.push({
        id: `${f.path}#${s.qualifiedName}`,
        kind: s.kind,
        name: s.name,
        qualifiedName: s.qualifiedName,
        file: f.path,
        loc: s.loc,
        exported: s.exported,
        basis: s.basis,
        signature: s.signature,
      });
    }
  }
  return out;
}

export function nodesByFile(nodes: readonly GraphNode[]): Map<string, GraphNode[]> {
  const m = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    let l = m.get(n.file);
    if (!l) m.set(n.file, (l = []));
    l.push(n);
  }
  return m;
}

/**
 * Node'lar + per-fayl semantik natijalardan yagona graph.
 * `tests` edge'lari bu yerda HISOBLANADI (import'lardan hosil bo'ladi, saqlanmaydi — drift bo'lmasligi uchun).
 */
export function assemble(nodes: readonly GraphNode[], semantic: ReadonlyMap<string, FileSemantic>): CodeGraph {
  const g = new CodeGraph();
  for (const n of nodes) g.addNode(n);

  const paths = [...semantic.keys()].sort();
  for (const p of paths) {
    const s = semantic.get(p)!;
    for (const e of s.edges) {
      if (!g.nodes.has(e.from) || !g.nodes.has(e.to)) continue; // dangling edge'larni tashlaymiz
      g.addEdge(e);
      const from = g.nodes.get(e.from)!;
      const to = g.nodes.get(e.to)!;
      if (e.kind === 'imports' && from.kind === 'test_file' && to.kind !== 'test_file') {
        const te: GraphEdge = { from: e.from, to: e.to, kind: 'tests', confidence: 'verified', count: 1, evidence: e.evidence, via: 'imports' };
        g.addEdge(te);
      }
    }
    for (const u of s.unresolved) g.unresolved.push(u);
    if (s.externals.length) g.externals.set(p, s.externals);
  }
  return g;
}
