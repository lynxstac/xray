import { parseArgs } from 'node:util';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { indexProject, openStore } from '@xray/graph';
import { renderMarkdown, runImpact } from '@xray/impact';
import { retrieve } from '@xray/retrieval';
import { ask, CONSENT_TEXT, DEFAULT_CONFIG_PATH, loadAiConfig, saveAiConfig, assertAiEnabled, AiDisabledError, type AiConfig, type ProviderId } from '@xray/ai';
import { dbPathFor, startServer } from '@xray/server';
import type { DiffSpec } from '@xray/git';
import { DEFAULT_LANG, parseLang, type Lang } from '@xray/core';

const USAGE_UZ = `xray — local-first code intelligence (read-only)

  xray index  <repo> [--full] [--json]            Repo'ni indekslash (incremental, SQLite kesh)
  xray impact <repo> [--staged | --base R --head R] [--depth N] [--json | --md]
                                                  Git diff -> nimalar ta'sirlanishi mumkin (dalillar bilan)
  xray search <repo> <so'rov>                     Symbol/fayl qidirish
  xray ask    <repo> <savol> [--dry-run]          Kod bazasi bo'yicha savol (AI ixtiyoriy, rozilik talab qiladi)
  xray serve  [repo] [--port N]                   Lokal web UI
  xray mcp                                        MCP server (stdio): AI agentlar uchun impact/qidiruv vositalari
  xray ai status | enable --provider anthropic|openai-compatible --model M --env-key ENV [--base-url U] [--accept-consent]

  Til / language: --lang uz|en  (yoki XRAY_LANG=en)
`;
const USAGE_EN = `xray — local-first code intelligence (read-only)

  xray index  <repo> [--full] [--json]            Index a repo (incremental, SQLite cache)
  xray impact <repo> [--staged | --base R --head R] [--depth N] [--json | --md]
                                                  Git diff -> what may be affected (with evidence)
  xray search <repo> <query>                      Search symbols/files
  xray ask    <repo> <question> [--dry-run]       Ask about the codebase (AI optional, needs consent)
  xray serve  [repo] [--port N]                   Local web UI
  xray mcp                                        MCP server (stdio): impact/search tools for AI agents
  xray ai status | enable --provider anthropic|openai-compatible --model M --env-key ENV [--base-url U] [--accept-consent]

  Language: --lang uz|en  (or XRAY_LANG=en)
`;

