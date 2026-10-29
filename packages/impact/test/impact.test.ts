import { afterEach, describe, expect, it } from 'vitest';
import { ids, makeRepo, precisionRecall, type Repo } from './helpers.ts';
import { scenarios } from './scenarios.ts';
import { renderMarkdown } from '@xray/impact';

let repo: Repo | undefined;
afterEach(async () => {
  await repo?.cleanup();
  repo = undefined;
});

describe('impact analysis vs hand-written ground truth', () => {
  for (const sc of scenarios) {
    it(sc.name, async () => {
      repo = await makeRepo();
      await sc.mutate(repo);
      const r = await repo.impact();
      expect({ direct: ids(r.direct), indirect: ids(r.indirect), tests: r.tests.map((t) => t.file).sort() }).toEqual({
        direct: [...sc.direct].sort(),
        indirect: [...sc.indirect].sort(),
        tests: [...sc.tests].sort(),
      });
      // har bir element dalil yo'liga ega va yo'l o'zgargan elementda tugaydi
      for (const it of [...r.direct, ...r.indirect]) {
        expect(it.path.length, it.id).toBe(it.depth);
        expect(it.path[0]!.from).toBe(it.id);
      }
      const md = renderMarkdown(r);
      expect(md).not.toMatch(/buziladi|will break/i);
    });
  }

  it('S5/S6: file-level and rename-derived impact is labelled `possible`, never `verified`', async () => {
    repo = await makeRepo();
    await scenarios[4]!.mutate(repo);
    const r = await repo.impact();
    expect(r.direct.every((d) => d.confidence === 'possible')).toBe(true);
  });

  it('S2: symbol-level direct dependency of a changed signature is `verified`; chain is statically proven', async () => {
    repo = await makeRepo();
    await scenarios[1]!.mutate(repo);
    const r = await repo.impact();
    expect(r.direct[0]).toMatchObject({ id: 'src/components/ArticleCard.tsx#ArticleCard', confidence: 'verified', tier: 'direct' });
    expect(r.indirect[0]).toMatchObject({ depth: 2, tier: 'indirect' });
    expect(r.changed[0]!.symbols).toEqual([expect.objectContaining({ name: 'formatDate', change: 'signature-changed' })]);
  });

  it('aggregate precision/recall over all scenarios is perfect on this fixture (and is measured, not assumed)', async () => {
    let gotAll: string[] = [];
    let wantAll: string[] = [];
    for (const sc of scenarios) {
      repo = await makeRepo();
      await sc.mutate(repo);
      const r = await repo.impact();
      gotAll = gotAll.concat([...ids(r.direct), ...ids(r.indirect), ...r.tests.map((t) => t.file)].map((x) => `${sc.name}|${x}`));
      wantAll = wantAll.concat([...sc.direct, ...sc.indirect, ...sc.tests].map((x) => `${sc.name}|${x}`));
      await repo.cleanup();
      repo = undefined;
    }
    const pr = precisionRecall(gotAll, wantAll);
    expect(pr.falsePositives).toEqual([]);
    expect(pr.falseNegatives).toEqual([]);
  });

  it('commit range (base...head) analyses the HEAD snapshot, not the dirty working tree', async () => {
    repo = await makeRepo();
    repo.git('checkout', '-q', '-b', 'feature');
    await scenarios[1]!.mutate(repo);
    repo.commitAll('change formatDate signature');
    // working tree'ni ataylab "iflos" qilamiz: u hisobotga ta'sir qilmasligi kerak
    await repo.write('src/lib/format.ts', 'export const garbage = 1;\n');
    const r = await repo.impact({ kind: 'range', base: 'main', head: 'feature' });
    expect(ids(r.direct)).toEqual(['src/components/ArticleCard.tsx#ArticleCard']);
  });

  it('empty diff yields an empty, honest report', async () => {
    repo = await makeRepo();
    const r = await repo.impact();
    expect(r.stats).toMatchObject({ changedFiles: 0, direct: 0, indirect: 0, tests: 0 });
  });

  it('non-source changes are reported as not analysed instead of silently ignored', async () => {
    repo = await makeRepo();
    await repo.write('README.md', '# hi\n');
    const r = await repo.impact();
    expect(r.uncertain).toEqual([expect.objectContaining({ kind: 'not-analyzed', file: 'README.md' })]);
  });

  it('syntax errors in a changed file are surfaced as parse-error uncertainty', async () => {
    repo = await makeRepo();
    await repo.edit('src/lib/format.ts', (s) => s + '\nexport function oops( {\n');
    const r = await repo.impact();
    expect(r.uncertain.some((u) => u.kind === 'parse-error' && u.file === 'src/lib/format.ts')).toBe(true);
  });
});

