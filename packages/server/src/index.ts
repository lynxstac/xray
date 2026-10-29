import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_LANG, parseLang, t, type EdgeKind, type GraphEdge, type GraphNode, type Lang, type MsgKey } from '@xray/core';
import { indexProject } from '@xray/graph';
import { GitError, isGitRepo, listRefs, type DiffSpec } from '@xray/git';
import { renderMarkdown, runImpact } from '@xray/impact';
import { retrieve } from '@xray/retrieval';
import { ask, assertAiEnabled, AiDisabledError, CONSENT_TEXT, DEFAULT_CONFIG_PATH, loadAiConfig, saveAiConfig, type AiConfig, type ProviderId } from '@xray/ai';
import { HttpError, ServerState } from './state.ts';

export { ServerState, dbPathFor, HttpError } from './state.ts';

export interface ServerOptions {
  port?: number;
  /** Faqat loopback ruxsat etiladi */
  host?: '127.0.0.1' | '::1';
  webDist?: string;
  token?: string;
  cacheDir?: string;
  aiConfigPath?: string;
  /** Test uchun: kalitlar shu env'dan o'qiladi */
  env?: NodeJS.ProcessEnv;
}

export interface RunningServer {
  url: string;
  token: string;
  port: number;
  state: ServerState;
  close: () => Promise<void>;
}

const MAX_BODY = 256 * 1024;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(s);
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const ct = req.headers['content-type'] ?? '';
  if (!ct.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'srv.contentType');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'srv.tooBig');
    chunks.push(c as Buffer);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'srv.badJson');
  }
}

const ALL_KINDS: EdgeKind[] = ['imports', 'calls', 'renders', 'references', 'tests'];

function brief(n: GraphNode) {
  return { id: n.id, kind: n.kind, name: n.name, file: n.file, line: n.loc.startLine, exported: n.exported, ...(n.route ? { route: n.route } : {}) };
}
function briefEdge(e: GraphEdge) {
  return { from: e.from, to: e.to, kind: e.kind, confidence: e.confidence, count: e.count, via: e.via, file: e.evidence.file, line: e.evidence.startLine };
}

