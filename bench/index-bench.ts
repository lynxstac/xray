// Ishlatish: node bench/index-bench.ts <repo> [<repo> ...]
// Har repo alohida jarayonda o'lchanadi (maxRSS toza bo'lishi uchun). Natija: bench/results/*.json
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.argv[2] === '--child') {
  const { indexProject } = await import('@xray/graph');
  const repo = process.argv[3]!;
  const t0 = performance.now();
  const r = await indexProject(repo); // keshsiz, to'liq
  const ms = Math.round(performance.now() - t0);
  const byKind: Record<string, number> = {};
  for (const e of r.graph.edges) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  const conf: Record<string, number> = {};
  for (const e of r.graph.edges) conf[e.confidence] = (conf[e.confidence] ?? 0) + 1;
  const unresolved: Record<string, number> = {};
  for (const u of r.graph.unresolved) unresolved[u.reason] = (unresolved[u.reason] ?? 0) + 1;
  const badImports = r.graph.unresolved.filter((u) => u.reason === 'unresolved-module').slice(0, 15).map((u) => `${u.file}:${u.loc.startLine} '${u.snippet}'`);
  const skipped: Record<string, number> = {};
  for (const s of r.scan.skipped) skipped[s.reason] = (skipped[s.reason] ?? 0) + 1;
  const externals = new Set<string>();
  for (const l of r.graph.externals.values()) l.forEach((x) => externals.add(x));
  console.log(
    JSON.stringify({
      repo: path.basename(repo), files: r.stats.scanned, nodes: r.stats.nodes, edges: r.stats.edges, edgesByKind: byKind, edgesByConfidence: conf,
      unresolved, skipped, syntaxErrors: r.stats.withSyntaxErrors, externalPackages: externals.size, indexMs: ms,
      maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024), badImports,
    }),
  );
} else {
  const env = { node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}` };
  const results = [];
  for (const repo of process.argv.slice(2)) {
    const out = execFileSync('node', [import.meta.filename, '--child', path.resolve(repo)], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const j = JSON.parse(out.trim().split('\n').pop()!);
    results.push(j);
    console.log(j.repo.padEnd(26), `files=${j.files}`.padEnd(11), `nodes=${j.nodes}`.padEnd(12), `edges=${j.edges}`.padEnd(12), `${j.indexMs}ms`.padEnd(9), `rss=${j.maxRssMB}MB`, ` unresolved=${JSON.stringify(j.unresolved)}`);
  }
  mkdirSync(path.join(import.meta.dirname, 'results'), { recursive: true });
  const file = path.join(import.meta.dirname, 'results', `index-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(file, JSON.stringify({ env, results }, null, 2));
  console.log('->', file);
}
