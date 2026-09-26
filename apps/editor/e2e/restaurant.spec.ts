import { expect, test } from '@playwright/test';
import { openTab, saved } from './helpers.js';

test('reference restaurant: covers, service route to a table, and print report', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('[data-template="restaurant"]').click();
  await page.locator('input[name="project-name"]').fill('Bistro 1');
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText('Bistro 1');
  await saved(page);
  await expect(page.getByTestId('restaurant-covers')).toContainText('44');
  await expect(page.locator('[data-item-id]')).toHaveCount(9);

  await page.selectOption('select[aria-label="Route to table"]', 'T01');
  await page.getByRole('button', { name: 'Show route' }).click();
  await expect(page.locator('.restaurant-route')).toContainText('reachable');

  await openTab(page, 'Review');
  await expect(page.locator('[data-rule="area-per-cover"]')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="table-reachability"]')).toHaveAttribute('data-status', 'pass');

  await page.getByRole('button', { name: /^3D/ }).first().click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();

  await page.getByRole('link', { name: 'Client report' }).click();
  await expect(page.getByTestId('report-restaurant-covers')).toContainText('44');
  await expect(page.getByTestId('report-picture')).toBeVisible({ timeout: 15_000 });
});
