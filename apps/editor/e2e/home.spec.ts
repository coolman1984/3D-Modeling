import { expect, test } from '@playwright/test';
import { saved } from './helpers.js';

test('apartment: a furnished one-bedroom in one click, hung art on a wall, 3D, and a dark theme kept', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  // Apartment is the first activity and chosen already; the furnished layout needs no name.
  await expect(page.locator('[data-activity="home"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-template="home-one-bedroom"]').click();
  await expect(page.getByTestId('furnished-preview')).toBeVisible();
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText('One bedroom apartment');
  await saved(page);
  const id = /#\/p\/([\w-]+)/.exec(page.url())![1]!;

  // The plan reads like an interior plan: symbols, room names with areas, and no issues.
  await expect(page.locator('.item-symbol').first()).toBeVisible();
  await expect(page.locator('.room-label').filter({ hasText: 'BEDROOM' })).toBeVisible();
  await expect(page.getByText('No issues found')).toBeVisible();

  // A print from the Decor shelf goes on a wall, at its own height, facing the room.
  const before = Object.keys((await (await page.request.get(`/api/projects/${id}`)).json()).items).length;
  await page.getByRole('tab', { name: /^Decor/ }).click();
  await page.locator('[data-add="home-art-60"]').click();
  await expect(page.getByTestId('save-state')).toHaveText('Saved · Revision 1');
  const after = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(Object.keys(after.items)).toHaveLength(before + 1);
  const art = Object.values(after.items as Record<string, { definitionId: string; elevation?: number }>).filter((i) => i.definitionId === 'home-art-60');
  expect(art).toHaveLength(1);
  expect(art[0]!.elevation).toBe(12_000);

  await page.getByRole('button', { name: /3D/ }).first().click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();

  // Appearance: dark theme and larger text apply at once and are kept after a reload.
  await page.goto('/#/settings');
  await page.locator('[data-theme-choice="dark"]').click();
  await page.getByRole('button', { name: 'Larger' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ts').trim())).toBe('1.22');
});