function parseSpec(b: any): DiffSpec {
  const s = b?.spec ?? b;
  if (s?.kind === 'working' || s?.kind === 'staged') return { kind: s.kind };
  if (s?.kind === 'range' && typeof s.base === 'string' && typeof s.head === 'string') return { kind: 'range', base: s.base, head: s.head };
  throw new HttpError(400, 'srv.badSpec');
}

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const token = opts.token ?? randomBytes(24).toString('hex');
  const state = new ServerState(opts.cacheDir);
  const env = opts.env ?? process.env;
  const aiPath = opts.aiConfigPath;
  const host = opts.host ?? '127.0.0.1';
  let port = opts.port ?? 0;

  const authOk = (req: http.IncomingMessage, url: URL): boolean => {
    const given = (req.headers['x-xray-token'] as string | undefined) ?? url.searchParams.get('token') ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const hostOk = (req: http.IncomingMessage): boolean => {
    // DNS-rebinding himoyasi: faqat o'z loopback manzilimiz
    const h = (req.headers.host ?? '').toLowerCase();
    return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
  };

  /** So'rov tili: UI `x-xray-lang` yuboradi; boshqalar uchun standart til */
  const reqLang = (req: http.IncomingMessage): Lang => parseLang(req.headers['x-xray-lang']);

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const lang = reqLang(req);
    if (!hostOk(req)) return json(res, 403, { error: t(lang, 'srv.hostDenied') });
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const method = req.method ?? 'GET';

    if (url.pathname.startsWith('/api/')) {
      if (!authOk(req, url)) return json(res, 401, { error: t(lang, 'srv.tokenNeeded') });
      if (method !== 'GET') {
        const origin = req.headers.origin;
        if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return json(res, 403, { error: t(lang, 'srv.originDenied') });
      }
      try {
        return json(res, 200, await route(method, url, req, lang));
      } catch (e) {
        if (e instanceof HttpError) return json(res, e.status, { error: t(lang, e.key, e.params) });
        // noto'g'ri ref/yo'l — mijoz xatosi; kodli xatolar so'rov tilida
        if (e instanceof GitError) return json(res, 400, { error: e.code ? t(lang, `err.${e.code}` as MsgKey, e.params) : e.message });
        return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return serveStatic(url.pathname, res);
  };

  async function route(method: string, url: URL, req: http.IncomingMessage, lang: Lang): Promise<unknown> {
    const p = url.pathname;
    const q = url.searchParams;

    if (method === 'GET' && p === '/api/state') {
      const cfg = await loadAiConfig(aiPath);
      let aiReady = false;
      let aiReason: string | undefined;
      try {
        assertAiEnabled(cfg, env, lang);
        aiReady = true;
      } catch (e) {
        aiReason = e instanceof AiDisabledError ? e.message : String(e);
      }
      const r = state.repo;
      return {
        repo: r ? summary(r) : null,
        ai: { ready: aiReady, reason: aiReason, provider: cfg?.provider ?? null, model: cfg?.model ?? null, configPath: aiPath ?? DEFAULT_CONFIG_PATH },
      };
    }

    if (method === 'POST' && p === '/api/open') {
      const b = await readJson(req);
      if (typeof b.path !== 'string' || !b.path) throw new HttpError(400, 'srv.pathNeeded');
      return summary(await state.open(b.path, !!b.full, lang));
    }

    if (method === 'POST' && p === '/api/reindex') {
      const r = state.require();
      const b = await readJson(req);
      return summary(await state.open(r.root, !!b.full, lang));
    }

    const repo = () => state.require();

    if (method === 'GET' && p === '/api/files') {
      const g = repo().index.graph;
      return {
        files: g.files().map((f) => ({ id: f.id, kind: f.kind, ...(f.route ? { route: f.route } : {}), symbols: g.nodesInFile(f.file).length - 1, in: g.incoming(f.id, ['imports']).length, out: g.outgoing(f.id, ['imports']).length })).sort((a, b) => a.id.localeCompare(b.id)),
      };
    }

    if (method === 'GET' && p === '/api/search') {
      const r = repo();
      const term = (q.get('q') ?? '').trim();
      const limit = Math.min(Number(q.get('limit') ?? 30) || 30, 100);
      if (!term) return { results: [] };
      const lower = term.toLowerCase();
      const seen = new Set<string>();
      const out: ReturnType<typeof brief>[] = [];
      const add = (n: GraphNode | undefined) => {
        if (n && !seen.has(n.id) && out.length < limit) {
          seen.add(n.id);
          out.push(brief(n));
        }
      };
      const nodes = [...r.index.graph.nodes.values()];
      nodes.filter((n) => n.name.toLowerCase() === lower).forEach(add);
      nodes.filter((n) => n.name.toLowerCase().startsWith(lower)).forEach(add);
      nodes.filter((n) => n.qualifiedName.toLowerCase().includes(lower) || n.file.toLowerCase().includes(lower)).forEach(add);
      for (const h of r.store.search(term, limit)) add(r.index.graph.nodes.get(h.id));
      return { results: out };
    }

    if (method === 'GET' && p === '/api/node') {
      const r = repo();
      const id = q.get('id') ?? '';
      const g = r.index.graph;
      const n = g.nodes.get(id);
      if (!n) throw new HttpError(404, 'srv.nodeNotFound');
      const group = (edges: GraphEdge[], side: 'from' | 'to') =>
        edges.map((e) => ({ ...briefEdge(e), other: brief(g.nodes.get(e[side])!) })).sort((a, b) => a.kind.localeCompare(b.kind) || a.other.id.localeCompare(b.other.id));
      return {
        node: { ...brief(n), qualifiedName: n.qualifiedName, loc: n.loc, basis: n.basis, signature: n.signature },
        outgoing: group(g.outgoing(id), 'to').slice(0, 300),
        incoming: group(g.incoming(id), 'from').slice(0, 300),
        unresolved: g.unresolved.filter((u) => u.file === n.file).map((u) => ({ reason: u.reason, snippet: u.snippet, line: u.loc.startLine })),
        externals: g.externals.get(n.file) ?? [],
      };
    }

    if (method === 'GET' && p === '/api/neighborhood') {
      const g = repo().index.graph;
      const id = q.get('id') ?? '';
      if (!g.nodes.has(id)) throw new HttpError(404, 'srv.nodeNotFound');
      const hops = Math.min(Math.max(Number(q.get('hops') ?? 1) || 1, 1), 3);
      const limit = Math.min(Number(q.get('limit') ?? 150) || 150, 500);
      const kinds = (q.get('kinds') ?? '').split(',').filter((k): k is EdgeKind => (ALL_KINDS as string[]).includes(k));
      const useKinds = kinds.length ? kinds : ALL_KINDS;
      const dist = new Map<string, number>([[id, 0]]);
      const edges = new Map<string, GraphEdge>();
      let truncated = false;
      let frontier = [id];
      for (let d = 1; d <= hops; d++) {
        const next: string[] = [];
        for (const cur of frontier) {
          for (const e of [...g.outgoing(cur, useKinds), ...g.incoming(cur, useKinds)]) {
            const other = e.from === cur ? e.to : e.from;
            if (!dist.has(other)) {
              if (dist.size >= limit) {
                truncated = true;
                continue;
              }
              dist.set(other, d);
              next.push(other);
            }
            edges.set(`${e.kind}|${e.from}|${e.to}`, e);
          }
        }
        frontier = next;
      }
      const kept = [...edges.values()].filter((e) => dist.has(e.from) && dist.has(e.to));
      return { center: id, truncated, nodes: [...dist].map(([nid, d]) => ({ ...brief(g.nodes.get(nid)!), distance: d })), edges: kept.map(briefEdge) };
    }

    if (method === 'GET' && p === '/api/source') {
      const r = repo();
      const file = q.get('file') ?? '';
      if (!r.index.graph.nodes.has(file)) throw new HttpError(404, 'srv.notIndexed'); // faqat indekslangan (maxfiy emas) fayllar
      const abs = path.join(r.root, file);
      const rootReal = await fs.realpath(r.root);
      const real = await fs.realpath(abs).catch(() => '');
      if (!real.startsWith(rootReal + path.sep)) throw new HttpError(403, 'srv.outsideRepo');
      const lines = (await fs.readFile(real, 'utf8')).split('\n');
      const start = Math.max(Number(q.get('start') ?? 1) || 1, 1);
      const end = Math.min(Number(q.get('end') ?? start + 80) || start + 80, start + 400, lines.length);
      return { file, start, end, total: lines.length, text: lines.slice(start - 1, end).join('\n') };
    }

    if (method === 'GET' && p === '/api/refs') {
      const r = repo();
      if (!(await isGitRepo(r.root))) return { git: false };
      return { git: true, ...(await listRefs(r.root)) };
    }

    if (method === 'POST' && p === '/api/impact') {
      const r = repo();
      const b = await readJson(req);
      const spec = parseSpec(b);
      const { report, head } = await runImpact({ root: r.root, spec, dbPath: r.dbPath, options: { ...b.options, lang } });
      r.lastImpact = report;
      // Working-tree indeksi yangilangan bo'lishi mumkin
      if (spec.kind !== 'range') r.index = head;
      return { report, markdown: renderMarkdown(report, lang) };
    }

    if (method === 'POST' && p === '/api/ask') {
      const r = repo();
      const b = await readJson(req);
      if (typeof b.question !== 'string' || !b.question.trim() || b.question.length > 2000) throw new HttpError(400, 'srv.questionBad');
      const evidence = await retrieve(b.question, { graph: r.index.graph, store: r.store, root: r.root, lang });
      return ask({ question: b.question, evidence, config: await loadAiConfig(aiPath), env, dryRun: !!b.dryRun, lang });
    }

    if (method === 'GET' && p === '/api/ai/consent-text') {
      const prov = (q.get('provider') ?? 'anthropic') as ProviderId;
      return { text: CONSENT_TEXT(prov, lang) };
    }

    if (method === 'POST' && p === '/api/ai/enable') {
      const b = await readJson(req);
      const provider: ProviderId = b.provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic';
      if (b.accepted !== true || ![CONSENT_TEXT(provider, 'uz'), CONSENT_TEXT(provider, 'en')].includes(b.consentText)) throw new HttpError(400, 'srv.consentExact');
      if (typeof b.model !== 'string' || !b.model || typeof b.apiKeyEnv !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(b.apiKeyEnv)) throw new HttpError(400, 'srv.aiFields');
      const cfg: AiConfig = {
        provider, model: b.model, apiKeyEnv: b.apiKeyEnv,
        baseUrl: typeof b.baseUrl === 'string' && b.baseUrl ? b.baseUrl : undefined,
        consent: { acceptedAt: new Date().toISOString(), provider, sendsSourceExcerpts: true },
      };
      await saveAiConfig(cfg, aiPath);
      return { ok: true };
    }

    throw new HttpError(404, 'srv.unknownRoute');
  }

  function summary(r: NonNullable<typeof state.repo>) {
    const g = r.index.graph;
    const skipped: Record<string, number> = {};
    for (const s of r.index.scan.skipped) skipped[s.reason] = (skipped[s.reason] ?? 0) + 1;
    const unresolvedBy: Record<string, number> = {};
    for (const u of g.unresolved) unresolvedBy[u.reason] = (unresolvedBy[u.reason] ?? 0) + 1;
    return {
      root: r.root,
      stats: r.index.stats,
      skipped,
      skippedList: r.index.scan.skipped.slice(0, 200),
      unresolved: unresolvedBy,
      syntaxErrors: r.index.files.filter((f) => f.errors.length).map((f) => ({ file: f.path, count: f.errors.length, first: f.errors[0]!.message, line: f.errors[0]!.loc.startLine })),
      kinds: [...g.nodes.values()].reduce<Record<string, number>>((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {}),
    };
  }

  const webDist = opts.webDist;
  function serveStatic(pathname: string, res: http.ServerResponse): void {
    const sec = {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    };
    if (!webDist || !existsSync(webDist)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', ...sec });
      return void res.end('X-Ray API ishlayapti. Web UI qurilmagan: `pnpm --filter @xray/web build`.');
    }
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    let file = path.resolve(webDist, rel);
    if (!file.startsWith(path.resolve(webDist) + path.sep) && file !== path.resolve(webDist)) {
      res.writeHead(403, sec);
      return void res.end('forbidden');
    }
    if (!existsSync(file) || !statSync(file).isFile()) file = path.join(webDist, 'index.html'); // SPA fallback
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600', ...sec });
    createReadStream(file).pipe(res);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => json(res, 500, { error: String(e) }));
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  port = (server.address() as AddressInfo).port;
  void indexProject; // (eager import — server bilan birga yuklansin)

  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    token,
    port,
    state,
    close: () => new Promise<void>((resolve) => { state.close(); server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
