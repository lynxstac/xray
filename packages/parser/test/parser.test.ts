import { describe, expect, it } from 'vitest';
import { parseSource } from '@xray/parser';

const p = (file: string, src: string) => parseSource(file, src);

describe('imports', () => {
  it('static: default, named (alias), namespace, type-only, side-effect', () => {
    const f = p('a.tsx', `
      import React from 'react';
      import { x as y, type T } from './m';
      import * as ns from './n';
      import type { U } from './u';
      import './side.css';
    `);
    expect(f.imports.map((i) => i.specifier)).toEqual(['react', './m', './n', './u', './side.css']);
    expect(f.imports[0]!.bindings).toEqual([{ kind: 'default', imported: 'default', local: 'React', typeOnly: false }]);
    expect(f.imports[1]!.bindings).toEqual([
      { kind: 'named', imported: 'x', local: 'y', typeOnly: false },
      { kind: 'named', imported: 'T', local: 'T', typeOnly: true },
    ]);
    expect(f.imports[2]!.bindings[0]).toMatchObject({ kind: 'namespace', imported: '*', local: 'ns' });
    expect(f.imports[3]!.typeOnly).toBe(true);
    expect(f.imports[4]!.bindings).toEqual([]);
  });

  it('dynamic import()/require() with literal are imports; non-literal are unresolved', () => {
    const f = p('d.ts', `
      async function f(n: string) {
        await import('./a'); await import(n); require('./b'); require(n);
      }
    `);
    expect(f.imports.map((i) => [i.specifier, i.kind])).toEqual([['./a', 'dynamic'], ['./b', 'require']]);
    expect(f.unresolved.map((u) => u.reason)).toEqual(['dynamic-import', 'dynamic-require']);
    expect(f.unresolved[0]!.snippet).toBe('import(n)');
  });
});

describe('exports', () => {
  it('declarations, default, list with alias', () => {
    const f = p('e.ts', `
      export function a() {}
      export const b = 1, c = 2;
      export default function d() {}
      const e = 1; export { e as f };
      export interface I {}
    `);
    const names = f.exports.map((e) => `${e.kind}:${e.exported}${e.local && e.local !== e.exported ? '<-' + e.local : ''}${e.typeOnly ? ':type' : ''}`);
    expect(names).toEqual(['declaration:a', 'declaration:b', 'declaration:c', 'default:default<-d', 'list:f<-e', 'declaration:I:type']);
  });

  it('re-exports: named, aliased default, star, namespace', () => {
    const f = p('b.ts', `
      export { default as Button, useX } from './Button';
      export * from './math';
      export * as utils from './utils';
      export type { Foo } from './types';
    `);
    expect(f.exports.map((e) => [e.kind, e.exported, e.local, e.from, e.typeOnly])).toEqual([
      ['reexport', 'Button', 'default', './Button', false],
      ['reexport', 'useX', 'useX', './Button', false],
      ['star', '*', '*', './math', false],
      ['namespace-reexport', 'utils', '*', './utils', false],
      ['reexport', 'Foo', 'Foo', './types', true],
    ]);
  });
});

describe('symbols', () => {
  it('classifies hook / component / function / class / method with basis', () => {
    const f = p('s.tsx', `
      export function useThing() { return 1; }
      export function Card() { return <div/>; }
      export function helper() { return 1; }
      export const Arrow = () => <b/>;
      export const Memo = React.memo(function Memo() { return <i/>; });
      class K { m() {} }
    `);
    const by = Object.fromEntries(f.symbols.map((s) => [s.qualifiedName, s]));
    expect(by.useThing!.kind).toBe('hook');
    expect(by.Card!.kind).toBe('component');
    expect(by.Card!.basis).toBe('capitalized+jsx');
    expect(by.helper!.kind).toBe('function');
    expect(by.Arrow!.kind).toBe('component');
    expect(by.Memo!.kind).toBe('component');
    expect(by.K!.kind).toBe('class');
    expect(by['K.m']!.kind).toBe('method');
    expect(by.K!.exported).toBe(false);
  });

  it('a capitalized function WITHOUT jsx is not called a component', () => {
    expect(p('x.ts', 'export function Foo() { return 1; }').symbols[0]!.kind).toBe('function');
  });

  it('marks locals exported via export list / default', () => {
    const f = p('l.ts', 'const a = () => 1; const b = () => 2; export { a as z }; export default b;');
    expect(f.symbols.map((s) => [s.name, s.exported])).toEqual([['a', true], ['b', true]]);
  });

  it('1-based locations', () => {
    const f = p('loc.ts', '\nexport function foo() {}\n');
    expect(f.symbols[0]!.loc).toMatchObject({ file: 'loc.ts', startLine: 2, startCol: 1 });
  });
});

describe('errors & misc', () => {
  it('reports syntax errors but still extracts what it can', () => {
    const f = p('bad.ts', 'export const ok = 1;\nexport function broken( {\n return ;\n');
    expect(f.errors.length).toBeGreaterThan(0);
    expect(f.errors[0]!.loc.startLine).toBeGreaterThan(1);
    expect(f.exports.some((e) => e.exported === 'ok')).toBe(true);
  });

  it('detects test files', () => {
    expect(p('src/a.test.tsx', '').isTestFile).toBe(true);
    expect(p('src/__tests__/a.ts', '').isTestFile).toBe(true);
    expect(p('src/a.ts', '').isTestFile).toBe(false);
  });
});
