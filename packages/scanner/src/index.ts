import { promises as fs } from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { ScanResult, ScannedFile, SkippedEntry, SkipReason } from '@xray/core';

/** Papka haddan tashqari katta (odatda noto'g'ri papka tanlangan: `~`, `/`). Aniq xabar bilan to'xtatiladi — jimgina osilib qolmaydi. */
export class ScanLimitError extends Error {
  readonly code: 'scanEntries' | 'scanFiles';
  readonly limit: number;
  constructor(message: string, code: 'scanEntries' | 'scanFiles', limit: number) {
    super(message);
    this.name = 'ScanLimitError';
    this.code = code;
    this.limit = limit;
  }
}

export interface ScanOptions {
  /** Manba fayllar soni chegarasi (default 50 000) */
  maxFiles?: number;
  /** Ko'rilgan yozuvlar (fayl+papka) chegarasi (default 600 000) */
  maxEntries?: number;
  maxFileBytes?: number; // default 1 MB
  extraIgnore?: string[]; // qo'shimcha gitignore-uslubidagi qoidalar
}

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

/** Har doim kirilmaydigan kataloglar (generated / dependency). */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo',
  'coverage', '.cache', '.xray', '.svelte-kit', '.vercel',
]);

/** Maxfiy fayllar: indekslanmaydi va AI kontekstiga hech qachon kirmaydi. */
const SENSITIVE: RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|crt|cer|keystore|jks)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /service[-_]?account.*\.json$/i,
];

/** Bundler chiqishi: `assets/` ichida `nom-HASH8.js` (Vite/Rollup). Foydalanuvchi .xrayignore bilan to'liq boshqaradi. */
const BUNDLE_RE = /(^|\/)assets\/[^/]+-[A-Za-z0-9_-]{8}\.[cm]?js$/;

/**
 * Faqat NOMIga qarab gumon qilinadigan fayllar: `secrets.json`, `credentials.yml`, kengaytmasiz `secret`...
 * MANBA KOD faylining nomi (`secret.ts`, `credentials.tsx` — masalan webhook secret generatori) maxfiy qiymat bor degani emas:
 * ularni o'tkazib yuborish graph'dan haqiqiy kodni yo'qotadi. Kod ichidagi qiymatlarni AI redaksiyasi tutadi.
 */
const NAME_ONLY_SENSITIVE = /^(credentials?|secrets?)(\..*)?$/i;
const SOURCE_EXT_RE = /\.[cm]?[jt]sx?$/i;

function isSensitive(name: string): boolean {
  if (SENSITIVE.some((re) => re.test(name))) return true;
  return NAME_ONLY_SENSITIVE.test(name) && !SOURCE_EXT_RE.test(name);
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

export async function scanRepository(rootInput: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const maxBytes = opts.maxFileBytes ?? 1_000_000;
  const maxFiles = opts.maxFiles ?? 50_000;
  const maxEntries = opts.maxEntries ?? 600_000;
  let entriesSeen = 0;
  const root = await fs.realpath(path.resolve(rootInput));
  const st = await fs.stat(root);
  if (!st.isDirectory()) throw new Error(`Not a directory: ${root}`);

  const ig: Ignore = ignore();
  for (const name of ['.gitignore', '.xrayignore']) {
    const txt = await readIfExists(path.join(root, name));
    if (txt) ig.add(txt);
  }
  if (opts.extraIgnore) ig.add(opts.extraIgnore);

  const files: ScannedFile[] = [];
  const skipped: SkippedEntry[] = [];
  let otherFileCount = 0;

  const skip = (rel: string, reason: SkipReason) => skipped.push({ path: rel, reason });

  async function walk(dirAbs: string, dirRel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      skip(dirRel || '.', 'unreadable');
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); // deterministik tartib

    for (const ent of entries) {
      if (++entriesSeen > maxEntries) {
        throw new ScanLimitError(`Papka juda katta: ${maxEntries.toLocaleString()} dan ortiq yozuv ko'rildi. Butun disk/uy papkasi emas, aniq loyiha papkasini tanlang.`, 'scanEntries', maxEntries);
      }
      const rel = dirRel ? `${dirRel}/${ent.name}` : ent.name;
      const abs = path.join(dirAbs, ent.name);

      if (ent.isSymbolicLink()) {
        // Repo tashqarisiga chiqsa — xavfli. Ichkarida bo'lsa ham dublikat/sikl oldini olish uchun o'tkazamiz.
        let real: string;
        try {
          real = await fs.realpath(abs);
        } catch {
          skip(rel, 'unreadable');
          continue;
        }
        const inside = real === root || real.startsWith(root + path.sep);
        skip(rel, inside ? 'symlink' : 'symlink-escape');
        continue;
      }

      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) {
          skip(rel + '/', 'ignored-dir');
          continue;
        }
        if (ig.ignores(rel + '/')) {
          skip(rel + '/', 'gitignore');
          continue;
        }
        await walk(abs, rel);
        continue;
      }

      if (!ent.isFile()) continue;

      // Maxfiylik tekshiruvi kengaytmadan OLDIN: .env kabi fayllar hisobotda ko'rinsin.
      if (isSensitive(ent.name)) {
        skip(rel, 'sensitive');
        continue;
      }
      if (ig.ignores(rel)) {
        skip(rel, 'gitignore');
        continue;
      }

      const ext = path.extname(ent.name).toLowerCase();
      if (!SOURCE_EXT.has(ext)) {
        otherFileCount++;
        continue;
      }
      if (/\.d\.[cm]?ts$/.test(ent.name)) {
        skip(rel, 'declaration-file');
        continue;
      }
      if (/\.min\.[cm]?js$/.test(ent.name)) {
        skip(rel, 'minified');
        continue;
      }
      if (BUNDLE_RE.test(rel)) {
        skip(rel, 'generated-bundle');
        continue;
      }

      let size: number;
      try {
        size = (await fs.stat(abs)).size;
      } catch {
        skip(rel, 'unreadable');
        continue;
      }
      if (size > maxBytes) {
        skip(rel, 'too-large');
        continue;
      }
      if (files.length >= maxFiles) {
        throw new ScanLimitError(`Papka juda katta: ${maxFiles.toLocaleString()} dan ortiq manba fayl. Aniq loyiha papkasini tanlang yoki .xrayignore bilan keraksizlarini chiqaring.`, 'scanFiles', maxFiles);
      }
      files.push({ path: rel, size });
    }
  }

  await walk(root, '');
  return { root, files, skipped, otherFileCount };
}
