import { expect, test, type Page } from '@playwright/test';

/** Maket: o'lchami o'zgaradigan panellar, saqlash, yig'ish, tor ekran va "kontent sig'adi" tekshiruvlari. */

const width = async (page: Page, testid: string) => Math.round((await page.getByTestId(testid).boundingBox())!.width);
const centerWidth = async (page: Page) => Math.round((await page.getByTestId('canvas').boundingBox())!.width);

async function openFocused(page: Page, query = 'fetchArticle') {
  await page.goto('/?token=e2e-token');
  await page.getByTestId('search').fill(query);
  await page.getByTestId('results').getByRole('button').first().click();
  await expect(page.getByTestId('detail-name')).toBeVisible();
}

async function drag(page: Page, testid: string, dx: number) {
  const box = (await page.getByTestId(testid).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Repo oldingi spec'da ochilgan (server holati saqlanadi); aks holda o'zi ochamiz.
  await page.goto('/?token=e2e-token');
  if (await page.getByTestId('tab-explorer').isDisabled()) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    await page.getByTestId('repo-path').fill(fs.readFileSync(path.resolve(import.meta.dirname, '../../../.tmp-test/e2e/repo-path.txt'), 'utf8'));
    await page.getByTestId('open-repo').click();
    await expect(page.getByTestId('index-report')).toBeVisible();
  }
  await page.evaluate(() => localStorage.clear());
});

test('drag resizes the right panel; width is clamped to its range', async ({ page }) => {
  await openFocused(page);
  const w0 = await width(page, 'pane-right');
  await drag(page, 'handle-r', -120);
  const w1 = await width(page, 'pane-right');
  expect(Math.abs(w1 - (w0 + 120))).toBeLessThanOrEqual(4);
  await drag(page, 'handle-r', 2000); // juda torayishga urinish -> minimum (280)
  expect(await width(page, 'pane-right')).toBe(280);
  await drag(page, 'handle-r', -3000); // juda kengayish -> maksimum (720) yoki markaz minimumi
  expect(await width(page, 'pane-right')).toBeLessThanOrEqual(720);
});

test('the centre never shrinks below 340px, however far panels are dragged', async ({ page }) => {
  await openFocused(page);
  await drag(page, 'handle-l', 900);
  await drag(page, 'handle-r', -900);
  expect(await centerWidth(page)).toBeGreaterThanOrEqual(338);
});

test('the graph re-fits when a panel shrinks the canvas (nothing is pushed out of view)', async ({ page }) => {
  await openFocused(page);
  const canvas = page.getByTestId('graph-canvas');
  await expect(canvas).toHaveAttribute('data-inview', 'true');
  const w0 = (await canvas.boundingBox())!.width;
  await drag(page, 'handle-r', -420); // markazni keskin toraytiramiz
  const w1 = (await canvas.boundingBox())!.width;
  expect(w1).toBeLessThan(w0 - 300);
  await expect.poll(async () => canvas.getAttribute('data-inview'), { timeout: 3000 }).toBe('true');
  // canvas elementi konteyner bilan bir xil kenglikda
  const cw = await page.locator('[data-testid=graph-canvas] canvas').first().evaluate((el) => (el as HTMLCanvasElement).clientWidth);
  expect(Math.abs(cw - w1)).toBeLessThanOrEqual(2);
});

test('keyboard: arrows resize (Shift = big step), Home resets, double-click resets', async ({ page }) => {
  await openFocused(page);
  const w0 = await width(page, 'pane-left');
  await page.getByTestId('handle-l').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  expect(await width(page, 'pane-left')).toBe(w0 + 48);
  await page.keyboard.press('Shift+ArrowRight');
  expect(await width(page, 'pane-left')).toBe(w0 + 48 + 64);
  await page.keyboard.press('Home');
  expect(await width(page, 'pane-left')).toBe(300);
  await page.keyboard.press('ArrowRight');
  await page.getByTestId('handle-l').dblclick();
  expect(await width(page, 'pane-left')).toBe(300);
  await expect(page.getByTestId('handle-l')).toHaveAttribute('role', 'separator');
  await expect(page.getByTestId('handle-l')).toHaveAttribute('aria-valuenow', '300');
});

test('sizes persist across reloads; panels collapse and re-open', async ({ page }) => {
  await openFocused(page);
  await drag(page, 'handle-r', -100);
  const w = await width(page, 'pane-right');
  await page.reload();
  await expect(page.getByTestId('pane-right')).toBeVisible();
  expect(Math.abs((await width(page, 'pane-right')) - w)).toBeLessThanOrEqual(2);

  const c0 = await centerWidth(page);
  await page.getByRole('button', { name: 'Tafsilot panelini yopish' }).click();
  await expect(page.getByTestId('pane-right')).toHaveCount(0);
  expect(await centerWidth(page)).toBeGreaterThan(c0 + 250);
  await page.reload();
  await expect(page.getByTestId('pane-right')).toHaveCount(0); // yig'ilgan holat ham saqlanadi
  await page.getByRole('button', { name: 'Tafsilot panelini ochish' }).click();
  await expect(page.getByTestId('pane-right')).toBeVisible();
});

