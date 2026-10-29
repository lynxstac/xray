import { DEFAULT_LANG, splitNodeId, t, type Lang } from '@xray/core';
import type { AffectedItem, ImpactReport } from './types.ts';

const BADGE = { verified: '✅ verified', possible: '🟡 possible', unresolved: '⚪ unresolved' } as const;

function specLabel(r: ImpactReport, lang: Lang): string {
  const s = r.spec;
  return s.kind === 'range' ? `${s.base}...${s.head}` : s.kind === 'staged' ? 'staged (index)' : t(lang, 'md.working');
}

function item(i: AffectedItem, lang: Lang): string {
  const chain = [...i.path].map((p) => `${short(p.from)} —${p.kind}→ ${short(p.to)}`).join('  ·  ');
  return `- **${i.name}** \`${i.file}:${i.loc.startLine}\` ${BADGE[i.confidence]}${i.alsoChanged ? t(lang, 'md.alsoChanged') : ''}\n  - ${i.reason}\n  - ${t(lang, 'md.path')}: ${chain}`;
}

const short = (id: string) => splitNodeId(id).symbol ?? id.split('/').pop()!;

/** Odam o'qiydigan hisobot. Hech qachon "buziladi" demaydi — faqat "ta'sirlanishi mumkin" va sababi. */
export function renderMarkdown(r: ImpactReport, lang: Lang = DEFAULT_LANG): string {
  const L: string[] = [];
  const T = (k: Parameters<typeof t>[1], p?: Record<string, string | number>) => t(lang, k, p);
  L.push(`# ${T('md.title')}`, '', `Diff: \`${specLabel(r, lang)}\` · base: \`${r.baseCommit?.slice(0, 8) ?? '—'}\``);
  L.push(`> ${T('md.disclaimer')}`, '');

  L.push(T('md.s1', { files: r.stats.changedFiles, symbols: r.stats.changedSymbols }));
  if (!r.changed.length) L.push(`_${T('md.noChanges')}_`);
  for (const c of r.changed) {
    L.push(`- \`${c.status}\` **${c.path}**${c.oldPath ? ` (← ${c.oldPath})` : ''}`);
    for (const s of c.symbols) L.push(`  - ${s.kind} \`${s.name}\` — ${s.change}`);
    if (c.fileLevelLines.length) L.push(`  - ${T('md.fileLevel', { lines: c.fileLevelLines.slice(0, 8).join(', ') + (c.fileLevelLines.length > 8 ? '…' : '') })}`);
  }

  L.push('', T('md.s2', { n: r.direct.length }));
  L.push(r.direct.length ? r.direct.map((i) => item(i, lang)).join('\n') : `_${T('md.none')}_`);
  L.push('', T('md.s3', { n: r.indirect.length }));
  L.push(r.indirect.length ? r.indirect.map((i) => item(i, lang)).join('\n') : `_${T('md.none')}_`);

  if (r.routes.length) {
    L.push('', T('md.routes', { n: r.stats.routes }));
    for (const x of r.routes.slice(0, 60)) L.push(`- \`${x.route}\` (${x.router}/${x.role}, \`${x.file}\`) — ${x.reason}: ${x.because}`);
    if (r.routes.length > 60) L.push(`- ${T('md.moreRoutes', { n: r.routes.length - 60 })}`);
  }

  L.push('', T('md.s4', { n: r.tests.length }));
  if (!r.tests.length) L.push(`_${T('md.noTests')}_`);
  for (const t of r.tests) L.push(`- \`${t.file}\` — ${t.relevance}: ${t.because}`);
  if (r.testCommand) L.push('', T('md.testCmd'), '', '```sh', r.testCommand, '```');
  if (r.untested.length) {
    L.push('', T('md.untested'));
    for (const u of r.untested) L.push(`- ${u.name} (\`${u.file}\`)`);
  }

  L.push('', T('md.s5', { n: r.uncertain.length }));
  if (!r.uncertain.length) L.push(`_${T('md.none')}_`);
  for (const u of r.uncertain) L.push(`- [${u.kind}] ${u.file ? `\`${u.file}${u.line ? ':' + u.line : ''}\` ` : ''}${u.message}`);

  L.push('', `---`, T('md.footer', { max: r.options.maxDepth, body: r.options.bodyOnlyDepth, ms: r.stats.ms }));
  return L.join('\n');
}
