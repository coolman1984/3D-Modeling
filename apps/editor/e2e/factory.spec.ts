import { expect, test } from '@playwright/test';
import { openTab, saved, send } from './helpers.js';

test('a production line: stations, flows in the inspector, rules, a crossing, simulation, undo and report', async ({ page }) => {
  await page.goto('/#/');
  await page.getByRole('button', { name: 'Create project' }).first().click();
  await page.locator('input[name="project-name"]').fill('Line 1');
  await page.locator('[data-activity="factory"]').click();
  await expect(page.locator('input[name="new-width"]')).toHaveValue('40');
  await page.locator('input[name="new-width"]').fill('30');
  await page.locator('input[name="new-depth"]').fill('15');
  await page.getByTestId('create-project').click();
  await expect(page.locator('h1.project-name')).toHaveText('Line 1');
  await saved(page);
  const id = /#\/p\/([\w-]+)/.exec(page.url())![1]!;
  await expect(page.getByTestId('line-panel')).toBeVisible();

  // Four stations along y = 7 m facing east (placed the way any client does: one revision).
  const at = (itemId: string, definitionId: string, x: number) => ({ type: 'item.add', item: { id: itemId, definitionId, position: { x: x * 10_000, y: 70_000 }, rotation: 270_000, locked: false } });
  await send(page, id, [at('in', 'goods-in', 3), at('cnc-1', 'cnc', 8), at('asm', 'assembly', 14), at('out', 'goods-out', 20)]);
  await expect(page.locator('[data-item-id]')).toHaveCount(4);
  await expect(page.getByTestId('station-count')).toHaveText('4');

  // Connect them from the inspector: each flow is one revision.
  const connect = async (from: string, to: string) => {
    await page.locator(`[data-station="${from}"]`).click();
    await page.getByLabel('Flow', { exact: true }).getByLabel('Send parts to').selectOption(to);
    await expect(page.locator(`[data-flow="${from}>${to}"]`)).toHaveCount(1); // a level arrow has no height, so count it
    await saved(page);
  };
  await openTab(page, 'Properties');
  await connect('in', 'cnc-1');
  await connect('cnc-1', 'asm');
  await connect('asm', 'out');
  await expect(page.getByTestId('station-cycle')).toHaveText('60 s'); // the assembly bench, still selected
  await expect(page.locator('[data-maintenance="cnc-1"]')).toHaveCount(1);

  // Undo the last flow in this window: the line is broken; redo mends it. (A change from
  // elsewhere restarts this window's undo list, so this comes before the second line.)
  await page.locator('svg.plan').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-flow="asm>out"]')).toHaveCount(0);
  await openTab(page, 'Review');
  await expect(page.locator('[data-rule="flow-links"]')).toHaveAttribute('data-status', 'fail');
  await page.keyboard.press('Control+y');
  await expect(page.locator('[data-flow="asm>out"]')).toHaveCount(1);
  await saved(page);
  await openTab(page, 'Properties');

  // Cycle times are entered by people: make the assembly bench a 100 s station in its type dialog,
  // check the simulation follows, then set it back to 60 s.
  const setAssemblyCycle = async (seconds: string) => {
    await page.locator('[data-station="asm"]').click();
    await page.getByRole('button', { name: /Edit item type/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Item type' });
    await expect(dialog.getByLabel('Station kind')).toHaveValue('machine');
    await dialog.getByLabel('Cycle time in seconds').fill(seconds);
    await dialog.getByRole('button', { name: 'Save item type' }).click();
    await saved(page);
  };
  await setAssemblyCycle('100');
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).catalog.assembly.meta).toEqual({ station: 'machine', cycle: 100_000 });
  await expect(page.getByTestId('station-cycle')).toHaveText('100 s');
  await setAssemblyCycle('60');

  // Rules: maintenance space free, flows complete, room to move material, no crossings.
  await openTab(page, 'Review');
  for (const code of ['maintenance-access', 'flow-links', 'flow-path', 'flow-crossings']) await expect(page.locator(`[data-rule="${code}"]`)).toHaveAttribute('data-status', 'pass');

  // One shift from the cycle times: the 90 s CNC sets the pace.
  await page.getByLabel('Hours to simulate').fill('8');
  await page.getByTestId('simulate').click();
  await expect(page.getByTestId('sim-produced')).toHaveText('318');
  await expect(page.getByTestId('sim-rate')).toHaveText('39.8');
  await expect(page.getByTestId('sim-bottleneck')).toHaveText('cnc-1');
  await page.screenshot({ path: 'e2e-results/factory.png' });

  // A second line across the first: the crossing is flagged in red.
  await send(page, id, [
    { type: 'item.add', item: { id: 'in-2', definitionId: 'goods-in', position: { x: 120_000, y: 20_000 }, rotation: 0, locked: false, meta: { next: 'out-2' } } },
    { type: 'item.add', item: { id: 'out-2', definitionId: 'goods-out', position: { x: 120_000, y: 120_000 }, rotation: 0, locked: false } },
  ]);
  await expect(page.locator('.flow.crossing')).toHaveCount(2);
  await expect(page.getByTestId('crossings')).toHaveText('1');
  await expect(page.locator('[data-rule="flow-crossings"]')).toHaveAttribute('data-status', 'fail');

  // 3D shows every station; the report states the simulated shift.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-items', '6');
  await page.screenshot({ path: 'e2e-results/factory-3d.png' });
  await page.getByRole('link', { name: 'Client report' }).click();
  // Both lines count: 318 parts from the first, 480 straight from goods in to goods out → 798 / 8 h.
  await expect(page.getByTestId('report-rate')).toHaveText('99.8');
  await expect(page.getByTestId('report-crossings')).toHaveText('1');
  await expect(page.getByTestId('report-picture')).toBeVisible({ timeout: 15_000 });
});
