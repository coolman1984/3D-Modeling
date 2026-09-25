import { expect, test } from '@playwright/test';
import { openTab, saved } from './helpers.js';

const revision = async (page: import('@playwright/test').Page, id: string) => (await (await page.request.get(`/api/projects/${id}`)).json()) as { revision: number; space: { meta: Record<string, unknown>; zones: Array<{ id: string }> } };

test('a warehouse: rack rows, truck, aisle and access rules, a blocked aisle, the route, undo and report', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('input[name="project-name"]').fill('North DC');
  await page.locator('[data-activity="warehouse"]').click();
  await expect(page.locator('input[name="new-width"]')).toHaveValue('48');
  await page.locator('input[name="new-width"]').fill('30');
  await page.locator('input[name="new-depth"]').fill('20');
  await page.locator('input[name="new-ceiling"]').fill('8');
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText('North DC');
  await saved(page);
  const id = /#\/p\/([\w-]+)/.exec(page.url())![1]!;

  // Warehouses open on the warehouse panel, with two docks and a staging area drawn on the plan.
  const panel = page.getByTestId('warehouse-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-zone]')).toHaveCount(3);
  await expect(panel.locator('[data-zone-row]')).toHaveCount(3);
  await expect(page.getByTestId('truck-needs')).toContainText('Needs a 2.90 m aisle');

  // Three rows of four bays from (5, 10) m with a 3 m aisle: one revision.
  await panel.getByLabel('Bays per row').fill('4');
  await panel.getByLabel('Number of rows').fill('3');
  await panel.getByLabel('Aisle width').fill('3');
  await panel.getByLabel('First bay x').fill('5');
  await panel.getByLabel('First bay y').fill('10');
  await page.getByTestId('add-rows').click();
  await expect(page.locator('[data-item-id]')).toHaveCount(12);
  await saved(page);
  expect((await revision(page, id)).revision).toBe(1);
  await expect(page.getByTestId('locations')).toHaveText('180');
  await expect(page.getByTestId('bays')).toHaveText('12');

  // The reach truck fits the 3 m aisle and reaches every bay.
  await openTab(page, 'Review');
  await expect(page.locator('[data-rule="aisle-width"]')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="rack-access"]')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="ceiling-clearance"]')).toHaveAttribute('data-status', 'pass');

  // A counterbalance truck needs 3.5 m: the aisle fails. The truck is project data (a revision).
  await panel.getByRole('button', { name: 'Counterbalance' }).click();
  await saved(page);
  await expect(page.locator('[data-rule="aisle-width"]')).toHaveAttribute('data-status', 'fail');
  expect((await revision(page, id)).space.meta).toEqual({ pack: 'warehouse', truck: 'counterbalance' });
  await panel.getByRole('button', { name: 'Reach truck' }).click();
  await saved(page);
  await expect(page.locator('[data-rule="aisle-width"]')).toHaveAttribute('data-status', 'pass');

  // Select a bay in the middle aisle: its facts, and the truck's route drawn on the plan.
  await openTab(page, 'Properties');
  await page.locator('[data-item-id="rack-bay-5"]').click();
  await expect(page.getByTestId('bay-locations')).toHaveText('15 · 5 levels × 3');
  await expect(page.getByTestId('bay-aisle')).toHaveText('3.00 m · needs 2.90 m');
  await expect(page.getByTestId('bay-travel')).toHaveText(/^\d+\.\d\d m$/);
  await expect(page.getByTestId('route')).toBeVisible();

  // Close both ends of that aisle with no-go zones: the bays inside are cut off.
  await panel.getByRole('button', { name: 'No-go' }).click();
  const zone = async (x: string, y: string, w: string, d: string) => {
    await panel.getByLabel('Zone x').fill(x);
    await panel.getByLabel('Zone y').fill(y);
    await panel.getByLabel('Zone width').fill(w);
    await panel.getByLabel('Zone depth').fill(d);
    await page.getByTestId('add-zone').click();
    await saved(page);
  };
  await zone('0', '12.4', '5', '3');
  await zone('16.2', '12.4', '13.8', '3');
  await expect(page.locator('[data-zone]')).toHaveCount(5);
  await expect(page.getByTestId('bay-travel')).toHaveText('Not reachable');
  await expect(page.getByTestId('route')).toHaveCount(0);
  await openTab(page, 'Review');
  await expect(page.locator('[data-rule="rack-access"]')).toHaveAttribute('data-status', 'fail');
  await page.screenshot({ path: 'e2e-results/warehouse.png' });

  // Undo opens the east end again: every bay is reachable.
  await page.locator('svg.plan').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-zone]')).toHaveCount(4);
  await expect(page.locator('[data-rule="rack-access"]')).toHaveAttribute('data-status', 'pass');
  await saved(page);
  expect((await revision(page, id)).space.zones.map((z) => z.id)).toEqual(['dock-1', 'dock-2', 'staging-1', 'no-go-1']);

  // 3D: twelve bays, drawn with instancing.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-items', '12');
  await page.screenshot({ path: 'e2e-results/warehouse-3d.png' });

  // The client report leads with capacity.
  await page.getByRole('link', { name: 'Client report' }).click();
  await expect(page.getByTestId('report-locations')).toHaveText('180');
  await expect(page.getByTestId('report-rules').locator('[data-rule="rack-access"]')).toBeVisible();
  await expect(page.getByTestId('report-picture')).toBeVisible({ timeout: 15_000 });
});
