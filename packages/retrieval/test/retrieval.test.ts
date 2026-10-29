import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { indexProject, openStore, type IndexResult, type XrayStore } from '@xray/graph';
import { extractTerms, retrieve } from '@xray/retrieval';

const fixture = path.resolve(import.meta.dirname, '../../../fixtures/react-app');
const base = path.resolve(import.meta.dirname, '../../../.tmp-test');
let dir: string;
let db: string;
let idx: IndexResult;
let store: XrayStore;

beforeAll(async () => {
  await mkdir(base, { recursive: true });
  dir = await mkdtemp(path.join(base, 'ret-'));
  await cp(fixture, dir, { recursive: true });
  db = dir + '.db';
  idx = await indexProject(dir, { dbPath: db });
  store = openStore(db);
});
afterAll(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
  for (const s of ['', '-wal', '-shm']) await rm(db + s, { force: true });
});

const run = (q: string) => retrieve(q, { graph: idx.graph, store, root: dir });

describe('extractTerms', () => {
  it('finds identifiers in backticks and camelCase, and plain words', () => {
    const t = extractTerms('Where is `fetchArticle` called from useArticle in the app?');
    expect(t.identifiers).toEqual(expect.arrayContaining(['fetchArticle', 'useArticle']));
    expect(t.words).not.toContain('the');
  });
});

describe('retrieve', () => {
  it('exact identifier match ranks first, and callers appear as graph facts with locations', async () => {
    const r = await run('Where is `fetchArticle` called?');
    expect(r.chunks[0]!.id).toBe('src/lib/api.ts#fetchArticle');
    expect(r.chunks.map((c) => c.id)).toContain('src/hooks/useArticle.ts#useArticle');
    expect(r.facts.some((f) => f.text.includes('useArticle') && f.text.includes('calls fetchArticle') && f.line > 0)).toBe(true);
  });

  it('natural-language question finds relevant code lexically (no exact identifier given)', async () => {
    const r = await run('how are articles fetched from the api');
    const ids = r.chunks.map((c) => c.id);
    expect(ids.some((i) => i.includes('fetchArticle'))).toBe(true);
  });

  it('chunk text is the real source at the stated lines', async () => {
    const r = await run('`formatDate`');
    const c = r.chunks.find((x) => x.id === 'src/lib/format.ts#formatDate')!;
    expect(c.text).toContain('toISOString');
    expect(c.startLine).toBe(1);
  });

  it('FTS operator characters in a question cannot break or inject into the query', async () => {
    for (const q of ['"; DROP TABLE files; --', 'NEAR( OR * AND', 'a" OR "b', '(((', '']) {
      await expect(run(q)).resolves.toBeTruthy();
    }
  });

  it('returns nothing (not guesses) for an unrelated question', async () => {
    const r = await run('kubernetes ingress controller helm chart');
    expect(r.chunks).toEqual([]);
  });
});
