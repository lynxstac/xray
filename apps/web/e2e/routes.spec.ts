import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const nextPath = () => readFileSync(path.resolve(import.meta.dirname, '../../../.tmp-test/e2e/next-path.txt'), 'utf8');

test('Next.js repo: route chips in Explorer and an affected-routes tab in Impact', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?token=e2e-token');
  await page.getByTestId('tab-repo').click();
  await page.getByTestId('repo-path').fill(nextPath());
  await page.getByTestId('open-repo').click();
  await expect(page.getByTestId('index-report')).toBeVisible();

  // Explorer: dinamik sahifa fayli marshrut belgisi bilan chiqadi
  await page.getByTestId('tab-explorer').click();
  await page.getByTestId('search').fill('Detail');
  await page.getByTestId('results').getByRole('button').first().click();
  await page.getByTestId('search').fill('slug');
  await page.getByTestId('results').getByRole('button').filter({ has: page.locator('.dot[data-k=file]') }).first().click();
  await expect(page.getByTestId('route-chip')).toContainText('/dashboard/[slug]');

  // Impact: Sidebar o'zgargan -> dashboard layout + uning ostidagi sahifalar
  await page.getByTestId('tab-impact').click();
  await page.getByTestId('run-impact').click();
  await expect(page.getByTestId('impact-report')).toBeVisible();
  await expect(page.getByTestId('n-routes')).toHaveText('3');
  await page.getByTestId('itab-routes').click();
  const routes = page.getByTestId('routes');
  await expect(routes).toContainText('/dashboard/[slug]');
  await expect(routes).toContainText('via-layout');
  await expect(routes).not.toContainText('/about');
  await expect(routes).not.toContainText('/api/ping');
});
