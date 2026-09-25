import { expect, test, type Page } from '@playwright/test';

async function newProject(page: Page, name: string, width: number, depth: number) {
  await page.goto('/#/');
  await page.locator('input[name="project-name"]').fill(name);
  await page.locator('input[name="new-width"]').fill(String(width));
  await page.locator('input[name="new-depth"]').fill(String(depth));
  await page.getByRole('button', { name: 'اعمل المشروع' }).click();
  await expect(page.locator('.toolbar h1')).toHaveText(name);
  await expect(page.getByTestId('save-state')).toHaveText('محفوظ');
  return /#\/p\/([\w-]+)/.exec(page.url())![1]!;
}

/** Send core commands the way any client does (one revision). Lengths in ticks: metres × 10 000. */
async function send(page: Page, id: string, commands: unknown[]) {
  const { revision } = await (await page.request.get(`/api/projects/${id}`)).json();
  const response = await page.request.post(`/api/projects/${id}/commands`, { data: { commands, baseRevision: revision, actor: 'human' } });
  expect(response.ok()).toBe(true);
}

const at = (id: string, definitionId: string, x: number, y: number, rotation = 0) => ({
  type: 'item.add',
  item: { id, definitionId, position: { x: Math.round(x * 10_000), y: Math.round(y * 10_000) }, rotation, locked: false },
});

test('hall pack: 29 hall items, rules that name the boxed-in seat, event style, and the rules in the report', async ({ page }) => {
  const id = await newProject(page, 'قاعة القواعد', 10, 8);

  // The hall catalog, searchable.
  await expect(page.locator('[data-add]')).toHaveCount(29);
  await page.locator('input[name="catalog-filter"]').fill('كوشة');
  await expect(page.locator('[data-add]')).toHaveCount(1);
  await page.locator('[data-add="kosha"]').click();
  await page.locator('input[name="catalog-filter"]').fill('');

  // A chair shut in a pen of four tables (they touch, they do not overlap), in the north-west,
  // clear of the kosha in the middle of the hall.
  await send(page, id, [
    at('chair-9', 'chair', 2.5, 6.5),
    at('t1', 'table-180', 2.5, 7.15),
    at('t2', 'table-180', 2.5, 5.85),
    at('t3', 'table-180', 1.2, 6.5, 90_000),
    at('t4', 'table-180', 3.8, 6.5, 90_000),
  ]);
  await expect(page.locator('[data-item-id]')).toHaveCount(6);
  const walkway = page.locator('[data-rule="walkway"]');
  await expect(walkway).toHaveAttribute('data-status', 'fail');
  await expect(walkway).toContainText('كرسي (chair-9)');
  await walkway.getByRole('button').click();
  await expect(page.locator('svg.plan')).toHaveAttribute('data-selected', 'chair-9');
  await expect(page.locator('[data-rule="exits"]')).toHaveAttribute('data-status', 'pass');

  // Open the pen on the south side (a 1.8 m wide opening): the rule passes again.
  // (Taking the east table away would not do: the chair would still sit in a 50 cm slot.)
  await page.locator('[data-item-id="t2"]').click();
  await page.keyboard.press('Delete');
  await expect(walkway).toHaveAttribute('data-status', 'pass');
  await page.keyboard.press('Control+z');
  await expect(walkway).toHaveAttribute('data-status', 'fail');

  // Theatre style asks for less floor per guest; the choice is remembered for the report.
  await page.locator('select[name="activity-style"]').selectOption('theatre');
  await expect(page.locator('[data-rule="area-per-guest"]')).toContainText('٠٫٧ م²');
  await expect(page.getByTestId('save-state')).toHaveText('محفوظ');
  await page.getByRole('link', { name: 'التقرير' }).click();
  const rules = page.getByTestId('report-rules');
  await expect(page.getByLabel('قواعد النشاط')).toContainText('مسرح أو محاضرة');
  await expect(rules.locator('[data-rule="walkway"]')).toHaveAttribute('data-status', 'fail');
  await expect(page.getByTestId('report-verdict')).toContainText('قواعد');
  await page.screenshot({ path: 'e2e-results/report-rules.png', fullPage: true });
  await page.getByRole('link', { name: 'رجوع للتصميم' }).click();
  await expect(page.locator('select[name="activity-style"]')).toHaveValue('theatre');
  await page.screenshot({ path: 'e2e-results/rules.png' });
});

test('an older project brings in the hall items it is missing in one step', async ({ page }) => {
  const id = await newProject(page, 'مشروع قديم', 8, 6);
  await send(page, id, [{ type: 'catalog.remove', id: 'kosha' }, { type: 'catalog.remove', id: 'dance-floor' }]);
  await expect(page.locator('[data-add]')).toHaveCount(27);
  await page.getByRole('button', { name: 'هات أصناف القاعات الناقصة (٢)' }).click();
  await expect(page.locator('[data-add]')).toHaveCount(29);
  await expect(page.getByRole('button', { name: /هات أصناف القاعات/ })).toHaveCount(0);
  await page.locator('[data-add="dance-floor"]').click();
  await page.getByRole('button', { name: 'مجسم', exact: true }).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-items', '1');
});
