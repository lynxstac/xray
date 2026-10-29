import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import { useI18n } from './i18n.tsx';

export interface GNode {
  id: string;
  label: string;
  kind: string;
  dist?: number;
  hot?: boolean;
}
export interface GEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  conf: string;
  hot?: boolean;
}

const KIND_STYLE: Record<string, { color: string; shape: cytoscape.Css.NodeShape }> = {
  file: { color: '#5b7388', shape: 'round-rectangle' },
  test_file: { color: '#c79a2b', shape: 'diamond' },
  component: { color: '#33e1ff', shape: 'ellipse' },
  hook: { color: '#b48cff', shape: 'hexagon' },
  function: { color: '#5aa2ff', shape: 'ellipse' },
  method: { color: '#5aa2ff', shape: 'ellipse' },
  class: { color: '#ff8fb1', shape: 'rectangle' },
  variable: { color: '#7dd3a8', shape: 'round-tag' },
  type: { color: '#9aa7b4', shape: 'tag' },
};
const EDGE_COLOR: Record<string, string> = { imports: '#4a5b6b', calls: '#5aa2ff', renders: '#33e1ff', references: '#7d8fa0', tests: '#c79a2b', exports: '#3a4856' };

/** Barcha elementlar ko'rinish chegarasi ichidami? (test va diagnostika uchun `data-inview` ga yoziladi) */
function markView(c: cytoscape.Core, node: HTMLElement | null): void {
  if (!node || !c.elements().length) return;
  const bb = c.elements().renderedBoundingBox({ includeLabels: false });
  const ok = bb.x1 >= -1 && bb.y1 >= -1 && bb.x2 <= c.width() + 1 && bb.y2 <= c.height() + 1;
  node.dataset.inview = String(ok);
}

/** Sig'dirish, lekin kichik grafni haddan tashqari kattalashtirmaslik */
function fitCapped(c: cytoscape.Core): void {
  c.fit(undefined, 28);
  if (c.zoom() > 1.1) {
    c.zoom(1.1);
    c.center();
  }
}

export const LEGEND = Object.entries(KIND_STYLE).map(([k, v]) => ({ kind: k, color: v.color }));

interface Props {
  nodes: GNode[];
  edges: GEdge[];
  focusId?: string;
  layout?: 'concentric' | 'cose' | 'breadthfirst' | 'chain';
  onSelect?: (id: string) => void;
  height?: number | string;
}

