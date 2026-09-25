import { expect, test } from '@playwright/test';
import { saved } from './helpers.js';

test('variants: try an idea in a variant, compare it with the approved plan, adopt it as one revision', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('input[name="project-name"]').fill('Site A');
  await page.locator('[data-activity="warehouse"]').click();
  await page.locator('input[name="new-width"]').fill('30');
  await page.locator('input[name="new-depth"]').fill('20');
  await page.locator('input[name="new-ceiling"]').fill('8');
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText('Site A');
  await saved(page);
  const baseId = /#\/p\/([\w-]+)/.exec(page.url())![1]!;

  // A variant starts as a copy and opens on its own.
  await page.getByRole('button', { name: 'Variants' }).click();
  await expect(page.getByTestId('variants-table').locator('thead th[data-variant]')).toHaveCount(1);
  await page.getByLabel('Variant name').fill('Three rows');
  await page.getByTestId('new-variant').click();
  await expect(page.locator('h1.project-name')).toHaveText('Three rows');
  await saved(page);
  const variantId = /#\/p\/([\w-]+)/.exec(page.url())![1]!;
  expect(variantId).not.toBe(baseId);

  // Change the variant only.
  const panel = page.getByTestId('warehouse-panel');
  await panel.getByLabel('Bays per row').fill('4');
  await panel.getByLabel('Number of rows').fill('3');
  await panel.getByLabel('Aisle width').fill('3');
  await panel.getByLabel('First bay x').fill('5');
  await panel.getByLabel('First bay y').fill('10');
  await page.getByTestId('add-rows').click();
  await saved(page);

  // Side by side: the variant has the most pallet locations; the approved plan is untouched.
  await page.getByRole('button', { name: 'Variants' }).click();
  const table = page.getByTestId('variants-table');
  await expect(table.locator('thead th[data-variant]')).toHaveCount(2);
  const locations = table.locator('tbody tr', { hasText: 'Pallet locations' });
  await expect(locations.locator('td').nth(0)).toHaveText('0');
  await expect(locations.locator('td').nth(1)).toHaveText('180');
  await expect(locations.locator('td.best')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Variants' })).toBeVisible();
  await page.waitForTimeout(250); // let the dialog finish fading in for the picture
  await page.screenshot({ path: 'e2e-results/variants.png' });
  expect(Object.keys((await (await page.request.get(`/api/projects/${baseId}`)).json()).items)).toHaveLength(0);

  // Adopt: the approved plan takes the variant's layout as one new revision, under the person's name.
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId(`adopt-${variantId}`).click();
  await expect(page.locator('h1.project-name')).toHaveText('Site A');
  await expect(page.locator('[data-item-id]')).toHaveCount(12);
  const history = await (await page.request.get(`/api/projects/${baseId}/history`)).json();
  expect(history[0]).toMatchObject({ revision: 1, actor: 'human', summary: 'Adopted variant “Three rows”' });

  // The projects page shows which plan a variant belongs to.
  await page.goto('/#/');
  await expect(page.locator(`[data-project="${variantId}"]`)).toContainText('Variant of Site A');
});
