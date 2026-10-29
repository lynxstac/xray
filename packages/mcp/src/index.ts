import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { indexProject, openStore } from '@xray/graph';
import { renderMarkdown, runImpact } from '@xray/impact';
import { dbPathFor } from '@xray/server';

/**
 * X-Ray MCP serveri (Model Context Protocol, stdio, newline-delimited JSON-RPC 2.0).
 * AI agentlar (Claude Code, Cursor...) "shu funksiyani o'zgartirsam nimalarga ta'sir qiladi?" deb so'raydi.
 * Faqat O'QIYDI: repoga hech narsa yozilmaydi, repo kodi bajarilmaydi; hech narsa tarmoqqa chiqmaydi.
 * Hech qanday tashqi bog'liqliksiz (SDK'siz) — protokol ~100 qator.
 */

const MAX_CHARS = 60_000;
const SERVER = { name: 'xray', version: '0.1.0' };

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (a: Record<string, unknown>) => Promise<string>;
}

const str = (a: Record<string, unknown>, k: string): string | undefined => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : undefined);

async function repoRoot(a: Record<string, unknown>): Promise<string> {
  const r = str(a, 'repo');
  if (!r) throw new Error('`repo` (absolute path to the repository) is required');
  const real = await fs.realpath(path.resolve(r)).catch(() => {
    throw new Error(`Folder not found: ${r}`);
  });
  if (!(await fs.stat(real)).isDirectory()) throw new Error(`Not a directory: ${r}`);
  return real;
}

const clip = (s: string) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n\n… [truncated: ${s.length - MAX_CHARS} more characters]` : s);

const TOOLS: Tool[] = [
  {
    name: 'xray_impact',
    description:
      'Change-impact analysis for a Git diff: what changed, which code MAY be affected (direct/indirect, with evidence paths and verified/possible confidence), related tests, affected Next.js routes, and what could not be analysed. Use BEFORE changing shared code or when reviewing a diff. Defaults to the working tree vs HEAD.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Absolute path of the repository' },
        base: { type: 'string', description: 'Base ref for a range diff (e.g. main). Omit for working tree.' },
        head: { type: 'string', description: 'Head ref for a range diff (default HEAD)' },
        staged: { type: 'boolean', description: 'Analyse staged changes only' },
        depth: { type: 'number', description: 'Max dependency depth (default 4)' },
      },
      required: ['repo'],
    },
    async run(a) {
      const root = await repoRoot(a);
      const base = str(a, 'base');
      const spec = base ? ({ kind: 'range', base, head: str(a, 'head') ?? 'HEAD' } as const) : a.staged === true ? ({ kind: 'staged' } as const) : ({ kind: 'working' } as const);
      const depth = typeof a.depth === 'number' ? Math.min(Math.max(Math.floor(a.depth), 1), 8) : undefined;
      const { report } = await runImpact({ root, spec, dbPath: dbPathFor(root), options: { lang: 'en', ...(depth ? { maxDepth: depth } : {}) } });
      return clip(renderMarkdown(report, 'en') + (report.testCommand ? `\n\nSuggested test command: \`${report.testCommand}\`\n` : ''));
    },
  },
  {
    name: 'xray_search',
    description: 'Find symbols (functions, components, hooks, classes, types) and files in a repository by name or words. Returns node ids usable with xray_node.',
    inputSchema: {
      type: 'object',
      properties: { repo: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number', description: 'default 15' } },
      required: ['repo', 'query'],
    },
    async run(a) {
      const root = await repoRoot(a);
      const q = str(a, 'query');
      if (!q) throw new Error('`query` is required');
      const db = dbPathFor(root);
      const idx = await indexProject(root, { dbPath: db, lang: 'en' });
      const store = openStore(db);
      try {
        const limit = typeof a.limit === 'number' ? Math.min(Math.max(Math.floor(a.limit), 1), 50) : 15;
        const lines = store.search(q, limit).map((h) => {
          const n = idx.graph.nodes.get(h.id);
          return `- ${n?.kind ?? '?'} \`${h.id}\`${n ? ` (line ${n.loc.startLine})` : ''}`;
        });
        return lines.length ? lines.join('\n') : 'No matches.';
      } finally {
        store.close();
      }
    },
  },
  {
    name: 'xray_node',
    description: 'Show the relationships of one node id (from xray_search): who calls/renders/references it (incoming) and what it uses (outgoing), each with file:line evidence and confidence.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' }, id: { type: 'string', description: 'e.g. src/lib/api.ts#fetchArticle' } }, required: ['repo', 'id'] },
    async run(a) {
      const root = await repoRoot(a);
      const id = str(a, 'id');
      if (!id) throw new Error('`id` is required');
      const idx = await indexProject(root, { dbPath: dbPathFor(root), lang: 'en' });
      const g = idx.graph;
      const n = g.nodes.get(id);
      if (!n) throw new Error(`Unknown node id: ${id} (use xray_search first)`);
      const fmt = (edges: ReturnType<typeof g.incoming>, side: 'from' | 'to') =>
        edges
          .slice(0, 80)
          .map((e) => `- ${e.kind} ${g.nodes.get(e[side])?.id ?? e[side]} [${e.confidence}] at ${e.evidence.file}:${e.evidence.startLine}${e.count > 1 ? ` ×${e.count}` : ''}`)
          .join('\n') || '- none';
      const route = n.route ? `\nNext.js route: ${n.route.router}/${n.route.role} ${n.route.path}` : '';
      return clip(`# ${n.name} (${n.kind})\n${n.file}:${n.loc.startLine}${n.signature ? `\nsignature: ${n.signature}` : ''}${route}\n\n## Incoming (${g.incoming(id).length})\n${fmt(g.incoming(id), 'from')}\n\n## Outgoing (${g.outgoing(id).length})\n${fmt(g.outgoing(id), 'to')}\n`);
    },
  },
  {
    name: 'xray_index',
    description: 'Index (or incrementally refresh) a repository and return honest statistics: files, nodes, relationships, skipped and unresolved items.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
    async run(a) {
      const root = await repoRoot(a);
      const r = await indexProject(root, { dbPath: dbPathFor(root), lang: 'en' });
      const skipped: Record<string, number> = {};
      for (const s of r.scan.skipped) skipped[s.reason] = (skipped[s.reason] ?? 0) + 1;
      const unresolved: Record<string, number> = {};
      for (const u of r.graph.unresolved) unresolved[u.reason] = (unresolved[u.reason] ?? 0) + 1;
      return JSON.stringify({ root: r.root, mode: r.stats.mode, reason: r.stats.reason, files: r.stats.scanned, nodes: r.stats.nodes, edges: r.stats.edges, syntaxErrors: r.stats.withSyntaxErrors, skipped, unresolved, ms: r.stats.ms }, null, 2);
    },
  },
];

