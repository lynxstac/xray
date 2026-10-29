import type { EdgeKind, GraphEdge, GraphNode, GraphUnresolved } from '@xray/core';

/** Xotiradagi graph. Barcha so'rovlar (impact, qidiruv, UI) shu ustida ishlaydi. */
export class CodeGraph {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges: GraphEdge[] = [];
  readonly unresolved: GraphUnresolved[] = [];
  /** fayl -> tashqi paketlar (node_modules, builtin) */
  readonly externals = new Map<string, string[]>();
  private out = new Map<string, GraphEdge[]>();
  private inn = new Map<string, GraphEdge[]>();
  private byFile = new Map<string, GraphNode[]>();

  addNode(n: GraphNode): void {
    this.nodes.set(n.id, n);
    let l = this.byFile.get(n.file);
    if (!l) this.byFile.set(n.file, (l = []));
    l.push(n);
  }

  addEdge(e: GraphEdge): void {
    this.edges.push(e);
    (this.out.get(e.from) ?? this.out.set(e.from, []).get(e.from)!).push(e);
    (this.inn.get(e.to) ?? this.inn.set(e.to, []).get(e.to)!).push(e);
  }

  outgoing(id: string, kinds?: readonly EdgeKind[]): GraphEdge[] {
    const l = this.out.get(id) ?? [];
    return kinds ? l.filter((e) => kinds.includes(e.kind)) : l;
  }

  incoming(id: string, kinds?: readonly EdgeKind[]): GraphEdge[] {
    const l = this.inn.get(id) ?? [];
    return kinds ? l.filter((e) => kinds.includes(e.kind)) : l;
  }

  nodesInFile(file: string): GraphNode[] {
    return this.byFile.get(file) ?? [];
  }

  files(): GraphNode[] {
    return [...this.nodes.values()].filter((n) => n.kind === 'file' || n.kind === 'test_file');
  }

  /** Fayldagi eng ichki symbol (yoki fayl node'i) berilgan pozitsiya uchun. */
  innermostAt(file: string, line: number, col: number): GraphNode | undefined {
    let best: GraphNode | undefined;
    let bestSpan = Infinity;
    for (const n of this.nodesInFile(file)) {
      if (n.kind === 'file' || n.kind === 'test_file') continue;
      if (!locContains(n.loc, line, col)) continue;
      const span = (n.loc.endLine - n.loc.startLine) * 100000 + (n.loc.endCol - n.loc.startCol);
      if (span < bestSpan) {
        best = n;
        bestSpan = span;
      }
    }
    return best ?? this.nodes.get(file);
  }
}

export function locContains(loc: { startLine: number; startCol: number; endLine: number; endCol: number }, line: number, col: number): boolean {
  if (line < loc.startLine || line > loc.endLine) return false;
  if (line === loc.startLine && col < loc.startCol) return false;
  if (line === loc.endLine && col > loc.endCol) return false;
  return true;
}
