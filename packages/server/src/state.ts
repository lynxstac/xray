import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexProject, openStore, type IndexResult, type XrayStore } from '@xray/graph';
import { ScanLimitError } from '@xray/scanner';
import { DEFAULT_LANG, t, type Lang, type MsgKey } from '@xray/core';
import type { ImpactReport } from '@xray/impact';

export interface ActiveRepo {
  root: string;
  dbPath: string;
  index: IndexResult;
  store: XrayStore;
  lastImpact?: ImpactReport;
}

export function dbPathFor(root: string, cacheDir = path.join(os.homedir(), '.cache', 'xray')): string {
  return path.join(cacheDir, createHash('sha1').update(root).digest('hex').slice(0, 16), 'index.db');
}

export class ServerState {
  repo: ActiveRepo | null = null;
  readonly cacheDir?: string;
  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir;
  }

  async open(input: string, full = false, lang: Lang = DEFAULT_LANG): Promise<ActiveRepo> {
    let real: string;
    try {
      real = await fs.realpath(path.resolve(input));
      if (!(await fs.stat(real)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new HttpError(400, 'srv.folderNotFound', { path: input });
    }
    const dbPath = dbPathFor(real, this.cacheDir);
    // ATOMIK: avval yangisini quramiz; xato bo'lsa eski repo ishlashda qoladi. Faqat tayyor bo'lgach almashtiramiz.
    const prev = this.repo;
    prev?.store.close(); // bir xil db faylini qayta yozish uchun (WAL) eski ulanishni yopamiz...
    let index: IndexResult;
    try {
      index = await indexProject(real, { dbPath, full, lang });
    } catch (e) {
      // ...lekin xato bo'lsa eski repo qayta ochiladi va ishlashda qoladi
      if (prev) this.repo = { ...prev, store: openStore(prev.dbPath) };
      if (e instanceof ScanLimitError) throw new HttpError(400, e.code === 'scanFiles' ? 'err.scanFiles' : 'err.scanEntries', { n: e.limit.toLocaleString() });
      throw e;
    }
    const store = openStore(dbPath);
    this.repo = { root: index.root, dbPath, index, store };
    return this.repo;
  }

  require(): ActiveRepo {
    if (!this.repo) throw new HttpError(409, 'srv.openFirst');
    return this.repo;
  }

  close(): void {
    this.repo?.store.close();
    this.repo = null;
  }
}

export class HttpError extends Error {
  readonly status: number;
  /** Xabar kaliti + parametrlar: matn so'rov tilida yasaladi (default 'uz' — `message`) */
  readonly key: MsgKey;
  readonly params?: Record<string, string | number>;
  constructor(status: number, key: MsgKey, params?: Record<string, string | number>) {
    super(t(DEFAULT_LANG, key, params));
    this.status = status;
    this.key = key;
    this.params = params;
  }
}
