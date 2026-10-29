import { describe, expect, it } from 'vitest';
import { LANGS, parseLang, t } from '@xray/core';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Katalog obyektlari eksport qilinmaydi — test manba matnini o'qib kalitlar va {placeholder}larni solishtiradi. */
const src = readFileSync(path.resolve(import.meta.dirname, '../src/i18n.ts'), 'utf8');
const section = (startMarker: string, endMarker: string) => {
  const a = src.indexOf(startMarker);
  return src.slice(a, src.indexOf(endMarker, a));
};
const entries = (block: string) => {
  const out: { key: string; text: string }[] = [];
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*'([\w.]+)':\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    let rest = m[2]!;
    if (rest === '') rest = lines[++i]!.trim(); // matn keyingi qatorda
    out.push({ key: m[1]!, text: rest });
  }
  return out;
};
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('backend i18n catalog', () => {
  const uz = entries(section('const uz = {', '} as const;'));
  const en = entries(section('const en: Record<MsgKey, string> = {', '\n};'));

  it('both languages define the same keys', () => {
    expect(uz.length).toBeGreaterThan(80);
    expect(en.map((e) => e.key)).toEqual(uz.map((e) => e.key));
  });

  it('every message uses the same {placeholders} in both languages', () => {
    for (const u of uz) {
      const e = en.find((x) => x.key === u.key)!;
      expect(params(e.text), u.key).toEqual(params(u.text));
    }
  });

  it('t() interpolates, keeps unknown placeholders visible; parseLang defaults to uz', () => {
    expect(t('en', 'imp.testImports', { file: 'a.ts' })).toBe('imports a.ts (coverage not proven)');
    expect(t('uz', 'imp.testImports')).toContain('{file}');
    expect(parseLang('en')).toBe('en');
    expect(parseLang('xx')).toBe('uz');
    expect(parseLang(undefined)).toBe('uz');
    expect(LANGS).toEqual(['uz', 'en']);
  });

  it('no English message contains Uzbek marker words', () => {
    const bad = /(bog'liq|yo'q\b|natija|tahlil|o'zgar|qadam|ishlat|chaqir|manba|rozilik|savol|papka|xato|kerak|mumkin|fayl)/i;
    for (const e of en) expect(e.text, e.key).not.toMatch(bad);
  });
});
