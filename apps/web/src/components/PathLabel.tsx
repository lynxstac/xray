/**
 * Fayl yo'li: katalog qismi CHAPDAN qisqartiriladi (…/components/ui/), fayl nomi va satr doim ko'rinadi.
 * To'liq yo'l `title`da.
 */
export function PathLabel({ file, line }: { file: string; line?: number }) {
  const i = file.lastIndexOf('/');
  const dir = i >= 0 ? file.slice(0, i + 1) : '';
  const base = file.slice(i + 1);
  return (
    <span className="plabel" title={`${file}${line ? `:${line}` : ''}`}>
      {dir && <span className="p-dir"><bdi>{dir}</bdi></span>}
      <span className="p-base">{base}{line ? `:${line}` : ''}</span>
    </span>
  );
}
