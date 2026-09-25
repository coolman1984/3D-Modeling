import { expect, test } from '@playwright/test';
import { openTab, saved } from './helpers.js';

test('a restaurant: compare table layouts, apply one, service routes and exits, a terrace, 3D and report', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('input[name="project-name"]').fill('Bistro');
  await page.locator('[data-activity="restaurant"]').click();
  await expect(page.locator('input[name="new-width"]')).toHaveValue('20');
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText('Bistro');
  await saved(page);
  const id = /#\/p\/([\w-]+)/.exec(page.url())![1]!;

  const panel = page.getByTestId('dining-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-item-id="pass-1"]')).toHaveCount(1);
  await expect(page.locator('[data-zone="dining-1"]')).toHaveCount(1);

  // Three proposals for 4-tops: 23, 20, 12 tables. Proposing changes nothing.
  await page.getByTestId('propose-layouts').click();
  await expect(panel.locator('[data-candidate]')).toHaveCount(3);
  await expect(panel.locator('[data-candidate="0"]')).toContainText('92 covers');
  await expect(panel.locator('[data-candidate="1"]')).toContainText('80 covers');
  await expect(panel.locator('[data-candidate="2"]')).toContainText('48 covers');
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).revision).toBe(0);

  // Apply the balanced one: one revision, 80 covers, every table reachable from the pass.
  await panel.locator('[data-candidate="1"]').getByRole('button', { name: 'Apply this layout' }).click();
  await saved(page);
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).revision).toBe(1);
  await expect(page.getByTestId('covers')).toHaveText('80');
  await expect(page.getByTestId('unreachable')).toHaveText('0');
  await openTab(page, 'Review');
  await expect(page.locator('[data-rule="service-route"]')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="walkway"]')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="floor-per-cover"]')).toHaveAttribute('data-status', 'pass');
  // 80 guests need two exits; the room has one door: the rule says so.
  await expect(page.locator('[data-rule="exits"]')).toHaveAttribute('data-status', 'fail');
  await page.screenshot({ path: 'e2e-results/restaurant.png' });

  // Undo the layout, redo it.
  await page.locator('svg.plan').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('covers')).toHaveText('0');
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('covers')).toHaveText('80');
  await saved(page);

  // A terrace zone (a revision of its own).
  await panel.getByRole('group', { name: 'Zone kind' }).getByRole('button', { name: 'Terrace' }).click();
  await panel.getByLabel('Zone x').fill('1');
  await panel.getByLabel('Zone y').fill('11.2');
  await panel.getByLabel('Zone width').fill('5');
  await panel.getByLabel('Zone depth').fill('2');
  await page.getByTestId('add-zone').click();
  await saved(page);
  await expect(page.locator('[data-zone="terrace-1"]')).toHaveCount(1);

  // 3D: 20 tables and the pass; the report leads with covers.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-items', '21');
  await page.screenshot({ path: 'e2e-results/restaurant-3d.png' });
  await page.getByRole('link', { name: 'Client report' }).click();
  await expect(page.getByTestId('report-covers')).toHaveText('80');
  await expect(page.getByTestId('report-picture')).toBeVisible({ timeout: 15_000 });
});
