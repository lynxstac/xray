import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { indexProject } from '@xray/graph';

const fixture = path.resolve(import.meta.dirname, '../../../fixtures/basic');

const snapshot = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else {
        const st = await fs.stat(abs);
        out.push(`${path.relative(dir, abs)}:${st.mtimeMs}:${st.size}`);
      }
    }
  };
  await walk(dir);
  return out.sort();
};

describe('indexProject(fixtures/basic)', () => {
  it('indexes the whole fixture; a broken file does not stop the run', async () => {
    const r = await indexProject(fixture);
    expect(r.files.map((f) => f.path)).toEqual([
      'src/Button.test.tsx', 'src/Button.tsx', 'src/broken.ts', 'src/cycleA.ts', 'src/cycleB.ts',
      'src/dynamic.ts', 'src/index.ts', 'src/math.ts', 'src/types.ts', 'src/utils.ts',
    ]);
    expect(r.stats).toMatchObject({ scanned: 10, parsed: 10, failed: 0, withSyntaxErrors: 1, unresolved: 2 });
    expect(r.files.find((f) => f.path === 'src/broken.ts')!.errors.length).toBeGreaterThan(0);
  });

  it('extracts expected facts from real parsing (spot checks)', async () => {
    const r = await indexProject(fixture);
    const f = (p: string) => r.files.find((x) => x.path === p)!;
    expect(f('src/Button.tsx').symbols.map((s) => [s.name, s.kind])).toEqual([['Button', 'component'], ['useCounter', 'hook'], ['Memo', 'component']]);
    expect(f('src/Button.test.tsx').isTestFile).toBe(true);
    expect(f('src/math.ts').exports.map((e) => e.exported)).toEqual(['add', 'mul', 'default', 'Calc', 'zero']);
  });

  it('is read-only: the indexed repo is byte-for-byte untouched (no .xray dir, no db inside)', async () => {
    const before = await snapshot(fixture);
    await indexProject(fixture);
    expect(await snapshot(fixture)).toEqual(before);
  });
});
