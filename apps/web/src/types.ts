import type { ImpactReport } from '@xray/impact';
import type { AskResult } from '@xray/ai';

export type { ImpactReport, AskResult };

export interface IndexStats {
  mode: 'full' | 'incremental' | 'noop';
  reason: string;
  reasonCode: 'forced' | 'first' | 'config' | 'structure' | 'noop' | 'incremental';
  reasonArgs: Record<string, number>;
  scanned: number;
  reparsed: number;
  semanticRecomputed: number;
  withSyntaxErrors: number;
  failed: number;
  nodes: number;
  edges: number;
  unresolved: number;
  ms: number;
}

export interface RepoSummary {
  root: string;
  stats: IndexStats;
  skipped: Record<string, number>;
  skippedList: { path: string; reason: string }[];
  unresolved: Record<string, number>;
  syntaxErrors: { file: string; count: number; first: string; line: number }[];
  kinds: Record<string, number>;
}

export interface AppState {
  repo: RepoSummary | null;
  ai: { ready: boolean; reason?: string; provider: string | null; model: string | null; configPath: string };
}

export interface NodeBrief {
  id: string;
  kind: string;
  name: string;
  file: string;
  line: number;
  exported: boolean;
  route?: { path: string; role: string; router: 'app' | 'pages' };
}

export interface EdgeBrief {
  from: string;
  to: string;
  kind: string;
  confidence: 'verified' | 'possible' | 'unresolved';
  count: number;
  via?: string;
  file: string;
  line: number;
}

export interface Neighborhood {
  center: string;
  truncated: boolean;
  nodes: (NodeBrief & { distance: number })[];
  edges: EdgeBrief[];
}

export interface NodeDetail {
  node: NodeBrief & { qualifiedName: string; loc: { startLine: number; endLine: number }; basis: string; signature: string };
  outgoing: (EdgeBrief & { other: NodeBrief })[];
  incoming: (EdgeBrief & { other: NodeBrief })[];
  unresolved: { reason: string; snippet: string; line: number }[];
  externals: string[];
}

export interface RefsResp {
  git: boolean;
  branches?: { name: string; current: boolean }[];
  commits?: { hash: string; short: string; subject: string }[];
}
