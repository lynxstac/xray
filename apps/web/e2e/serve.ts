// E2E server: fixture'dan vaqtinchalik git repo yasaydi (ishchi katalogda bitta o'zgarish bilan),
// X-Ray serverini ko'taradi va AI uchun lokal soxta (mock) provayder ishga tushiradi.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startServer } from '@xray/server';

const root = path.resolve(import.meta.dirname, '../../..');
const work = path.join(root, '.tmp-test', 'e2e');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const repo = path.join(work, 'repo');
cpSync(path.join(root, 'fixtures/react-app'), repo, { recursive: true });
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@x', ...a], { cwd: repo });
git('init', '-q', '-b', 'main');
git('add', '-A');
git('commit', '-q', '-m', 'base');
const f = path.join(repo, 'src/lib/format.ts');
writeFileSync(f, readFileSync(f, 'utf8').replace('formatDate(d: Date)', 'formatDate(d: Date, locale?: string)'));
writeFileSync(path.join(work, 'repo-path.txt'), repo);

// Ikkinchi repo: Next.js fixture (Sidebar o'zgargan — nested layout ssenariysi)
const nrepo = path.join(work, 'next-repo');
cpSync(path.join(root, 'fixtures/next-app'), nrepo, { recursive: true });
const ng = (...a: string[]) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@x', ...a], { cwd: nrepo });
ng('init', '-q', '-b', 'main');
ng('add', '-A');
ng('commit', '-q', '-m', 'base');
const sb = path.join(nrepo, 'components/Sidebar.tsx');
writeFileSync(sb, readFileSync(sb, 'utf8').replace('return ', 'return /* x */ '));
writeFileSync(path.join(work, 'next-path.txt'), nrepo);

// Soxta provayder: so'rovdagi birinchi <source> ga TO'G'RI iqtibos va bitta o'ylab topilgan iqtibos bilan javob beradi.
const mock = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', () => {
    const body = JSON.parse(b);
    const user: string = body.messages?.find((m: { role: string }) => m.role === 'user')?.content ?? '';
    const m = /<source file="([^"]+)" lines="(\d+)-(\d+)"/.exec(user);
    const answer = m ? `Bu funksiya shu yerda aniqlangan [${m[1]}:${m[2]}-${m[3]}]. Yana bir da'vo [src/yoq-fayl.ts:1-2].` : 'Yetarli dalil topilmadi.';
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  });
});
await new Promise<void>((r) => mock.listen(8798, '127.0.0.1', r));

const srv = await startServer({
  port: 8799,
  token: 'e2e-token',
  webDist: path.join(root, 'apps/web/dist'),
  cacheDir: path.join(work, 'cache'),
  aiConfigPath: path.join(work, 'ai.json'),
  env: { XRAY_E2E_KEY: 'e2e' },
});
console.log('E2E server ready', srv.port);
process.on('SIGTERM', () => void srv.close().then(() => process.exit(0)));
