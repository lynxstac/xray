import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildGraphFromDisk, indexProject, type IndexResult } from '@xray/graph';

const base = path.resolve(import.meta.dirname, '../../../.tmp-test');
let dir: string;
const w = async (rel: string, c: string) => {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), c);
};
beforeEach(async () => {
  await mkdir(base, { recursive: true });
  dir = await mkdtemp(path.join(base, 'mono-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));
const has = (g: Awaited<ReturnType<typeof buildGraphFromDisk>>['graph'], kind: string, from: string, to: string) => g.edges.some((e) => e.kind === kind && e.from === from && e.to === to);

describe('cross-package edges in a monorepo', () => {
  it('pnpm-style workspace symlink (node_modules/@org/ui -> packages/ui) resolves to the real source, through a barrel', async () => {
    await w('packages/ui/package.json', JSON.stringify({ name: '@org/ui', main: 'src/index.ts' }));
    await w('packages/ui/tsconfig.json', '{ "compilerOptions": {} }');
    await w('packages/ui/src/button.ts', 'export function Button() { return 1; }\n');
    await w('packages/ui/src/index.ts', "export * from './button';\n");
    await w('packages/app/tsconfig.json', '{ "compilerOptions": {} }');
    await w('packages/app/src/main.ts', "import { Button } from '@org/ui';\nexport const run = () => Button();\n");
    await mkdir(path.join(dir, 'packages/app/node_modules/@org'), { recursive: true });
    await symlink(path.join(dir, 'packages/ui'), path.join(dir, 'packages/app/node_modules/@org/ui'));
    const { graph } = await buildGraphFromDisk(dir);
    expect(has(graph, 'imports', 'packages/app/src/main.ts', 'packages/ui/src/index.ts')).toBe(true);
    expect(has(graph, 'calls', 'packages/app/src/main.ts#run', 'packages/ui/src/button.ts#Button')).toBe(true);
  });

  it('tsconfig `paths` alias pointing into a sibling package', async () => {
    await w('packages/lib/tsconfig.json', '{ "compilerOptions": {} }');
    await w('packages/lib/src/util.ts', 'export const util = () => 1;\n');
    await w('packages/app/tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['../lib/src/*'] } } }));
    await w('packages/app/src/main.ts', "import { util } from '@lib/util';\nexport const run = () => util();\n");
    const { graph } = await buildGraphFromDisk(dir);
    expect(has(graph, 'imports', 'packages/app/src/main.ts', 'packages/lib/src/util.ts')).toBe(true);
    expect(has(graph, 'calls', 'packages/app/src/main.ts#run', 'packages/lib/src/util.ts#util')).toBe(true);
  });

  it('incremental: a new export in package `lib` reaches `app` (cross-package, via barrel) and equals a full re-index', async () => {
    await w('packages/lib/tsconfig.json', '{ "compilerOptions": {} }');
    await w('packages/lib/src/a.ts', 'export const a = 1;\n');
    await w('packages/lib/src/index.ts', "export * from './a';\n");
    await w('packages/app/tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib': ['../lib/src/index.ts'] } } }));
    await w('packages/app/src/main.ts', "import { a, later } from '@lib';\nexport const run = () => [a, later];\n");
    const db = dir + '.db';
    await indexProject(dir, { dbPath: db });
    await w('packages/lib/src/a.ts', 'export const a = 1;\nexport const later = 2;\n');
    const inc = await indexProject(dir, { dbPath: db });
    expect(inc.stats.mode).toBe('incremental');
    expect(has(inc.graph, 'references', 'packages/app/src/main.ts#run', 'packages/lib/src/a.ts#later')).toBe(true);
    const canon = (r: IndexResult) => r.graph.edges.map((e) => `${e.kind}|${e.from}|${e.to}|${e.confidence}|${e.count}`).sort();
    expect(canon(inc)).toEqual(canon(await indexProject(dir, { full: true })));
    for (const x of ['', '-wal', '-shm']) await rm(db + x, { force: true });
  });

  it('workspace packages resolve from package.json `name` with NO node_modules: main -> dist (unbuilt) falls back to src; subpaths work', async () => {
    await w('packages/ui/package.json', JSON.stringify({ name: '@org/ui', main: './dist/index.js', types: './dist/index.d.ts' }));
    await w('packages/ui/src/index.ts', "export * from './button';\n");
    await w('packages/ui/src/button.ts', 'export function Button() { return 1; }\n');
    await w('packages/ui/src/icons/star.ts', 'export const Star = () => 2;\n');
    await w('packages/app/package.json', JSON.stringify({ name: 'app' }));
    await w('packages/app/tsconfig.json', '{ "compilerOptions": {} }');
    await w('packages/app/src/main.ts', "import { Button } from '@org/ui';\nimport { Star } from '@org/ui/icons/star';\nimport React from 'react';\nexport const run = () => [Button(), Star(), React];\n");
    const { graph } = await buildGraphFromDisk(dir);
    expect(has(graph, 'imports', 'packages/app/src/main.ts', 'packages/ui/src/index.ts')).toBe(true);
    expect(has(graph, 'imports', 'packages/app/src/main.ts', 'packages/ui/src/icons/star.ts')).toBe(true);
    expect(has(graph, 'calls', 'packages/app/src/main.ts#run', 'packages/ui/src/button.ts#Button')).toBe(true);
    expect(has(graph, 'calls', 'packages/app/src/main.ts#run', 'packages/ui/src/icons/star.ts#Star')).toBe(true);
    expect(graph.externals.get('packages/app/src/main.ts')).toEqual(['react']); // haqiqiy npm paket tashqi bo'lib qoladi
  });

  it('an existing tsconfig `paths` entry wins over the workspace fallback; bare specifiers are not rebased to the repo root', async () => {
    await w('packages/lib/package.json', JSON.stringify({ name: '@org/lib' }));
    await w('packages/lib/src/index.ts', 'export const fromSrc = 1;\n');
    await w('packages/lib/custom/index.ts', 'export const custom = 1;\n');
    await w('utils/index.ts', 'export const rootUtils = 1;\n'); // `import "utils"` shu yerga RESOLVE BO'LMASLIGI kerak
    await w('packages/app/package.json', JSON.stringify({ name: 'app' }));
    await w('packages/app/tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@org/lib': ['../lib/custom'] } } }));
    await w('packages/app/src/main.ts', "import { custom } from '@org/lib';\nimport * as u from 'utils';\nexport const run = () => [custom, u];\n");
    const { graph } = await buildGraphFromDisk(dir);
    expect(has(graph, 'imports', 'packages/app/src/main.ts', 'packages/lib/custom/index.ts')).toBe(true);
    expect(has(graph, 'imports', 'packages/app/src/main.ts', 'packages/lib/src/index.ts')).toBe(false);
    expect(graph.edges.some((e) => e.kind === 'imports' && e.from === 'packages/app/src/main.ts' && e.to === 'utils/index.ts')).toBe(false);
    expect(graph.externals.get('packages/app/src/main.ts')).toEqual(['utils']);
  });
});
