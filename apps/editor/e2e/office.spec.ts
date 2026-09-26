import { expect, test } from '@playwright/test';
import { newProject, openTab, send } from './helpers.js';

test('an office from creation to report: office items, desks need chairs, office rules, and halls stay one click away', async ({ page }) => {
  const id = await newProject(page, 'Company Office', 8, 6, 'office');

  // Office catalog and office rules, recognised from the catalog.
  await expect(page.locator('[data-add]')).toHaveCount(25);
  await expect(page.getByTestId('bring-missing')).toHaveCount(0);
  await openTab(page, 'Review');
  await expect(page.locator('select[name="activity"]')).toHaveValue('office');
  await expect(page.locator('select[name="activity-style"]')).toHaveValue('open-plan');

  // A desk facing north at (2, 3) m has no chair yet.
  await send(page, id, [{ type: 'item.add', item: { id: 'desk-1', definitionId: 'desk-140', position: { x: 20_000, y: 30_000 }, rotation: 0, locked: false } }]);
  const desks = page.locator('[data-rule="workstations"]');
  await expect(desks).toHaveAttribute('data-status', 'fail');
  await desks.click();
  await expect(page.locator('svg.plan')).toHaveAttribute('data-selected', 'desk-1');

  // A chair 30 cm in front of it (its centre at y = 3.65 m) makes the desk a workstation.
  await send(page, id, [{ type: 'item.add', item: { id: 'chair-1', definitionId: 'office-chair', position: { x: 20_000, y: 36_500 }, rotation: 180_000, locked: false } }]);
  await expect(desks).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="area-per-person"]')).toContainText('48 m²');
  await expect(page.locator('[data-rule="walkway"]')).toHaveAttribute('data-status', 'pass');

  // The report names the activity and checks the desks.
  await page.getByRole('link', { name: 'Client report' }).click();
  await expect(page.getByLabel('Rules and issues')).toContainText('Office · Open-plan office');
  await expect(page.getByTestId('report-rules').locator('[data-rule="workstations"]')).toHaveAttribute('data-status', 'pass');
  await page.screenshot({ path: 'e2e-results/office-report.png', fullPage: true });
  await page.getByRole('link', { name: 'Back to plan' }).click();

  // The same space as an event hall: hall rules, and the hall items are one click away.
  await openTab(page, 'Review');
  await page.locator('select[name="activity"]').selectOption('hall');
  await expect(page.locator('[data-rule="area-per-guest"]')).toBeVisible();
  await page.getByRole('button', { name: 'Add 25 missing event hall item types' }).click();
  await expect(page.locator('[data-add]')).toHaveCount(50);
  await page.screenshot({ path: 'e2e-results/office.png' });
});
