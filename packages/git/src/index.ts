import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Xavfsiz Git wrapper.
 *  - shell yo'q (`execFile`), argumentlar massivda;
 *  - foydalanuvchi bergan ref `--end-of-options`dan keyin, oldindan validatsiya qilinadi;
 *  - hook'lar/fsmonitor/ext-protokol o'chirilgan; GIT_* env tozalangan;
 *  - hech qachon repoga yozmaydi (worktree/checkout/reset yo'q).
 */

const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'USER', 'TMPDIR', 'SYSTEMROOT'];

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of SAFE_ENV_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.LC_ALL = 'C';
  return env;
}

const HARDENING = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.quotepath=false',
  '-c', 'protocol.ext.allow=never',
  '-c', 'diff.external=',
  '-c', 'core.pager=cat',
];

export class GitError extends Error {
  /** Tildan mustaqil kod + parametrlar: server shu orqali foydalanuvchi tilida xabar yasaydi */
  readonly code?: 'badRef' | 'unsafePath' | 'diffTooBig' | 'notRepo';
  readonly params?: Record<string, string | number>;
  constructor(message: string, code?: GitError['code'], params?: Record<string, string | number>) {
    super(message);
    this.code = code;
    this.params = params;
  }
}

export async function git(root: string, args: string[], opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...HARDENING, ...args],
      { cwd: root, env: cleanEnv(), timeout: opts.timeoutMs ?? 30_000, maxBuffer: opts.maxBytes ?? 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) reject(new GitError(`git ${args[0]} failed: ${(stderr || err.message).trim().split('\n')[0]}`));
        else resolve(stdout);
      },
    );
  });
}

// ---- validatsiya ----

const REF_RE = /^[A-Za-z0-9._/@^~{}:+-]{1,200}$/;

/** Foydalanuvchi bergan ref'ni tekshiradi va commit hash'ga aylantiradi. */
export async function resolveRef(root: string, ref: string): Promise<string> {
  if (!REF_RE.test(ref) || ref.startsWith('-') || ref.includes('..') || ref.includes('@{')) {
    throw new GitError(`Noto'g'ri ref nomi: ${JSON.stringify(ref).slice(0, 80)}`, 'badRef', { ref: JSON.stringify(ref).slice(0, 80) });
  }
  const out = await git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  return out.trim();
}

/** Repo ichidagi nisbiy yo'l: absolyut emas, `..` yo'q, NUL yo'q. */
export function assertSafeRelPath(p: string): string {
  if (!p || p.includes('\0') || path.isAbsolute(p) || p.split('/').includes('..') || p.startsWith('-')) {
    throw new GitError(`Xavfli yo'l: ${JSON.stringify(p).slice(0, 80)}`, 'unsafePath', { path: JSON.stringify(p).slice(0, 80) });
  }
  return p;
}

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    return (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch {
    return false;
  }
}

export async function repoTopLevel(root: string): Promise<string> {
  return (await git(root, ['rev-parse', '--show-toplevel'])).trim();
}

// ---- refs ----

export interface RefInfo {
  branches: { name: string; hash: string; current: boolean }[];
  commits: { hash: string; short: string; subject: string; date: string }[];
  head: string | null;
}

export async function listRefs(root: string, commitLimit = 30): Promise<RefInfo> {
  let head: string | null = null;
  try {
    head = (await git(root, ['rev-parse', 'HEAD'])).trim();
  } catch {
    /* commit yo'q */
  }
  const branches: RefInfo['branches'] = [];
  try {
    const out = await git(root, ['for-each-ref', '--format=%(HEAD)%09%(refname:short)%09%(objectname)', 'refs/heads']);
    for (const line of out.split('\n').filter(Boolean)) {
      const [cur, name, hash] = line.split('\t');
      branches.push({ name: name ?? '', hash: hash ?? '', current: cur === '*' });
    }
  } catch {
    /* ref yo'q */
  }
  const commits: RefInfo['commits'] = [];
  if (head) {
    const out = await git(root, ['log', `-n${Math.min(commitLimit, 200)}`, '--format=%H%x1f%h%x1f%s%x1f%cI']);
    for (const line of out.split('\n').filter(Boolean)) {
      const [hash, short, subject, date] = line.split('\x1f');
      commits.push({ hash: hash ?? '', short: short ?? '', subject: subject ?? '', date: date ?? '' });
    }
  }
  return { branches, commits, head };
}

// ---- diff ----

export type DiffSpec =
  | { kind: 'working' } // HEAD <-> ishchi katalog (staged + unstaged + untracked)
  | { kind: 'staged' } // HEAD <-> index
  | { kind: 'range'; base: string; head: string }; // base...head (PR uslubi: merge-base'dan)

export interface Range {
  start: number;
  count: number;
}

export interface FileChange {
  status: 'A' | 'M' | 'D' | 'R';
  path: string; // yangi yo'l (D bo'lsa — eski)
  oldPath?: string; // R uchun
  newRanges: Range[]; // yangi fayl satrlari (count=0 -> faqat o'chirish nuqtasi)
  oldRanges: Range[];
  binary: boolean;
  untracked?: boolean;
}

export interface DiffResult {
  spec: DiffSpec;
  /** O'zgarishdan oldingi holat commit'i (eski fayllarni o'qish uchun) */
  baseCommit: string | null;
  files: FileChange[];
}

