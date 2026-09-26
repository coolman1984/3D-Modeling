import { expect, test } from '@playwright/test';
import { saved } from './helpers.js';

test('sample company: add it, re-slot the main DC, find a material and empty one location', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('add-sample').click();
  await expect(page.getByRole('status').filter({ hasText: 'Added Nile Gate Logistics' })).toBeVisible();
  const list = await (await page.request.get('/api/projects')).json() as Array<{ id: string; name: string }>;
  const dc = list.find((p) => p.name.includes('10th of Ramadan DC'))!;
  expect(list.filter((p) => p.name.includes('Try it'))).toHaveLength(1);

  await page.goto(`/#/p/${dc.id}`);
  await expect(page.getByTestId('stock-occupied')).toContainText('of 1,680 locations');
  await page.getByTestId('optimise-slotting').click();
  await expect(page.getByTestId('slotting-proposal')).toContainText('forklift travel');
  await page.getByTestId('slotting-proposal').getByRole('button', { name: 'Apply' }).click();
  await saved(page);
  const history = await (await page.request.get(`/api/projects/${dc.id}/history`)).json() as Array<{ revision: number }>;
  expect(history[0]!.revision).toBe(1);

  const find = page.getByRole('list', { name: 'Materials in stock' }).getByRole('button').first();
  await find.click();
  await expect(find).toHaveAttribute('aria-pressed', 'true');
  await find.click();

  await page.locator('[data-item-id="W01"]').click();
  await expect(page.getByTestId('rack-locations')).toBeVisible();
  const full = page.getByTestId('rack-locations').locator('.rack-cell.full').first();
  const before = await page.getByTestId('rack-locations').locator('.rack-cell.full').count();
  await full.click();
  await expect(page.getByTestId('selected-slot')).toContainText('W01-B');
  await page.getByLabel('Material in this location').selectOption('');
  await saved(page);
  await expect(page.getByTestId('rack-locations').locator('.rack-cell.full')).toHaveCount(before - 1);

  await page.getByRole('button', { name: /3D/ }).first().click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();
});
