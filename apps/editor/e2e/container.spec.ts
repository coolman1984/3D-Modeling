import { expect, test } from '@playwright/test';
import { openTab, saved } from './helpers.js';

test('a container load: plan the cargo, compare packing plans, apply one, inspect, play back, undo and report', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('input[name="project-name"]').fill('Order 4471');
  await page.locator('[data-activity="container"]').click();
  await page.locator('[data-container="20gp"]').click();
  await expect(page.getByRole('dialog')).toContainText('Inside 5.89 × 2.35 × 2.39 m');
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText('Order 4471');
  await saved(page);
  const id = /#\/p\/([\w-]+)/.exec(page.url())![1]!;

  // Containers open on the loading plan, in plan + 3D.
  await expect(page.getByLabel('Loading plan', { exact: true })).toBeVisible();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('room-size')).toContainText('5.89 × 2.35 m');

  // Plan ten euro pallets and let the packer propose.
  const qty = page.getByLabel('Quantity of Euro pallet 120 × 80');
  await qty.fill('10');
  await qty.press('Enter');
  await saved(page);
  await expect(page.getByTestId('unpacked')).toHaveText('10');
  await page.getByTestId('find-plans').click();
  // One cargo type: the three strategies give the same plan, so it is offered once.
  await expect(page.locator('[data-candidate]')).toHaveCount(1);
  await expect(page.locator('[data-candidate="0"]')).toContainText('placed 10 of 10 pieces');
  await page.locator('[data-candidate="0"]').getByRole('button', { name: 'Apply this plan' }).click();
  await expect(page.locator('[data-item-id]')).toHaveCount(10);
  await expect(page.getByTestId('unpacked')).toHaveText('0');
  await saved(page);
  // One plan = one revision (create, quantity, plan).
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).revision).toBe(2);

  // The loading rules run in the review.
  await openTab(page, 'Review');
  await expect(page.locator('[data-rule="payload"]')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="unpacked"]')).toHaveAttribute('data-status', 'pass');
  await expect(page.locator('[data-rule="support"]')).toHaveAttribute('data-status', 'pass');

  // Select a pallet: the inspector shows its cargo data; give it an unloading stop.
  await openTab(page, 'Properties');
  await page.locator('[data-item-id="euro-pallet-1"]').click();
  const cargo = page.getByLabel('Cargo', { exact: true });
  await expect(cargo).toContainText('400 kg');
  await expect(cargo).toContainText('No · this way up');
  await cargo.getByLabel('Unloading stop').fill('2');
  await cargo.getByLabel('Unloading stop').press('Enter');
  await saved(page);
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).items['euro-pallet-1'].meta).toMatchObject({ stop: 2, step: expect.any(Number) });

  // The "Cut away side wall" tick box keeps the focus after a click; the arrows must still move
  // the selected pallet (they used to stop working until something else was clicked).
  const cut = page.locator('.container-tools input[type="checkbox"]');
  await cut.click();
  await cut.click();
  await expect(cut).toBeFocused();
  const x0 = (await (await page.request.get(`/api/projects/${id}`)).json()).items['euro-pallet-1'].position.x;
  await page.keyboard.press('ArrowRight');
  await saved(page);
  const x1 = (await (await page.request.get(`/api/projects/${id}`)).json()).items['euro-pallet-1'].position.x;
  expect(x1).toBeGreaterThan(x0);
  await page.keyboard.press('Control+z'); // leave the history as the rest of this journey expects
  await saved(page);

  // Colour by loading step numbers the pieces on the plan; playback empties and refills the 3D view.
  // A piece now has a drop, so "Delivery drop" is offered and says what it means.
  await page.locator('.container-tools').getByRole('button', { name: 'Delivery drop' }).click();
  await expect(page.getByTestId('color-by-hint')).toContainText('Drop 1 is unloaded first');
  await page.locator('.container-tools').getByRole('button', { name: 'Load order' }).click();
  await expect(page.locator('[data-item-id] .item-label').first()).toHaveText(/^\d+$/);
  const slider = page.locator('.sequence input[type="range"]');
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('sequence-label')).toHaveText('Empty');
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-items', '0');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('sequence-label')).toHaveText('Loading step 2 of 10');
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-items', '2');
  await page.keyboard.press('End');
  await expect(page.getByTestId('sequence-label')).toHaveText('Fully loaded');
  await page.screenshot({ path: 'e2e-results/container.png' });

  // The whole plan is one step back and forth.
  await page.locator('svg.plan').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-item-id]')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.locator('[data-item-id]')).toHaveCount(10);
  await page.keyboard.press('Control+y');
  await saved(page);

  // The client report shows the load and its sequence.
  await page.getByRole('link', { name: 'Client report' }).click();
  await expect(page.getByTestId('report-pieces')).toHaveText('10');
  await expect(page.getByTestId('report-sequence').locator('tbody tr')).toHaveCount(10);
  await expect(page.getByTestId('report-rules').locator('[data-rule="unloading-order"]')).toBeVisible();
  await expect(page.getByTestId('report-picture')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'e2e-results/container-report.png', fullPage: true });
});
