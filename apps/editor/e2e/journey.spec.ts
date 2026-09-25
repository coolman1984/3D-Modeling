import { expect, test, type Page } from '@playwright/test';

async function itemCentre(page: Page, id: string) {
  const box = await page.locator(`[data-item-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`item ${id} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Screen point of a world position (metres), read from the room's drawn outline. */
async function worldToScreen(page: Page, xM: number, yM: number, roomW = 10, roomD = 8) {
  const floor = await page.locator('path.floor').boundingBox();
  if (!floor) throw new Error('floor not drawn');
  return { x: floor.x + (xM / roomW) * floor.width, y: floor.y + floor.height - (yM / roomD) * floor.height };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('plan a hall: add, drag, see a problem, undo, save and reopen', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('قاعة تجريبية ١٠×٨ م');
  await expect(page.getByTestId('issue-count')).toHaveText('مفيش');

  // Add a table and two chairs from the catalog.
  await page.locator('[data-add="table-180"]').click();
  await page.locator('[data-add="chair"]').click();
  await page.locator('[data-add="chair"]').click();
  await expect(page.locator('[data-item-id]')).toHaveCount(3);
  await expect(page.getByTestId('seats')).toHaveText('٢');
  // Each new item lands in the nearest free spot, so nothing clashes.
  await expect(page.getByTestId('issue-count')).toHaveText('مفيش');

  // Rearrange, then drag the second chair into the door swing.
  const drag = async (id: string, xM: number, yM: number) => {
    const from = await itemCentre(page, id);
    const to = await worldToScreen(page, xM, yM);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
  };
  await drag('table-180-1', 7.5, 6.5);
  await drag('chair-1', 7.5, 5.6); // south of the table, facing it
  await expect(page.getByTestId('issue-count')).toHaveText('مفيش');

  await drag('chair-2', 1.35, 0.45);
  const doorIssue = page.locator('[data-issue="door-blocked"]');
  await expect(doorIssue).toBeVisible();
  await expect(doorIssue).toContainText('في طريق الباب');
  await expect(page.locator('[data-item-id="chair-2"].error')).toHaveCount(1);
  await page.screenshot({ path: 'e2e-results/door-blocked.png' });

  // Undo the last drag: the problem goes away.
  await page.keyboard.press('Control+z');
  await expect(doorIssue).toHaveCount(0);

  // Rotate the selected chair with the keyboard and check the inspector.
  await page.locator('[data-item-id="chair-1"]').click();
  await page.keyboard.press('r');
  await expect(page.getByLabel('العنصر المختار')).toContainText('٢٧٠°');

  // Save to a file, start fresh, and open the file again.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'احفظ ملف' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const seatsBefore = await page.getByTestId('seats').textContent();

  await page.getByRole('button', { name: 'قاعة جديدة' }).click();
  await page.getByRole('button', { name: 'اعمل القاعة' }).click();
  await expect(page.locator('[data-item-id]')).toHaveCount(0);

  await page.getByTestId('file-input').setInputFiles(path);
  await expect(page.locator('h1')).toHaveText('قاعة تجريبية ١٠×٨ م');
  await expect(page.locator('[data-item-id]')).toHaveCount(3);
  await expect(page.getByTestId('seats')).toHaveText(seatsBefore ?? '');
  await expect(page.getByTestId('issue-count')).toHaveText('مفيش');
  await page.screenshot({ path: 'e2e-results/reopened.png' });
});

test('autosave keeps the plan after a reload', async ({ page }) => {
  await page.locator('[data-add="stage"]').click();
  await expect(page.locator('[data-item-id]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-item-id="stage-1"]')).toHaveCount(1);
});

test('locked items refuse to be deleted and say why', async ({ page }) => {
  await page.locator('[data-add="buffet"]').click();
  await page.getByRole('button', { name: 'اقفل مكانه' }).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-item-id="buffet-1"]')).toHaveCount(1);
  await expect(page.getByRole('status')).toContainText('مقفول');
});