type CParams = Record<string, string | number>;
const CLI = {
  uz: {
    usage: USAGE_UZ,
    unknownCmd: "Noma'lum buyruq: {cmd}",
    errPrefix: 'xato',
    repoNeeded: 'repo papkasi kerak',
    noFolder: "Papka yo'q: {path}",
    repo: 'Repo',
    mode: 'Rejim',
    files: "Fayllar: {scanned} skanerlandi · {reparsed} qayta parse · {sem} semantika qayta hisoblandi · {synt} sintaksis xatosi · {failed} o'qilmadi",
    graph: "Graph: {nodes} node, {edges} edge, {unres} aniqlanmagan/hal bo'lmagan · {ms} ms",
    skipped: "O'tkazib yuborildi",
    unresolved: 'Aniqlanmagan',
    queryNeeded: "qidiruv so'rovi kerak",
    questionNeeded: 'savol kerak',
    aiOff: "[AI o'chiq] {reason}\nQuyida topilgan dalillar (hech narsa tashqariga yuborilmadi):\n",
    dryRun: "[dry-run] Yuboriladi: {prov}/{model} · {chunks} parcha · {chars} belgi · {red} maxfiy qiymat olib tashlandi\nFayllar: {files}\n",
    citations: '\n— iqtiboslar: {ok} yaroqli, {bad} yaroqsiz',
    sent: '— yuborildi: {prov}/{model}, {files} fayl, {chars} belgi, {red} maxfiy qiymat olib tashlandi',
    noEvidence: 'Yetarli dalil topilmadi.',
    serve: "X-Ray: {url}\n(faqat shu kompyuterdan ochiladi; token URL ichida. To'xtatish: Ctrl+C)",
    aiNotConfigured: "AI sozlanmagan (default: o'chiq — hech narsa tashqariga yuborilmaydi).",
    aiLine: 'Provayder: {prov} · model: {model} · kalit env: {env}',
    aiOn: 'Holat: YOQILGAN (rozilik berilgan, kalit bor)',
    aiOffLine: "Holat: o'chiq — {reason}",
    badProvider: 'provider: anthropic | openai-compatible',
    modelNeeded: '--model kerak',
    consentHdr: 'ROZILIK',
    consentNonTty: 'Rozilik interaktiv tasdiqlanishi yoki --accept-consent berilishi kerak',
    consentPrompt: 'Roziman? ("ha" deb yozing): ',
    consentYes: 'ha',
    cancelled: "Bekor qilindi. AI o'chiq qoldi.",
    saved: "Saqlandi: {path}. Kalit faylda saqlanmaydi: {env} env o'zgaruvchisini o'rnating.",
    aiSub: 'ai status | ai enable',
  },
  en: {
    usage: USAGE_EN,
    unknownCmd: 'Unknown command: {cmd}',
    errPrefix: 'error',
    repoNeeded: 'a repo folder is required',
    noFolder: 'No such folder: {path}',
    repo: 'Repo',
    mode: 'Mode',
    files: 'Files: {scanned} scanned · {reparsed} re-parsed · {sem} semantics recomputed · {synt} with syntax errors · {failed} unreadable',
    graph: 'Graph: {nodes} nodes, {edges} edges, {unres} unresolved · {ms} ms',
    skipped: 'Skipped',
    unresolved: 'Unresolved',
    queryNeeded: 'a search query is required',
    questionNeeded: 'a question is required',
    aiOff: '[AI off] {reason}\nLocal evidence found below (nothing was sent anywhere):\n',
    dryRun: '[dry-run] Would send: {prov}/{model} · {chunks} excerpts · {chars} chars · {red} secret values removed\nFiles: {files}\n',
    citations: '\n— citations: {ok} valid, {bad} invalid',
    sent: '— sent: {prov}/{model}, {files} files, {chars} chars, {red} secret values removed',
    noEvidence: 'Not enough evidence found.',
    serve: 'X-Ray: {url}\n(reachable from this machine only; the token is in the URL. Stop: Ctrl+C)',
    aiNotConfigured: 'AI is not configured (default: off — nothing is sent anywhere).',
    aiLine: 'Provider: {prov} · model: {model} · key env: {env}',
    aiOn: 'Status: ENABLED (consent given, key present)',
    aiOffLine: 'Status: off — {reason}',
    badProvider: 'provider: anthropic | openai-compatible',
    modelNeeded: '--model is required',
    consentHdr: 'CONSENT',
    consentNonTty: 'Consent must be confirmed interactively or --accept-consent must be passed',
    consentPrompt: 'Do you agree? (type "yes"): ',
    consentYes: 'yes',
    cancelled: 'Cancelled. AI stays off.',
    saved: 'Saved: {path}. The key is not stored in the file: set the {env} environment variable.',
    aiSub: 'ai status | ai enable',
  },
} as const;
type CKey = keyof (typeof CLI)['uz'];
let L: Lang = DEFAULT_LANG;
const c = (k: CKey, p?: CParams): string => {
  const s: string = CLI[L][k];
  return p ? s.replace(/\{(\w+)\}/g, (_, x: string) => String(p[x] ?? `{${x}}`)) : s;
};

type Out = (s: string) => void;

/** `--lang uz|en` (har qayerda) yoki XRAY_LANG; qolgan argumentlar qaytariladi. */
function takeLang(argv: string[]): string[] {
  const rest: string[] = [];
  let lang: unknown = process.env.XRAY_LANG;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--lang') lang = argv[++i];
    else if (a.startsWith('--lang=')) lang = a.slice(7);
    else rest.push(a);
  }
  L = parseLang(lang);
  return rest;
}

