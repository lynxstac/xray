import { Fragment, useState } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { SourceView } from '../SourceView.tsx';
import type { AppState, AskResult } from '../types.ts';

const CITE = /(\[[^\[\]\s:]+:\d+(?:-\d+)?\])/g;

export function AskScreen({ ai, onAiChanged }: { ai: AppState['ai']; onAiChanged: () => void }) {
  const { t, rich } = useI18n();
  const [question, setQuestion] = useState('');
  const [dry, setDry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<AskResult | null>(null);
  const [view, setView] = useState<{ file: string; from: number; to: number } | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    setView(null);
    try {
      setRes(await api<AskResult>('/api/ask', { question, dryRun: dry }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderAnswer = (r: AskResult) =>
    (r.answer ?? '').split(CITE).map((part, i) => {
      const c = r.citations.find((x) => x.raw === part);
      if (!c) return <Fragment key={i}>{part}</Fragment>;
      return (
        <button key={i} className={c.valid ? 'cite ok' : 'cite bad'} title={c.valid ? t('ask.citeOk') : t('ask.citeBad', { problem: c.problem ?? '' })} disabled={!c.valid} onClick={() => setView({ file: c.file, from: c.startLine, to: c.endLine })}>
          {part}
        </button>
      );
    });

  return (
    <div className="ask scroll">
      <h2>{t('ask.title')}</h2>
      <p className="muted">{t('ask.intro')}</p>
      <div className={ai.ready ? 'note ok' : 'note'} data-testid="ai-status">
        {ai.ready ? <>{rich('ask.aiOn', { provider: ai.provider ?? '', model: ai.model ?? '' })}</> : <>{t('ask.aiOff')} <span className="muted">({ai.reason})</span></>}
      </div>
      <textarea aria-label={t('ask.questionLabel')} data-testid="question" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('ask.questionPh')} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && question.trim() && !busy) void submit(); }} />
      <div className="row">
        <button className="primary" disabled={busy || !question.trim()} onClick={() => void submit()} data-testid="ask-btn">{busy ? t('ask.searching') : t('ask.submit')}</button>
        {ai.ready && <label className="chk"><input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} />{t('ask.dryLabel')}</label>}
      </div>
      {err && <div className="note err" role="alert">{err}</div>}

      {res && (
        <div data-testid="ask-result">
          {res.mode === 'ai' && res.answer && (
            <div className="answer" data-testid="answer">
              <div>{renderAnswer(res)}</div>
              <div className="muted small">{t('ask.citeStats', { ok: res.citations.filter((c) => c.valid).length, bad: res.citations.filter((c) => !c.valid).length })}{res.unsupportedRate !== null && res.unsupportedRate > 0 ? t('ask.unsupported', { pct: (res.unsupportedRate * 100).toFixed(0) }) : ''}</div>
            </div>
          )}
          {res.mode === 'ai' && !res.answer && res.sent && <div className="note" data-testid="dry-run">{rich('ask.dryResult', { provider: res.sent.provider, model: res.sent.model, chunks: res.sent.chunks, chars: res.sent.chars, red: res.sent.redactions, files: res.sent.files.join(', ') })}</div>}
          {res.mode === 'evidence-only' && <div className="note" data-testid="evidence-only">{t('ask.evidenceOnly')}</div>}
          {res.sent && res.answer && <div className="muted small">{t('ask.sentLine', { provider: res.sent.provider, model: res.sent.model, files: res.sent.files.length, chars: res.sent.chars, red: res.sent.redactions })}</div>}

          {view && <SourceView file={view.file} from={view.from} to={view.to} />}

          <h3>{t('ask.evidence', { n: res.evidence.chunks.length })}</h3>
          {res.evidence.chunks.length === 0 && <div className="empty small" data-testid="no-evidence">{t('ask.noEvidence')}</div>}
          {res.evidence.chunks.map((c) => (
            <details key={c.id} className="chunk" open={res.evidence.chunks.indexOf(c) < 2}>
              <summary><code>{c.file}:{c.startLine}-{c.endLine}</code> {c.kind} <b>{c.name}</b> <span className="muted">— {c.why.join('; ')}</span></summary>
              <pre>{c.text}</pre>
            </details>
          ))}
          {res.evidence.facts.length > 0 && (
            <>
              <h3>{t('ask.facts')}</h3>
              <ul className="list">{res.evidence.facts.slice(0, 20).map((f, i) => <li key={i}>{f.text} <span className="muted">[{f.file}:{f.line}]</span></li>)}</ul>
            </>
          )}
        </div>
      )}

      {!ai.ready && <EnableAi onDone={onAiChanged} />}
    </div>
  );
}

function EnableAi({ onDone }: { onDone: () => void }) {
  const { t, rich } = useI18n();
  const [provider, setProvider] = useState<'anthropic' | 'openai-compatible'>('anthropic');
  const [model, setModel] = useState('claude-sonnet-5-5');
  const [envKey, setEnvKey] = useState('ANTHROPIC_API_KEY');
  const [baseUrl, setBaseUrl] = useState('');
  const [text, setText] = useState('');
  const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadText = async (p: typeof provider) => setText((await api<{ text: string }>(`/api/ai/consent-text?provider=${p}`)).text);

  return (
    <details className="enable" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void loadText(provider)}>
      <summary>{t('ask.enable')}</summary>
      <div className="stack">
        <label>{t('ask.provider')}
          <select value={provider} onChange={(e) => { const p = e.target.value as typeof provider; setProvider(p); setEnvKey(p === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'); setModel(p === 'anthropic' ? 'claude-sonnet-5-5' : ''); void loadText(p); }}>
            <option value="anthropic">{t('ask.optAnthropic')}</option>
            <option value="openai-compatible">{t('ask.optOpenai')}</option>
          </select>
        </label>
        <label>{t('ask.model')} <input value={model} onChange={(e) => setModel(e.target.value)} /></label>
        <label>{t('ask.keyEnv')} <input value={envKey} onChange={(e) => setEnvKey(e.target.value)} /></label>
        {provider === 'openai-compatible' && <label>Base URL <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:11434/v1" /></label>}
        <p className="muted small">{rich('ask.keyNote', { env: envKey })}</p>
        <blockquote data-testid="consent-text">{text}</blockquote>
        <label className="chk"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="consent-check" />{t('ask.consentCheck')}</label>
        <button disabled={!ok || !model || !text} onClick={async () => {
          try {
            await api('/api/ai/enable', { provider, model, apiKeyEnv: envKey, baseUrl, accepted: true, consentText: text });
            setMsg(t('ask.saved'));
            onDone();
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}>{t('ask.consentSave')}</button>
        {msg && <div className="note">{msg}</div>}
      </div>
    </details>
  );
}
