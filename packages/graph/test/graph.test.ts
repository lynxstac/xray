import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildGraphFromDisk } from '@xray/graph';
import type { EdgeKind } from '@xray/core';

const fixture = path.resolve(import.meta.dirname, '../../../fixtures/react-app');

async function actual() {
  const b = await buildGraphFromDisk(fixture);
  const by: Record<string, Set<string>> = {};
  for (const e of b.graph.edges) (by[e.kind] ??= new Set()).add(`${e.from} -> ${e.to}`);
  return { b, by };
}

describe('graph vs hand-written expected-graph.json', () => {
  for (const kind of ['imports', 'calls', 'renders', 'references', 'tests', 'exports'] as EdgeKind[]) {
    it(`${kind}: exact match (no missing, no extra)`, async () => {
      const exp = JSON.parse(await fs.readFile(path.join(fixture, 'expected-graph.json'), 'utf8'));
      const { by } = await actual();
      const got = [...(by[kind] ?? [])].sort();
      const want = [...(exp[kind] as string[])].sort();
      expect({ missing: want.filter((x) => !got.includes(x)), extra: got.filter((x) => !want.includes(x)) }).toEqual({ missing: [], extra: [] });
    });
  }

  it('unresolved: dynamic template import is reported, not guessed', async () => {
    const { b } = await actual();
    expect(b.graph.unresolved.map((u) => `${u.file}|${u.reason}`)).toEqual(['src/dyn/loader.ts|dynamic-import']);
  });

  it('externals recorded (react), no node_modules parsed', async () => {
    const { b } = await actual();
    expect(b.graph.externals.get('src/hooks/useArticle.ts')).toEqual(['react']);
  });

  it('every edge has evidence inside its source file; test files have test_file kind', async () => {
    const { b } = await actual();
    for (const e of b.graph.edges) {
      if (e.kind === 'tests') continue;
      const from = b.graph.nodes.get(e.from)!;
      if (e.kind !== 'exports') expect(e.evidence.file, `${e.kind} ${e.from}->${e.to}`).toBe(from.file);
      expect(e.evidence.startLine).toBeGreaterThan(0);
    }
    expect(b.graph.nodes.get('src/lib/api.test.ts')!.kind).toBe('test_file');
  });
});