export function parseHunkHeaders(patch: string): { oldRanges: Range[]; newRanges: Range[] } {
  const oldRanges: Range[] = [];
  const newRanges: Range[] = [];
  const re = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  for (let m = re.exec(patch); m; m = re.exec(patch)) {
    oldRanges.push({ start: Number(m[1]), count: m[2] === undefined ? 1 : Number(m[2]) });
    newRanges.push({ start: Number(m[3]), count: m[4] === undefined ? 1 : Number(m[4]) });
  }
  return { oldRanges, newRanges };
}

export async function getDiff(root: string, spec: DiffSpec, opts: { maxFiles?: number } = {}): Promise<DiffResult> {
  const maxFiles = opts.maxFiles ?? 3000;
  let revArgs: string[];
  let baseCommit: string | null;
  switch (spec.kind) {
    case 'working':
    case 'staged': {
      baseCommit = await resolveRef(root, 'HEAD').catch(() => null);
      revArgs = [...(spec.kind === 'staged' ? ['--cached'] : []), ...(baseCommit ? [baseCommit] : [])];
      break;
    }
    case 'range': {
      const base = await resolveRef(root, spec.base);
      const head = await resolveRef(root, spec.head);
      baseCommit = (await git(root, ['merge-base', '--end-of-options', base, head]).catch(() => base)).trim() || base;
      revArgs = [baseCommit, head];
      break;
    }
  }

  const common = ['--no-color', '--no-ext-diff', '--no-textconv', '--relative', '-M60%'];
  const ns = await git(root, ['diff', ...common, '--name-status', '-z', ...revArgs, '--']);
  const tokens = ns.split('\0');
  const entries: { status: FileChange['status']; path: string; oldPath?: string }[] = [];
  for (let i = 0; i < tokens.length && tokens[i]; ) {
    const st = tokens[i++]!;
    const code = st[0];
    if (code === 'R' || code === 'C') {
      const oldP = tokens[i++]!;
      const newP = tokens[i++]!;
      entries.push({ status: 'R', path: newP, oldPath: oldP });
    } else {
      const p = tokens[i++]!;
      entries.push({ status: (code === 'A' || code === 'D' ? code : 'M') as FileChange['status'], path: p });
    }
  }
  if (entries.length > maxFiles) throw new GitError(`Diff juda katta: ${entries.length} fayl (limit ${maxFiles})`, 'diffTooBig', { n: entries.length, max: maxFiles });

  const files: FileChange[] = [];
  // Hunk'lar: bitta umumiy patch; bloklarni name-status tartibi bilan moslashtiramiz, mos kelmasa fayl bo'yicha.
  const patch = await git(root, ['diff', ...common, '--unified=0', ...revArgs, '--']);
  const blocks = patch.split(/^diff --git /m).slice(1);
  const useBlocks = blocks.length === entries.length;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    assertSafeRelPath(e.path);
    let block = useBlocks ? blocks[i]! : await git(root, ['diff', ...common, '--unified=0', ...revArgs, '--', e.path]);
    const binary = /^Binary files /m.test(block) || /^GIT binary patch/m.test(block);
    const { oldRanges, newRanges } = parseHunkHeaders(block);
    block = '';
    files.push({ ...e, oldRanges, newRanges, binary });
  }

  if (spec.kind === 'working') {
    const out = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    for (const p of out.split('\0').filter(Boolean)) {
      try {
        assertSafeRelPath(p);
      } catch {
        continue;
      }
      const text = await fs.readFile(path.join(root, p), 'utf8').catch(() => null);
      const lines = text === null ? 0 : text.split('\n').length;
      files.push({ status: 'A', path: p, newRanges: lines ? [{ start: 1, count: lines }] : [], oldRanges: [], binary: text === null, untracked: true });
    }
  }
  return { spec, baseCommit, files };
}

/** Eski fayl matni (`git show <commit>:<path>`). Yo'q bo'lsa null. */
export async function showFile(root: string, commit: string, relPath: string): Promise<string | null> {
  assertSafeRelPath(relPath);
  if (!/^[0-9a-f]{7,64}$/.test(commit)) throw new GitError('commit hash kutilgan');
  try {
    return await git(root, ['show', `${commit}:./${relPath}`], { maxBytes: 8 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/**
 * Commit snapshot'ini vaqtinchalik papkaga chiqaradi (`git archive | tar -x`). Repoga yozmaydi.
 * Chaqiruvchi `cleanup()`ni chaqirishi shart.
 */
export async function exportSnapshot(root: string, commit: string, cacheBase?: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  if (!/^[0-9a-f]{7,64}$/.test(commit)) throw new GitError('commit hash kutilgan');
  const base = cacheBase ?? path.join(os.homedir(), '.cache', 'xray', 'snapshots');
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'snap-'));
  await new Promise<void>((resolve, reject) => {
    const g = spawn('git', [...HARDENING, 'archive', '--format=tar', commit], { cwd: root, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    // --no-same-owner/--no-same-permissions: arxiv ichidagi mode/owner'ga ishonmaymiz
    const t = spawn('tar', ['-x', '--no-same-owner', '--no-same-permissions', '-C', dir], { stdio: ['pipe', 'ignore', 'pipe'] });
    g.stdout.pipe(t.stdin);
    let err = '';
    g.stderr.on('data', (d) => (err += d));
    t.stderr.on('data', (d) => (err += d));
    let pending = 2;
    const done = (code: number | null) => {
      if (code !== 0) return reject(new GitError(`snapshot failed: ${err.trim().split('\n')[0]}`));
      if (--pending === 0) resolve();
    };
    g.on('close', done);
    t.on('close', done);
    g.on('error', reject);
    t.on('error', reject);
  }).catch(async (e) => {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  });
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}
