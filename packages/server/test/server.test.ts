import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { startServer, type RunningServer } from '@xray/server';

const fixture = path.resolve(import.meta.dirname, '../../../fixtures/react-app');
const base = path.resolve(import.meta.dirname, '../../../.tmp-test');
let srv: RunningServer;
let repoDir: string;
let cacheDir: string;

const api = (p: string, init: RequestInit = {}, token: string | null = srv.token) =>
  fetch(`http://127.0.0.1:${srv.port}${p}`, { ...init, headers: { ...(token ? { 'x-xray-token': token } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers as object) } });
const post = (p: string, body: unknown) => api(p, { method: 'POST', body: JSON.stringify(body) });

beforeAll(async () => {
  await mkdir(base, { recursive: true });
  repoDir = await mkdtemp(path.join(base, 'srv-repo-'));
  cacheDir = await mkdtemp(path.join(base, 'srv-cache-'));
  await cp(fixture, repoDir, { recursive: true });
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repoDir });
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  srv = await startServer({ cacheDir, aiConfigPath: path.join(cacheDir, 'ai.json'), env: {} });
});
afterAll(async () => {
  await srv.close();
  await rm(repoDir, { recursive: true, force: true });
  await rm(cacheDir, { recursive: true, force: true });
});

describe('transport security', () => {
  it('binds loopback only and requires the token', async () => {
    expect((await api('/api/state', {}, null)).status).toBe(401);
    expect((await api('/api/state', {}, 'wrong')).status).toBe(401);
    expect((await api('/api/state')).status).toBe(200);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/api/state', headers: { host: 'evil.example.com', 'x-xray-token': srv.token } }, (res) => resolve(res.statusCode ?? 0));
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('rejects cross-origin POST and non-JSON POST', async () => {
    const r1 = await api('/api/open', { method: 'POST', body: JSON.stringify({ path: repoDir }), headers: { origin: 'https://evil.example' } });
    expect(r1.status).toBe(403);
    const r2 = await api('/api/open', { method: 'POST', body: 'path=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(r2.status).toBe(415);
  });

  it('sets no CORS headers', async () => {
    const r = await api('/api/state');
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('workflow', () => {
  it('requires a repo before queries', async () => {
    expect((await api('/api/files')).status).toBe(409);
  });

  it('rejects a non-existent path with a clear error', async () => {
    const r = await post('/api/open', { path: '/definitely/not/here' });
    expect(r.status).toBe(400);
  });

  it('opens a repo, reports honest index stats', async () => {
    const r = await post('/api/open', { path: repoDir });
    expect(r.status).toBe(200);
    const s = await r.json();
    expect(s.stats).toMatchObject({ mode: 'full', scanned: 17, failed: 0 });
    expect(s.unresolved).toEqual({ 'dynamic-import': 1 });
    // ikkinchi ochilish keshdan (noop)
    expect((await (await post('/api/open', { path: repoDir })).json()).stats.mode).toBe('noop');
  });

  it('search finds symbols by name and by words', async () => {
    const a = await (await api('/api/search?q=fetchArticle')).json();
    expect(a.results[0].id).toBe('src/lib/api.ts#fetchArticle');
    const b = await (await api('/api/search?q=' + encodeURIComponent('"; DROP --'))).json();
    expect(Array.isArray(b.results)).toBe(true);
  });

  it('node details expose incoming/outgoing with evidence locations', async () => {
    const d = await (await api('/api/node?id=' + encodeURIComponent('src/lib/api.ts#fetchArticle'))).json();
    expect(d.incoming.map((e: any) => e.other.id)).toContain('src/hooks/useArticle.ts#useArticle');
    const call = d.incoming.find((e: any) => e.kind === 'calls');
    expect(call).toMatchObject({ file: 'src/hooks/useArticle.ts', confidence: 'verified' });
    expect(call.line).toBeGreaterThan(0);
  });

  it('neighborhood is bounded and consistent', async () => {
    const n = await (await api('/api/neighborhood?id=' + encodeURIComponent('src/components/index.ts') + '&hops=2&limit=5')).json();
    expect(n.nodes.length).toBeLessThanOrEqual(5);
    expect(n.truncated).toBe(true);
    const ids = new Set(n.nodes.map((x: any) => x.id));
    for (const e of n.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  });

  it('source endpoint only serves indexed files, never outside the repo', async () => {
    const ok = await (await api('/api/source?file=src/lib/api.ts&start=1&end=3')).json();
    expect(ok.text).toContain('BASE');
    for (const f of ['../../../etc/passwd', '/etc/passwd', 'package.json', 'src/../../x']) {
      expect((await api('/api/source?file=' + encodeURIComponent(f))).status, f).toBe(404);
    }
  });

  it('impact over HTTP matches engine result for a real uncommitted change', async () => {
    await writeFile(path.join(repoDir, 'src/lib/format.ts'), 'export function formatDate(d: Date, locale?: string) {\n  return d.toISOString() + String(locale);\n}\n\nexport default function unusedDefault() {\n  return 0;\n}\n');
    const r = await post('/api/impact', { spec: { kind: 'working' } });
    expect(r.status).toBe(200);
    const { report, markdown } = await r.json();
    expect(report.direct.map((x: any) => x.id)).toEqual(['src/components/ArticleCard.tsx#ArticleCard']);
    expect(markdown).toContain('X-Ray Impact Report');
  });

  it('impact rejects malicious refs', async () => {
    const r = await post('/api/impact', { spec: { kind: 'range', base: '--output=/tmp/x', head: 'HEAD' } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/ref/i);
  });

  it('ask without AI configured returns evidence only (no external call possible)', async () => {
    const r = await (await post('/api/ask', { question: 'Where is `fetchArticle` called?' })).json();
    expect(r.mode).toBe('evidence-only');
    expect(r.disabledReason).toBeTruthy();
    expect(r.evidence.chunks[0].id).toBe('src/lib/api.ts#fetchArticle');
  });

  it('AI enabling requires the exact consent text', async () => {
    const bad = await post('/api/ai/enable', { provider: 'anthropic', model: 'm', apiKeyEnv: 'ANTHROPIC_API_KEY', accepted: true, consentText: 'ok' });
    expect(bad.status).toBe(400);
    const text = (await (await api('/api/ai/consent-text?provider=anthropic')).json()).text;
    const good = await post('/api/ai/enable', { provider: 'anthropic', model: 'm', apiKeyEnv: 'ANTHROPIC_API_KEY', accepted: true, consentText: text });
    expect(good.status).toBe(200);
    // kalit env'da yo'q -> hali ham o'chiq
    const st = await (await api('/api/state')).json();
    expect(st.ai.ready).toBe(false);
    expect(st.ai.reason).toMatch(/API kalit/);
  });
});

describe('open() is atomic', () => {
  it('when indexing a new folder fails, the previously opened repo keeps working', async () => {
    expect((await post('/api/open', { path: repoDir })).status).toBe(200);
    // Hech narsa chegaradan oshmasa ham, `open` yo'q papkada 400 beradi va holat buzilmaydi
    expect((await post('/api/open', { path: '/definitely/not/here' })).status).toBe(400);
    expect((await api('/api/search?q=fetchArticle')).status).toBe(200);
    // scanner chegarasi: state to'g'ridan-to'g'ri, kichik chegara bilan (indexProject'ga scan opsiyasi uzatiladigan yo'l)
    const { indexProject } = await import('@xray/graph');
    const { ScanLimitError } = await import('@xray/scanner');
    await expect(indexProject(repoDir, { scan: { maxFiles: 2 } })).rejects.toBeInstanceOf(ScanLimitError);
    expect((await api('/api/search?q=fetchArticle')).status).toBe(200);
  });
});

describe('language per request (x-xray-lang)', () => {
  const en = (p: string, init: RequestInit = {}) => api(p, { ...init, headers: { 'x-xray-lang': 'en', ...(init.headers as object) } });
  const UZ = /(topilmadi|yo'q|kerak|noto'g'ri|papka|rozilik|sozlanmagan|ruxsat)/i;

  it('errors are English when asked, Uzbek by default', async () => {
    const bad = await en('/api/open', { method: 'POST', body: JSON.stringify({ path: '/definitely/not/here' }) });
    expect(bad.status).toBe(400);
    const msg = (await bad.json()).error as string;
    expect(msg).toMatch(/^Folder not found or not readable/);
    expect(msg).not.toMatch(UZ);
    const uz = await api('/api/open', { method: 'POST', body: JSON.stringify({ path: '/definitely/not/here' }) });
    expect((await uz.json()).error).toMatch(/^Papka topilmadi/);
    // token xatosi ham
    const noTok = await fetch(`http://127.0.0.1:${srv.port}/api/state`, { headers: { 'x-xray-lang': 'en' } });
    expect((await noTok.json()).error).toBe('Token required');
  });

  it('coded git/scan errors are localised; AI-off reason and evidence reasons are English', async () => {
    await post('/api/open', { path: repoDir });
    const badRef = await en('/api/impact', { method: 'POST', body: JSON.stringify({ spec: { kind: 'range', base: '--output=/tmp/x', head: 'HEAD' } }) });
    expect(badRef.status).toBe(400);
    expect((await badRef.json()).error).toMatch(/^Invalid ref name/);

    const ask = await (await en('/api/ask', { method: 'POST', body: JSON.stringify({ question: 'Where is `fetchArticle` called?' }) })).json();
    expect(ask.disabledReason).toMatch(/^(AI is not configured|No consent|API key not found|Consent was given)/);
    expect(ask.evidence.chunks[0].why.join(' ')).toContain("name matches 'fetchArticle'");
    expect(ask.evidence.facts.map((f: { text: string }) => f.text).join(' ')).not.toMatch(UZ);
  });

  it('index stats carry a language-independent reasonCode; reason text follows the language', async () => {
    const r = await (await en('/api/open', { method: 'POST', body: JSON.stringify({ path: repoDir, full: true }) })).json();
    expect(r.stats.reasonCode).toBe('forced');
    expect(r.stats.reason).toBe('full requested');
  });

  it('consent text is served per language and EITHER language is accepted on enable', async () => {
    const enText = (await (await en('/api/ai/consent-text?provider=anthropic')).json()).text as string;
    expect(enText).toContain('sent over the internet');
    const ok = await en('/api/ai/enable', { method: 'POST', body: JSON.stringify({ provider: 'anthropic', model: 'm', apiKeyEnv: 'ANTHROPIC_API_KEY', accepted: true, consentText: enText }) });
    expect(ok.status).toBe(200);
  });
});
