import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_LANG, t, type GraphNode, type Lang } from '@xray/core';
import { splitIdent, type CodeGraph, type XrayStore } from '@xray/graph';

export interface Chunk {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  kind: GraphNode['kind'];
  name: string;
  text: string;
  /** Nima uchun tanlandi (dalil) */
  why: string[];
  score: number;
}

export interface Fact {
  text: string;
  file: string;
  line: number;
}

export interface Retrieval {
  chunks: Chunk[];
  /** Graph'dan olingan tasdiqlangan bog'lanishlar (LLM'ga ham beriladi) */
  facts: Fact[];
  /** Savoldan ajratilgan qidiruv atamalari */
  terms: string[];
}

export interface RetrieveOptions {
  graph: CodeGraph;
  store?: XrayStore;
  root: string;
  maxChunks?: number;
  maxLinesPerChunk?: number;
  lang?: Lang;
}

const STOP = new Set(['the', 'is', 'are', 'how', 'does', 'what', 'where', 'which', 'this', 'that', 'work', 'works', 'in', 'of', 'to', 'a', 'an', 'and', 'or', 'it', 'for', 'with', 'by', 'from', 'used', 'use', 'qayerda', 'qanday', 'nima', 'uchun', 'bu', 'va', 'ishlaydi', 'ishlatiladi']);

/** Savoldan identifikator va so'zlar. Backtick va camelCase/PascalCase alohida ajratiladi. */
export function extractTerms(q: string): { identifiers: string[]; words: string[] } {
  const identifiers = new Set<string>();
  for (const m of q.matchAll(/`([^`]+)`/g)) identifiers.add(m[1]!.trim());
  for (const m of q.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const w = m[1]!;
    if (/[a-z][A-Z]|^[A-Z][a-z]+[A-Z]|^use[A-Z]|_/.test(w) || /^[A-Z][a-z]{2,}$/.test(w)) identifiers.add(w);
  }
  const words = splitIdent(q).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  return { identifiers: [...identifiers], words: [...new Set(words)] };
}

async function readLines(root: string, file: string, from: number, to: number): Promise<string | null> {
  const abs = path.resolve(root, file);
  // Faqat repo ichidan o'qiymiz (graph'dagi yo'l ham ishonchsiz ma'lumot sifatida tekshiriladi).
  const rootReal = await fs.realpath(root);
  let real: string;
  try {
    real = await fs.realpath(abs);
  } catch {
    return null;
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null;
  try {
    const text = await fs.readFile(real, 'utf8');
    return text.split('\n').slice(from - 1, to).join('\n');
  } catch {
    return null;
  }
}

export async function retrieve(question: string, opts: RetrieveOptions): Promise<Retrieval> {
  const { graph, store, root } = opts;
  const maxChunks = opts.maxChunks ?? 10;
  const maxLines = opts.maxLinesPerChunk ?? 60;
  const lang: Lang = opts.lang ?? DEFAULT_LANG;
  const { identifiers, words } = extractTerms(question);
  const scores = new Map<string, { score: number; why: string[] }>();
  const bump = (id: string, s: number, why: string) => {
    const e = scores.get(id) ?? { score: 0, why: [] };
    e.score += s;
    if (!e.why.includes(why)) e.why.push(why);
    scores.set(id, e);
  };

  // 1) Aniq nom mosligi (eng kuchli signal)
  const lowerIdents = new Set(identifiers.map((i) => i.toLowerCase()));
  for (const n of graph.nodes.values()) {
    if (n.kind === 'file' || n.kind === 'test_file') continue;
    if (lowerIdents.has(n.name.toLowerCase()) || lowerIdents.has(n.qualifiedName.toLowerCase())) bump(n.id, 100, t(lang, 'ret.nameMatch', { name: n.name }));
  }
  // 2) Lexical (FTS5): nom, yo'l, tana matni
  if (store) {
    const hits = store.search([...identifiers, ...words].join(' '), 30);
    hits.forEach((h, i) => bump(h.id, 30 - i * 0.8, t(lang, 'ret.fts')));
  }
  // 3) Graph qo'shnilari: yuqori ballli symbol'larning chaqiruvchilari/chaqiriladiganlari
  const top = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 4);
  const facts: Fact[] = [];
  for (const [id] of top) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    for (const e of graph.outgoing(id, ['calls', 'renders', 'references']).slice(0, 6)) {
      const to = graph.nodes.get(e.to);
      if (to) {
        bump(to.id, 12, t(lang, 'ret.uses', { name: n.name }));
        facts.push({ text: `${n.name} (${n.file}) ${e.kind} ${to.name} (${to.file})${e.confidence === 'verified' ? '' : t(lang, 'ret.tentative')}`, file: e.evidence.file, line: e.evidence.startLine });
      }
    }
    for (const e of graph.incoming(id, ['calls', 'renders', 'references']).slice(0, 6)) {
      const f = graph.nodes.get(e.from);
      if (f) {
        bump(f.id, 10, t(lang, 'ret.usedBy', { name: n.name }));
        facts.push({ text: `${f.name} (${f.file}) ${e.kind} ${n.name} (${n.file})${e.confidence === 'verified' ? '' : t(lang, 'ret.tentative')}`, file: e.evidence.file, line: e.evidence.startLine });
      }
    }
  }

  // 4) Chunk'lar
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const chunks: Chunk[] = [];
  const usedRanges: { file: string; a: number; b: number }[] = [];
  for (const [id, s] of ranked) {
    if (chunks.length >= maxChunks) break;
    const n = graph.nodes.get(id);
    if (!n) continue;
    const isFile = n.kind === 'file' || n.kind === 'test_file';
    const startLine = n.loc.startLine;
    const endLine = isFile ? Math.min(n.loc.endLine, startLine + 29) : Math.min(n.loc.endLine, startLine + maxLines - 1);
    if (usedRanges.some((u) => u.file === n.file && u.a <= startLine && u.b >= endLine)) continue; // takror
    const text = await readLines(root, n.file, startLine, endLine);
    if (text === null) continue;
    usedRanges.push({ file: n.file, a: startLine, b: endLine });
    chunks.push({ id, file: n.file, startLine, endLine, kind: n.kind, name: n.name, text, why: s.why, score: Math.round(s.score * 10) / 10 });
  }
  const seen = new Set<string>();
  const uniqueFacts = facts.filter((f) => !seen.has(f.text) && seen.add(f.text));
  return { chunks, facts: uniqueFacts.slice(0, 30), terms: [...identifiers, ...words] };
}
