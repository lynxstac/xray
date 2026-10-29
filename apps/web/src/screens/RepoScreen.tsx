import { useState } from 'react';
import { api } from '../api.ts';
import { useI18n, type UIKey } from '../i18n.tsx';
import type { RepoSummary } from '../types.ts';

const RECENT = 'xray-recent';
const recent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? '[]');
  } catch {
    return [];
  }
};
const remember = (p: string) => {
  try {
    localStorage.setItem(RECENT, JSON.stringify([p, ...recent().filter((x) => x !== p)].slice(0, 6)));
  } catch {
    /* ixtiyoriy qulaylik */
  }
};

export function RepoScreen({ repo, onOpened }: { repo: RepoSummary | null; onOpened: (r: RepoSummary) => void }) {
  const { t, rich } = useI18n();
  const [path, setPath] = useState(repo?.root ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = async (full = false) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<RepoSummary>('/api/open', { path: path.trim(), full });
      remember(r.root);
      onOpened(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen scroll">
      {!repo && (
        <section className="hero" data-testid="hero">
          <h1>{t('hero.title')}</h1>
          <p className="hero-sub">{t('hero.sub')}</p>
          <ul className="hero-points">
            <li><span className="hp-ic" aria-hidden>◈</span>{t('hero.p1')}</li>
            <li><span className="hp-ic" aria-hidden>⌖</span>{t('hero.p2')}</li>
            <li><span className="hp-ic" aria-hidden>◌</span>{t('hero.p3')}</li>
          </ul>
        </section>
      )}
      <h2>{t('repo.title')}</h2>
      <p className="muted">{rich('repo.intro')}</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void open(); }}>
        <input aria-label={t('repo.pathLabel')} data-testid="repo-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('repo.pathPh')} spellCheck={false} />
        <button className="primary" disabled={busy || !path.trim()} data-testid="open-repo">{busy ? t('repo.indexing') : t('repo.open')}</button>
      </form>
      {recent().length > 0 && (
        <div className="chips">
          {recent().map((r) => (
            <button key={r} className="chip" onClick={() => setPath(r)}>{r}</button>
          ))}
        </div>
      )}
      {err && <div className="note err" role="alert">{err}</div>}

      {!repo && !err && <div className="empty">{t('repo.none')}</div>}

      {repo && (
        <div data-testid="index-report">
          <div className="cards">
            <Card label={t('repo.files')} value={repo.stats.scanned} />
            <Card label={t('repo.nodes')} value={repo.stats.nodes} />
            <Card label={t('repo.edges')} value={repo.stats.edges} />
            <Card label={t('repo.unresolved')} value={repo.stats.unresolved} warn={repo.stats.unresolved > 0} />
            <Card label={t('repo.syntax')} value={repo.stats.withSyntaxErrors} warn={repo.stats.withSyntaxErrors > 0} />
          </div>
          <p className="muted" data-testid="index-mode">
            {rich('repo.modeLine', { mode: repo.stats.mode, reason: t(`repo.reason.${repo.stats.reasonCode}` as UIKey, repo.stats.reasonArgs), reparsed: repo.stats.reparsed, sem: repo.stats.semanticRecomputed, ms: repo.stats.ms })}
            <button className="link" onClick={() => void open(true)} disabled={busy}>{t('repo.full')}</button>
          </p>

          <div className="cols">
            <section>
              <h3>{t('repo.kinds')}</h3>
              <ul className="kv">{Object.entries(repo.kinds).map(([k, v]) => <li key={k}><span>{k}</span><b>{v}</b></li>)}</ul>
            </section>
            <section>
              <h3>{t('repo.skipped')} <span className="muted">{t('repo.notHidden')}</span></h3>
              {Object.keys(repo.skipped).length === 0 ? <p className="muted">{t('repo.nothing')}</p> : (
                <ul className="kv">{Object.entries(repo.skipped).map(([k, v]) => (
                  <li key={k} className="kv-block">
                    <details>
                      <summary><span>{t(`skip.${k}` as UIKey) === `skip.${k}` ? k : t(`skip.${k}` as UIKey)}</span><b>{v}</b></summary>
                      <ul className="list small" data-testid={`skipped-${k}`}>
                        {repo.skippedList.filter((x) => x.reason === k).slice(0, 50).map((x) => <li key={x.path}><code>{x.path}</code></li>)}
                        {v > 50 && <li className="muted">{t('repo.skipMore', { n: v - 50 })}</li>}
                      </ul>
                    </details>
                  </li>
                ))}</ul>
              )}
            </section>
            <section>
              <h3>{t('repo.unresolvedH')}</h3>
              {Object.keys(repo.unresolved).length === 0 ? <p className="muted">{t('common.none')}</p> : (
                <ul className="kv">{Object.entries(repo.unresolved).map(([k, v]) => <li key={k}><span>{k}</span><b>{v}</b></li>)}</ul>
              )}
            </section>
          </div>

          {repo.syntaxErrors.length > 0 && (
            <section>
              <h3>{t('repo.syntaxH')}</h3>
              <ul className="list">{repo.syntaxErrors.map((s) => <li key={s.file}><code>{s.file}:{s.line}</code> {s.first} <span className="muted">({s.count})</span></li>)}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={warn ? 'card warn' : 'card'}>
      <div className="card-v">{value.toLocaleString()}</div>
      <div className="card-l">{label}</div>
    </div>
  );
}
