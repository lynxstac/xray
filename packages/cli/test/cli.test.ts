import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const main = path.resolve(import.meta.dirname, '../src/main.ts');
const fixture = path.resolve(import.meta.dirname, '../../../fixtures/react-app');
const base = path.resolve(import.meta.dirname, '../../../.tmp-test');
let home: string;
let repo: string;

const xray = (...args: string[]) =>
  spawnSync('node', [main, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, XRAY_AI_CONFIG: path.join(home, 'ai.json'), ANTHROPIC_API_KEY: '' } });

beforeAll(async () => {
  await mkdir(base, { recursive: true });
  home = await mkdtemp(path.join(base, 'cli-home-'));
  repo = await mkdtemp(path.join(base, 'cli-repo-'));
  await cp(fixture, repo, { recursive: true });
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo });
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  const f = path.join(repo, 'src/lib/format.ts');
  await writeFile(f, (await readFile(f, 'utf8')).replace('formatDate(d: Date)', 'formatDate(d: Date, l?: string)'));
});
afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

describe('xray CLI (real process)', () => {
  it('prints usage and fails on unknown commands', () => {
    expect(xray('--help').stdout).toContain('xray impact');
    const r = xray('nope');
    expect(r.status).toBe(2);
  });

  it('index: full, then noop; cache lives under HOME, never inside the repo', async () => {
    const before = (await readdir(repo)).sort();
    const a = xray('index', repo);
    expect(a.status).toBe(0);
    expect(a.stdout).toContain('Rejim: full');
    expect(a.stdout).toContain('dynamic-import=1');
    expect(xray('index', repo).stdout).toContain('Rejim: noop');
    expect((await readdir(repo)).sort()).toEqual(before); // repoda yangi fayl/papka yo'q (.xray yo'q)
    expect((await readdir(path.join(home, '.cache', 'xray'))).length).toBeGreaterThan(0);
  });

  it('index --json is machine-readable and complete', () => {
    const j = JSON.parse(xray('index', repo, '--json').stdout);
    expect(j.stats.scanned).toBe(17);
    expect(j.edges.length).toBe(j.stats.edges);
  });

  it('impact: markdown by default, JSON with --json; verified direct dependency + related test', () => {
    const md = xray('impact', repo).stdout;
    expect(md).toContain('# X-Ray Impact Report');
    expect(md).toContain('ArticleCard');
    expect(md).toContain('ArticleCard.test.tsx');
    const j = JSON.parse(xray('impact', repo, '--json').stdout);
    expect(j.direct.map((d: { id: string }) => d.id)).toEqual(['src/components/ArticleCard.tsx#ArticleCard']);
  });

  it('impact refuses a malicious ref with a non-zero exit', () => {
    const r = xray('impact', repo, '--base', '--output=/tmp/x');
    expect(r.status).not.toBe(0);
  });

  it('search finds symbols; ask without AI returns local evidence and says nothing was sent', () => {
    expect(xray('search', repo, 'fetchArticle').stdout).toContain('src/lib/api.ts#fetchArticle');
    const a = xray('ask', repo, 'Where is `fetchArticle` called?');
    expect(a.stdout).toContain('AI o\'chiq');
    expect(a.stdout).toContain('hech narsa tashqariga yuborilmadi');
    expect(a.stdout).toContain('src/hooks/useArticle.ts');
  });

  it('ai status: disabled by default; enable without consent in a non-interactive shell is refused', () => {
    expect(xray('ai', 'status').stdout).toContain('o\'chiq');
    const r = xray('ai', 'enable', '--provider', 'anthropic');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Rozilik/);
    expect(xray('ai', 'status').stdout).toContain('sozlanmagan');
  });

  it('--lang en / XRAY_LANG=en switches CLI, report and errors to English', () => {
    const idx = xray('index', repo, '--lang', 'en').stdout;
    expect(idx).toContain('Mode:');
    expect(idx).toContain('Files:');
    expect(idx).not.toMatch(/Rejim|Fayllar/);
    const imp = xray('impact', repo, '--lang=en').stdout;
    expect(imp).toContain('## 2. Direct dependents (1)');
    expect(imp).toContain('ArticleCard calls formatDate');
    const ask = spawnSync('node', [main, 'ask', repo, 'Where is `fetchArticle` called?'], { encoding: 'utf8', env: { ...process.env, HOME: home, XRAY_AI_CONFIG: path.join(home, 'ai.json'), ANTHROPIC_API_KEY: '', XRAY_LANG: 'en' } });
    expect(ask.stdout).toContain('[AI off]');
    expect(ask.stdout).toContain("name matches 'fetchArticle'");
    expect(ask.stdout).not.toMatch(/AI o'chiq|dalil/);
    expect(xray('nope', '--lang', 'en').stdout).toContain('Unknown command: nope');
    expect(xray('--help', '--lang', 'en').stdout).toContain('Index a repo');
    const err = xray('impact', '/definitely/not/here', '--lang', 'en');
    expect(err.stderr).toContain('error: No such folder');
  });
});
