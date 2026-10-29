import { useEffect, useMemo, useRef, useState } from 'react';
import { splitNodeId } from '@xray/core';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { GraphView, type GEdge, type GNode } from '../GraphView.tsx';
import { SourceView } from '../SourceView.tsx';
import { SplitLayout } from '../components/SplitLayout.tsx';
import { PathLabel } from '../components/PathLabel.tsx';
import type { ImpactReport, RefsResp } from '../types.ts';

type Item = ImpactReport['direct'][number];
type Kind = 'working' | 'staged' | 'range';
type Tab = 'changed' | 'direct' | 'indirect' | 'routes' | 'tests' | 'uncertain';
type PathStep = Item['path'][number];

/** Dalil panelida ko'rsatiladigan har qanday element (natija elementi yoki test) */
interface Ev {
  id: string;
  name: string;
  kind: string;
  confidence: string;
  meta: string;
  reason: string;
  path: PathStep[];
}

const shortId = (id: string) => splitNodeId(id).symbol ?? id.split('/').pop()!;
const PAGE = 50;

const toEv = (i: Item, meta: string): Ev => ({ id: i.id, name: i.name, kind: i.kind, confidence: i.confidence, meta, reason: i.reason, path: i.path });

export function ImpactScreen({ onOpenInExplorer }: { onOpenInExplorer: (id: string) => void }) {
  const { t, rich, lang } = useI18n();
  const [refs, setRefs] = useState<RefsResp | null>(null);
  const [kind, setKind] = useState<Kind>('working');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('HEAD');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ report: ImpactReport; markdown: string } | null>(null);
  const [sel, setSel] = useState<Ev | null>(null);
  const [tab, setTab] = useState<Tab>('direct');
  const [filter, setFilter] = useState('');
  const [conf, setConf] = useState<'all' | 'verified' | 'possible'>('all');
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    api<RefsResp>('/api/refs').then(setRefs).catch((e) => setErr(e.message));
  }, []);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setSel(null);
    try {
      const spec = kind === 'range' ? { kind, base, head } : { kind };
      const r = await api<{ report: ImpactReport; markdown: string }>('/api/impact', { spec });
      setRes(r);
      const rep = r.report;
      setTab(rep.direct.length ? 'direct' : rep.indirect.length ? 'indirect' : rep.routes.length ? 'routes' : rep.tests.length ? 'tests' : rep.changed.length ? 'changed' : 'direct');
      setLimit(PAGE);
    } catch (e) {
      setErr((e as Error).message);
      setRes(null);
    } finally {
      setBusy(false);
    }
  };

  // Til almashganda hisobot matnlari (sabablar, xabarlar) server tomonida qayta yasaladi: jimgina yangilaymiz (tab/filtr saqlanadi)
  const firstLang = useRef(true);
  useEffect(() => {
    if (firstLang.current) {
      firstLang.current = false;
      return;
    }
    if (!res) return;
    const spec = kind === 'range' ? { kind, base, head } : { kind };
    setSel(null);
    api<{ report: ImpactReport; markdown: string }>('/api/impact', { spec }).then(setRes).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const download = (name: string, text: string, type: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const r = res?.report;
  const noGit = refs && !refs.git;
  const switchTab = (t: Tab) => {
    setTab(t);
    setLimit(PAGE);
  };

  const list = useMemo(() => {
    if (!r || (tab !== 'direct' && tab !== 'indirect')) return [];
    const f = filter.trim().toLowerCase();
    return (tab === 'direct' ? r.direct : r.indirect).filter((i) => (conf === 'all' || i.confidence === conf) && (!f || i.name.toLowerCase().includes(f) || i.file.toLowerCase().includes(f)));
  }, [r, tab, filter, conf]);

  const tabBtn = (t: Tab, label: string, n: number, testid?: string) => (
    <button role="tab" aria-selected={tab === t} className={`tab-s${tab === t ? ' on' : ''}${n === 0 ? ' zero' : ''}`} onClick={() => switchTab(t)} data-testid={`itab-${t}`}>
      {label} <span className="count" data-testid={testid}>{n}</span>
    </button>
  );

  const evidence = !sel ? <div className="empty small">{t('imp.evidenceEmpty')}</div> : <Evidence ev={sel} onOpen={onOpenInExplorer} />;

  return (
    <SplitLayout id="impact" right={evidence} rightTitle={t('imp.panelEvidence')} rightDefault={420} rightRange={[300, 760]} openRightSignal={sel?.id}>
      <div className="impact-main" data-testid="impact-main">
        <div className="sticky-top">
          <div className="spec-row">
            {noGit ? <div className="note err" role="alert">{t('imp.notGit')}</div> : (
              <>
                <div className="seg wide" role="radiogroup" aria-label={t('imp.specLabel')}>
                  <label className={kind === 'working' ? 'on' : ''}><input type="radio" name="k" checked={kind === 'working'} onChange={() => setKind('working')} />{t('imp.working')}</label>
                  <label className={kind === 'staged' ? 'on' : ''}><input type="radio" name="k" checked={kind === 'staged'} onChange={() => setKind('staged')} />{t('imp.staged')}</label>
                  <label className={kind === 'range' ? 'on' : ''}><input type="radio" name="k" checked={kind === 'range'} onChange={() => setKind('range')} />{t('imp.range')}</label>
                </div>
                {kind === 'range' && (
                  <div className="row tight">
                    <input list="refs" aria-label="base" data-testid="base-ref" placeholder={t('imp.basePh')} value={base} onChange={(e) => setBase(e.target.value)} />
                    <span>…</span>
                    <input list="refs" aria-label="head" data-testid="head-ref" placeholder={t('imp.headPh')} value={head} onChange={(e) => setHead(e.target.value)} />
                    <datalist id="refs">
                      {refs?.branches?.map((b) => <option key={b.name} value={b.name} />)}
                      {refs?.commits?.map((c) => <option key={c.hash} value={c.short}>{c.subject}</option>)}
                    </datalist>
                  </div>
                )}
                <button className="primary" onClick={() => void run()} disabled={busy || (kind === 'range' && !base.trim())} data-testid="run-impact">{busy ? t('imp.running') : t('imp.run')}</button>
              </>
            )}
          </div>
          {err && <div className="note err" role="alert" data-testid="impact-error">{err}</div>}

          {r && (
            <div className="summary" data-testid="impact-report">
              <div role="tablist" className="tabs-s" aria-label={t('imp.tabsLabel')}>
                {tabBtn('changed', t('imp.tabChanged'), r.stats.changedFiles)}
                {tabBtn('direct', t('imp.tabDirect'), r.stats.direct, 'n-direct')}
                {tabBtn('indirect', t('imp.tabIndirect'), r.stats.indirect, 'n-indirect')}
                {r.routes.length > 0 && tabBtn('routes', t('imp.tabRoutes'), r.stats.routes, 'n-routes')}
                {tabBtn('tests', t('imp.tabTests'), r.stats.tests)}
                {tabBtn('uncertain', t('imp.tabUncertain'), r.uncertain.length)}
              </div>
              <div className="row tight tools">
                <span className="muted small">{t('imp.statLine', { symbols: r.stats.changedSymbols, ms: r.stats.ms, max: r.options.maxDepth, body: r.options.bodyOnlyDepth })}</span>
                <span className="grow" />
                <button className="small" onClick={() => download('xray-impact.md', res!.markdown, 'text/markdown')}>{t('imp.mdDownload')}</button>
                <button className="small" onClick={() => download('xray-impact.json', JSON.stringify(r, null, 2), 'application/json')}>{t('imp.jsonDownload')}</button>
              </div>
            </div>
          )}
        </div>

        <div className="tab-body">
          {!r && !err && !busy && !noGit && <div className="empty">{t('imp.emptyA')}<br />{t('imp.emptyB')}<br /><span className="small">{t('imp.emptyC')}</span></div>}

          {r && tab === 'changed' && (
            r.changed.length === 0 ? <div className="empty small" data-testid="no-changes">{t('imp.noChanges')}</div> : (
              <div data-testid="changed">
                {r.changed.map((c) => (
                  <details key={c.path} className="sec" open={r.changed.length <= 3 ? true : undefined}>
                    <summary className="file-sum"><span className="badge st">{c.status}</span><PathLabel file={c.path} />{c.oldPath && <span className="muted small wrap"> ← {c.oldPath}</span>}<span className="count">{c.symbols.length}</span></summary>
                    <div className="sub pad">
                      {c.symbols.map((s) => <span key={s.id} className={`tag ch-${s.change}`}>{s.name}: {s.change}</span>)}
                      {c.fileLevelLines.length > 0 && <span className="tag">{t('imp.fileLevel', { line: c.fileLevelLines[0] ?? 0 })}</span>}
                      {c.symbols.length === 0 && c.fileLevelLines.length === 0 && <span className="muted small">{t('imp.noSymbolChange')}</span>}
                    </div>
                  </details>
                ))}
              </div>
            )
          )}

          {r && (tab === 'direct' || tab === 'indirect') && (
            <>
              <div className="row tight filters-row">
                <input aria-label={t('imp.filterLabel')} placeholder={t('imp.filterPh')} value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(PAGE); }} />
                <div className="seg" role="group" aria-label={t('imp.confLabel')}>
                  {(['all', 'verified', 'possible'] as const).map((c) => <button key={c} className={conf === c ? 'on' : ''} aria-pressed={conf === c} onClick={() => { setConf(c); setLimit(PAGE); }}>{c === 'all' ? t('imp.confAll') : c}</button>)}
                </div>
              </div>
              {list.length === 0 ? <div className="empty small">{(tab === 'direct' ? r.direct : r.indirect).length === 0 ? t('common.none') : t('imp.noMatch')}</div> : (
                <div data-testid={tab}>
                  {list.slice(0, limit).map((i) => (
                    <button key={i.id} className={`row-item${sel?.id === i.id ? ' on' : ''}`} onClick={() => setSel(toEv(i, t('imp.tier', { tier: t(`imp.tier.${i.tier}` as 'imp.tier.direct'), depth: i.depth })))} data-testid="impact-item" title={i.reason}>
                      <span className={`badge ${i.confidence}`}>{i.confidence}</span>
                      <span className="ri-main">
                        <span className="ri-top"><b>{i.name}</b><span className="kind">{i.kind}</span>{i.alsoChanged && <span className="kind ok">{t('imp.alsoChanged')}</span>}</span>
                        <PathLabel file={i.file} line={i.loc.startLine} />
                      </span>
                    </button>
                  ))}
                  {list.length > limit && <button className="more" onClick={() => setLimit(limit + PAGE)}>{t('imp.showMore', { n: Math.min(PAGE, list.length - limit), total: list.length })}</button>}
                </div>
              )}
            </>
          )}

          {r && tab === 'routes' && (
            <div data-testid="routes">
              <p className="muted small pad">{rich('imp.routesNote')}</p>
              {r.routes.map((x, i) => (
                <button key={i} className="row-item" onClick={() => onOpenInExplorer(x.file)} title={t('imp.openExplorer')}>
                  <span className={`badge ${x.reason === 'changed' ? 'st' : x.reason === 'affected' ? 'verified' : 'possible'}`}>{x.reason}</span>
                  <span className="ri-main">
                    <span className="ri-top"><b className="mono">{x.route}</b><span className="kind">{x.router}/{x.role}</span></span>
                    <PathLabel file={x.file} />
                    <span className="muted small wrap">{x.because}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {r && tab === 'tests' && (
            <>
              {r.testCommand && <TestCommand cmd={r.testCommand} />}
              {r.tests.length === 0 ? <div className="empty small">{t('imp.noTests')}</div> : (
                <div data-testid="tests">
                  {r.tests.map((t) => (
                    <button key={t.file} className={`row-item${sel?.id === t.file ? ' on' : ''}`} onClick={() => setSel({ id: t.file, name: t.file.split('/').pop()!, kind: 'test_file', confidence: t.path.every((p) => p.confidence === 'verified') ? 'verified' : 'possible', meta: t.relevance, reason: t.because, path: t.path })}>
                      <span className={`badge rel-${t.relevance}`}>{t.relevance}</span>
                      <span className="ri-main">
                        <span className="ri-top"><b>{t.file.split('/').pop()}</b></span>
                        <PathLabel file={t.file} />
                        <span className="muted small wrap">{t.because}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {r.untested.length > 0 && <div className="note warn">{rich('imp.untested', { names: r.untested.map((u) => u.name).join(', ') })}</div>}
            </>
          )}

          {r && tab === 'uncertain' && (
            r.uncertain.length === 0 ? <div className="empty small">{t('imp.noUncertain')}</div> : (
              <div data-testid="uncertain">
                {r.uncertain.map((u, i) => (
                  <div key={i} className="unc"><span className="badge unresolved">{u.kind}</span><div>{u.file && <PathLabel file={u.file} line={u.line} />}<div className="wrap">{u.message}</div></div></div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </SplitLayout>
  );
}

function Evidence({ ev, onOpen }: { ev: Ev; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const { nodes, edges } = useMemo(() => {
    const ns = new Map<string, GNode>();
    const es: GEdge[] = [];
    const add = (id: string, hot = false) => {
      if (!ns.has(id)) ns.set(id, { id, label: shortId(id), kind: id.includes('#') ? 'function' : /\.(test|spec)\./.test(id) ? 'test_file' : 'file', hot });
    };
    add(ev.id, true);
    ev.path.forEach((p, i) => {
      add(p.from, i === 0);
      add(p.to, i === ev.path.length - 1);
      es.push({ id: `${p.kind}|${p.from}|${p.to}`, source: p.from, target: p.to, kind: p.kind, conf: p.confidence, hot: true });
    });
    return { nodes: [...ns.values()], edges: es };
  }, [ev]);
  const first = ev.path[0];
  return (
    <div className="detail-body" data-testid="evidence-body">
      <h3>{ev.name}</h3>
      <div className="meta"><span className={`badge ${ev.confidence}`}>{ev.confidence}</span><span className="kind">{ev.meta}</span></div>
      <p className="wrap">{ev.reason}</p>
      <details className="sec" open>
        <summary>{t('imp.evidencePath')} <span className="count">{ev.path.length}</span></summary>
        <ol className="steps">
          {ev.path.map((p, i) => (
            <li key={i}>
              <div className="step-line"><code>{shortId(p.from)}</code><span className="arrow">—{p.kind}{p.via ? `(${p.via})` : ''}→</span><code>{shortId(p.to)}</code><span className={`badge ${p.confidence}`}>{p.confidence}</span></div>
              <PathLabel file={p.evidence.file} line={p.evidence.startLine} />
            </li>
          ))}
        </ol>
        <div className="mini-graph" style={{ height: Math.min(380, Math.max(170, nodes.length * 74 + 30)) }}><GraphView nodes={nodes} edges={edges} layout="chain" height="100%" /></div>
      </details>
      {first && (
        <details className="sec" open>
          <summary>{t('imp.source')}</summary>
          <SourceView file={first.evidence.file} from={first.evidence.startLine} to={first.evidence.endLine} context={3} />
        </details>
      )}
      <div className="row"><button onClick={() => onOpen(ev.id)}>{t('imp.openExplorer')}</button></div>
    </div>
  );
}

function TestCommand({ cmd }: { cmd: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <div className="testcmd" data-testid="test-command">
      <div className="muted small">{t('imp.testCmd')}</div>
      <pre className="sig">{cmd}</pre>
      <button className="small" onClick={() => { void navigator.clipboard?.writeText(cmd).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>{done ? t('imp.copied') : t('imp.copy')}</button>
    </div>
  );
}
