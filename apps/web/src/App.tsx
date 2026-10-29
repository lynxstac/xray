import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.ts';
import { RepoScreen } from './screens/RepoScreen.tsx';
import { ExplorerScreen } from './screens/ExplorerScreen.tsx';
import { ImpactScreen } from './screens/ImpactScreen.tsx';
import { AskScreen } from './screens/AskScreen.tsx';
import { useI18n, type UIKey } from './i18n.tsx';
import { Palette, Shortcuts, type Command } from './components/Palette.tsx';
import type { AppState, RepoSummary } from './types.ts';

type Tab = 'repo' | 'explorer' | 'impact' | 'ask';
const TABS: { id: Tab; key: UIKey }[] = [
  { id: 'repo', key: 'nav.repo' },
  { id: 'explorer', key: 'nav.explorer' },
  { id: 'impact', key: 'nav.impact' },
  { id: 'ask', key: 'nav.ask' },
];

type Theme = 'dark' | 'light';
function initialTheme(): Theme {
  try { return localStorage.getItem('xray-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

export function App() {
  const { t, rich, lang, setLang } = useI18n();
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>('repo');
  const [focus, setFocus] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('xray-theme', theme); } catch { /* ixtiyoriy */ }
  }, [theme]);
  const toggleTheme = useCallback(() => setTheme((x) => (x === 'dark' ? 'light' : 'dark')), []);

  const refresh = useCallback(async () => {
    try {
      const s = await api<AppState>('/api/state');
      setState(s);
      return s;
    } catch (e) {
      setFatal((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh().then((s) => s?.repo && setTab('explorer'));
  }, [refresh]);

  const onOpened = (r: RepoSummary) => {
    setState((s) => (s ? { ...s, repo: r } : s));
    setFocus(null);
  };
  const openInExplorer = (id: string) => {
    setFocus(id);
    setTab('explorer');
  };

  const hasRepo0 = !!state?.repo;
  const goTab = useCallback((id: Tab) => { if (id === 'repo' || hasRepo0) setTab(id); }, [hasRepo0]);
  const runImpact = useCallback(() => {
    goTab('impact');
    setTimeout(() => window.dispatchEvent(new Event('xray:run-impact')), 60);
  }, [goTab]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement | null)?.tagName ?? '');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((x) => !x); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); window.dispatchEvent(new Event('xray:run-impact')); return; }
      if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); goTab(TABS[Number(e.key) - 1]!.id); return; }
      if (e.key === '?' && !typing) { e.preventDefault(); setHelp((x) => !x); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [goTab]);

  const commands = useMemo<Command[]>(() => [
    ...TABS.map((x, i) => ({ id: `go-${x.id}`, label: t(x.key), group: t('pal.go'), hint: `Alt ${i + 1}`, run: () => goTab(x.id) })),
    ...(hasRepo0 ? [{ id: 'run', label: t('cmd.run'), group: t('pal.actions'), hint: 'Ctrl+Enter', run: runImpact }] : []),
    { id: 'theme', label: t('cmd.theme'), group: t('pal.actions'), run: toggleTheme },
    { id: 'lang', label: t('cmd.lang'), group: t('pal.actions'), run: () => { setLang(lang === 'en' ? 'uz' : 'en'); void refresh(); } },
    { id: 'help', label: t('cmd.shortcuts'), group: t('pal.actions'), hint: '?', run: () => setHelp(true) },
  ], [t, goTab, hasRepo0, runImpact, toggleTheme, setLang, lang, refresh]);

  if (fatal) {
    return (
      <div className="fatal" role="alert">
        <h2>{t('app.fatalTitle')}</h2>
        <p>{fatal}</p>
        <p className="muted">{rich('app.fatalHint')}</p>
      </div>
    );
  }
  if (!state) return <div className="fatal">{t('app.loading')}</div>;
  const hasRepo = !!state.repo;

  return (
    <div className="app">
      <header className="top">
        <div className="logo"><svg viewBox="0 0 32 32" width="22" height="22" aria-hidden><rect width="32" height="32" rx="8" fill="#0b0f14" stroke="#33e1ff" strokeOpacity=".55"/><path d="M6 16h5l3-8 4 16 3-8h5" fill="none" stroke="#33e1ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg><span>X</span>-RAY</div>
        <nav role="tablist">
          {TABS.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} disabled={x.id !== 'repo' && !hasRepo} className={tab === x.id ? 'tab on' : 'tab'} onClick={() => setTab(x.id)} data-testid={`tab-${x.id}`}>{t(x.key)}</button>
          ))}
        </nav>
        <div className="grow" />
        {state.repo && <span className="pill" title={state.repo.root}>{state.repo.root.split('/').slice(-2).join('/')}</span>}
        <span className={state.ai.ready ? 'pill ai on' : 'pill ai'} title={state.ai.reason ?? ''}>{state.ai.ready ? t('app.aiOn', { provider: state.ai.provider ?? '' }) : t('app.aiOff')}</span>
        <button className="icon kbd-btn" onClick={() => setPalette(true)} title={t('pal.title')} aria-label={t('pal.title')} data-testid="open-palette"><kbd>Ctrl K</kbd></button>
        <button className="icon theme-btn" onClick={toggleTheme} title={t('theme.toggle')} aria-label={t('theme.toggle')} data-testid="theme-toggle">{theme === 'dark' ? '☾' : '☀'}</button>
        <div className="seg lang" role="group" aria-label={t('app.lang')} data-testid="lang-switch">
          {(['en', 'uz'] as const).map((l) => (
            <button key={l} className={lang === l ? 'on' : ''} aria-pressed={lang === l} onClick={() => { setLang(l); void refresh(); }} data-testid={`lang-${l}`}>{l.toUpperCase()}</button>
          ))}
        </div>
      </header>
      <div className="body">
        {tab === 'repo' && <RepoScreen repo={state.repo} onOpened={onOpened} />}
        {tab === 'explorer' && hasRepo && <ExplorerScreen focusId={focus} onFocus={setFocus} />}
        {tab === 'impact' && hasRepo && <ImpactScreen onOpenInExplorer={openInExplorer} />}
        {tab === 'ask' && hasRepo && <AskScreen ai={state.ai} onAiChanged={() => void refresh()} />}
      </div>
      {palette && <Palette commands={commands} onSymbol={openInExplorer} onClose={() => setPalette(false)} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </div>
  );
}
