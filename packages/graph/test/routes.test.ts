import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { buildGraphFromDisk, routeForFile } from '@xray/graph';

const next = path.resolve(import.meta.dirname, '../../../fixtures/next-app');
const react = path.resolve(import.meta.dirname, '../../../fixtures/react-app');

describe('routeForFile (pure path convention)', () => {
  it('app router: groups and slots vanish from the URL, dynamic segments stay', () => {
    expect(routeForFile('app/(marketing)/about/page.tsx', '')).toEqual({ path: '/about', role: 'page', router: 'app' });
    expect(routeForFile('src/app/dashboard/[slug]/page.tsx', '')).toEqual({ path: '/dashboard/[slug]', role: 'page', router: 'app' });
    expect(routeForFile('app/shop/[...all]/page.tsx', '')?.path).toBe('/shop/[...all]');
    expect(routeForFile('app/@modal/photo/page.tsx', '')?.path).toBe('/photo');
    expect(routeForFile('app/layout.tsx', '')).toEqual({ path: '/', role: 'layout', router: 'app' });
    expect(routeForFile('app/api/x/route.ts', '')).toEqual({ path: '/api/x', role: 'route-handler', router: 'app' });
    expect(routeForFile('app/components/Button.tsx', '')).toBeUndefined(); // app/ ichidagi oddiy fayl marshrut emas
  });
  it('pages router: index collapses, api/_app special', () => {
    expect(routeForFile('pages/index.tsx', '')?.path).toBe('/');
    expect(routeForFile('pages/blog/index.tsx', '')?.path).toBe('/blog');
    expect(routeForFile('pages/api/hello.ts', '')).toMatchObject({ path: '/api/hello', role: 'api' });
    expect(routeForFile('pages/_app.tsx', '')).toMatchObject({ role: 'app', path: '*' });
  });
  it('monorepo: path is relative to the nearest Next.js root', () => {
    expect(routeForFile('apps/web/app/about/page.tsx', 'apps/web')?.path).toBe('/about');
    expect(routeForFile('apps/web/middleware.ts', 'apps/web')?.role).toBe('middleware');
  });
});

describe('route nodes in a real graph', () => {
  it('Next.js fixture: exactly the hand-written route table', async () => {
    const { graph } = await buildGraphFromDisk(next);
    const table = graph.files().filter((n) => n.route).map((n) => `${n.file} => ${n.route!.router}:${n.route!.role}:${n.route!.path}`).sort();
    expect(table).toEqual([
      'app/(marketing)/about/page.tsx => app:page:/about',
      'app/api/ping/route.ts => app:route-handler:/api/ping',
      'app/dashboard/[slug]/page.tsx => app:page:/dashboard/[slug]',
      'app/dashboard/layout.tsx => app:layout:/dashboard',
      'app/dashboard/page.tsx => app:page:/dashboard',
      'app/layout.tsx => app:layout:/',
      'app/page.tsx => app:page:/',
      'middleware.ts => app:middleware:*',
      'pages/_app.tsx => pages:app:*',
      'pages/api/hello.ts => pages:api:/api/hello',
      'pages/legacy.tsx => pages:page:/legacy',
    ]);
  });

  it('a NON-Next repo with src/pages/ (React Router style) gets no routes', async () => {
    const { graph } = await buildGraphFromDisk(react); // fixtures/react-app has src/pages/*.tsx and no `next`
    expect(graph.files().filter((n) => n.route)).toEqual([]);
  });
});
