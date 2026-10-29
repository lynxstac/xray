import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { indexProject, type IndexResult } from '@xray/graph';

const fixture = path.resolve(import.meta.dirname, '../../../fixtures/react-app');
const base = path.resolve(import.meta.dirname, '../../../.tmp-test');
let dir: string;
let db: string;

const canon = (r: IndexResult) => ({
  nodes: [...r.graph.nodes.keys()].sort(),
  edges: r.graph.edges.map((e) => `${e.kind}|${e.from}|${e.to}|${e.confidence}|${e.count}|${e.via ?? ''}`).sort(),
  unresolved: r.graph.unresolved.map((u) => `${u.file}|${u.reason}|${u.snippet}`).sort(),
  externals: [...r.graph.externals].sort(),
});

async function edit(rel: string, fn: (s: string) => string) {
  const p = path.join(dir, rel);
  await writeFile(p, fn(await readFile(p, 'utf8')));
}

beforeAll(async () => {
  await mkdir(base, { recursive: true });
  dir = await mkdtemp(path.join(base, 'inc-'));
  await cp(fixture, dir, { recursive: true });
  db = path.join(dir, '..', path.basename(dir) + '.db');
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(db, { force: true });
  await rm(db + '-wal', { force: true });
  await rm(db + '-shm', { force: true });
});

describe('incremental indexing == full re-index', () => {
  it('first run is full and persisted; second run is a no-op with identical graph', async () => {
    const a = await indexProject(dir, { dbPath: db });
    expect(a.stats.mode).toBe('full');
    const b = await indexProject(dir, { dbPath: db });
    expect(b.stats).toMatchObject({ mode: 'noop', reparsed: 0, semanticRecomputed: 0 });
    expect(canon(b)).toEqual(canon(a));
  });

  it('body-only edit of a leaf file: reparses 1 file, recomputes only its dependents, equals full', async () => {
    await edit('src/pages/ListPage.tsx', (s) => s.replace('String(items)', 'String(items) + "!"'));
    const inc = await indexProject(dir, { dbPath: db });
    expect(inc.stats.mode).toBe('incremental');
    expect(inc.stats.reparsed).toBe(1);
    // ListPage + uni import qiluvchi dyn/loader.ts, jami 2 ta (butun repo emas)
    expect(inc.stats.semanticRecomputed).toBe(2);
    const full = await indexProject(dir, { full: true });
    expect(canon(inc)).toEqual(canon(full));
  });

  it('renaming an export in a deep file invalidates transitive importers (through barrels) — equals full', async () => {
    await edit('src/lib/format.ts', (s) => s.replace(/formatDate/g, 'formatDay'));
    const inc = await indexProject(dir, { dbPath: db });
    expect(inc.stats.mode).toBe('incremental');
    const full = await indexProject(dir, { full: true });
    expect(canon(inc)).toEqual(canon(full));
    // ArticleCard hali formatDate'ni ishlatadi -> endi buzilgan: calls edge yo'q, lekin xato yashirilmaydi
    expect(inc.graph.edges.some((e) => e.kind === 'calls' && e.to.endsWith('#formatDate'))).toBe(false);
  });

  it('a NEW export two hops away (via `export *` barrel) reaches importers that previously failed to resolve it', async () => {
    await writeFile(path.join(dir, 'src/lib/index.ts'), "export * from './api';\nexport * from './format';\n");
    await edit('src/components/ArticleCard.tsx', (s) => s.replace(/formatDate/g, 'formatYear'));
    const before = await indexProject(dir, { dbPath: db });
    expect(before.graph.edges.some((e) => e.kind === 'calls' && e.to.endsWith('#formatYear'))).toBe(false);

    await edit('src/lib/format.ts', (s) => s + '\nexport function formatYear(d: Date) {\n  return d.getFullYear();\n}\n');
    const inc = await indexProject(dir, { dbPath: db });
    expect(inc.stats.mode).toBe('incremental');
    expect(inc.graph.edges.some((e) => e.kind === 'calls' && e.from === 'src/components/ArticleCard.tsx#ArticleCard' && e.to === 'src/lib/format.ts#formatYear')).toBe(true);
    expect(canon(inc)).toEqual(canon(await indexProject(dir, { full: true })));
  });

  it('adding a file triggers a full rebuild (resolution may change) and is correct', async () => {
    await writeFile(path.join(dir, 'src/lib/extra.ts'), "import { fetchArticles } from './api';\nexport const x = () => fetchArticles();\n");
    const inc = await indexProject(dir, { dbPath: db });
    expect(inc.stats.mode).toBe('full');
    expect(inc.graph.edges.some((e) => e.kind === 'calls' && e.from === 'src/lib/extra.ts#x')).toBe(true);
    expect(canon(inc)).toEqual(canon(await indexProject(dir, { full: true })));
  });

  it('deleting a file removes its nodes/edges and importers get unresolved-module (not stale edges)', async () => {
    await unlink(path.join(dir, 'src/cycle/b.ts'));
    const inc = await indexProject(dir, { dbPath: db });
    expect(inc.stats.mode).toBe('full');
    expect(inc.graph.nodes.has('src/cycle/b.ts')).toBe(false);
    expect(inc.graph.unresolved.some((u) => u.file === 'src/cycle/a.ts' && u.reason === 'unresolved-module')).toBe(true);
    expect(canon(inc)).toEqual(canon(await indexProject(dir, { full: true })));
  });

  it('changing tsconfig paths invalidates the cache', async () => {
    await edit('tsconfig.json', (s) => s.replace('"@/*": ["src/*"]', '"@/*": ["src/*"], "~/*": ["src/*"]'));
    expect((await indexProject(dir, { dbPath: db })).stats.reason).toMatch(/tsconfig/);
  });

  it('a syntax error does not poison the index; fixing it restores edges', async () => {
    await edit('src/hooks/useArticles.ts', (s) => s + '\nexport function broken( {\n');
    const bad = await indexProject(dir, { dbPath: db });
    expect(bad.stats.withSyntaxErrors).toBe(1);
    await edit('src/hooks/useArticles.ts', (s) => s.replace('\nexport function broken( {\n', ''));
    const ok = await indexProject(dir, { dbPath: db });
    expect(ok.stats.withSyntaxErrors).toBe(0);
    expect(canon(ok)).toEqual(canon(await indexProject(dir, { full: true })));
  });
});