import { routeScenarios } from './scenarios.ts';
import { fixtureDir } from './helpers.ts';
import path from 'node:path';

describe('Next.js route impact vs hand-written ground truth', () => {
  const nextFixture = path.resolve(fixtureDir, '../next-app');
  for (const sc of routeScenarios) {
    it(sc.name, async () => {
      repo = await makeRepo(nextFixture);
      await sc.mutate(repo);
      const r = await repo.impact();
      expect(r.routes.map((x) => `${x.route}|${x.role}|${x.reason}`).sort()).toEqual([...sc.routes].sort());
      expect(r.stats.routes).toBe(sc.routes.length);
    });
  }

  it('non-Next repo: report has no routes section', async () => {
    repo = await makeRepo();
    await repo.edit('src/lib/format.ts', (s) => s.replace('formatDate(d: Date)', 'formatDate(d: Date, l?: string)'));
    const r = await repo.impact();
    expect(r.routes).toEqual([]);
    expect(renderMarkdown(r)).not.toContain('marshrutlar');
  });
});

const UZ_MARKERS = /(bog'liq|yo'q\b|natija|tahlil|o'zgar|qadam|ishlatadi|chaqiradi|manba|rozilik|savol|papka|xato|kerak|mumkin)/i;

describe('English report (lang: en)', () => {
  const snaps = path.resolve(fixtureDir, '../../.tmp-test/snaps');

  it('markdown, reasons and tests are fully English; uz stays the default', async () => {
    repo = await makeRepo();
    await scenarios[1]!.mutate(repo);
    const { runImpact } = await import('@xray/impact');
    const { report: en } = await runImpact({ root: repo.dir, spec: { kind: 'working' }, snapshotDir: snaps, options: { lang: 'en' } });
    const md = renderMarkdown(en, 'en');
    expect(md).toContain('## 2. Direct dependents (1)');
    expect(md).toContain('This report shows code that **may be affected**');
    expect(en.direct[0]!.reason).toBe('ArticleCard calls formatDate (src/components/ArticleCard.tsx:6); source: formatDate @ src/lib/format.ts — signature changed');
    expect(en.indirect[0]!.reason).toContain('renders ArticleCard (chain of 2 steps)');
    expect(en.tests[0]!.because).toContain('connected through a chain');
    expect(md).not.toMatch(UZ_MARKERS);
    const uz = await repo.impact();
    expect(uz.direct[0]!.reason).toContain('ni chaqiradi');
    expect(renderMarkdown(uz)).toContain("## 2. Bevosita bog'liq (1)");
  });

  it('uncertainty messages (not-analysed, syntax error) are English too', async () => {
    repo = await makeRepo();
    await repo.write('README.md', '# x\n');
    await repo.edit('src/lib/format.ts', (s) => s + '\nexport function oops( {\n');
    const { runImpact } = await import('@xray/impact');
    const { report } = await runImpact({ root: repo.dir, spec: { kind: 'working' }, snapshotDir: snaps, options: { lang: 'en' } });
    const msgs = report.uncertain.map((u) => u.message).join('\n');
    expect(msgs).toContain('Not a source file');
    expect(msgs).toContain('Syntax error:');
    expect(msgs).not.toMatch(UZ_MARKERS);
  });
});

describe('suggested test command', () => {
  it('detects vitest/jest from package.json, quotes odd paths, and stays silent without a runner or tests', async () => {
    const { suggestTestCommand } = await import('@xray/impact');
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const dir = await mkdtemp(path.join(path.resolve(fixtureDir, '../../.tmp-test'), 'tc-'));
    try {
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^5' } }));
      expect(await suggestTestCommand(dir, ['a.test.ts', 'src/my dir/b.test.ts', "it's.test.ts"])).toBe(`npx vitest run a.test.ts 'src/my dir/b.test.ts' 'it'\\''s.test.ts'`);
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { jest: '^29' } }));
      expect(await suggestTestCommand(dir, ['a.test.ts'])).toBe('npx jest a.test.ts');
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { mocha: '1' } }));
      expect(await suggestTestCommand(dir, ['a.test.ts'])).toBeUndefined();
      expect(await suggestTestCommand(dir, [])).toBeUndefined();
      expect(await suggestTestCommand('/definitely/not/here', ['a.test.ts'])).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
