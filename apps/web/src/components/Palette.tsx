import { useEffect, useMemo, useRef, useState } from 'react';
import { api, q } from '../api.ts';
import { useI18n } from '../i18n.tsx';

export interface Command { id: string; label: string; group: string; hint?: string; run: () => void }
interface Brief { id: string; name: string; kind: string; file: string }

/** Ctrl/⌘+K: bo'limlarga o'tish, amallar va symbol qidiruvi bitta oynada. */
export function Palette({ commands, onSymbol, onClose }: { commands: Command[]; onSymbol: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [syms, setSyms] = useState<Brief[]>([]);
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const needle = text.trim().toLowerCase();
  useEffect(() => {
    if (needle.length < 2) { setSyms([]); return; }
    let live = true;
    const h = setTimeout(() => {
      api<{ results: Brief[] }>(`/api/search?q=${q(needle)}`).then((r) => live && setSyms(r.results.slice(0, 8))).catch(() => live && setSyms([]));
    }, 150);
    return () => { live = false; clearTimeout(h); };
  }, [needle]);

  const rows = useMemo(() => {
    const cs = commands.filter((c) => !needle || c.label.toLowerCase().includes(needle)).map((c) => ({ key: c.id, label: c.label, group: c.group, hint: c.hint, run: c.run }));
    const ss = syms.map((s) => ({ key: s.id, label: s.name, group: t('pal.symbols'), hint: `${s.kind} · ${s.file}`, run: () => onSymbol(s.id) }));
    return [...cs, ...ss];
  }, [commands, syms, needle, onSymbol, t]);
  useEffect(() => setIdx(0), [needle, syms.length]);

  const go = (i: number) => { const r = rows[i]; if (r) { onClose(); r.run(); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  useEffect(() => { document.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' }); }, [idx]);

  let last = '';
  return (
    <div className="overlay" onMouseDown={onClose} data-testid="palette">
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('pal.title')} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('pal.ph')} aria-label={t('pal.title')} data-testid="palette-input" />
        <div className="pal-list" role="listbox">
          {rows.length === 0 && <div className="empty small">{t('pal.empty')}</div>}
          {rows.map((r, i) => {
            const head = r.group !== last ? <div className="pal-group">{r.group}</div> : null;
            last = r.group;
            return (
              <div key={r.key}>
                {head}
                <button role="option" aria-selected={i === idx} className={`pal-row${i === idx ? ' on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => go(i)}>
                  <span>{r.label}</span>{r.hint && <span className="muted small pal-hint">{r.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Shortcuts({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const rows: [string, string][] = [['Ctrl/⌘ K', t('sc.palette')], ['Alt 1–4', t('sc.tabs')], ['Ctrl/⌘ Enter', t('sc.run')], ['?', t('sc.help')], ['Esc', t('sc.esc')]];
  return (
    <div className="overlay" onMouseDown={onClose} data-testid="shortcuts">
      <div className="palette shortcuts" role="dialog" aria-modal="true" aria-label={t('sc.title')} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t('sc.title')}</h3>
        <table><tbody>{rows.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
