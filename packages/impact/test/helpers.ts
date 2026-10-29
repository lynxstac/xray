import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runImpact } from '@xray/impact';
import type { ImpactReport } from '@xray/impact';
import type { DiffSpec } from '@xray/git';

export const fixtureDir = path.resolve(import.meta.dirname, '../../../fixtures/react-app');
export const tmpBase = path.resolve(import.meta.dirname, '../../../.tmp-test');

export interface Repo {
  dir: string;
  git: (...a: string[]) => string;
  edit: (rel: string, fn: (s: string) => string) => Promise<void>;
  write: (rel: string, content: string) => Promise<void>;
  commitAll: (msg: string) => string;
  impact: (spec?: DiffSpec) => Promise<ImpactReport>;
  cleanup: () => Promise<void>;
}

export async function makeRepo(src = fixtureDir): Promise<Repo> {
  await mkdir(tmpBase, { recursive: true });
  const dir = await mkdtemp(path.join(tmpBase, 'impact-'));
  await cp(src, dir, { recursive: true });
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const snaps = path.join(tmpBase, 'snaps');
  return {
    dir,
    git,
    edit: async (rel, fn) => writeFile(path.join(dir, rel), fn(await readFile(path.join(dir, rel), 'utf8'))),
    write: async (rel, c) => {
      await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeFile(path.join(dir, rel), c);
    },
    commitAll: (msg) => {
      git('add', '-A');
      git('commit', '-q', '-m', msg);
      return git('rev-parse', 'HEAD').trim();
    },
    impact: async (spec = { kind: 'working' }) => (await runImpact({ root: dir, spec, snapshotDir: snaps })).report,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

export function precisionRecall(got: string[], want: string[]) {
  const g = new Set(got);
  const w = new Set(want);
  const tp = [...g].filter((x) => w.has(x)).length;
  return { precision: g.size ? tp / g.size : 1, recall: w.size ? tp / w.size : 1, falsePositives: [...g].filter((x) => !w.has(x)), falseNegatives: [...w].filter((x) => !g.has(x)) };
}