export function GraphView({ nodes, edges, focusId, layout = 'concentric', onSelect, height = '100%' }: Props) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const cy = useRef<cytoscape.Core | null>(null);
  const onSel = useRef(onSelect);
  onSel.current = onSelect;
  /** Foydalanuvchi o'zi surgan/zoom qilgan bo'lsa, panel o'lchami o'zgarganda qayta "fit" qilmaymiz */
  const moved = useRef(false);

  useEffect(() => {
    if (!el.current) return;
    const c = cytoscape({
      container: el.current,
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.25,
      style: [
        { selector: 'node', style: { label: 'data(label)', 'font-size': 10, color: '#d7e3ee', 'text-valign': 'bottom', 'text-margin-y': 4, 'text-outline-color': '#0b0f14', 'text-outline-width': 2, width: 22, height: 22, 'background-color': 'data(color)', shape: 'data(shape)' as never, 'border-width': 1, 'border-color': '#0b0f14', 'text-max-width': '120px', 'text-wrap': 'ellipsis' } },
        { selector: 'node[?center]', style: { width: 36, height: 36, 'border-width': 3, 'border-color': '#33e1ff', 'font-weight': 700, 'underlay-color': '#33e1ff', 'underlay-opacity': 0.22, 'underlay-padding': 12, 'underlay-shape': 'ellipse' } },
        { selector: 'node[?hot]', style: { 'border-width': 3, 'border-color': '#ff6b6b' } },
        { selector: '.dim', style: { opacity: 0.18 } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#ffffff' } },
        { selector: 'edge', style: { width: 1.3, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, 'curve-style': 'bezier', opacity: 0.8 } },
        { selector: 'edge[conf = "possible"]', style: { 'line-style': 'dashed' } },
        { selector: 'edge[?hot]', style: { width: 3, opacity: 1, 'line-color': '#ff6b6b', 'target-arrow-color': '#ff6b6b' } },
      ],
    });
    c.on('tap', 'node', (e) => onSel.current?.(e.target.id()));
    // hover: tugun va qo'shnilarini yoritadi, qolganini xiralashtiradi
    c.on('mouseover', 'node', (e) => {
      const keep = e.target.closedNeighborhood();
      c.elements().not(keep).addClass('dim');
      if (el.current) el.current.style.cursor = 'pointer';
    });
    c.on('mouseout', 'node', () => {
      c.elements().removeClass('dim');
      if (el.current) el.current.style.cursor = '';
    });
    cy.current = c;
    const node = el.current;
    const mark = () => { moved.current = true; };
    node.addEventListener('wheel', mark, { passive: true });
    node.addEventListener('pointerdown', mark);
    // Panel kengligi o'zgarganda canvas o'lchamini yangilaymiz (aks holda cytoscape eski o'lchamda chizadi)
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      c.resize();
      markView(c, node);
      clearTimeout(t);
      t = setTimeout(() => {
        if (!moved.current && c.elements().length) fitCapped(c);
        markView(c, node);
      }, 120);
    });
    ro.observe(node);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      node.removeEventListener('wheel', mark);
      node.removeEventListener('pointerdown', mark);
      c.destroy();
      cy.current = null;
    };
  }, []);

  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    c.batch(() => {
      c.elements().remove();
      c.add([
        ...nodes.map((n) => ({ group: 'nodes' as const, data: { id: n.id, label: n.label, kind: n.kind, dist: n.dist ?? 0, center: n.id === focusId, hot: !!n.hot, color: KIND_STYLE[n.kind]?.color ?? '#888', shape: KIND_STYLE[n.kind]?.shape ?? 'ellipse' } })),
        ...edges.map((e) => ({ group: 'edges' as const, data: { id: e.id, source: e.source, target: e.target, kind: e.kind, conf: e.conf, hot: !!e.hot, color: EDGE_COLOR[e.kind] ?? '#555' } })),
      ]);
    });
    const big = nodes.length > 90;
    const l =
      layout === 'chain'
        ? { name: 'preset', positions: (n: cytoscape.NodeSingular) => ({ x: 0, y: nodes.findIndex((x) => x.id === n.id()) * 74 }), animate: false, padding: 24 }
        : layout === 'breadthfirst'
          ? { name: 'breadthfirst', directed: true, padding: 24, spacingFactor: 1.6, nodeDimensionsIncludeLabels: true, animate: false }
        : layout === 'cose' || big
          ? { name: 'cose', animate: false, padding: 20, nodeRepulsion: () => 9000, idealEdgeLength: () => 70 }
          : { name: 'concentric', animate: false, padding: 20, minNodeSpacing: 28, concentric: (n: cytoscape.NodeSingular) => 10 - (n.data('dist') as number), levelWidth: () => 1 };
    c.layout(l as cytoscape.LayoutOptions).run();
    moved.current = false;
    fitCapped(c);
    markView(c, el.current);
  }, [nodes, edges, focusId, layout]);

  return (
    <div className="graph-wrap" style={{ height }}>
      <div ref={el} className="graph" role="img" aria-label={t('graph.aria')} data-testid="graph-canvas" data-nodes={nodes.length} data-edges={edges.length} />
      <div className="graph-tools">
        <button onClick={() => { moved.current = false; if (cy.current) fitCapped(cy.current); }} title={t('graph.fit')}>⤢</button>
        <button onClick={() => cy.current?.zoom({ level: (cy.current?.zoom() ?? 1) * 1.3, renderedPosition: { x: (el.current?.clientWidth ?? 0) / 2, y: (el.current?.clientHeight ?? 0) / 2 } })} title={t('graph.zoomIn')}>＋</button>
        <button onClick={() => cy.current?.zoom({ level: (cy.current?.zoom() ?? 1) / 1.3, renderedPosition: { x: (el.current?.clientWidth ?? 0) / 2, y: (el.current?.clientHeight ?? 0) / 2 } })} title={t('graph.zoomOut')}>－</button>
      </div>
    </div>
  );
}

export const nodeLabel = (n: { kind: string; name: string }) => n.name;
