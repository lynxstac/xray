// Takrorlanadigan demo: fixture'dan vaqtinchalik git repo yasaydi, formatDate imzosini o'zgartiradi
// va X-Ray'ni ishga tushiradi. Hech narsa tashqariga yuborilmaydi. Ishlatish: pnpm demo
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'xray-demo-'));
cpSync(path.join(root, 'fixtures/react-app'), dir, { recursive: true });
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@x', ...a], { cwd: dir });
git('init', '-q', '-b', 'main');
git('add', '-A');
git('commit', '-q', '-m', 'base');

const f = path.join(dir, 'src/lib/format.ts');
writeFileSync(f, readFileSync(f, 'utf8').replace('formatDate(d: Date)', 'formatDate(d: Date, locale?: string)'));
console.log(`Demo repo: ${dir}\nO'zgartirildi: src/lib/format.ts — formatDate imzosi\n`);

const cli = path.join(root, 'packages/cli/src/main.ts');
const env = { ...process.env, HOME: dir }; // keshni demo papkasiga yozamiz
for (const args of [['index', dir], ['impact', dir]]) {
  console.log(`$ xray ${args.join(' ')}\n`);
  spawnSync('node', [cli, ...args], { stdio: 'inherit', env });
  console.log('\n' + '─'.repeat(70) + '\n');
}
console.log(`Web UI uchun: pnpm serve  →  repo yo'li sifatida shuni kiriting:\n  ${dir}`);
