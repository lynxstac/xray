import { useI18n } from '../i18n.tsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

/**
 * Chap/o'ng yon panelli, o'lchami o'zgaradigan maket.
 *  - sichqoncha bilan sudrash (pointer capture), klaviatura: ← → (Shift = katta qadam), Home = asl o'lcham, Enter = yig'ish;
 *  - ikki marta bosish — asl o'lcham; panelni yig'ish/ochish;
 *  - o'lchamlar localStorage'da saqlanadi (ixtiyoriy qulaylik — bo'lmasa ham ishlaydi);
 *  - markaz hech qachon MIN_CENTER dan torayib ketmaydi;
 *  - tor ekranda (< NARROW) panellar yo'qolmaydi, balki yopiladigan "drawer" bo'ladi.
 */

const MIN_CENTER = 340;
const NARROW = 900;
const HANDLE = 8;

interface Props {
  id: string;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  leftTitle?: string;
  rightTitle?: string;
  leftDefault?: number;
  rightDefault?: number;
  leftRange?: [number, number];
  rightRange?: [number, number];
  /** O'zgarsa, tor ekranda o'ng drawer avtomatik ochiladi (masalan, element tanlanganda) */
  openRightSignal?: unknown;
  /** Tor ekranda birinchi ko'rinishda qaysi drawer ochiq bo'lsin */
  initialDrawer?: 'l' | 'r';
  /** O'zgarsa, tor ekranda ochiq drawer yopiladi (masalan, chap ro'yxatdan element tanlanganda) */
  closeSignal?: unknown;
}

interface Saved { l: number; r: number; lc: boolean; rc: boolean }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function load(id: string, d: Saved): Saved {
  try {
    const raw = localStorage.getItem(`xray-split-${id}`);
    if (!raw) return d;
    const j = JSON.parse(raw) as Partial<Saved>;
    return { l: Number(j.l) || d.l, r: Number(j.r) || d.r, lc: !!j.lc, rc: !!j.rc };
  } catch {
    return d;
  }
}

