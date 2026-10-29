import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, q } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { GraphView, LEGEND, type GEdge, type GNode } from '../GraphView.tsx';
import { SourceView } from '../SourceView.tsx';
import { SplitLayout } from '../components/SplitLayout.tsx';
import { PathLabel } from '../components/PathLabel.tsx';
import type { EdgeBrief, Neighborhood, NodeBrief, NodeDetail } from '../types.ts';

const EDGE_KINDS = ['imports', 'calls', 'renders', 'references', 'tests'] as const;
const NODE_KINDS = ['file', 'test_file', 'component', 'hook', 'function', 'method', 'class', 'variable', 'type'] as const;

interface FileRow { id: string; kind: string; symbols: number; in: number; out: number; route?: { path: string; role: string } }

function Row({ n, on, onClick, extra }: { n: { name: string; kind: string; file: string; line?: number; route?: { path: string; role: string } }; on?: boolean; onClick: () => void; extra?: string }) {
  return (
    <button className={`row-item${on ? ' on' : ''}`} onClick={onClick} title={`${n.file}${n.line ? ':' + n.line : ''}`}>
      <span className="dot" data-k={n.kind} />
      <span className="ri-main">
        <span className="ri-top"><b>{n.name}</b><span className="kind">{n.kind}</span>{n.route && <span className="kind route" title={`Next.js ${n.route.role}`}>{n.route.role === 'page' || n.route.role === 'route-handler' || n.route.role === 'api' ? n.route.path : `${n.route.role} ${n.route.path}`}</span>}{extra && <span className="muted small">{extra}</span>}</span>
        <PathLabel file={n.file} line={n.line} />
      </span>
    </button>
  );
}

