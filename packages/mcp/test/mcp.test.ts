import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runMcp, MCP_TOOLS } from '@xray/mcp';

const fixture = path.resolve(import.meta.dirname, '../../../fixtures/react-app');
const base = path.resolve(import.meta.dirname, '../../../.tmp-test');
let home: string;
let repo: string;
const prevHome = process.env.HOME;

beforeAll(async () => {
  await mkdir(base, { recursive: true });
  home = await mkdtemp(path.join(base, 'mcp-home-'));
  process.env.HOME = home; // indeks keshi haqiqiy ~/.cache'ga yozilmasin
  repo = await mkdtemp(path.join(base, 'mcp-repo-'));
  await cp(fixture, repo, { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'fx', devDependencies: { vitest: '^5' } }));
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo });
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  const f = path.join(repo, 'src/lib/format.ts');
  await writeFile(f, (await readFile(f, 'utf8')).replace('formatDate(d: Date)', 'formatDate(d: Date, l?: string)'));
});
afterAll(async () => {
  process.env.HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

/** JSON-RPC so'rovlarini yuborib, javoblarni qaytaradi (oqim yopilguncha) */
async function session(lines: unknown[]): Promise<Record<string, any>[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (d) => chunks.push(String(d)));
  const done = runMcp(input, output);
  for (const l of lines) input.write((typeof l === 'string' ? l : JSON.stringify(l)) + '\n');
  input.end();
  await done;
  return chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
const call = (id: number, name: string, args: unknown) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const text = (r: Record<string, any>) => r.result.content[0].text as string;

describe('MCP protocol', () => {
  it('initialize, ping, tools/list; notifications get no response', async () => {
    const out = await session([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    ]);
    expect(out.map((o) => o.id)).toEqual([1, 2, 3]);
    expect(out[0]!.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'xray' }, capabilities: { tools: {} } });
    expect(out[2]!.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([...MCP_TOOLS].sort());
    for (const t of out[2]!.result.tools) expect(t.inputSchema.required).toContain('repo');
  });

  it('protocol errors: parse error, unknown method, unknown tool', async () => {
    const out = await session(['{not json', { jsonrpc: '2.0', id: 7, method: 'nope' }, call(8, 'nope', {})]);
    expect(out[0]!.error.code).toBe(-32700);
    expect(out[1]!.error.code).toBe(-32601);
    expect(out[2]!.error.code).toBe(-32602);
  });
});

describe('MCP tools (read-only, real analysis)', () => {
  it('xray_index returns honest stats', async () => {
    const [r] = await session([call(1, 'xray_index', { repo })]);
    const j = JSON.parse(text(r!));
    expect(j).toMatchObject({ files: 17, mode: 'full' });
    expect(j.unresolved).toEqual({ 'dynamic-import': 1 });
  });

  it('xray_search -> xray_node: ids from search work, relationships carry evidence', async () => {
    const out = await session([call(1, 'xray_search', { repo, query: 'fetchArticle' }), call(2, 'xray_node', { repo, id: 'src/lib/api.ts#fetchArticle' })]);
    expect(text(out[0]!)).toContain('`src/lib/api.ts#fetchArticle`');
    const node = text(out[1]!);
    expect(node).toContain('## Incoming');
    expect(node).toMatch(/calls src\/hooks\/useArticle\.ts#useArticle \[verified\] at src\/hooks\/useArticle\.ts:\d+/);
  });

  it('xray_impact: English report with evidence, related tests and a runnable test command', async () => {
    const [r] = await session([call(1, 'xray_impact', { repo })]);
    const md = text(r!);
    expect(md).toContain('## 2. Direct dependents (1)');
    expect(md).toContain('ArticleCard calls formatDate');
    expect(md).toContain('ArticleCard.test.tsx');
    expect(md).toContain('npx vitest run src/components/ArticleCard.test.tsx');
  });

  it('tool failures are isError results (the model can recover), not protocol errors', async () => {
    const out = await session([call(1, 'xray_impact', { repo: '/definitely/not/here' }), call(2, 'xray_node', { repo, id: 'nope#x' }), call(3, 'xray_search', { repo })]);
    for (const o of out) expect(o.result.isError).toBe(true);
    expect(text(out[0]!)).toMatch(/Folder not found/);
    expect(text(out[1]!)).toMatch(/Unknown node id/);
  });

  it('does not modify the repository (read-only)', async () => {
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
    await session([call(1, 'xray_impact', { repo }), call(2, 'xray_index', { repo })]);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toBe(before);
  });
});

describe('xray mcp (real process over stdio)', () => {
  it('answers initialize and a tool call through the CLI entry point', async () => {
    const main = path.resolve(import.meta.dirname, '../../cli/src/main.ts');
    const p = spawn('node', [main, 'mcp'], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = '';
    p.stdout.on('data', (d) => (buf += d));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    p.stdin.write(JSON.stringify(call(2, 'xray_search', { repo, query: 'ArticleCard' })) + '\n');
    p.stdin.end();
    await new Promise((r) => p.on('close', r));
    const msgs = buf.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(msgs[0].result.serverInfo.name).toBe('xray');
    expect(msgs[1].result.content[0].text).toContain('ArticleCard');
  });
});
