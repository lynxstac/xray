import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeRelPath, exportSnapshot, getDiff, GitError, listRefs, parseHunkHeaders, resolveRef, showFile } from '@xray/git';

const base = path.resolve(import.meta.dirname, '../../../.tmp-test');
let dir: string;
const sh = (...a: string[]) => execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
const w = async (rel: string, c: string) => {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), c);
};

beforeEach(async () => {
  await mkdir(base, { recursive: true });
  dir = await mkdtemp(path.join(base, 'git-'));
  sh('init', '-q', '-b', 'main');
  await w('a.ts', 'line1\nline2\nline3\nline4\n');
  await w('b.ts', 'x\n');
  await w('with space.ts', 'y\n');
  sh('add', '.');
  sh('commit', '-q', '-m', 'init');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('parseHunkHeaders', () => {
  it('parses counts, default count=1, and pure deletions (count=0)', () => {
    const r = parseHunkHeaders('@@ -2,0 +3 @@\n+a\n@@ -10,2 +11,0 @@\n-x\n-y\n@@ -5 +5,3 @@\n');
    expect(r.newRanges).toEqual([{ start: 3, count: 1 }, { start: 11, count: 0 }, { start: 5, count: 3 }]);
    expect(r.oldRanges).toEqual([{ start: 2, count: 0 }, { start: 10, count: 2 }, { start: 5, count: 1 }]);
  });
});

describe('getDiff', () => {
  it('working tree: modified (with hunk ranges), deleted, untracked-added, path with spaces', async () => {
    await w('a.ts', 'line1\nCHANGED\nline3\nline4\nnew5\n');
    await w('with space.ts', 'y2\n');
    await rm(path.join(dir, 'b.ts'));
    await w('c.ts', 'a\nb\n');
    const d = await getDiff(dir, { kind: 'working' });
    const by = Object.fromEntries(d.files.map((f) => [f.path, f]));
    expect(by['a.ts']).toMatchObject({ status: 'M', newRanges: [{ start: 2, count: 1 }, { start: 5, count: 1 }] });
    expect(by['b.ts']).toMatchObject({ status: 'D' });
    expect(by['with space.ts']).toMatchObject({ status: 'M' });
    expect(by['c.ts']).toMatchObject({ status: 'A', untracked: true, newRanges: [{ start: 1, count: 3 }] });
  });

  it('detects renames', async () => {
    sh('mv', 'a.ts', 'z.ts');
    const d = await getDiff(dir, { kind: 'working' });
    expect(d.files).toHaveLength(1);
    expect(d.files[0]).toMatchObject({ status: 'R', oldPath: 'a.ts', path: 'z.ts' });
  });

  it('staged vs working are distinct', async () => {
    await w('a.ts', 'S\n');
    sh('add', 'a.ts');
    await w('b.ts', 'U\n');
    expect((await getDiff(dir, { kind: 'staged' })).files.map((f) => f.path)).toEqual(['a.ts']);
    expect((await getDiff(dir, { kind: 'working' })).files.map((f) => f.path).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('range base...head uses merge-base (PR style)', async () => {
    sh('checkout', '-q', '-b', 'feature');
    await w('f.ts', 'feat\n');
    sh('add', '.');
    sh('commit', '-q', '-m', 'feat');
    sh('checkout', '-q', 'main');
    await w('m.ts', 'main-only\n');
    sh('add', '.');
    sh('commit', '-q', '-m', 'main change');
    const d = await getDiff(dir, { kind: 'range', base: 'main', head: 'feature' });
    expect(d.files.map((f) => f.path)).toEqual(['f.ts']); // main'dagi m.ts kirmaydi
  });
});

describe('safety', () => {
  it('rejects option-like and malformed refs before touching git', async () => {
    for (const bad of ['--output=/tmp/pwn', '-p', 'a..b', 'x;rm -rf /', '$(id)', 'HEAD@{1}', '', 'a b']) {
      await expect(resolveRef(dir, bad), bad).rejects.toBeInstanceOf(GitError);
    }
  });
  it('rejects unsafe relative paths', () => {
    for (const bad of ['../etc/passwd', '/etc/passwd', '-rf', 'a/../../b', 'x\0y']) expect(() => assertSafeRelPath(bad), bad).toThrow(GitError);
    expect(assertSafeRelPath('src/a.ts')).toBe('src/a.ts');
  });
  it('does not execute repo-configured commands (core.fsmonitor / diff.external attack vector)', async () => {
    const marker = path.join(dir, 'pwned');
    const script = path.join(dir, 'evil.sh');
    await writeFile(script, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    sh('config', 'core.fsmonitor', script);
    await w('a.ts', 'q\n');
    // Kontrol: himoyasiz oddiy git haqiqatan ham buyruqni ishga tushiradi (aks holda test hech narsani isbotlamaydi)
    sh('status', '--porcelain');
    expect(() => execFileSync('test', ['-e', marker])).not.toThrow();
    await rm(marker);
    await getDiff(dir, { kind: 'working' });
    await listRefs(dir);
    expect(() => execFileSync('test', ['-e', marker])).toThrow();
  });
  it('showFile returns old content, null for missing', async () => {
    const head = await resolveRef(dir, 'HEAD');
    expect(await showFile(dir, head, 'b.ts')).toBe('x\n');
    expect(await showFile(dir, head, 'nope.ts')).toBeNull();
  });
  it('exportSnapshot extracts a commit without touching the repo', async () => {
    const head = await resolveRef(dir, 'HEAD');
    await w('a.ts', 'dirty\n');
    const snap = await exportSnapshot(dir, head, path.join(base, 'snaps'));
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(path.join(snap.dir, 'a.ts'), 'utf8')).toBe('line1\nline2\nline3\nline4\n');
    await snap.cleanup();
  });
});
