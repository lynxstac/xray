// Mustaqil oracle bilan solishtirish: TypeScript LanguageService.findReferences (tsserver'ning o'zi)
// vs X-Ray graph'idagi (calls|renders|references) edge'lar. FAYL darajasida: "bu symbol'ni qaysi fayllar ishlatadi?"
// Ishlatish: node bench/accuracy.ts <repo> <tsconfig (repo'ga nisbatan)> [namuna soni=80]
// Natija: bench/results/accuracy-<repo>-<sana>.json
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { indexProject } from '@xray/graph';

const [repoArg, cfgArg, nArg] = process.argv.slice(2);
if (!repoArg || !cfgArg) throw new Error('usage: accuracy.ts <repo> <tsconfig> [n]');
const root = path.resolve(repoArg);
const cfgPath = path.resolve(root, cfgArg);
const N = Number(nArg ?? 80);

const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(cfgPath), undefined, cfgPath);
const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/');

const ours = await indexProject(root);
const ourFiles = new Set(ours.files.map((f) => f.path));
const cfgFiles = parsed.fileNames.filter((f) => ourFiles.has(rel(f)) && !f.includes('node_modules'));
const inCfg = new Set(cfgFiles.map(rel));

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => cfgFiles,
  getScriptVersion: () => '1',
  getScriptSnapshot: (f) => (ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f) ?? '') : undefined),
  getCurrentDirectory: () => root,
  getCompilationSettings: () => ({ ...parsed.options, noEmit: true }),
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
const program = ls.getProgram()!;

// Namuna: eksport qilingan funksiya/komponent/hook/class/variable, tasodifiy emas — deterministik (har k-chisi)
const candidates = [...ours.graph.nodes.values()].filter(
  (n) => inCfg.has(n.file) && n.exported && ['function', 'component', 'hook', 'class', 'variable'].includes(n.kind) && !n.file.includes('.test.'),
).sort((a, b) => a.id.localeCompare(b.id));
const step = Math.max(1, Math.floor(candidates.length / N));
const sample = candidates.filter((_, i) => i % step === 0).slice(0, N);

function declNamePos(file: string, line: number, col: number): number | undefined {
  const sf = program.getSourceFile(path.join(root, file));
  if (!sf) return undefined;
  const pos = sf.getPositionOfLineAndCharacter(line - 1, col - 1);
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (n.getStart(sf) === pos && (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isVariableDeclaration(n)) && n.name) found = n.name;
    else if (n.getStart(sf) <= pos && pos < n.end) ts.forEachChild(n, visit);
  };
  visit(sf);
  return found?.getStart(sf);
}

function inSpecifier(sf: ts.SourceFile, pos: number): boolean {
  let hit = false;
  const visit = (n: ts.Node) => {
    if (hit) return;
    if (pos >= n.getStart(sf) && pos < n.end) {
      if (ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n) || ts.isExportSpecifier(n) || ts.isImportEqualsDeclaration(n) || ts.isExportAssignment(n) && false) {
        hit = true;
        return;
      }
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  return hit;
}

let tp = 0, fp = 0, fn = 0, symbols = 0, skipped = 0;
// Faqat `verified` edge'lar bilan ham hisoblaymiz: `possible` — ataylab taxminiy deb belgilangan (a'zo orqali va h.k.)
let vtp = 0, vfp = 0, vfn = 0;
const diffs: { symbol: string; onlyOurs: string[]; onlyOracle: string[] }[] = [];
for (const n of sample) {
  const pos = declNamePos(n.file, n.loc.startLine, n.loc.startCol);
  if (pos === undefined) { skipped++; continue; }
  const refs = ls.findReferences(path.join(root, n.file), pos) ?? [];
  const oracle = new Set<string>();
  for (const group of refs) for (const r of group.references) {
    if (r.isDefinition) continue;
    const f = rel(r.fileName);
    if (f === n.file || !inCfg.has(f)) continue;
    const sf = program.getSourceFile(r.fileName);
    if (sf && inSpecifier(sf, r.textSpan.start)) continue;
    oracle.add(f);
  }
  const mine = new Set<string>();
  // XRAY_CONTROL=calls-only: harness sezgirligini tekshirish uchun ATAYIN buzilgan graph (faqat calls)
  const kinds = process.env.XRAY_CONTROL === 'calls-only' ? (['calls'] as const) : (['calls', 'renders', 'references'] as const);
  for (const e of ours.graph.incoming(n.id, kinds)) {
    const f = ours.graph.nodes.get(e.from)!.file;
    if (f !== n.file && inCfg.has(f)) mine.add(f);
  }
  const mineV = new Set<string>();
  for (const e of ours.graph.incoming(n.id, kinds)) {
    const f = ours.graph.nodes.get(e.from)!.file;
    if (e.confidence === 'verified' && f !== n.file && inCfg.has(f)) mineV.add(f);
  }
  vtp += [...mineV].filter((x) => oracle.has(x)).length;
  vfp += [...mineV].filter((x) => !oracle.has(x)).length;
  vfn += [...oracle].filter((x) => !mineV.has(x)).length;
  symbols++;
  const onlyOurs = [...mine].filter((x) => !oracle.has(x));
  const onlyOracle = [...oracle].filter((x) => !mine.has(x));
  tp += [...mine].filter((x) => oracle.has(x)).length;
  fp += onlyOurs.length;
  fn += onlyOracle.length;
  if (onlyOurs.length || onlyOracle.length) diffs.push({ symbol: n.id, onlyOurs, onlyOracle });
}
const precision = tp / Math.max(1, tp + fp);
const recall = tp / Math.max(1, tp + fn);
const vPrecision = vtp / Math.max(1, vtp + vfp);
const vRecall = vtp / Math.max(1, vtp + vfn);
const out = { repo: path.basename(root), tsconfig: cfgArg, filesInProject: cfgFiles.length, sampledSymbols: symbols, skippedSymbols: skipped, truePositive: tp, falsePositive: fp, falseNegative: fn, precision: +precision.toFixed(4), recall: +recall.toFixed(4), verifiedOnly: { truePositive: vtp, falsePositive: vfp, falseNegative: vfn, precision: +vPrecision.toFixed(4), recall: +vRecall.toFixed(4) }, symbolsWithDiffs: diffs.length, diffs: diffs.slice(0, 25) };
mkdirSync(path.join(import.meta.dirname, 'results'), { recursive: true });
writeFileSync(path.join(import.meta.dirname, 'results', `accuracy-${out.repo}-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(out, null, 2));
console.log(`${out.repo}: symbols=${symbols} | all: tp=${tp} fp=${fp} fn=${fn} P=${out.precision} R=${out.recall} | verified-only: fp=${vfp} fn=${vfn} P=${out.verifiedOnly.precision} R=${out.verifiedOnly.recall}`);
for (const d of diffs.slice(0, 6)) console.log('  ', d.symbol, 'ours-only:', d.onlyOurs.slice(0, 3), 'oracle-only:', d.onlyOracle.slice(0, 3));
void existsSync; void readFileSync;
