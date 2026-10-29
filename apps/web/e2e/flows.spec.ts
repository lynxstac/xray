import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoPath = () => readFileSync(path.resolve(import.meta.dirname, '../../../.tmp-test/e2e/repo-path.txt'), 'utf8');
const SHOTS = path.resolve(import.meta.dirname, '../../../docs/screenshots');

test.describe.configure({ mode: 'serial' });

/** Skrinshotlar faqat `XRAY_SHOTS=1 pnpm shots` bilan yangilanadi (oddiy test yurishi tracked fayllarni o'zgartirmasin). */
const shot = async (name: string) => {
  if (process.env.XRAY_SHOTS) await page.screenshot({ path: path.join(SHOTS, name) });
};

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto('/?token=e2e-token');
});
test.afterAll(async () => {
  const errors = (page as unknown as { __errors: string[] }).__errors;
  // Ataylab qilingan ikkita rad javobi (yo'q papka, zararli ref) brauzer konsolida 400 sifatida ko'rinadi; boshqa xato bo'lmasligi kerak.
  const unexpected = errors.filter((e) => !/status of 400/.test(e));
  expect(unexpected, 'kutilmagan brauzer xatosi').toEqual([]);
  expect(errors.filter((e) => /status of 400/.test(e))).toHaveLength(2);
  await page.close();
});

test('token is stripped from the URL after load', async () => {
  await expect(page.getByTestId('tab-repo')).toBeVisible();
  expect(page.url()).not.toContain('token');
});

test('explorer/impact/ask tabs are disabled until a repo is open; empty state is explained', async () => {
  await expect(page.getByTestId('tab-explorer')).toBeDisabled();
  await expect(page.getByText('Hali repozitoriy ochilmagan')).toBeVisible();
});

test('opening a missing folder shows a clear error', async () => {
  await page.getByTestId('repo-path').fill('/definitely/not/here');
  await page.getByTestId('open-repo').click();
  await expect(page.getByRole('alert')).toContainText('Papka topilmadi');
});

test('open the fixture repo -> honest index report', async () => {
  await page.getByTestId('repo-path').fill(repoPath());
  await page.getByTestId('open-repo').click();
  const rep = page.getByTestId('index-report');
  await expect(rep).toBeVisible();
  await expect(rep).toContainText('17');
  await expect(rep).toContainText('dynamic-import');
  await expect(page.getByTestId('index-mode')).toContainText('full');
  await shot('1-repository.png');
});

test('explorer: search -> graph + details with incoming callers and source', async () => {
  await page.getByTestId('tab-explorer').click();
  await expect(page.getByText('Graph — faqat tanlangan node atrofi')).toBeVisible();
  await page.getByTestId('search').fill('fetchArticle');
  await page.getByTestId('results').getByRole('button').first().click();
  await expect(page.getByTestId('detail-name')).toHaveText('fetchArticle');
  const incoming = page.getByTestId('incoming');
  await expect(incoming).toContainText('useArticle');
  const canvas = page.getByTestId('graph-canvas');
  await expect(canvas).toHaveAttribute('data-nodes', /^([3-9]|\d\d+)$/);
  await expect(page.getByTestId('source-view')).toContainText('fetchArticle');
  await shot('2-explorer.png');
});

