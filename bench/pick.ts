import { runImpact } from '@xray/impact';
import { execFileSync } from 'node:child_process';
const root = process.argv[2]!;
const shas = execFileSync('git', ['log', '--no-merges', '-n40', '--format=%H %s'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const rows = [];
for (const l of shas) {
  const sha = l.slice(0, 40);
  try {
    const { report } = await runImpact({ root, spec: { kind: 'range', base: `${sha}~1`, head: sha } });
    rows.push({ sha: sha.slice(0, 8), subj: l.slice(41, 80), d: report.stats.direct, i: report.stats.indirect, routes: report.stats.routes, t: report.stats.tests });
  } catch { /* birinchi commit */ }
}
rows.sort((a, b) => b.routes - a.routes || b.d - a.d);
console.table(rows.slice(0, 6));
