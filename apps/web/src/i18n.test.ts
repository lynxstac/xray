import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** UI katalogi: uz va en bir xil kalit va {placeholder}larga ega; inglizchada o'zbekcha so'z yo'q. */
const src = readFileSync(path.resolve(import.meta.dirname, 'i18n.tsx'), 'utf8');
const section = (start: string, end: string) => {
  const a = src.indexOf(start);
  return src.slice(a, src.indexOf(end, a));
};
const entries = (block: string) => {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/'([\w.-]+)':\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g)) out.set(m[1]!, m[2]!.slice(1, -1));
  return out;
};
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('web UI catalog', () => {
  const uz = entries(section('const uz = {', '} as const;'));
  const en = entries(section('const en: Record<UIKey, string> = {', '\n};'));

  it('has the same keys in both languages', () => {
    expect(uz.size).toBeGreaterThan(150);
    expect([...en.keys()]).toEqual([...uz.keys()]);
  });
  it('uses identical {placeholders} per key', () => {
    for (const [k, v] of uz) expect(params(en.get(k)!), k).toEqual(params(v));
  });
  it('English text has no Uzbek marker words', () => {
    const bad = /(bog'liq|yo'q\b|natija|tahlil|o'zgar|qadam|ishlatadi|chaqiradi|manba\b|rozilik|savol|papka|xato|kerak|mumkin|fayl|repozitoriy|tafsilot|qidiruv|ochish)/i;
    for (const [k, v] of en) expect(v, k).not.toMatch(bad);
  });
});
