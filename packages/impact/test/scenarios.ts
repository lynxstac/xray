import type { Repo } from './helpers.ts';

/**
 * Qo'lda hisoblangan ground truth (fixtures/react-app/expected-graph.json dagi bog'lanishlardan chiqarilgan).
 * Natija generatsiya qilinmagan — har bir kutilgan ro'yxat graph'ga qarab qo'lda yozilgan.
 */
export interface Scenario {
  name: string;
  mutate: (r: Repo) => Promise<void>;
  direct: string[];
  indirect: string[];
  tests: string[];
}

export const scenarios: Scenario[] = [
  {
    name: 'S1 body-only change of private helper `request` (depth cap 2)',
    mutate: (r) => r.edit('src/lib/api.ts', (s) => s.replace('r.json())', 'r.json()).catch(() => null)')),
    direct: ['src/lib/api.ts#fetchArticle', 'src/lib/api.ts#fetchArticles'],
    indirect: ['src/hooks/useArticle.ts#useArticle', 'src/hooks/useArticles.ts#useArticles'],
    tests: ['src/hooks/useArticle.test.ts', 'src/lib/api.test.ts'],
  },
  {
    name: 'S2 signature change of formatDate (full depth)',
    mutate: (r) => r.edit('src/lib/format.ts', (s) => s.replace('formatDate(d: Date)', 'formatDate(d: Date, locale?: string)')),
    direct: ['src/components/ArticleCard.tsx#ArticleCard'],
    indirect: ['src/pages/ArticlePage.tsx#ArticlePage'],
    tests: ['src/components/ArticleCard.test.tsx'],
  },
  {
    name: 'S3 remove exported-but-unused default export',
    mutate: (r) => r.edit('src/lib/format.ts', (s) => s.replace(/\nexport default function unusedDefault\(\) \{\n {2}return 0;\n\}\n/, '\n')),
    direct: [],
    indirect: [],
    tests: [],
  },
  {
    name: 'S4 delete a file in an import cycle',
    mutate: async (r) => {
      r.git('rm', '-q', 'src/cycle/b.ts');
    },
    direct: ['src/cycle/a.ts', 'src/cycle/a.ts#a'],
    indirect: [],
    tests: [],
  },
  {
    name: 'S5 file-level change (comment above imports) -> importers only, as possible',
    mutate: (r) => r.edit('src/pages/ListPage.tsx', (s) => '// note\n' + s),
    direct: ['src/dyn/loader.ts'],
    indirect: [],
    tests: [],
  },
  {
    name: 'S6 rename file + update barrel',
    mutate: async (r) => {
      r.git('mv', 'src/components/Layout.tsx', 'src/components/Shell.tsx');
      await r.edit('src/components/index.ts', (s) => s.replace("'./Layout'", "'./Shell'"));
    },
    direct: ['src/components/index.ts', 'src/pages/ArticlePage.tsx', 'src/pages/ListPage.tsx'],
    indirect: [],
    tests: [],
  },
];

/** Next.js marshrut ssenariylari (fixtures/next-app). `routes` = "marshrut|sabab" juftliklari, qo'lda hisoblangan. */
export interface RouteScenario {
  name: string;
  mutate: (r: Repo) => Promise<void>;
  routes: string[];
}

const touch = (rel: string) => (r: Repo) => r.edit(rel, (s) => s.replace(/return /, 'return /* x */ '));

export const routeScenarios: RouteScenario[] = [
  {
    name: 'R1 leaf component used by one page -> only that route (affected)',
    mutate: touch('components/Card.tsx'),
    routes: ['/dashboard/[slug]|page|affected'],
  },
  {
    name: 'R2 component used by a nested layout -> that layout + every PAGE below it, nothing else',
    mutate: touch('components/Sidebar.tsx'),
    routes: ['/dashboard|layout|affected', '/dashboard|page|via-layout', '/dashboard/[slug]|page|via-layout'],
  },
  {
    name: 'R3 component used by the ROOT layout -> all app pages (not route handlers, not pages router)',
    mutate: touch('components/Header.tsx'),
    routes: ['/|layout|affected', '/|page|via-layout', '/about|page|via-layout', '/dashboard|page|via-layout', '/dashboard/[slug]|page|via-layout'],
  },
  {
    name: 'R4 middleware changed -> every route incl. handlers and pages router',
    mutate: touch('middleware.ts'),
    routes: ['*|middleware|changed', '/|page|via-middleware', '/about|page|via-middleware', '/api/hello|api|via-middleware', '/api/ping|route-handler|via-middleware', '/dashboard|page|via-middleware', '/dashboard/[slug]|page|via-middleware', '/legacy|page|via-middleware'],
  },
  {
    name: 'R5 pages/_app changed -> only pages-router pages',
    mutate: touch('pages/_app.tsx'),
    routes: ['*|app|changed', '/legacy|page|via-layout'],
  },
  {
    name: 'R6 a page file itself changed -> that route (changed)',
    mutate: touch('app/(marketing)/about/page.tsx'),
    routes: ['/about|page|changed'],
  },
];
