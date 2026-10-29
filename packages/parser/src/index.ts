import ts from 'typescript';
import type {
  ImportBinding, Loc, ParsedExport, ParsedFile, ParsedImport, ParsedSymbol, ParseError,
  SymbolKind, UnresolvedUse,
} from '@xray/core';

const TEST_RE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)__tests__\//;

function scriptKindFor(file: string): ts.ScriptKind {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Bitta fayl matnini sintaktik tahlil qiladi (AST, type-checker'siz).
 * Resolve (alias/barrel) keyingi bosqichda `graph` paketida bo'ladi.
 */
export function parseSource(relPath: string, text: string): ParsedFile {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true, scriptKindFor(relPath));

  const locOf = (node: ts.Node): Loc => {
    const s = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const e = sf.getLineAndCharacterOfPosition(node.getEnd());
    return { file: relPath, startLine: s.line + 1, startCol: s.character + 1, endLine: e.line + 1, endCol: e.character + 1 };
  };

  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];
  const exports: ParsedExport[] = [];
  const unresolved: UnresolvedUse[] = [];

  const hasMod = (n: ts.Node, kind: ts.SyntaxKind) =>
    ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === kind);

  const snippet = (n: ts.Node) => n.getText(sf).replace(/\s+/g, ' ').slice(0, 80);

  const containsJsx = (n: ts.Node): boolean => {
    let found = false;
    const walk = (x: ts.Node) => {
      if (found) return;
      if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) {
        found = true;
        return;
      }
      ts.forEachChild(x, walk);
    };
    walk(n);
    return found;
  };

  const classify = (name: string, body: ts.Node): { kind: SymbolKind; basis: string } => {
    if (/^use[A-Z0-9]/.test(name)) return { kind: 'hook', basis: 'name-convention:use*' };
    if (/^[A-Z]/.test(name) && containsJsx(body)) return { kind: 'component', basis: 'capitalized+jsx' };
    return { kind: 'function', basis: 'declaration' };
  };

  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const fnSignature = (fn: ts.SignatureDeclarationBase): string =>
    norm(`(${fn.parameters.map((p) => p.getText(sf)).join(', ')})${fn.type ? ': ' + fn.type.getText(sf) : ''}`);

  const addSymbol = (name: string, qualified: string, kind: SymbolKind, basis: string, node: ts.Node, exported: boolean, signature = '') =>
    symbols.push({ name, qualifiedName: qualified, kind, exported, loc: locOf(node), basis, signature });

  const bindingNames = (name: ts.BindingName): string[] => {
    if (ts.isIdentifier(name)) return [name.text];
    const out: string[] = [];
    for (const el of name.elements) if (!ts.isOmittedExpression(el)) out.push(...bindingNames(el.name));
    return out;
  };

  const strLit = (n: ts.Node | undefined): string | undefined =>
    n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;

  function handleStatement(st: ts.Statement) {
    const exported = hasMod(st, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasMod(st, ts.SyntaxKind.DefaultKeyword);

    if (ts.isFunctionDeclaration(st)) {
      const name = st.name?.text ?? 'default';
      const { kind, basis } = classify(name, st);
      addSymbol(name, name, kind, basis, st, exported, fnSignature(st));
      if (exported) exports.push({ exported: isDefault ? 'default' : name, local: st.name?.text, kind: isDefault ? 'default' : 'declaration', typeOnly: false, loc: locOf(st) });
    } else if (ts.isClassDeclaration(st)) {
      const name = st.name?.text ?? 'default';
      const { kind } = classify(name, st);
      addSymbol(name, name, kind === 'component' ? 'component' : 'class', kind === 'component' ? 'capitalized+jsx' : 'declaration', st, exported, norm((st.heritageClauses ?? []).map((h) => h.getText(sf)).join(' ')));
      for (const m of st.members) {
        if ((ts.isMethodDeclaration(m)) && m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) {
          addSymbol(m.name.text, `${name}.${m.name.text}`, 'method', 'class-member', m, false, fnSignature(m));
        }
      }
      if (exported) exports.push({ exported: isDefault ? 'default' : name, local: st.name?.text, kind: isDefault ? 'default' : 'declaration', typeOnly: false, loc: locOf(st) });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        for (const n of bindingNames(d.name)) {
          const init = d.initializer;
          if (init && ts.isIdentifier(d.name) && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
            const { kind, basis } = classify(n, init);
            addSymbol(n, n, kind, basis, d, exported, fnSignature(init));
          } else if (init && ts.isIdentifier(d.name) && ts.isCallExpression(init) && /^(React\.)?(memo|forwardRef)$/.test(init.expression.getText(sf)) && /^[A-Z]/.test(n)) {
            addSymbol(n, n, 'component', `wrapper:${init.expression.getText(sf)}`, d, exported);
          } else {
            addSymbol(n, n, 'variable', 'declaration', d, exported, d.type ? norm(d.type.getText(sf)) : '');
          }
          if (exported) exports.push({ exported: n, local: n, kind: 'declaration', typeOnly: false, loc: locOf(d) });
        }
      }
    } else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) {
      addSymbol(st.name.text, st.name.text, 'type', 'declaration', st, exported, norm(st.getText(sf)));
      if (exported) exports.push({ exported: isDefault ? 'default' : st.name.text, local: st.name.text, kind: isDefault ? 'default' : 'declaration', typeOnly: !ts.isEnumDeclaration(st), loc: locOf(st) });
    } else if (ts.isExportAssignment(st)) {
      const e = st.expression;
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) addSymbol('default', 'default', containsJsx(e) ? 'component' : 'function', containsJsx(e) ? 'default-export+jsx' : 'declaration', st, true, fnSignature(e));
      exports.push({ exported: 'default', local: ts.isIdentifier(e) ? e.text : undefined, kind: 'default', typeOnly: false, loc: locOf(st) });
    } else if (ts.isExportDeclaration(st)) {
      const from = strLit(st.moduleSpecifier);
      const clause = st.exportClause;
      if (!clause) {
        exports.push({ exported: '*', local: '*', from, kind: 'star', typeOnly: st.isTypeOnly, loc: locOf(st) });
      } else if (ts.isNamespaceExport(clause)) {
        exports.push({ exported: clause.name.text, local: '*', from, kind: 'namespace-reexport', typeOnly: st.isTypeOnly, loc: locOf(st) });
      } else {
        for (const el of clause.elements) {
          exports.push({
            exported: el.name.text,
            local: (el.propertyName ?? el.name).text,
            from,
            kind: from ? 'reexport' : 'list',
            typeOnly: st.isTypeOnly || el.isTypeOnly,
            loc: locOf(el),
          });
        }
      }
    } else if (ts.isImportDeclaration(st)) {
      const spec = strLit(st.moduleSpecifier);
      if (spec === undefined) return;
      const bindings: ImportBinding[] = [];
      const c = st.importClause;
      const clauseTypeOnly = !!c?.isTypeOnly;
      if (c?.name) bindings.push({ kind: 'default', imported: 'default', local: c.name.text, typeOnly: clauseTypeOnly });
      if (c?.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) {
          bindings.push({ kind: 'namespace', imported: '*', local: c.namedBindings.name.text, typeOnly: clauseTypeOnly });
        } else {
          for (const el of c.namedBindings.elements) {
            bindings.push({ kind: 'named', imported: (el.propertyName ?? el.name).text, local: el.name.text, typeOnly: clauseTypeOnly || el.isTypeOnly });
          }
        }
      }
      imports.push({ specifier: spec, kind: 'static', typeOnly: clauseTypeOnly, bindings, loc: locOf(st) });
    } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)) {
      const spec = strLit(st.moduleReference.expression);
      if (spec !== undefined) {
        imports.push({ specifier: spec, kind: 'require', typeOnly: st.isTypeOnly, bindings: [{ kind: 'namespace', imported: '*', local: st.name.text, typeOnly: st.isTypeOnly }], loc: locOf(st) });
      }
    }
  }

  // Top-level deklaratsiyalar
  for (const st of sf.statements) handleStatement(st);

  // Chuqur sayr: dynamic import() va require() har joyda uchrashi mumkin.
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const spec = strLit(n.arguments[0]);
        if (spec !== undefined) imports.push({ specifier: spec, kind: 'dynamic', typeOnly: false, bindings: [], loc: locOf(n) });
        else unresolved.push({ reason: 'dynamic-import', snippet: snippet(n), loc: locOf(n) });
      } else if (ts.isElementAccessExpression(n.expression) && strLit(n.expression.argumentExpression) === undefined) {
        unresolved.push({ reason: 'computed-call', snippet: snippet(n), loc: locOf(n) });
      } else if (ts.isIdentifier(n.expression) && n.expression.text === 'require' && n.arguments.length === 1) {
        const spec = strLit(n.arguments[0]);
        if (spec !== undefined) imports.push({ specifier: spec, kind: 'require', typeOnly: false, bindings: [], loc: locOf(n) });
        else unresolved.push({ reason: 'dynamic-require', snippet: snippet(n), loc: locOf(n) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  // `export { a as b }` va `export default a` bilan eksport qilingan lokal symbol'larni belgilash.
  const exportedLocals = new Set(exports.filter((e) => !e.from && e.local).map((e) => e.local!));
  for (const s of symbols) if (!s.qualifiedName.includes('.') && exportedLocals.has(s.name)) s.exported = true;

  // Sintaksis xatolari. `parseDiagnostics` — TS ichki maydoni (rasmiy API'da yo'q), shuning uchun himoyalangan.
  const diags = ((sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? []);
  const errors: ParseError[] = diags.map((d) => {
    const s = sf.getLineAndCharacterOfPosition(d.start);
    const e = sf.getLineAndCharacterOfPosition(d.start + d.length);
    return {
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      loc: { file: relPath, startLine: s.line + 1, startCol: s.character + 1, endLine: e.line + 1, endCol: e.character + 1 },
    };
  });

  return {
    path: relPath,
    isTestFile: TEST_RE.test(relPath),
    lineCount: sf.getLineAndCharacterOfPosition(sf.getEnd()).line + 1,
    symbols, imports, exports, unresolved, errors,
  };
}
