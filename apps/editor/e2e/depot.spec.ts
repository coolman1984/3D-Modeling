import { expect, test } from '@playwright/test';
import { openTab, saved, send } from './helpers.js';

test('a depot: a row of car bays, every bay driven in and out, the swept path, a walled-in bay, 3D and report', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('input[name="project-name"]').fill('Yard A');
  await page.locator('[data-activity="depot"]').click();
  await expect(page.locator('input[name="new-width"]')).toHaveValue('40');
  await page.locator('input[name="new-width"]').fill('30');
  await page.locator('input[name="new-depth"]').fill('20');
  await page.locator('input[name="new-ceiling"]').fill('5');
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText('Yard A');
  await saved(page);
  const id = /#\/p\/([\w-]+)/.exec(page.url())![1]!;

  // Depots open on the bays panel, with the gate drawn.
  const panel = page.getByTestId('depot-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-zone="gate-1"]')).toHaveCount(1);

  // Five 2.5 × 5 m car bays along y = 12 m: one revision, each checked by driving the car in and out.
  await expect(panel.getByLabel('Bay vehicle')).toHaveValue('car'); // the pack's order, not A–Z
  await panel.getByLabel('Number of bays').fill('5');
  await panel.getByLabel('Bay width').fill('2.5');
  await panel.getByLabel('Bay length').fill('5');
  await panel.getByLabel('Row start x').fill('4');
  await panel.getByLabel('Row start y').fill('12');
  await page.getByTestId('add-bays').click();
  await saved(page);
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).revision).toBe(1);
  await expect(panel.locator('[data-bay]')).toHaveCount(5);
  await expect(panel.locator('[data-bay][data-status="pass"]')).toHaveCount(5, { timeout: 15_000 });
  await expect(page.getByTestId('usable-bays')).toHaveText('5');
  await openTab(page, 'Review');
  await expect(page.locator('[data-rule="bay-access"]')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="bay-size"]')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="gates"]')).toHaveAttribute('data-status', 'pass');

  // Choose a bay: its car's swept path in and out is drawn on the plan.
  await panel.locator('[data-bay="bay-3"] .bay-pick').click();
  await expect(page.locator('[data-path="enter"]')).toHaveCount(1);
  await expect(page.locator('[data-path="leave"]')).toHaveCount(1);
  expect(await page.locator('[data-swept]').count()).toBeGreaterThan(10);
  await page.screenshot({ path: 'e2e-results/depot.png' });

  // A car parked in bay 4 and walls on the other three sides of bay 5: bay 5 cannot be used.
  const wall = (wid: string, x0: number, y0: number, x1: number, y1: number) => ({ id: wid, kind: 'blocked-zone', polygon: [{ x: x0 * 1e4, y: y0 * 1e4 }, { x: x1 * 1e4, y: y0 * 1e4 }, { x: x1 * 1e4, y: y1 * 1e4 }, { x: x0 * 1e4, y: y1 * 1e4 }] });
  const current = await (await page.request.get(`/api/projects/${id}`)).json();
  await send(page, id, [
    { type: 'item.add', item: { id: 'car-b', definitionId: 'car', position: { x: 127_500, y: 145_000 }, rotation: 0, locked: false } },
    { type: 'space.set', space: { ...current.space, obstacles: [wall('front', 14, 11.6, 16.8, 12), wall('end', 16.5, 12, 16.8, 17.3), wall('north', 13.9, 17, 16.8, 17.3)] } },
  ]);
  await expect(panel.locator('[data-bay="bay-5"]')).toHaveAttribute('data-status', 'fail', { timeout: 15_000 });
  await expect(page.locator('[data-rule="bay-access"]')).toHaveAttribute('data-status', 'fail');
  await expect(page.getByTestId('usable-bays')).toHaveText('4');

  // 3D shows the parked car; the report leads with usable bays.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-items', '1');
  await page.screenshot({ path: 'e2e-results/depot-3d.png' });
  await page.getByRole('link', { name: 'Client report' }).click();
  await expect(page.getByTestId('report-usable')).toHaveText('4');
  await expect(page.getByTestId('report-rules').locator('[data-rule="bay-access"]')).toBeVisible();
  await expect(page.getByTestId('report-picture')).toBeVisible({ timeout: 15_000 });
});