type Json = Record<string, unknown>;

async function handle(msg: Json): Promise<Json | null> {
  const id = msg.id as string | number | null | undefined;
  const method = msg.method as string | undefined;
  const params = (msg.params ?? {}) as Json;
  const ok = (result: unknown): Json => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string): Json => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

  if (method === undefined) return id === undefined ? null : err(-32600, 'Invalid request');
  if (id === undefined) return null; // notification (masalan notifications/initialized)
  switch (method) {
    case 'initialize':
      return ok({ protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER, instructions: 'X-Ray: local, read-only code-impact analysis. Start with xray_impact for a diff, or xray_search + xray_node to explore relationships.' });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return err(-32602, `Unknown tool: ${String(params.name)}`);
      try {
        const text = await tool.run((params.arguments ?? {}) as Json);
        return ok({ content: [{ type: 'text', text }] });
      } catch (e) {
        // Vosita xatolari protokol xatosi emas: model ularni ko'rib to'g'rilay oladi
        return ok({ isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] });
      }
    }
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

/** Oqimlar bo'yicha ishlaydi (testlarda stdin/stdout o'rniga o'z oqimlari). So'rovlar ketma-ket bajariladi. */
export function runMcp(input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  let chain: Promise<void> = Promise.resolve();
  const send = (m: Json) => output.write(JSON.stringify(m) + '\n');
  rl.on('line', (line) => {
    if (!line.trim()) return;
    chain = chain.then(async () => {
      let msg: Json;
      try {
        msg = JSON.parse(line) as Json;
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      const res = await handle(msg).catch((e) => ({ jsonrpc: '2.0', id: (msg.id as number | string | null) ?? null, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } }));
      if (res) send(res);
    });
  });
  return new Promise((resolve) => rl.on('close', () => void chain.then(resolve)));
}

export const MCP_TOOLS = TOOLS.map((t) => t.name);
