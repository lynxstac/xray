// Real git tarixida Impact'ni qayta o'ynash: oxirgi N ta commit (merge'siz), har biri `sha~1...sha`.
// Maqsad: qulash/xato/anomaliyalarni topish va vaqtni o'lchash. (Aniqlik emas — u accuracy.ts da.)
// Ishlatish: node bench/replay.ts <repo> [N=12]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runImpact } from '@xray/impact';

const root = path.resolve(process.argv[2]!);
const N = Number(process.argv[3] ?? 12);
const shas = execFileSync('git', ['log', '--no-merges', `-n${N}`, '--format=%H'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const rows: Record<string, unknown>[] = [];
let failures = 0;
for (const sha of shas) {
  const t0 = performance.now();
  try {
    const { report } = await runImpact({ root, spec: { kind: 'range', base: `${sha}~1`, head: sha } });
    const s = report.stats;
    const noPath = [...report.direct, ...report.indirect].filter((i) => i.path.length !== i.depth).length;
    rows.push({ sha: sha.slice(0, 8), ms: Math.round(performance.now() - t0), files: s.changedFiles, symbols: s.changedSymbols, direct: s.direct, indirect: s.indirect, tests: s.tests, uncertain: report.uncertain.length, truncated: s.truncated, itemsWithBrokenPath: noPath });
  } catch (e) {
    failures++;
    rows.push({ sha: sha.slice(0, 8), error: e instanceof Error ? e.message : String(e) });
  }
}
const ok = rows.filter((r) => !r.error);
const ms = ok.map((r) => r.ms as number).sort((a, b) => a - b);
const summary = { repo: path.basename(root), commits: shas.length, failures, medianMs: ms[Math.floor(ms.length / 2)] ?? null, maxMs: ms.at(-1) ?? null, truncated: ok.filter((r) => r.truncated).length, brokenPaths: ok.reduce((a, r) => a + (r.itemsWithBrokenPath as number), 0) };
mkdirSync(path.join(import.meta.dirname, 'results'), { recursive: true });
writeFileSync(path.join(import.meta.dirname, 'results', `replay-${summary.repo}-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify(summary));
for (const r of rows.filter((r) => r.error)) console.log('  ERROR', r);