test('explorer: edge-kind filter changes the graph; clicking a neighbour navigates; back returns', async () => {
  const canvas = page.getByTestId('graph-canvas');
  const before = Number(await canvas.getAttribute('data-edges'));
  await page.locator('.filters summary').click();
  const filters = page.locator('.filters');
  for (const k of ['calls', 'renders', 'references', 'tests']) await filters.getByText(k, { exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-edges'))).toBeLessThan(before);
  for (const k of ['calls', 'renders', 'references', 'tests']) await filters.getByText(k, { exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-edges'))).toBe(before);
  await page.getByTestId('incoming').getByRole('button').first().click();
  await expect(page.getByTestId('detail-name')).not.toHaveText('fetchArticle');
  await page.getByRole('button', { name: 'Orqaga' }).click();
  await expect(page.getByTestId('detail-name')).toHaveText('fetchArticle');
});

test('explorer: no results state', async () => {
  await page.getByTestId('search').fill('zzzzqqqq');
  await expect(page.getByTestId('no-results')).toBeVisible();
  await page.getByTestId('search').fill('');
});

test('impact: working-tree signature change -> direct/indirect with evidence path', async () => {
  await page.getByTestId('tab-impact').click();
  await page.getByTestId('run-impact').click();
  await expect(page.getByTestId('impact-report')).toBeVisible();
  await expect(page.getByTestId('n-direct')).toHaveText('1');
  await expect(page.getByTestId('n-indirect')).toHaveText('1');
  await expect(page.getByTestId('direct')).toContainText('ArticleCard');
  await page.getByTestId('itab-indirect').click();
  await expect(page.getByTestId('indirect')).toContainText('ArticlePage');
  await page.getByTestId('itab-tests').click();
  await expect(page.getByTestId('tests')).toContainText('ArticleCard.test.tsx');
  await page.getByTestId('itab-direct').click();
  await page.getByTestId('direct').getByTestId('impact-item').first().click();
  const ev = page.getByTestId('evidence-body');
  await expect(ev).toContainText('formatDate');
  await expect(ev).toContainText('calls');
  await expect(ev.getByTestId('source-view')).toContainText('formatDate');
  await shot('3-impact.png');
});

test('impact: a malicious ref is rejected with an error, not executed', async () => {
  await page.getByText("Branch/commit oralig'i").click();
  await page.getByTestId('base-ref').fill('--output=/tmp/pwned');
  await page.getByTestId('run-impact').click();
  await expect(page.getByTestId('impact-error')).toContainText(/ref/i);
  await page.getByText('Ishchi katalog (HEAD ↔ hozir)').click();
});

test('ask: AI off -> local evidence only, nothing sent', async () => {
  await page.getByTestId('tab-ask').click();
  await expect(page.getByTestId('ai-status')).toContainText("AI o'chiq");
  await page.getByTestId('question').fill('Where is `fetchArticle` called?');
  await page.getByTestId('ask-btn').click();
  await expect(page.getByTestId('evidence-only')).toBeVisible();
  await expect(page.getByTestId('ask-result')).toContainText('src/lib/api.ts');
});

test('ask: enabling AI needs explicit consent; answer citations are validated against the evidence', async () => {
  await page.getByText('AI ni yoqish (ixtiyoriy)').click();
  const enable = page.locator('details.enable');
  await enable.locator('select').selectOption('openai-compatible');
  const inputs = enable.locator('input[type=text], input:not([type])');
  await inputs.nth(0).fill('mock-model');
  await inputs.nth(1).fill('XRAY_E2E_KEY');
  await inputs.nth(2).fill('http://127.0.0.1:8798');
  const save = enable.getByRole('button', { name: /Rozilik berish/ });
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('consent-text')).toContainText('internet orqali yuboriladi');
  await page.getByTestId('consent-check').check();
  await save.click();
  await expect(page.getByTestId('ai-status')).toContainText('AI yoqilgan');
  await page.getByTestId('question').fill('Where is `fetchArticle` defined?');
  await page.getByTestId('ask-btn').click();
  const answer = page.getByTestId('answer');
  await expect(answer).toContainText('aniqlangan');
  await expect(answer.locator('.cite.ok')).toHaveCount(1);
  await expect(answer.locator('.cite.bad')).toHaveCount(1);
  await answer.locator('.cite.ok').click();
  await expect(page.getByTestId('ask-result').getByTestId('source-view')).toContainText('fetchArticle');
  await shot('4-ask.png');
});

test('reopening the same repo is served from the cache (noop)', async () => {
  await page.getByTestId('tab-repo').click();
  await page.getByTestId('repo-path').fill(repoPath());
  await page.getByTestId('open-repo').click();
  await expect(page.getByTestId('index-mode')).toContainText(/noop|incremental/);
});
