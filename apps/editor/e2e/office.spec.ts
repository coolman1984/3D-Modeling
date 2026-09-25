import { expect, test, type Page } from '@playwright/test';

async function send(page: Page, id: string, commands: unknown[]) {
  const { revision } = await (await page.request.get(`/api/projects/${id}`)).json();
  const response = await page.request.post(`/api/projects/${id}/commands`, { data: { commands, baseRevision: revision, actor: 'human' } });
  expect(response.ok()).toBe(true);
}

test('an office from creation to report: office items, desks need chairs, office rules, and halls stay one click away', async ({ page }) => {
  await page.goto('/#/');
  await page.locator('input[name="project-name"]').fill('مكتب الشركة');
  await page.locator('input[name="new-width"]').fill('8');
  await page.locator('input[name="new-depth"]').fill('6');
  await page.locator('select[name="new-activity"]').selectOption('office');
  await page.getByRole('button', { name: 'اعمل المشروع' }).click();
  await expect(page.locator('.toolbar h1')).toHaveText('مكتب الشركة');
  await expect(page.getByTestId('save-state')).toHaveText('محفوظ');
  const id = /#\/p\/([\w-]+)/.exec(page.url())![1]!;

  // Office catalog and office rules, recognised from the catalog.
  await expect(page.locator('[data-add]')).toHaveCount(20);
  await expect(page.locator('select[name="activity"]')).toHaveValue('office');
  await expect(page.getByLabel('قواعد النشاط').locator('h2')).toContainText('قواعد مكتب');
  await expect(page.getByRole('button', { name: /هات أصناف/ })).toHaveCount(0);

  // A desk facing north at (2, 3) m has no chair yet.
  await send(page, id, [{ type: 'item.add', item: { id: 'desk-1', definitionId: 'desk-140', position: { x: 20_000, y: 30_000 }, rotation: 0, locked: false } }]);
  const desks = page.locator('[data-rule="workstations"]');
  await expect(desks).toHaveAttribute('data-status', 'fail');
  await desks.getByRole('button').click();
  await expect(page.locator('svg.plan')).toHaveAttribute('data-selected', 'desk-1');

  // A chair 30 cm in front of it (its centre at y = 3.65 m) makes the desk a workstation.
  await send(page, id, [{ type: 'item.add', item: { id: 'chair-1', definitionId: 'office-chair', position: { x: 20_000, y: 36_500 }, rotation: 180_000, locked: false } }]);
  await expect(desks).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="area-per-person"]')).toContainText('٤٨ م²');
  await expect(page.locator('[data-rule="walkway"]')).toHaveAttribute('data-status', 'pass');

  // The report names the activity and checks the desks.
  await page.getByRole('link', { name: 'التقرير' }).click();
  await expect(page.getByLabel('قواعد النشاط')).toContainText('قواعد مكتب: مكتب مفتوح');
  await expect(page.getByTestId('report-rules').locator('[data-rule="workstations"]')).toHaveAttribute('data-status', 'pass');
  await page.screenshot({ path: 'e2e-results/office-report.png', fullPage: true });
  await page.getByRole('link', { name: 'رجوع للتصميم' }).click();

  // The same space as an event hall: hall rules, and the hall items are one click away.
  await page.locator('select[name="activity"]').selectOption('hall');
  await expect(page.locator('[data-rule="area-per-guest"]')).toBeVisible();
  await page.getByRole('button', { name: 'هات أصناف القاعات الناقصة (٢٥)' }).click();
  await expect(page.locator('[data-add]')).toHaveCount(45);
  await page.screenshot({ path: 'e2e-results/office.png' });
});
