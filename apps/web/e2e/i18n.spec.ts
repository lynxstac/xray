import { expect, test, type Page } from '@playwright/test';

/** Ikki tilli UI: ingliz tilida HECH QANDAY o'zbekcha matn qolmasligi (UI + server tomoni matnlari) va tilni almashtirish. */

const UZ = /(bog'liq|yo'q\b|natija|tahlil|o'zgar|qadam|ishlatadi|chaqiradi|manba\b|rozilik|savol|papka|xato|kerak|mumkin|fayl|repozitoriy|tafsilot|qidiruv|yuklan|ochish|dalil|noaniq|bevosita|bilvosita|marshrut|testlar|ko'rsat|tanlang|kiriting)/i;

async function openRepoIfNeeded(page: Page) {
  if (await page.getByTestId('tab-explorer').isDisabled()) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    await page.getByTestId('repo-path').fill(fs.readFileSync(path.resolve(import.meta.dirname, '../../../.tmp-test/e2e/repo-path.txt'), 'utf8'));
    await page.getByTestId('open-repo').click();
    await expect(page.getByTestId('index-report')).toBeVisible();
  }
}

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);
const noUzbek = async (page: Page, where: string) => {
  const txt = await bodyText(page);
  expect(txt.match(UZ)?.[0] ?? null, `Uzbek text left on "${where}"`).toBeNull();
};

test.describe('English UI (browser locale en-US)', () => {
  test.use({ locale: 'en-US' });

  test('defaults to English from the browser locale; <html lang> follows', async ({ page }) => {
    await page.goto('/?token=e2e-token');
    await expect(page.getByTestId('tab-repo')).toHaveText('Repository');
    await expect(page.getByTestId('tab-ask')).toHaveText('Ask');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
    await expect(page.getByTestId('lang-en')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a missing folder error comes back in English (server-side message)', async ({ page }) => {
    await page.goto('/?token=e2e-token');
    await page.getByTestId('tab-repo').click(); // repo oldingi testlarda ochilgan bo'lsa, ilova Explorer'da boshlanadi
    await page.getByTestId('repo-path').fill('/definitely/not/here');
    await page.getByTestId('open-repo').click();
    await expect(page.getByRole('alert')).toContainText('Folder not found or not readable');
    await noUzbek(page, 'repo error');
  });

  test('every screen and tab is fully English (no Uzbek left anywhere)', async ({ page }) => {
    await page.goto('/?token=e2e-token');
    await openRepoIfNeeded(page);

    // Repository: index report (reason text built from reasonCode on the client)
    await page.getByTestId('tab-repo').click();
    await page.getByTestId('open-repo').click();
    await expect(page.getByTestId('index-report')).toBeVisible();
    await expect(page.getByTestId('index-mode')).toContainText('Mode:');
    await noUzbek(page, 'repository');

    // Explorer: empty state, search, details, filters, edges
    await page.getByTestId('tab-explorer').click();
    await expect(page.getByText('only the neighbourhood of the selected node')).toBeVisible();
    await noUzbek(page, 'explorer (empty)');
    await page.getByTestId('search').fill('fetchArticle');
    await page.getByTestId('results').getByRole('button').first().click();
    await expect(page.getByTestId('detail-name')).toHaveText('fetchArticle');
    await page.locator('.filters summary').click();
    await expect(page.getByText('Relation kinds')).toBeVisible();
    await expect(page.getByTestId('incoming')).toContainText('useArticle');
    await noUzbek(page, 'explorer (details)');
    await page.getByTestId('search').fill('zzzzqqqq');
    await expect(page.getByTestId('no-results')).toContainText('Nothing found');
    await page.getByTestId('search').fill('');

    // Impact: every tab, evidence panel, server-built reasons
    await page.getByTestId('tab-impact').click();
    await noUzbek(page, 'impact (empty)');
    await page.getByTestId('run-impact').click();
    await expect(page.getByTestId('impact-report')).toBeVisible();
    for (const tab of ['changed', 'direct', 'indirect', 'tests', 'uncertain']) {
      await page.getByTestId(`itab-${tab}`).click();
      await noUzbek(page, `impact/${tab}`);
    }
    await page.getByTestId('itab-direct').click();
    await page.getByTestId('impact-item').first().click();
    await expect(page.getByTestId('evidence-body')).toContainText('calls formatDate');
    await noUzbek(page, 'impact (evidence)');
    await page.getByTestId('itab-tests').click();
    await page.getByTestId('tests').getByRole('button').first().click();
    await expect(page.getByTestId('evidence-body')).toContainText('connected through a chain');
    await noUzbek(page, 'impact (test evidence)');

    // Ask: AI holati oldingi testlarda yoqilgan bo'lishi mumkin — dry-run bilan ikkala holatda ham serverga yuborilmaydi
    await page.getByTestId('tab-ask').click();
    await page.getByTestId('question').fill('Where is `fetchArticle` called?');
    const dry = page.getByLabel('Only show what would be sent');
    if (await dry.count()) await dry.check(); // faqat AI yoqilganda ko'rinadi
    await page.getByTestId('ask-btn').click();
    await expect(page.getByTestId('ask-result')).toContainText("name matches 'fetchArticle'");
    await expect(page.getByTestId('ask-result').locator('[data-testid=dry-run], [data-testid=evidence-only]')).toContainText(/Not sent \(dry run\)|Local evidence only/);
    if (await page.getByText('Enable AI (optional)').count()) {
      await page.getByText('Enable AI (optional)').click();
      await expect(page.getByTestId('consent-text')).toContainText('sent over the internet');
    }
    await noUzbek(page, 'ask');
  });

  test('switching language updates the UI at once, persists across reloads, and re-localises server text', async ({ page }) => {
    await page.goto('/?token=e2e-token');
    await openRepoIfNeeded(page);
    await page.getByTestId('tab-impact').click();
    await page.getByTestId('run-impact').click();
    await expect(page.getByTestId('impact-report')).toBeVisible();
    await page.getByTestId('impact-item').first().click();
    await expect(page.getByTestId('evidence-body')).toContainText('calls formatDate');

    await page.getByTestId('lang-uz').click();
    await expect(page.getByTestId('tab-ask')).toHaveText('Savol');
    await expect(page.getByTestId('itab-direct')).toContainText('Bevosita');
    // server tomonidagi sabab matni ham o'zbekchaga qayta yasaladi (hisobot qayta olinadi)
    await page.getByTestId('impact-item').first().click();
    await expect(page.getByTestId('evidence-body')).toContainText('ni chaqiradi');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('uz');

    await page.reload();
    await expect(page.getByTestId('tab-ask')).toHaveText('Savol'); // saqlangan
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('tab-ask')).toHaveText('Ask');
  });
});

test.describe('language detection', () => {
  test.use({ locale: 'de-DE' });
  test('an unknown browser locale falls back to English', async ({ page }) => {
    await page.goto('/?token=e2e-token');
    await expect(page.getByTestId('tab-repo')).toHaveText('Repository');
  });
});

test.describe('Uzbek browser locale', () => {
  test.use({ locale: 'uz-UZ' });
  test('Uzbek by default for an Uzbek browser', async ({ page }) => {
    await page.goto('/?token=e2e-token');
    await expect(page.getByTestId('tab-repo')).toHaveText('Repozitoriy');
    await expect(page.getByTestId('lang-uz')).toHaveAttribute('aria-pressed', 'true');
  });
});
