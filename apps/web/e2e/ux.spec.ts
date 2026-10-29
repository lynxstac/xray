import { expect, test, type Page } from '@playwright/test';

/** Zamonaviy UX: buyruqlar paneli, klaviatura yorliqlari, mavzu, Impact dashboard. */

async function ready(page: Page) {
  await page.goto('/?token=e2e-token');
  if (await page.getByTestId('tab-explorer').isDisabled()) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    await page.getByTestId('repo-path').fill(fs.readFileSync(path.resolve(import.meta.dirname, '../../../.tmp-test/e2e/repo-path.txt'), 'utf8'));
    await page.getByTestId('open-repo').click();
    await expect(page.getByTestId('index-report')).toBeVisible();
  }
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

test('Ctrl+K opens the command palette; commands and symbols are navigable by keyboard', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.getByTestId('palette-input').fill('Sidebar');
  const opt = page.getByRole('option').first();
  await expect(opt).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toBeHidden();
  await expect(page.getByTestId('detail-name')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('impact');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('run-impact')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toBeHidden();
});

test('Alt+digit switches sections, "?" shows shortcuts, Esc closes', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Alt+3');
  await expect(page.getByTestId('run-impact')).toBeVisible();
  await page.keyboard.press('Alt+1');
  await expect(page.getByTestId('tab-repo')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcuts')).toBeHidden();
});

test('theme toggle switches light/dark and persists across reload', async ({ page }) => {
  await ready(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe('rgb(11, 15, 20)');
  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('impact dashboard: tiles jump to sections; Ctrl+Enter runs the analysis', async ({ page }) => {
  await ready(page);
  await page.getByTestId('tab-impact').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('impact-dash')).toBeVisible();
  await page.getByTestId('impact-dash').getByRole('button', { name: /Bilvosita|Indirect/ }).click();
  await expect(page.getByTestId('itab-indirect')).toHaveAttribute('aria-selected', 'true');
  const bar = page.locator('.dash .bar .v');
  await expect(bar).toBeVisible();
});
