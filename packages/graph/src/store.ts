import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ParsedFile } from '@xray/core';
import type { FileSemantic } from './semantic.ts';

export const SCHEMA_VERSION = 1;

export interface StoredFile {
  hash: string;
  size: number;
  parsed: ParsedFile;
}

export interface FtsRow {
  id: string; // node id
  file: string;
  name: string;
  tokens: string;
  body: string;
}

export interface FtsHit {
  id: string;
  file: string;
  name: string;
  score: number;
}

/** Identifikatorni so'zlarga bo'ladi: useArticleList -> "use article list". */
export function splitIdent(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase()
    .trim();
}

/** Lokal indeks. Repoga EMAS, alohida faylga yoziladi. */
export class XrayStore {
  readonly db: DatabaseSync;
  readonly file: string;

  constructor(file: string) {
    this.file = file;
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    this.migrate();
  }

  private migrate(): void {
    const v = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (v !== SCHEMA_VERSION) {
      // Indeks — qayta tiklanadigan kesh: eski sxemani tashlab yuboramiz.
      this.db.exec(`
        DROP TABLE IF EXISTS meta; DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS semantic; DROP TABLE IF EXISTS code_fts;
      `);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, size INTEGER NOT NULL, parsed TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS semantic (path TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(id UNINDEXED, file UNINDEXED, name, tokens, body, tokenize='unicode61 tokenchars ''_''');
    `);
  }

  getMeta(k: string): string | undefined {
    return (this.db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined)?.v;
  }

  loadFiles(): Map<string, StoredFile> {
    const m = new Map<string, StoredFile>();
    for (const r of this.db.prepare('SELECT path, hash, size, parsed FROM files').all() as { path: string; hash: string; size: number; parsed: string }[]) {
      m.set(r.path, { hash: r.hash, size: r.size, parsed: JSON.parse(r.parsed) as ParsedFile });
    }
    return m;
  }

  loadSemantic(): Map<string, FileSemantic> {
    const m = new Map<string, FileSemantic>();
    for (const r of this.db.prepare('SELECT path, data FROM semantic').all() as { path: string; data: string }[]) m.set(r.path, JSON.parse(r.data) as FileSemantic);
    return m;
  }

  /** Bitta tranzaksiyada: o'chirilganlar, o'zgargan fayllar, semantika, FTS, meta. */
  save(args: {
    deleted: string[];
    files: Map<string, StoredFile>;
    semantic: Map<string, FileSemantic>;
    fts: Map<string, FtsRow[]>; // fayl -> qatorlar (shu fayl qatorlari to'liq almashtiriladi)
    meta: Record<string, string>;
    resetAll?: boolean;
  }): void {
    const db = this.db;
    db.exec('BEGIN');
    try {
      if (args.resetAll) db.exec('DELETE FROM files; DELETE FROM semantic; DELETE FROM code_fts;');
      const delFile = db.prepare('DELETE FROM files WHERE path = ?');
      const delSem = db.prepare('DELETE FROM semantic WHERE path = ?');
      const delFts = db.prepare('DELETE FROM code_fts WHERE file = ?');
      for (const p of args.deleted) {
        delFile.run(p);
        delSem.run(p);
        delFts.run(p);
      }
      const putFile = db.prepare('INSERT OR REPLACE INTO files (path, hash, size, parsed) VALUES (?, ?, ?, ?)');
      for (const [p, f] of args.files) putFile.run(p, f.hash, f.size, JSON.stringify(f.parsed));
      const putSem = db.prepare('INSERT OR REPLACE INTO semantic (path, data) VALUES (?, ?)');
      for (const [p, s] of args.semantic) putSem.run(p, JSON.stringify(s));
      const putFts = db.prepare('INSERT INTO code_fts (id, file, name, tokens, body) VALUES (?, ?, ?, ?, ?)');
      for (const [file, rows] of args.fts) {
        delFts.run(file);
        for (const r of rows) putFts.run(r.id, r.file, r.name, r.tokens, r.body);
      }
      const putMeta = db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)');
      for (const [k, v] of Object.entries(args.meta)) putMeta.run(k, v);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Lexical qidiruv. Foydalanuvchi matni FTS operatoriga aylanib ketmasligi uchun token'lar qo'shtirnoqqa olinadi. */
  search(query: string, limit = 20): FtsHit[] {
    const terms = splitIdent(query).split(' ').filter((t) => t.length > 1).slice(0, 12);
    if (terms.length === 0) return [];
    const match = terms.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
    const rows = this.db
      .prepare(`SELECT id, file, name, bm25(code_fts, 0, 0, 8.0, 4.0, 1.0) AS score FROM code_fts WHERE code_fts MATCH ? ORDER BY score LIMIT ?`)
      .all(match, limit) as { id: string; file: string; name: string; score: number }[];
    return rows.map((r) => ({ id: r.id, file: r.file, name: r.name, score: -r.score }));
  }

  close(): void {
    this.db.close();
  }
}
