import { expect, test } from '@playwright/test';
import { openTab, saved } from './helpers.js';

test('reference production line: flow length, edit a station order, and print report', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('[data-template="production"]').click();
  await page.locator('input[name="project-name"]').fill('Assembly line 1');
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText('Assembly line 1');
  await saved(page);
  const id = /#\/p\/([\w-]+)/.exec(page.url())![1]!;
  await expect(page.getByTestId('production-flow-length')).toContainText('8.8');
  await expect(page.getByTestId('production-throughput')).toContainText('39.8');
  await expect(page.getByTestId('production-panel')).toContainText('318');
  await expect(page.getByTestId('production-panel')).toContainText('S04');
  await expect(page.locator('[data-item-id]')).toHaveCount(6);
  await expect(page.getByTestId('warehouse-route')).toBeVisible();

  await page.locator('[data-item-id="S02"]').click();
  await expect(page.locator('.insp-group', { hasText: 'Production flow' })).toContainText('machine');
  await page.getByLabel('Flow order').fill('7');
  await page.getByLabel('Flow order').press('Enter');
  await saved(page);
  await expect(page.getByTestId('production-flow-length')).not.toContainText('8.8');
  const project = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(project.items.S02.meta.step).toBe(7);
  await expect(page.getByTestId('production-simulation-missing')).toContainText('unknown next');

  // Put the process sequence back into a valid state before the client report.
  await page.locator('[data-item-id="S02"]').click();
  await page.getByLabel('Flow order').fill('2');
  await page.getByLabel('Flow order').press('Enter');
  await saved(page);
  await expect(page.getByTestId('production-throughput')).toContainText('39.8');

  await openTab(page, 'Review');
  await expect(page.locator('[data-rule="machine-boundary"]')).toHaveAttribute('data-status', 'pass');
  await page.getByRole('button', { name: /3D/ }).first().click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();
  await page.getByRole('link', { name: 'Client report' }).click();
  await expect(page.getByTestId('report-production-stations')).toHaveText('6');
  await expect(page.getByTestId('report-production-simulation')).toContainText('318 finished parts');
  await expect(page.getByTestId('report-production-simulation')).toContainText('39.8 parts/hour');
  await expect(page.getByTestId('report-picture')).toBeVisible({ timeout: 15_000 });
});
