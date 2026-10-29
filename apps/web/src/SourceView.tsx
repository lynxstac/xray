import { useEffect, useState } from 'react';
import { api, q } from './api.ts';
import { useI18n } from './i18n.tsx';

interface Props {
  file: string;
  /** Ajratib ko'rsatiladigan satrlar */
  from: number;
  to?: number;
  context?: number;
}

export function SourceView({ file, from, to = from, context = 6 }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState<{ start: number; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const start = Math.max(1, from - context);
    const end = to + context + 4;
    setErr(null);
    api<{ start: number; text: string }>(`/api/source?file=${q(file)}&start=${start}&end=${end}`)
      .then((r) => alive && setText(r))
      .catch((e) => alive && setErr(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [file, from, to, context]);

  if (err) return <div className="note err">{t('src.failed', { err })}</div>;
  if (!text) return <div className="note">{t('src.loading')}</div>;
  const lines = text.text.split('\n');
  return (
    <div className="source" data-testid="source-view">
      <div className="source-head">{file}:{from}{to !== from ? `-${to}` : ''}</div>
      <pre>
        {lines.map((l, i) => {
          const n = text.start + i;
          const hot = n >= from && n <= to;
          return (
            <div key={n} className={hot ? 'ln hot' : 'ln'}>
              <span className="num">{n}</span>
              <span>{l || ' '}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
