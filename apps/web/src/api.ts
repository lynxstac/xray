import { currentLang } from './i18n.tsx';

const KEY = 'xray-token';

/** Token URL'da keladi (?token=...) — sessionStorage'ga olib, manzildan olib tashlaymiz. */
export function initToken(): void {
  try {
    const u = new URL(location.href);
    const t = u.searchParams.get('token');
    if (t) {
      sessionStorage.setItem(KEY, t);
      u.searchParams.delete('token');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    }
  } catch {
    /* sessionStorage yo'q bo'lishi mumkin */
  }
}

function token(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-xray-token': token(), 'x-xray-lang': currentLang(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* JSON emas */
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const q = encodeURIComponent;
