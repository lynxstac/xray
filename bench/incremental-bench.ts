// Incremental vs full: repo nusxasida (asl repo o'zgarmaydi). Ishlatish: node bench/incremental-bench.ts <nusxa-papka>
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexProject } from '@xray/graph';

const dir = path.resolve(process.argv[2]!);
const db = path.join(mkdtempSync(path.join(os.tmpdir(), 'xray-incb-')), 'i.db');
const t = async (label: string, f: () => ReturnType<typeof indexProject>) => {
  const t0 = performance.now();
  const r = await f();
  const ms = Math.round(performance.now() - t0);
  console.log(label.padEnd(34), `${ms} ms`.padEnd(10), `mode=${r.stats.mode} reparsed=${r.stats.reparsed} semantic=${r.stats.semanticRecomputed}/${r.stats.scanned}`);
  return r;
};
const full = await t('full (cold, with db write)', () => indexProject(dir, { dbPath: db }));
await t('noop (nothing changed)', () => indexProject(dir, { dbPath: db }));
const files = full.files.filter((f) => !f.isTestFile).map((f) => f.path);
const fanIn = (p: string) => full.graph.incoming(p, ['imports']).length;
const leaf = files.find((p) => fanIn(p) === 0)!;
const hub = files.sort((a, b) => fanIn(b) - fanIn(a))[0]!;
appendFileSync(path.join(dir, leaf), '\n// xray-bench touch\n');
await t(`incremental: leaf (fan-in 0)`, () => indexProject(dir, { dbPath: db }));
appendFileSync(path.join(dir, hub), '\n// xray-bench touch\n');
await t(`incremental: hub (fan-in ${fanIn(hub)})`, () => indexProject(dir, { dbPath: db }));
await t('full again (no cache)', () => indexProject(dir, { full: true }));
rmSync(path.dirname(db), { recursive: true, force: true });
