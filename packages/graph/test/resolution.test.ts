import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildGraphFromDisk } from '@xray/graph';

const base = path.resolve(import.meta.dirname, '../../../.tmp-test');
let dir: string;
const w = async (rel: string, c: string) => {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), c);
};
beforeEach(async () => {
  await mkdir(base, { recursive: true });
  dir = await mkdtemp(path.join(base, 'res-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const has = (g: Awaited<ReturnType<typeof buildGraphFromDisk>>['graph'], kind: string, from: string, to: string) =>
  g.edges.some((e) => e.kind === kind && e.from === from && e.to === to);

describe('tsconfig resolution', () => {
  it('Vite-style solution tsconfig: paths live in tsconfig.app.json referenced from tsconfig.json', async () => {
    await w('tsconfig.json', JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.node.json' }] }));
    await w('tsconfig.app.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } }, include: ['src'] }));
    await w('tsconfig.node.json', JSON.stringify({ compilerOptions: {}, include: ['vite.config.ts'] }));
    await w('src/lib/x.ts', 'export function x() { return 1; }\n');
    await w('src/main.ts', "import { x } from '@/lib/x';\nexport const run = () => x();\n");
    await w('vite.config.ts', 'export default {};\n');
    const { graph } = await buildGraphFromDisk(dir);
    expect(has(graph, 'imports', 'src/main.ts', 'src/lib/x.ts')).toBe(true);
    expect(has(graph, 'calls', 'src/main.ts#run', 'src/lib/x.ts#x')).toBe(true);
    expect(graph.unresolved).toEqual([]);
  });

  it('alias-looking specifier that cannot be resolved is REPORTED, never silently treated as an npm package', async () => {
    await w('src/a.ts', "import { q } from '@/missing/thing';\nimport z from '~/also/missing';\nimport r from 'react';\nexport const a = [q, z, r];\n");
    const { graph } = await buildGraphFromDisk(dir);
    expect(graph.unresolved.filter((u) => u.reason === 'unresolved-module').map((u) => u.snippet).sort()).toEqual(['@/missing/thing', '~/also/missing']);
    expect(graph.externals.get('src/a.ts')).toEqual(['react']);
  });

  it('monorepo: each package resolves its OWN alias via its nearest tsconfig', async () => {
    await w('packages/a/tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@a/*': ['src/*'] } } }));
    await w('packages/a/src/util.ts', 'export const ua = () => 1;\n');
    await w('packages/a/src/index.ts', "import { ua } from '@a/util';\nexport const fa = () => ua();\n");
    await w('packages/b/tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@b/*': ['src/*'] } } }));
    await w('packages/b/src/util.ts', 'export const ub = () => 2;\n');
    await w('packages/b/src/index.ts', "import { ub } from '@b/util';\nexport const fb = () => ub();\n");
    const { graph } = await buildGraphFromDisk(dir);
    expect(has(graph, 'calls', 'packages/a/src/index.ts#fa', 'packages/a/src/util.ts#ua')).toBe(true);
    expect(has(graph, 'calls', 'packages/b/src/index.ts#fb', 'packages/b/src/util.ts#ub')).toBe(true);
    expect(graph.unresolved).toEqual([]);
  });

  it('ESM-style `./x.js` specifiers resolve to x.ts; CSS/asset imports are not "unresolved"', async () => {
    await w('src/x.ts', 'export const x = 1;\n');
    await w('src/y.ts', "import { x } from './x.js';\nimport './styles.css';\nimport logo from './logo.svg';\nexport const y = [x, logo];\n");
    const { graph } = await buildGraphFromDisk(dir);
    expect(has(graph, 'imports', 'src/y.ts', 'src/x.ts')).toBe(true);
    expect(graph.unresolved).toEqual([]);
  });

  it('class methods, new, and member calls resolve to the exact member (verified) ', async () => {
    await w('src/k.ts', 'export class K {\n  run() { return this.helper(); }\n  helper() { return 1; }\n}\n');
    await w('src/use.ts', "import { K } from './k';\nexport function go() {\n  const k = new K();\n  return k.run();\n}\n");
    const { graph } = await buildGraphFromDisk(dir);
    expect(has(graph, 'calls', 'src/use.ts#go', 'src/k.ts#K')).toBe(true);
    expect(has(graph, 'calls', 'src/use.ts#go', 'src/k.ts#K.run')).toBe(true);
    expect(has(graph, 'calls', 'src/k.ts#K.run', 'src/k.ts#K.helper')).toBe(true);
    const e = graph.edges.find((x) => x.kind === 'calls' && x.to === 'src/k.ts#K.run')!;
    expect(e.confidence).toBe('verified');
  });

  it('type flows through Promise: `await import()` destructuring, `.then(m => m.X)` and `{ shorthand }` are references', async () => {
    await w('src/page.ts', 'export const Page = () => 1;\nexport const Other = () => 2;\nexport const cfg = { a: 1 };\n');
    await w('src/router.ts', "export const lazyPage = () => import('./page').then((m) => ({ default: m.Page }));\n");
    await w('src/test.ts', "export async function t() {\n  const { Other } = await import('./page');\n  return Other();\n}\n");
    await w('src/bag.ts', "import { cfg } from './page';\nexport const bag = { cfg };\n");
    const { graph } = await buildGraphFromDisk(dir);
    expect(has(graph, 'references', 'src/router.ts#lazyPage', 'src/page.ts#Page')).toBe(true);
    expect(has(graph, 'references', 'src/test.ts#t', 'src/page.ts#Other')).toBe(true);
    expect(has(graph, 'references', 'src/bag.ts#bag', 'src/page.ts#cfg')).toBe(true);
  });

  it('computed calls are flagged unresolved instead of guessed', async () => {
    await w('src/c.ts', 'const o: Record<string, () => void> = {};\nexport function f(k: string) {\n  o[k]();\n}\n');
    const { graph } = await buildGraphFromDisk(dir);
    expect(graph.unresolved.map((u) => u.reason)).toEqual(['computed-call']);
  });
});
