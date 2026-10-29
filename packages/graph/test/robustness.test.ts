import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { indexProject } from '@xray/graph';

const base = path.resolve(import.meta.dirname, '../../../.tmp-test');
let dir: string;
const w = async (rel: string, c: string | Buffer) => {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), c);
};
beforeEach(async () => {
  await mkdir(base, { recursive: true });
  dir = await mkdtemp(path.join(base, 'rob-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('untrusted repository content', () => {
  it('NEVER executes repo code: tsconfig plugin, config scripts and import side effects stay inert', async () => {
    const marker = path.join(dir, 'PWNED');
    const evil = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\nmodule.exports = () => ({});\n`;
    await w('evil-plugin.js', evil);
    await w('tsconfig.json', JSON.stringify({ compilerOptions: { plugins: [{ name: './evil-plugin.js' }], paths: { '@/*': ['src/*'] }, baseUrl: '.' } }));
    await w('vite.config.ts', evil);
    await w('package.json', JSON.stringify({ scripts: { postinstall: `node evil-plugin.js`, prepare: `node evil-plugin.js` } }));
    await w('src/a.ts', `import '@/b';\n${evil}\nexport const a = 1;\n`);
    await w('src/b.ts', 'export const b = 2;\n');
    const r = await indexProject(dir);
    expect(r.stats.scanned).toBeGreaterThan(0);
    expect(existsSync(marker)).toBe(false);
  });

  it('pathologically deep nesting does not crash the run; the failure is reported, other files still indexed', async () => {
    await w('src/ok.ts', 'export const ok = 1;\n');
    await w('src/deep.ts', `export const x = ${'['.repeat(60000)}${']'.repeat(60000)};\n`);
    const r = await indexProject(dir, { scan: { maxFileBytes: 5_000_000 } });
    expect(r.files.find((f) => f.path === 'src/ok.ts')!.exports.length).toBe(1);
    const deep = r.files.find((f) => f.path === 'src/deep.ts')!;
    // Yiqilish YASHIRILMAYDI: fayl xato bilan belgilangan va semantik tahlilga kiritilmagan.
    expect(deep.parseFailed).toBe(true);
    expect(deep.errors[0]!.message).toMatch(/Parser xatosi/);
    expect(r.stats).toMatchObject({ failed: 1, withSyntaxErrors: 1 });
    expect(r.graph.edges.every((e) => !e.from.startsWith('src/deep.ts'))).toBe(true);
  });

  it('garbage / binary bytes in a .ts file produce syntax errors, not a crash', async () => {
    await w('src/bin.ts', Buffer.from([0, 1, 2, 255, 254, 0, 0, 71, 71, 0xc3, 0x28]));
    await w('src/ok.ts', 'export const ok = 1;\n');
    const r = await indexProject(dir);
    expect(r.files.map((f) => f.path)).toEqual(['src/bin.ts', 'src/ok.ts']);
  });

  it('a very long single line and an oversized file are handled (oversized is skipped and reported)', async () => {
    await w('src/long.ts', `export const s = "${'a'.repeat(900_000)}";\n`);
    await w('src/huge.ts', 'x'.repeat(3_000_000));
    const r = await indexProject(dir);
    expect(r.files.some((f) => f.path === 'src/long.ts')).toBe(true);
    expect(r.scan.skipped).toContainEqual({ path: 'src/huge.ts', reason: 'too-large' });
  });

  it('odd file names (spaces, unicode, brackets, #, quotes) round-trip through ids and edges', async () => {
    await w('src/app/[id]/page (1).ts', 'export const page = 1;\n');
    await w('src/ünï/ключ.ts', "import { page } from '../app/[id]/page (1)';\nexport const k = () => page;\n");
    await w('src/we#ird.ts', 'export const w = 1;\n');
    await w('src/use.ts', "import { w } from './we#ird';\nexport const u = () => w;\n");
    const r = await indexProject(dir);
    expect(r.graph.edges.some((e) => e.kind === 'references' && e.from === 'src/ünï/ключ.ts#k' && e.to === 'src/app/[id]/page (1).ts#page')).toBe(true);
    expect(r.graph.edges.some((e) => e.kind === 'references' && e.from === 'src/use.ts#u' && e.to === 'src/we#ird.ts#w')).toBe(true);
  });
});
