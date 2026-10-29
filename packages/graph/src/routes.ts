import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RouteInfo } from '@xray/core';

/**
 * Next.js yashirin ulanishlari: sahifa/layout/route handler fayllarini import qiluvchi yo'q — framework chaqiradi.
 * Bu modul fayl yo'lidan marshrutni (App Router va Pages Router) aniqlaydi. Hech narsa bajarilmaydi, faqat yo'l konventsiyasi.
 * Faqat Next.js loyihasi (package.json'da `next` yoki next.config.*) ichida qo'llanadi — aks holda `src/pages/` kabi
 * papkalar (React Router loyihalarida keng tarqalgan) noto'g'ri marshrut deb olinardi.
 */

const APP_ROLES: Record<string, RouteInfo['role']> = {
  page: 'page', layout: 'layout', template: 'template', loading: 'loading', error: 'error',
  'global-error': 'global-error', 'not-found': 'not-found', default: 'default', route: 'route-handler',
};
const EXT = /\.[cm]?[jt]sx?$/;

/** Next.js loyihasi ildizlari (repo ichidagi nisbiy papkalar; '' = repo ildizi). */
export async function detectNextRoots(root: string, files: readonly string[]): Promise<string[]> {
  const dirs = new Set<string>(['']);
  for (const f of files) {
    let d = path.posix.dirname(f);
    while (d !== '.' && !dirs.has(d)) {
      dirs.add(d);
      d = path.posix.dirname(d);
    }
  }
  const out: string[] = [];
  for (const d of [...dirs].sort()) {
    const abs = path.join(root, d);
    let isNext = false;
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(abs, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      isNext = !!(pkg.dependencies?.next ?? pkg.devDependencies?.next);
    } catch {
      /* package.json yo'q yoki buzuq */
    }
    if (!isNext) {
      try {
        isNext = (await fs.readdir(abs)).some((n) => /^next\.config\.(js|mjs|cjs|ts)$/.test(n));
      } catch {
        /* o'qib bo'lmadi */
      }
    }
    if (isNext) out.push(d);
  }
  return out;
}

export function nearestNextRoot(file: string, roots: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const r of roots) {
    if ((r === '' || file.startsWith(r + '/')) && (best === undefined || r.length > best.length)) best = r;
  }
  return best;
}

const cleanSegs = (segs: string[]) => segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@')); // (group) va @slot URL'da yo'q

/** Fayl yo'li (repo'ga nisbatan) va uning Next.js ildizi bo'yicha marshrut. Marshrut fayli bo'lmasa undefined. */
export function routeForFile(file: string, nextRoot: string): RouteInfo | undefined {
  const rel = nextRoot ? file.slice(nextRoot.length + 1) : file;
  if (!EXT.test(rel)) return undefined;
  const base = rel.replace(EXT, '');

  if (['middleware', 'src/middleware', 'proxy', 'src/proxy'].includes(base)) return { path: '*', role: 'middleware', router: 'app' };

  for (const dir of ['src/app', 'app']) {
    if (!base.startsWith(dir + '/')) continue;
    const segs = base.slice(dir.length + 1).split('/');
    const name = segs.pop()!;
    const role = APP_ROLES[name];
    if (!role) return undefined;
    return { path: '/' + cleanSegs(segs).join('/'), role, router: 'app' };
  }

  for (const dir of ['src/pages', 'pages']) {
    if (!base.startsWith(dir + '/')) continue;
    const segs = base.slice(dir.length + 1).split('/');
    const last = segs[segs.length - 1]!;
    if (last === '_app') return { path: '*', role: 'app', router: 'pages' };
    if (last === '_document') return { path: '*', role: 'document', router: 'pages' };
    if (last === '_error') return { path: '*', role: 'error', router: 'pages' };
    if (last === 'index') segs.pop();
    return { path: '/' + segs.join('/'), role: segs[0] === 'api' ? 'api' : 'page', router: 'pages' };
  }
  return undefined;
}

/** Marshrutga olib boruvchi fayllar (sahifalar/handlerlar) — layout/middleware'dan farqli. */
export const isLeafRoute = (r: RouteInfo) => r.role === 'page' || r.role === 'route-handler' || r.role === 'api';
/** Ota-bobo qatlamlar: o'z papkasi ostidagi hamma marshrutga ta'sir qiladi */
export const isScopeRoute = (r: RouteInfo) => ['layout', 'template', 'loading', 'error', 'global-error', 'not-found', 'default', 'middleware', 'app', 'document'].includes(r.role);

export interface WorkspacePackage {
  name: string;
  /** repo ildiziga nisbatan papka (POSIX) */
  dir: string;
}

/**
 * Monorepo workspace paketlari: `package.json`dagi `name` -> papka. `node_modules`ga (o'rnatishga) tayanmaymiz:
 * paket `main/types`i ko'pincha `dist`ga (build natijasi) ishora qiladi, manba esa `src`da.
 */
export async function detectWorkspacePackages(root: string, files: readonly string[]): Promise<WorkspacePackage[]> {
  const dirs = new Set<string>();
  for (const f of files) {
    let d = path.posix.dirname(f);
    while (d !== '.' && !dirs.has(d)) {
      dirs.add(d);
      d = path.posix.dirname(d);
    }
  }
  const out: WorkspacePackage[] = [];
  const seen = new Set<string>();
  for (const d of [...dirs].sort()) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, d, 'package.json'), 'utf8')) as { name?: unknown };
      if (typeof pkg.name === 'string' && /^(@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/.test(pkg.name) && !seen.has(pkg.name)) {
        seen.add(pkg.name);
        out.push({ name: pkg.name, dir: d });
      }
    } catch {
      /* package.json yo'q yoki buzuq */
    }
  }
  return out;
}