export function SplitLayout({ id, left, right, children, leftTitle = 'Panel', rightTitle = 'Details', leftDefault = 300, rightDefault = 380, leftRange = [220, 560], rightRange = [280, 720], openRightSignal, initialDrawer, closeSignal }: Props) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(1200);
  const [s, setS] = useState<Saved>(() => load(id, { l: leftDefault, r: rightDefault, lc: false, rc: false }));
  const [drag, setDrag] = useState<null | 'l' | 'r'>(null);
  const [drawer, setDrawer] = useState<null | 'l' | 'r'>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(`xray-split-${id}`, JSON.stringify(s));
    } catch {
      /* ixtiyoriy */
    }
  }, [id, s]);

  const narrow = W < NARROW;
  const wasNarrow = useRef(false);
  useEffect(() => {
    if (narrow && openRightSignal !== undefined && right) setDrawer('r');
  }, [openRightSignal, narrow, right]);
  useEffect(() => {
    if (narrow && !wasNarrow.current) setDrawer(initialDrawer ?? null);
    if (!narrow) setDrawer(null);
    wasNarrow.current = narrow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow]);
  const firstClose = useRef(true);
  useEffect(() => {
    if (firstClose.current) {
      firstClose.current = false;
      return;
    }
    if (narrow) setDrawer((d) => (d === 'l' ? null : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSignal]);

  // Joriy kengliklar: markaz MIN_CENTER dan kichik bo'lmasligi uchun avval o'ng, keyin chap qisqartiriladi.
  const hasL = !!left;
  const hasR = !!right;
  const lw = hasL && !s.lc ? clamp(s.l, leftRange[0], leftRange[1]) : 0;
  let rw = hasR && !s.rc ? clamp(s.r, rightRange[0], rightRange[1]) : 0;
  let lwe = lw;
  const room = W - MIN_CENTER - (lwe ? HANDLE : 0) - (rw ? HANDLE : 0);
  if (lwe + rw > room) {
    rw = rw ? Math.max(rightRange[0], room - lwe) : 0;
    if (lwe + rw > room) lwe = lwe ? Math.max(leftRange[0], room - rw) : 0;
  }

  const startDrag = (side: 'l' | 'r') => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = side === 'l' ? lwe : rw;
    setDrag(side);
    const move = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - x0;
      const next = side === 'l' ? w0 + dx : w0 - dx;
      setS((p) => (side === 'l' ? { ...p, l: clamp(next, leftRange[0], leftRange[1]) } : { ...p, r: clamp(next, rightRange[0], rightRange[1]) }));
    };
    const up = () => {
      setDrag(null);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const onKey = (side: 'l' | 'r') => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dir) {
      e.preventDefault();
      setS((p) => (side === 'l' ? { ...p, l: clamp(lwe + dir * step, leftRange[0], leftRange[1]) } : { ...p, r: clamp(rw - dir * step, rightRange[0], rightRange[1]) }));
    } else if (e.key === 'Home') {
      e.preventDefault();
      reset(side);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      toggle(side);
    }
  };

  const reset = useCallback((side: 'l' | 'r') => setS((p) => (side === 'l' ? { ...p, l: leftDefault } : { ...p, r: rightDefault })), [leftDefault, rightDefault]);
  const toggle = (side: 'l' | 'r') => setS((p) => (side === 'l' ? { ...p, lc: !p.lc } : { ...p, rc: !p.rc }));

  const handle = (side: 'l' | 'r', w: number, range: [number, number]) => (
    <div
      className={`handle${drag === side ? ' on' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('split.width', { title: side === 'l' ? leftTitle : rightTitle })}
      aria-valuemin={range[0]}
      aria-valuemax={range[1]}
      aria-valuenow={Math.round(w)}
      tabIndex={0}
      data-testid={`handle-${side}`}
      title={t('split.handleTitle')}
      onPointerDown={startDrag(side)}
      onDoubleClick={() => reset(side)}
      onKeyDown={onKey(side)}
    />
  );

  const paneHead = (side: 'l' | 'r', title: string) => (
    <div className="pane-h">
      <span>{title}</span>
      <button className="icon" onClick={() => (narrow ? setDrawer(null) : toggle(side))} aria-label={t('split.collapse', { title })} title={t('common.close')}>{side === 'l' ? '«' : '»'}</button>
    </div>
  );

  if (narrow) {
    return (
      <div className="split narrow" ref={root} data-testid={`split-${id}`}>
        <div className="center">
          <div className="drawer-toggles">
            {hasL && <button onClick={() => setDrawer(drawer === 'l' ? null : 'l')} aria-expanded={drawer === 'l'} data-testid="toggle-left">☰ {leftTitle}</button>}
            {hasR && <button onClick={() => setDrawer(drawer === 'r' ? null : 'r')} aria-expanded={drawer === 'r'} data-testid="toggle-right">ⓘ {rightTitle}</button>}
          </div>
          {children}
        </div>
        {drawer && <div className="backdrop" onClick={() => setDrawer(null)} />}
        {hasL && drawer === 'l' && <aside className="pane drawer l" style={{ width: `min(92%, ${Math.max(leftDefault, 320)}px)` }}>{paneHead('l', leftTitle)}<div className="pane-b">{left}</div></aside>}
        {hasR && drawer === 'r' && <aside className="pane drawer r" style={{ width: `min(94%, ${Math.max(rightDefault, 380)}px)` }}>{paneHead('r', rightTitle)}<div className="pane-b">{right}</div></aside>}
      </div>
    );
  }

  const cols = [hasL ? `${lwe}px ${lwe ? HANDLE : 0}px` : '', 'minmax(0,1fr)', hasR ? `${rw ? HANDLE : 0}px ${rw}px` : ''].filter(Boolean).join(' ');
  return (
    <div className={`split${drag ? ' dragging' : ''}`} ref={root} style={{ gridTemplateColumns: cols }} data-testid={`split-${id}`}>
      {hasL && (lwe ? <aside className="pane l" data-testid="pane-left">{paneHead('l', leftTitle)}<div className="pane-b">{left}</div></aside> : <div />)}
      {hasL && (lwe ? handle('l', lwe, leftRange) : <div />)}
      <div className="center">
        {hasL && s.lc && <button className="edge-btn l" onClick={() => toggle('l')} aria-label={t('split.expand', { title: leftTitle })} title={leftTitle}>»</button>}
        {hasR && s.rc && <button className="edge-btn r" onClick={() => toggle('r')} aria-label={t('split.expand', { title: rightTitle })} title={rightTitle}>«</button>}
        {children}
      </div>
      {hasR && (rw ? handle('r', rw, rightRange) : <div />)}
      {hasR && (rw ? <aside className="pane r" data-testid="pane-right">{paneHead('r', rightTitle)}<div className="pane-b">{right}</div></aside> : <div />)}
    </div>
  );
}
