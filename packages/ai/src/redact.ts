/** Tashqi provayderga ketadigan matndan maxfiy qiymatlarni olib tashlaydi. Soxta-salbiy bo'lishi mumkin — bu yaxshi tomon xato. */
const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED:private-key]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED:api-key]'],
  [/\bghp_[A-Za-z0-9]{30,}\b/g, '[REDACTED:github-token]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED:slack-token]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED:google-key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED:jwt]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, (_m, a = '', _b, c = '') => `${a}[REDACTED:password]${c}`],
  [
    /((?:api[_-]?key|secret|token|passw(?:or)?d|auth(?:orization)?|private[_-]?key)[A-Za-z0-9_]*['"`]?\s*[:=]\s*)(['"`])([^'"`\n]{8,})\2/gi,
    (_m, k = '', q = '') => `${k}${q}[REDACTED:secret]${q}`,
  ],
];

export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [re, rep] of RULES) {
    out = out.replace(re, (...args: unknown[]) => {
      count++;
      return typeof rep === 'string' ? rep : rep(...(args as string[]));
    });
  }
  return { text: out, count };
}