test('panel contents fit: no horizontal overflow in panes or page; long paths keep the file name visible', async ({ page }) => {
  await openFocused(page, 'formatDate');
  for (const id of ['pane-left', 'pane-right']) {
    const o = await page.getByTestId(id).locator('.pane-b').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(o.sw, id).toBeLessThanOrEqual(o.cw + 1);
  }
  const page_o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(page_o.sw).toBeLessThanOrEqual(page_o.cw);
  // fayl nomi (p-base) hech qachon kesilmaydi
  const base = page.getByTestId('pane-right').locator('.p-base').first();
  await expect(base).toBeVisible();
  const trunc = await base.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(trunc).toBe(false);
});

test('narrow screen: panels become drawers (nothing disappears); selecting from the list closes it', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto('/?token=e2e-token');
  await expect(page.getByTestId('toggle-left')).toBeVisible();
  await expect(page.getByTestId('pane-left')).toHaveCount(0);
  // boshida qidiruv drawer'i ochiq
  await page.getByTestId('search').fill('fetchArticle');
  await page.getByTestId('results').getByRole('button').first().click();
  await expect(page.getByTestId('search')).toHaveCount(0); // tanlagach yopildi — graf ko'rinadi
  await expect(page.getByTestId('graph-canvas')).toBeVisible();
  await page.getByTestId('toggle-right').click();
  await expect(page.getByTestId('detail-name')).toHaveText('fetchArticle');
  await page.getByRole('button', { name: 'Tafsilot panelini yopish' }).click();
  await page.getByTestId('toggle-left').click();
  await expect(page.getByTestId('search')).toBeVisible();
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.cw);
});

test('impact: sticky summary tabs with counts, filter narrows the list, evidence panel is resizable', async ({ page }) => {
  await page.getByTestId('tab-impact').click();
  await page.getByTestId('run-impact').click();
  await expect(page.getByTestId('impact-report')).toBeVisible();
  await expect(page.getByTestId('itab-direct')).toContainText('1');
  await page.getByLabel('Filtr').fill('zzz-no-match');
  await expect(page.getByText("Filtrga mos element yo'q")).toBeVisible();
  await page.getByLabel('Filtr').fill('article');
  await expect(page.getByTestId('impact-item')).toHaveCount(1);
  await page.getByTestId('impact-item').first().click();
  const w0 = await width(page, 'pane-right');
  await drag(page, 'handle-r', -100);
  expect(await width(page, 'pane-right')).toBeGreaterThan(w0 + 90);
  // testni bossak ham dalil ko'rinadi
  await page.getByTestId('itab-tests').click();
  await page.getByTestId('tests').getByRole('button').first().click();
  await expect(page.getByTestId('evidence-body')).toContainText('ArticleCard.test.tsx');
});

test('impact "changed" tab: file paths are normal-case and the status badge stays on the same line', async ({ page }) => {
  await page.getByTestId('tab-impact').click();
  await page.getByTestId('run-impact').click();
  await page.getByTestId('itab-changed').click();
  const sum = page.locator('summary.file-sum').first();
  await expect(sum).toBeVisible();
  expect(await sum.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');
  const [badge, label] = await Promise.all([sum.locator('.badge').boundingBox(), sum.locator('.plabel').boundingBox()]);
  expect(Math.abs(badge!.y + badge!.height / 2 - (label!.y + label!.height / 2))).toBeLessThan(12); // bir qatorda
});

test('repository screen: skipped files are inspectable, not just counted', async ({ page }) => {
  await page.getByTestId('tab-repo').click();
  await page.getByTestId('open-repo').click();
  await expect(page.getByTestId('index-report')).toBeVisible();
  const rows = page.locator('.kv-block');
  if ((await rows.count()) > 0) {
    await rows.first().locator('summary').click();
    await expect(rows.first().locator('code').first()).toBeVisible();
  }
});

test('phone width (390px): header does not break, drawer toggles never cover content, no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/?token=e2e-token');
  const logo = await page.locator('.logo').boundingBox();
  expect(logo!.height).toBeLessThan(30); // "X-RAY" bir qatorda
  // hamma tab ko'rinadi/skroll qilinadi: kamida birinchi to'rttasi matni kesilmagan holda bor
  for (const t of ['tab-repo', 'tab-explorer', 'tab-impact', 'tab-ask']) await expect(page.getByTestId(t)).toBeVisible();

  await page.getByTestId('tab-impact').click();
  const bar = await page.locator('.drawer-toggles').boundingBox();
  const first = await page.locator('.spec-row').boundingBox();
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(first!.y + 1); // tugmalar formaning tepasida, ustida emas
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.cw);

  await page.getByTestId('tab-explorer').click();
  await expect(page.getByTestId('search')).toBeVisible(); // boshida qidiruv drawer'i ochiq
});