export async function runCli(rawArgv: string[], out: Out = console.log): Promise<number> {
  const [cmd, ...rest] = takeLang(rawArgv);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    out(c('usage'));
    return 0;
  }
  try {
    switch (cmd) {
      case 'index': return await cmdIndex(rest, out);
      case 'impact': return await cmdImpact(rest, out);
      case 'search': return await cmdSearch(rest, out);
      case 'ask': return await cmdAsk(rest, out);
      case 'serve': return await cmdServe(rest, out);
      case 'ai': return await cmdAi(rest, out);
      case 'mcp': { const { runMcp } = await import('@xray/mcp'); await runMcp(); return 0; }
      default:
        out(`${c('unknownCmd', { cmd })}\n\n${c('usage')}`);
        return 2;
    }
  } catch (e) {
    console.error(`${c('errPrefix')}: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
}

function repoArg(positionals: string[]): string {
  const p = positionals[0];
  if (!p) throw new Error(c('repoNeeded'));
  if (!existsSync(p)) throw new Error(c('noFolder', { path: p }));
  return path.resolve(p);
}

async function cmdIndex(args: string[], out: Out): Promise<number> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { full: { type: 'boolean' }, json: { type: 'boolean' } } });
  const root = repoArg(positionals);
  const { realpath } = await import('node:fs/promises');
  const r = await indexProject(root, { dbPath: dbPathFor(await realpath(root)), full: values.full, lang: L });
  if (values.json) {
    out(JSON.stringify({ root: r.root, stats: r.stats, skipped: r.scan.skipped, unresolved: r.graph.unresolved, failed: r.failed, syntaxErrors: r.files.filter((f) => f.errors.length).map((f) => ({ file: f.path, errors: f.errors })), nodes: [...r.graph.nodes.values()], edges: r.graph.edges }, null, 2));
    return 0;
  }
  const s = r.stats;
  out(`${c('repo')}: ${r.root}`);
  out(`${c('mode')}: ${s.mode} (${s.reason})`);
  out(c('files', { scanned: s.scanned, reparsed: s.reparsed, sem: s.semanticRecomputed, synt: s.withSyntaxErrors, failed: s.failed }));
  out(c('graph', { nodes: s.nodes, edges: s.edges, unres: s.unresolved, ms: s.ms }));
  const bySkip: Record<string, number> = {};
  for (const k of r.scan.skipped) bySkip[k.reason] = (bySkip[k.reason] ?? 0) + 1;
  if (Object.keys(bySkip).length) out(`${c('skipped')}: ${Object.entries(bySkip).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  for (const f of r.files.filter((x) => x.errors.length)) out(`  ✗ ${f.path}:${f.errors[0]!.loc.startLine} ${f.errors[0]!.message}`);
  const byU: Record<string, number> = {};
  for (const u of r.graph.unresolved) byU[u.reason] = (byU[u.reason] ?? 0) + 1;
  if (Object.keys(byU).length) out(`${c('unresolved')}: ${Object.entries(byU).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  return 0;
}

async function cmdImpact(args: string[], out: Out): Promise<number> {
  const { positionals, values } = parseArgs({
    args, allowPositionals: true,
    options: { staged: { type: 'boolean' }, base: { type: 'string' }, head: { type: 'string' }, depth: { type: 'string' }, json: { type: 'boolean' }, md: { type: 'boolean' } },
  });
  const root = repoArg(positionals);
  let spec: DiffSpec = { kind: 'working' };
  if (values.staged) spec = { kind: 'staged' };
  else if (values.base) spec = { kind: 'range', base: values.base, head: values.head ?? 'HEAD' };
  const { realpath } = await import('node:fs/promises');
  const { report } = await runImpact({ root, spec, dbPath: dbPathFor(await realpath(root)), options: { ...(values.depth ? { maxDepth: Number(values.depth) } : {}), lang: L } });
  out(values.json ? JSON.stringify(report, null, 2) : renderMarkdown(report, L));
  return 0;
}

async function openForQuery(root: string) {
  const { realpath } = await import('node:fs/promises');
  const real = await realpath(root);
  const db = dbPathFor(real);
  const idx = await indexProject(real, { dbPath: db });
  return { idx, store: openStore(db), root: idx.root };
}

async function cmdSearch(args: string[], out: Out): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  const root = repoArg(positionals);
  const q = positionals.slice(1).join(' ');
  if (!q) throw new Error(c('queryNeeded'));
  const { store, idx } = await openForQuery(root);
  try {
    for (const h of store.search(q, 20)) {
      const n = idx.graph.nodes.get(h.id);
      out(`${n?.kind ?? '?'}\t${h.id}${n ? `:${n.loc.startLine}` : ''}`);
    }
  } finally {
    store.close();
  }
  return 0;
}

async function cmdAsk(args: string[], out: Out): Promise<number> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { 'dry-run': { type: 'boolean' } } });
  const root = repoArg(positionals);
  const question = positionals.slice(1).join(' ');
  if (!question) throw new Error(c('questionNeeded'));
  const { idx, store, root: real } = await openForQuery(root);
  try {
    const evidence = await retrieve(question, { graph: idx.graph, store, root: real, lang: L });
    const r = await ask({ question, evidence, config: await loadAiConfig(), dryRun: values['dry-run'], lang: L });
    if (r.mode === 'evidence-only') out(c('aiOff', { reason: r.disabledReason ?? '' }));
    else if (values['dry-run']) out(c('dryRun', { prov: r.sent!.provider, model: r.sent!.model, chunks: r.sent!.chunks, chars: r.sent!.chars, red: r.sent!.redactions, files: r.sent!.files.join(', ') }));
    else {
      out(r.answer ?? '');
      const bad = r.citations.filter((c) => !c.valid);
      out(c('citations', { ok: r.citations.length - bad.length, bad: bad.length }) + (bad.length ? ' → ' + bad.map((b) => `${b.raw} (${b.problem})`).join('; ') : ''));
      out(c('sent', { prov: r.sent!.provider, model: r.sent!.model, files: r.sent!.files.length, chars: r.sent!.chars, red: r.sent!.redactions }));
      return 0;
    }
    for (const c of evidence.chunks) out(`• ${c.file}:${c.startLine}-${c.endLine}  ${c.kind} ${c.name}  (${c.why.join('; ')})`);
    for (const f of evidence.facts.slice(0, 12)) out(`  ↳ ${f.text} [${f.file}:${f.line}]`);
    if (!evidence.chunks.length) out(c('noEvidence'));
  } finally {
    store.close();
  }
  return 0;
}

async function cmdServe(args: string[], out: Out): Promise<number> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { port: { type: 'string' } } });
  const webDist = path.resolve(import.meta.dirname, '../../../apps/web/dist');
  const srv = await startServer({ port: values.port ? Number(values.port) : 0, webDist });
  if (positionals[0]) await srv.state.open(positionals[0]);
  out(c('serve', { url: srv.url }));
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => void srv.close().then(resolve));
    process.once('SIGTERM', () => void srv.close().then(resolve));
  });
  return 0;
}

async function cmdAi(args: string[], out: Out): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === 'status' || !sub) {
    const cfg = await loadAiConfig();
    out(`Config: ${DEFAULT_CONFIG_PATH}`);
    if (!cfg) return out(c('aiNotConfigured')), 0;
    out(c('aiLine', { prov: cfg.provider, model: cfg.model, env: cfg.apiKeyEnv }) + (cfg.baseUrl ? ' · ' + cfg.baseUrl : ''));
    try {
      assertAiEnabled(cfg, process.env, L);
      out(c('aiOn'));
    } catch (e) {
      out(c('aiOffLine', { reason: e instanceof AiDisabledError ? e.message : String(e) }));
    }
    return 0;
  }
  if (sub === 'enable') {
    const { values } = parseArgs({ args: rest, options: { provider: { type: 'string' }, model: { type: 'string' }, 'env-key': { type: 'string' }, 'base-url': { type: 'string' }, 'accept-consent': { type: 'boolean' } } });
    const provider = (values.provider ?? 'anthropic') as ProviderId;
    if (provider !== 'anthropic' && provider !== 'openai-compatible') throw new Error(c('badProvider'));
    const model = values.model ?? (provider === 'anthropic' ? 'claude-sonnet-5-5' : '');
    const envKey = values['env-key'] ?? (provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY');
    if (!model) throw new Error(c('modelNeeded'));
    out(`${c('consentHdr')}:\n${CONSENT_TEXT(provider, L)}\n`);
    let ok = !!values['accept-consent'];
    if (!ok) {
      if (!process.stdin.isTTY) throw new Error(c('consentNonTty'));
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      ok = (await rl.question(c('consentPrompt'))).trim().toLowerCase() === c('consentYes');
      rl.close();
    }
    if (!ok) return out(c('cancelled')), 1;
    const cfg: AiConfig = { provider, model, apiKeyEnv: envKey, baseUrl: values['base-url'], consent: { acceptedAt: new Date().toISOString(), provider, sendsSourceExcerpts: true } };
    await saveAiConfig(cfg);
    out(c('saved', { path: DEFAULT_CONFIG_PATH, env: envKey }));
    return 0;
  }
  throw new Error(c('aiSub'));
}
