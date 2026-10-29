import { indexProject, type IndexResult } from '@xray/graph';
import { exportSnapshot, getDiff, GitError, isGitRepo, resolveRef, showFile, type DiffSpec } from '@xray/git';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { analyzeImpact, type ImpactOptions } from './analyze.ts';
import type { ImpactReport } from './types.ts';

export interface RunImpactArgs {
  root: string;
  spec: DiffSpec;
  /** Ishchi katalog indeksi uchun SQLite keshi */
  dbPath?: string;
  options?: ImpactOptions;
  snapshotDir?: string;
}

/** Diff'ni oladi, kerakli graph'larni quradi (head: ishchi katalog yoki commit snapshot; base: faqat kerak bo'lsa) va tahlil qiladi. */
export async function runImpact(args: RunImpactArgs): Promise<{ report: ImpactReport; head: IndexResult }> {
  const { root, spec } = args;
  if (!(await isGitRepo(root))) throw new GitError('Bu papka Git repozitoriy emas', 'notRepo');
  const diff = await getDiff(root, spec);

  let head: IndexResult;
  if (spec.kind === 'range') {
    // "Yangi" tomon ishchi katalog bo'lmasligi mumkin: aniq commit snapshot'idan quramiz.
    const commit = await resolveRef(root, spec.head);
    const snap = await exportSnapshot(root, commit, args.snapshotDir);
    try {
      head = await indexProject(snap.dir);
    } finally {
      await snap.cleanup();
    }
  } else {
    head = await indexProject(root, { dbPath: args.dbPath });
  }

  const report = await analyzeImpact({
    graph: head.graph,
    files: head.files,
    diff,
    readOld: (commit, p) => showFile(root, commit, p),
    buildBaseGraph: async () => {
      if (!diff.baseCommit) throw new GitError('base commit yo\'q');
      const snap = await exportSnapshot(root, diff.baseCommit, args.snapshotDir);
      try {
        return (await indexProject(snap.dir)).graph;
      } finally {
        await snap.cleanup();
      }
    },
    options: args.options,
  });
  const testCommand = await suggestTestCommand(root, report.tests.map((t) => t.file));
  if (testCommand) report.testCommand = testCommand;
  return { report, head };
}

const shq = (p: string) => (/^[\w@%+=:,./\-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

/** Loyihaning test runner'ini (vitest/jest) package.json'dan aniqlab, ta'sirlangan testlar uchun tayyor buyruq beradi. Hech narsa bajarilmaydi. */
export async function suggestTestCommand(root: string, testFiles: string[]): Promise<string | undefined> {
  if (testFiles.length === 0) return undefined;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const files = testFiles.map(shq).join(' ');
    if (deps.vitest) return `npx vitest run ${files}`;
    if (deps.jest) return `npx jest ${files}`;
  } catch {
    /* package.json yo'q yoki buzuq */
  }
  return undefined;
}
