import { expect, test } from '@playwright/test';
import { openTab, saved } from './helpers.js';

test('reference vehicle depot: bay counts, entry check, add a bay, and print report', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('[data-template="depot"]').click();
  await page.locator('input[name="project-name"]').fill('Fleet depot 1');
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText('Fleet depot 1');
  await saved(page);
  const id = /#\/p\/([\w-]+)/.exec(page.url())![1]!;
  await expect(page.getByTestId('depot-bays')).toContainText('6');
  await expect(page.locator('[data-item-id]')).toHaveCount(2);

  await page.selectOption('select[aria-label="Bay to check"]', 'BAY03');
  await page.getByRole('button', { name: 'Show entry path' }).click();
  await expect(page.locator('.depot-entry')).toContainText('Clear');

  await page.getByLabel('Bay x').fill('25');
  await page.getByLabel('Bay y').fill('13');
  await page.getByRole('button', { name: 'Add bay' }).click();
  await saved(page);
  await expect(page.getByTestId('depot-bays')).toContainText('7');
  const project = await (await page.request.get(`/api/projects/${id}`)).json();
  const zones: Array<{ kind: string }> = project.space.zones;
  expect(zones.filter((z) => z.kind === 'bay')).toHaveLength(7);

  await openTab(page, 'Review');
  await expect(page.locator('[data-rule="bay-boundary"]')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="bay-entry"]')).toHaveAttribute('data-status', 'pass');

  await page.getByRole('button', { name: /^3D/ }).first().click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();

  await page.getByRole('link', { name: 'Client report' }).click();
  await expect(page.getByTestId('report-depot-bays')).toContainText('7');
  await expect(page.getByTestId('report-picture')).toBeVisible({ timeout: 15_000 });
});
