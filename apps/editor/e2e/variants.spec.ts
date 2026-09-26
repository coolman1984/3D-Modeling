import { expect, test } from '@playwright/test';
import { saved } from './helpers.js';

test('variants: change an alternative only, compare it, then adopt it as one base revision', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('[data-template="warehouse"]').click();
  await page.locator('input[name="project-name"]').fill('Variant safety warehouse');
  await page.getByTestId('create-project').click();
  await saved(page);

  const baseId = /#\/p\/([\w-]+)/.exec(page.url())![1]!;
  await expect(page.getByTestId('warehouse-capacity')).toContainText('240');

  // Create an alternative. The approved base remains untouched.
  await page.getByRole('button', { name: 'Variants' }).click();
  const firstDialog = page.getByRole('dialog', { name: 'Variants' });
  await expect(firstDialog).toBeVisible();
  await expect(firstDialog.locator('thead th[data-variant]')).toHaveCount(1);
  await firstDialog.getByLabel('Variant name').fill('Five-bay first row');
  await firstDialog.getByTestId('new-variant').click();
  await saved(page);

  const variantId = /#\/p\/([\w-]+)/.exec(page.url())![1]!;
  expect(variantId).not.toBe(baseId);

  // Change only the variant using the real rack inspector.
  await page.locator('[data-item-id="R01"]').click();
  await page.getByLabel('Rack bays').fill('5');
  await page.getByLabel('Rack bays').press('Enter');
  await saved(page);
  await expect(page.getByTestId('warehouse-capacity')).toContainText('232');

  // The base is still 240 and the comparison shows both alternatives.
  const baseBefore = await (await page.request.get(`/api/projects/${baseId}`)).json();
  expect(baseBefore.revision).toBe(0);
  await page.getByRole('button', { name: 'Variants' }).click();
  const dialog = page.getByRole('dialog', { name: 'Variants' });
  await expect(dialog.locator('thead th[data-variant]')).toHaveCount(2);
  const locations = dialog.locator('tbody tr', { hasText: 'Pallet locations' });
  await expect(locations.locator('td').nth(0)).toHaveText(/240/);
  await expect(locations.locator('td').nth(1)).toHaveText(/232/);

  // Adoption is explicit and becomes exactly one undoable base revision.
  page.once('dialog', (d) => void d.accept());
  await dialog.getByTestId(`adopt-${variantId}`).click();
  await expect(page).toHaveURL(new RegExp(`#\\/p\\/${baseId}$`));
  await expect(page.getByTestId('warehouse-capacity')).toContainText('232');
  await saved(page);

  const history = await (await page.request.get(`/api/projects/${baseId}/history`)).json();
  expect(history[0]).toMatchObject({
    revision: 1,
    actor: 'human',
    summary: 'Adopted variant “Five-bay first row”',
  });
  expect(history).toHaveLength(2);

  // The variant remains preserved after adoption.
  const variantAfter = await (await page.request.get(`/api/projects/${variantId}`)).json();
  expect(variantAfter.items.R01).toBeDefined();
});