export function ExplorerScreen({ focusId, onFocus }: { focusId: string | null; onFocus: (id: string | null) => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NodeBrief[] | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [hood, setHood] = useState<Neighborhood | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [hops, setHops] = useState(1);
  const [edgeKinds, setEdgeKinds] = useState<Set<string>>(new Set(EDGE_KINDS));
  const [nodeKinds, setNodeKinds] = useState<Set<string>>(new Set(NODE_KINDS));
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Orqaga/oldinga tarixi
  const [hist, setHist] = useState<string[]>([]);
  const [pos, setPos] = useState(-1);
  const viaNav = useRef(false);

  useEffect(() => {
    api<{ files: FileRow[] }>('/api/files').then((r) => setFiles(r.files)).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!query.trim()) return setResults(null);
      api<{ results: NodeBrief[] }>(`/api/search?q=${q(query)}`).then((r) => setResults(r.results)).catch((e) => setErr(e.message));
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  // Tarixga yozish (orqaga/oldinga bosilganda emas)
  useEffect(() => {
    if (!focusId) return;
    if (viaNav.current) {
      viaNav.current = false;
      return;
    }
    setHist((h) => {
      const base = h.slice(0, pos + 1);
      if (base[base.length - 1] === focusId) return h;
      const next = [...base, focusId].slice(-60);
      setPos(next.length - 1);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const go = (delta: number) => {
    const np = pos + delta;
    const id = hist[np];
    if (id === undefined) return;
    viaNav.current = true;
    setPos(np);
    onFocus(id);
  };

  const kindsParam = [...edgeKinds].join(',');
  useEffect(() => {
    if (!focusId) {
      setHood(null);
      setDetail(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(null);
    Promise.all([
      api<Neighborhood>(`/api/neighborhood?id=${q(focusId)}&hops=${hops}&kinds=${kindsParam}&limit=120`),
      api<NodeDetail>(`/api/node?id=${q(focusId)}`),
    ])
      .then(([h, d]) => alive && (setHood(h), setDetail(d)))
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [focusId, hops, kindsParam]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const n = new Set(set);
    n.has(k) ? n.delete(k) : n.add(k);
    setter(n);
  };

  const { gnodes, gedges } = useMemo(() => {
    if (!hood) return { gnodes: [] as GNode[], gedges: [] as GEdge[] };
    const keep = new Set(hood.nodes.filter((n) => n.id === hood.center || nodeKinds.has(n.kind)).map((n) => n.id));
    return {
      gnodes: hood.nodes.filter((n) => keep.has(n.id)).map((n) => ({ id: n.id, label: n.name, kind: n.kind, dist: n.distance })),
      gedges: hood.edges.filter((e) => keep.has(e.from) && keep.has(e.to)).map((e) => ({ id: `${e.kind}|${e.from}|${e.to}`, source: e.from, target: e.to, kind: e.kind, conf: e.confidence })),
    };
  }, [hood, nodeKinds]);

  const select = useCallback((id: string) => onFocus(id), [onFocus]);
  const topFiles = useMemo(() => [...files].sort((a, b) => b.in - a.in).slice(0, 30), [files]);
  const activeFilters = (EDGE_KINDS.length - edgeKinds.size) + (NODE_KINDS.length - nodeKinds.size);

  const left = (
    <div className="stack-fill">
      <div className="search">
        <input aria-label={t('exp.searchLabel')} data-testid="search" placeholder={t('exp.searchPh')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        {query && <button className="icon clear" onClick={() => setQuery('')} aria-label={t('exp.clear')}>×</button>}
      </div>
      <div className="scroll-y grow-y">
        {results === null ? (
          <>
            <h4>{t('exp.topFiles')}</h4>
            {topFiles.length === 0 && <div className="empty small">{t('exp.noFiles')}</div>}
            {topFiles.map((f) => <Row key={f.id} n={{ name: f.id.split('/').pop() ?? f.id, kind: f.kind, file: f.id, route: f.route }} on={focusId === f.id} onClick={() => select(f.id)} extra={`←${f.in}`} />)}
          </>
        ) : results.length === 0 ? (
          <div className="empty small" data-testid="no-results">{t('exp.noResults', { q: query })}</div>
        ) : (
          <div data-testid="results">
            <h4>{t('exp.results', { n: results.length })}</h4>
            {results.map((r) => <Row key={r.id} n={r} on={focusId === r.id} onClick={() => select(r.id)} />)}
          </div>
        )}
      </div>
      <details className="filters" open={activeFilters > 0 ? true : undefined}>
        <summary>{t('exp.filters')}{activeFilters > 0 && <span className="badge possible">{t('exp.off', { n: activeFilters })}</span>}</summary>
        <h4>{t('exp.edgeKinds')}</h4>
        <div className="pills">{EDGE_KINDS.map((k) => <label key={k} className={`pill-chk${edgeKinds.has(k) ? ' on' : ''}`}><input type="checkbox" checked={edgeKinds.has(k)} onChange={() => toggle(edgeKinds, setEdgeKinds, k)} />{k}</label>)}</div>
        <h4>{t('exp.nodeKinds')}</h4>
        <div className="pills">{NODE_KINDS.map((k) => <label key={k} className={`pill-chk${nodeKinds.has(k) ? ' on' : ''}`}><input type="checkbox" checked={nodeKinds.has(k)} onChange={() => toggle(nodeKinds, setNodeKinds, k)} />{k}</label>)}</div>
        <h4>{t('exp.hops')}</h4>
        <div className="seg" role="group" aria-label={t('exp.hopsLabel')}>{[1, 2, 3].map((h) => <button key={h} className={hops === h ? 'on' : ''} aria-pressed={hops === h} onClick={() => setHops(h)}>{h}</button>)}</div>
      </details>
    </div>
  );

  return (
    <SplitLayout id="explorer" left={left} leftTitle={t('exp.panelSearch')} right={detail ? <Detail d={detail} onFocus={select} /> : <div className="empty small">{t('exp.noNode')}</div>} rightTitle={t('exp.panelDetail')} leftDefault={300} rightDefault={400} initialDrawer={focusId ? undefined : 'l'} closeSignal={focusId}>
      <div className="canvas" data-testid="canvas">
        {!focusId && <div className="empty big">{t('exp.emptyA')}<br />{t('exp.emptyB')}</div>}
        {focusId && (
          <>
            <div className="topbar">
              <button className="icon" onClick={() => go(-1)} disabled={pos <= 0} aria-label={t('exp.back')} title={t('exp.back')}>←</button>
              <button className="icon" onClick={() => go(1)} disabled={pos >= hist.length - 1} aria-label={t('exp.forward')} title={t('exp.forward')}>→</button>
              <span className="crumb" title={focusId}>{detail?.node.name ?? '…'}</span>
              {hood && <span className="muted small">{t('exp.stats', { nodes: gnodes.length, edges: gedges.length })}</span>}
              {loading && <span className="muted small">{t('common.loading')}</span>}
            </div>
            {err && <div className="note err float" role="alert">{err}</div>}
            {hood?.truncated && <div className="note warn float second" data-testid="truncated">{t('exp.truncated')}</div>}
            {hood && gnodes.length <= 1 && !loading && <div className="note float second">{t('exp.noEdges')}</div>}
            <GraphView nodes={gnodes} edges={gedges} focusId={focusId} onSelect={select} />
            <div className="legend">{LEGEND.map((l) => <span key={l.kind}><i style={{ background: l.color }} />{l.kind}</span>)}<span className="muted">{t('exp.legendNote')}</span></div>
          </>
        )}
      </div>
    </SplitLayout>
  );
}

function Detail({ d, onFocus }: { d: NodeDetail; onFocus: (id: string) => void }) {
  const { t, rich } = useI18n();
  const n = d.node;
  return (
    <div className="detail-body" data-testid="detail">
      <h3 data-testid="detail-name">{n.name}</h3>
      <div className="meta"><span className="kind">{n.kind}</span>{n.exported && <span className="kind ok">{t('exp.exported')}</span>}{n.route && <span className="kind route" data-testid="route-chip">Next.js {n.route.router}/{n.route.role} {n.route.path}</span>}</div>
      <PathLabel file={n.file} line={n.line} />
      {n.signature && <pre className="sig">{n.signature}</pre>}
      <div className="muted small">{t('exp.basis', { basis: n.basis })}</div>
      {d.externals.length > 0 && <div className="muted small">{t('exp.externals', { list: d.externals.join(', ') })}</div>}
      {d.unresolved.length > 0 && (
        <div className="note warn"><b>{t('exp.unresolvedInFile')}</b>{d.unresolved.map((u, i) => <div key={i}>{rich('exp.unresolvedItem', { reason: u.reason, snippet: u.snippet, line: u.line })}</div>)}</div>
      )}
      <EdgeGroups title={t('exp.incoming')} edges={d.incoming} onFocus={onFocus} testid="incoming" />
      <EdgeGroups title={t('exp.outgoing')} edges={d.outgoing} onFocus={onFocus} testid="outgoing" />
      <details className="sec" open>
        <summary>{t('exp.source')}</summary>
        <SourceView file={n.file} from={n.loc.startLine} to={Math.min(n.loc.endLine, n.loc.startLine + 40)} context={2} />
      </details>
    </div>
  );
}

function EdgeGroups({ title, edges, onFocus, testid }: { title: string; edges: (EdgeBrief & { other: NodeBrief })[]; onFocus: (id: string) => void; testid: string }) {
  const { t } = useI18n();
  const byKind = useMemo(() => {
    const m = new Map<string, (EdgeBrief & { other: NodeBrief })[]>();
    for (const e of edges) (m.get(e.kind) ?? m.set(e.kind, []).get(e.kind)!).push(e);
    return [...m.entries()];
  }, [edges]);
  return (
    <details className="sec" open={edges.length > 0 && edges.length <= 40 ? true : undefined}>
      <summary>{title} <span className="count">{edges.length}</span></summary>
      {edges.length === 0 ? <div className="muted small pad">{t('common.none')}</div> : (
        <div data-testid={testid}>
          {byKind.map(([kind, list]) => (
            <div key={kind} className="grp">
              <div className="grp-h">{kind} <span className="count">{list.length}</span></div>
              {list.slice(0, 60).map((e, i) => (
                <button key={i} className="row-item" onClick={() => onFocus(e.other.id)} title={`${e.file}:${e.line}`}>
                  <span className={`dot cf-${e.confidence}`} />
                  <span className="ri-main">
                    <span className="ri-top"><b>{e.other.name}</b><span className={`badge ${e.confidence}`}>{e.confidence}</span>{e.count > 1 && <span className="muted small">×{e.count}</span>}{e.via && <span className="muted small">{e.via}</span>}</span>
                    <PathLabel file={e.file} line={e.line} />
                  </span>
                </button>
              ))}
              {list.length > 60 && <div className="muted small pad">{t('common.more', { n: list.length - 60 })}</div>}
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
