import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { scanRepository, ScanLimitError } from '@xray/scanner';

const base = path.resolve(import.meta.dirname, '../../../.tmp-test');
let dir: string;
let outside: string;

beforeEach(async () => {
  await fs.mkdir(base, { recursive: true });
  dir = await fs.mkdtemp(path.join(base, 'repo-'));
  outside = await fs.mkdtemp(path.join(base, 'outside-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

const w = async (rel: string, content = 'export {};') => {
  const abs = path.join(dir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
};
const reasons = (r: Awaited<ReturnType<typeof scanRepository>>) => Object.fromEntries(r.skipped.map((s) => [s.path, s.reason]));

describe('scanRepository', () => {
  it('finds sources deterministically, counts other files', async () => {
    await w('src/b.ts'); await w('src/a.tsx'); await w('README.md', '#'); await w('x.json', '{}');
    const r = await scanRepository(dir);
    expect(r.files.map((f) => f.path)).toEqual(['src/a.tsx', 'src/b.ts']);
    expect(r.otherFileCount).toBe(2);
  });

  it('never indexes secrets, and reports them as skipped', async () => {
    await w('.env', 'KEY=1'); await w('.env.local', 'K=2'); await w('server.pem', 'x'); await w('id_rsa', 'x'); await w('.npmrc', 'x');
    const r = await scanRepository(dir);
    expect(r.files).toEqual([]);
    expect(reasons(r)).toMatchObject({ '.env': 'sensitive', '.env.local': 'sensitive', 'server.pem': 'sensitive', id_rsa: 'sensitive', '.npmrc': 'sensitive' });
  });

  it('a SOURCE file merely named secret/credentials is real code and is indexed; data files with those names are not', async () => {
    await w('lib/secret.ts'); await w('lib/secrets.tsx'); await w('auth/credentials.ts');
    await w('secrets.json', '{}'); await w('credentials.yml', 'a: 1'); await w('secret', 'x'); await w('config/credentials.json', '{}');
    const r = await scanRepository(dir);
    expect(r.files.map((f) => f.path)).toEqual(['auth/credentials.ts', 'lib/secret.ts', 'lib/secrets.tsx']);
    expect(reasons(r)).toMatchObject({ 'secrets.json': 'sensitive', 'credentials.yml': 'sensitive', secret: 'sensitive', 'config/credentials.json': 'sensitive' });
  });

  it('skips generated/dependency dirs without descending', async () => {
    await w('node_modules/pkg/index.js'); await w('dist/a.js'); await w('.next/b.js'); await w('src/ok.ts');
    const r = await scanRepository(dir);
    expect(r.files.map((f) => f.path)).toEqual(['src/ok.ts']);
    expect(reasons(r)).toMatchObject({ 'node_modules/': 'ignored-dir', 'dist/': 'ignored-dir', '.next/': 'ignored-dir' });
  });

  it('respects .gitignore and .xrayignore', async () => {
    await w('.gitignore', 'gen/\n*.generated.ts\n'); await w('.xrayignore', 'legacy/\n');
    await w('gen/a.ts'); await w('b.generated.ts'); await w('legacy/c.ts'); await w('keep.ts');
    const r = await scanRepository(dir);
    expect(r.files.map((f) => f.path)).toEqual(['keep.ts']);
  });

  it('skips symlinks that escape the repo (file and dir) and records why', async () => {
    await fs.writeFile(path.join(outside, 'secret.ts'), 'export const s = 1;');
    await fs.symlink(path.join(outside, 'secret.ts'), path.join(dir, 'link.ts'));
    await fs.symlink(outside, path.join(dir, 'linkdir'));
    await w('real.ts');
    const r = await scanRepository(dir);
    expect(r.files.map((f) => f.path)).toEqual(['real.ts']);
    expect(reasons(r)).toMatchObject({ 'link.ts': 'symlink-escape', linkdir: 'symlink-escape' });
  });

  it('does not follow in-repo symlinks (avoids loops/duplicates)', async () => {
    await w('a/x.ts');
    await fs.symlink(path.join(dir, 'a'), path.join(dir, 'loop'));
    const r = await scanRepository(dir);
    expect(r.files.map((f) => f.path)).toEqual(['a/x.ts']);
    expect(reasons(r).loop).toBe('symlink');
  });

  it('skips too-large, .d.ts and minified', async () => {
    await w('big.ts', 'x'.repeat(2000)); await w('t.d.ts'); await w('a.min.js'); await w('ok.ts');
    const r = await scanRepository(dir, { maxFileBytes: 1000 });
    expect(r.files.map((f) => f.path)).toEqual(['ok.ts']);
    expect(reasons(r)).toMatchObject({ 'big.ts': 'too-large', 't.d.ts': 'declaration-file', 'a.min.js': 'minified' });
  });

  it('skips hashed bundler output in assets/ but keeps hand-written files there', async () => {
    await w('releases/v1/assets/DRACOLoader-Cmdreirx.js'); await w('assets/helpers.js'); await w('assets/app-x.js');
    const r = await scanRepository(dir);
    expect(r.files.map((f) => f.path)).toEqual(['assets/app-x.js', 'assets/helpers.js']);
    expect(reasons(r)['releases/v1/assets/DRACOLoader-Cmdreirx.js']).toBe('generated-bundle');
  });

  it('refuses absurdly large folders with a clear error instead of hanging', async () => {
    for (const n of ['a', 'b', 'c', 'd']) await w(`src/${n}.ts`);
    await expect(scanRepository(dir, { maxFiles: 3 })).rejects.toBeInstanceOf(ScanLimitError);
    await expect(scanRepository(dir, { maxFiles: 3 })).rejects.toThrow(/loyiha papkasini/i);
    await expect(scanRepository(dir, { maxEntries: 2 })).rejects.toBeInstanceOf(ScanLimitError);
    expect((await scanRepository(dir, { maxFiles: 4 })).files).toHaveLength(4); // chegaraning o'zi — ruxsat
  });

  it('throws on a non-directory', async () => {
    await w('f.ts');
    await expect(scanRepository(path.join(dir, 'f.ts'))).rejects.toThrow(/Not a directory/);
  });
});
