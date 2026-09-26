import { expect, test } from '@playwright/test';
import { saved } from './helpers.js';

test('sample company: add it, re-slot the main DC, find a material and empty one location', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('add-sample').click();
  await page.getByTestId('add-sample-nile-gate').click();
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

test('second sample company: Samsung Egypt lists as its own group and its campus opens outdoors in 3D', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('add-sample').click();
  await page.getByTestId('add-sample-samsung-egypt').click();
  await expect(page.getByRole('status').filter({ hasText: 'Added Samsung Electronics Egypt · Beni Suef · 10 projects' })).toBeVisible();
  const group = page.locator('[data-group="samsung-egypt"]');
  await expect(group.locator('.proj-group-count')).toHaveText('10 projects');

  const list = await (await page.request.get('/api/projects')).json() as Array<{ id: string; name: string; collection: string | null }>;
  const campus = list.find((p) => p.collection === 'samsung-egypt' && p.name.includes('campus'))!;
  expect(list.filter((p) => p.collection === 'samsung-egypt')).toHaveLength(10);

  await page.goto(`/#/p/${campus.id}`);
  await expect(page.locator('[data-item-id]').first()).toBeVisible();
  await page.getByRole('button', { name: /3D/ }).first().click();
  const view = page.getByTestId('view3d');
  await expect(view.locator('canvas')).toBeVisible();
  await expect(view).toHaveClass(/outdoor/);
  await expect(view).toContainText('Site with sky and sun');

  // The graphics level: one click to the next level, a new canvas, and it is remembered.
  const levels = ['fast', 'balanced', 'high'];
  const before = (await view.getAttribute('data-quality'))!;
  const after = levels[(levels.indexOf(before) + 1) % levels.length]!;
  await page.getByTestId('graphics-quality').click();
  await expect(view).toHaveAttribute('data-quality', after);
  await expect(view.locator('canvas')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('space-planner.graphics'))).toBe(after);
});
