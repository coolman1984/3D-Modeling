import { expect, test, type Page } from '@playwright/test';
import { newProject, openPanel, saved } from './helpers.js';

interface Item {
  position: { x: number; y: number };
  rotation: number;
  elevation?: number;
}

async function items(page: Page, id: string): Promise<Record<string, Item>> {
  await saved(page);
  return (await (await page.request.get(`/api/projects/${id}`)).json()).items;
}

async function revisions(page: Page, id: string): Promise<number> {
  await saved(page);
  return (await (await page.request.get(`/api/projects/${id}`)).json()).revision;
}

async function centreOf(page: Page, id: string) {
  const box = (await page.locator(`[data-item-id="${id}"]`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const plan = (page: Page) => page.locator('svg.plan');

/** The arrow step shown in the status bar ("Arrow 5 cm"), in ticks. */
async function arrowStepTicks(page: Page): Promise<number> {
  const text = (await page.getByTestId('arrow-step').textContent())!;
  const [, value, unit] = /Arrow ([\d.,]+) (mm|cm|m)/.exec(text)!;
  return Math.round(Number(value!.replace(/,/g, '')) * (unit === 'm' ? 10_000 : unit === 'cm' ? 100 : 10));
}

test('arrow keys: a visible step, the view moves when nothing is selected, and a tick box does not steal them', async ({ page }) => {
  const id = await newProject(page, 'Arrow Hall');
  await page.locator('[data-add="chair"]').click();
  await saved(page);

  // Nothing selected: the arrows pan the plan and leave the design alone.
  await page.keyboard.press('Escape');
  const rev = await revisions(page, id);
  const before = (await page.locator('path.floor').boundingBox())!;
  await page.keyboard.press('ArrowRight');
  const after = (await page.locator('path.floor').boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 30);
  expect(await revisions(page, id)).toBe(rev);

  // A clicked switch keeps the focus, but the arrows still move the selected chair.
  await openPanel(page, 'Precision');
  const guides = page.locator('[data-name="control-guides"]');
  await guides.click();
  await guides.click();
  await page.locator('[data-item-id="chair-1"]').click();
  const start = (await items(page, id))['chair-1']!.position.x;
  const step = await arrowStepTicks(page);
  await page.keyboard.press('ArrowRight');
  expect((await items(page, id))['chair-1']!.position.x).toBe(start + step);

  // In 3D with nothing selected the arrows turn the camera; the heading label follows.
  await page.getByRole('button', { name: /3D/ }).first().click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  const rev3d = await revisions(page, id);
  const canvas = page.getByTestId('view3d').locator('canvas');
  await page.waitForTimeout(500);
  const shotBefore = await canvas.screenshot();
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight'); // 90°
  await page.waitForTimeout(500);
  expect((await canvas.screenshot()).equals(shotBefore)).toBe(false);
  expect(await revisions(page, id)).toBe(rev3d);
});

test('select many with a box, move with the keyboard as one step, raise, copy and turn', async ({ page }) => {
  const id = await newProject(page, 'Control Hall');
  for (const add of ['table-180', 'chair', 'chair']) await page.locator(`[data-add="${add}"]`).click();
  await expect(page.locator('[data-item-id]')).toHaveCount(3);

  // Box select: drag across the whole floor from outside it.
  const floor = (await page.locator('path.floor').boundingBox())!;
  await page.mouse.move(floor.x + 3, floor.y + 3);
  await page.mouse.down();
  await page.mouse.move(floor.x + floor.width / 2, floor.y + floor.height / 2, { steps: 4 });
  await expect(page.getByTestId('marquee')).toBeVisible();
  await page.mouse.move(floor.x + floor.width - 3, floor.y + floor.height - 3, { steps: 4 });
  await page.mouse.up();
  await expect(plan(page)).toHaveAttribute('data-selected', 'chair-1 chair-2 table-180-1');
  await expect(page.getByLabel('Selected items', { exact: true })).toContainText('3 objects');

  // Holding the right arrow moves all three and is saved as one revision.
  const before = await items(page, id);
  const start = await revisions(page, id);
  for (let i = 0; i < 12; i++) await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  const after = await items(page, id);
  expect(await revisions(page, id)).toBe(start + 1);
  const moved = after['chair-1']!.position.x - before['chair-1']!.position.x;
  expect(moved).toBeGreaterThanOrEqual(12 * 100); // at least 12 × 1 cm; a long press speeds up
  expect(after['table-180-1']!.position.x - before['table-180-1']!.position.x).toBe(moved);
  expect(after['chair-2']!.position.y).toBe(before['chair-2']!.position.y);

  // Click one chair: just that one. PageUp raises it 5 cm; Shift+ArrowDown moves it ten arrow
  // steps south. The arrow step follows the zoom by default; the status bar shows it.
  await page.locator('[data-item-id="chair-1"]').click();
  await expect(plan(page)).toHaveAttribute('data-selected', 'chair-1');
  const arrow = await arrowStepTicks(page);
  expect(arrow).toBeGreaterThanOrEqual(100); // at least 1 cm: visible at this zoom
  await page.keyboard.press('PageUp');
  await page.keyboard.press('Shift+ArrowDown');
  const raised = (await items(page, id))['chair-1']!;
  expect(raised.elevation).toBe(500);
  expect(raised.position.y).toBe(after['chair-1']!.position.y - 10 * arrow);
  await expect(page.getByLabel('Elevation', { exact: true })).toHaveValue('5');

  // Shift-click adds the table; Ctrl+D copies both, and the copies become the selection.
  await page.locator('[data-item-id="table-180-1"]').click({ modifiers: ['Shift'] });
  await expect(plan(page)).toHaveAttribute('data-selected', 'chair-1 table-180-1');
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-item-id]')).toHaveCount(5);
  await expect(plan(page)).toHaveAttribute('data-selected', 'chair-3 table-180-2');
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-item-id]')).toHaveCount(3);

  // The rotation handle turns the selection and lands on the 15° steps.
  await page.locator('[data-item-id="table-180-1"]').click();
  const handle = (await page.getByTestId('rotate-handle').boundingBox())!;
  const pivot = await centreOf(page, 'table-180-1');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(pivot.x + 60, pivot.y - 45, { steps: 6 });
  await expect(page.getByTestId('readout')).toContainText('°');
  await page.mouse.move(pivot.x + 80, pivot.y - 8, { steps: 6 });
  await page.mouse.up();
  const turned = (await items(page, id))['table-180-1']!;
  expect(turned.rotation).not.toBe(0);
  expect(turned.rotation % 15_000).toBe(0);

  await page.screenshot({ path: 'e2e-results/controls.png' });
});

test('precision settings change the step and are remembered; Alt drags slowly; right button pans', async ({ page }) => {
  const id = await newProject(page, 'Precision Hall');
  await page.locator('[data-add="chair"]').click();
  await openPanel(page, 'Precision');
  await page.locator('input[name="control-step"]').fill('5');
  await page.locator('input[name="control-step"]').blur();
  const before = (await items(page, id))['chair-1']!;
  await page.locator('[data-item-id="chair-1"]').click();
  await page.keyboard.press('ArrowUp');
  expect((await items(page, id))['chair-1']!.position.y).toBe(before.position.y + 500); // 5 cm = 500 ticks
  await page.reload();
  await openPanel(page, 'Precision');
  await expect(page.locator('input[name="control-step"]')).toHaveValue('5');

  // The status bar turns snapping off and back on to the same grid.
  await expect(page.getByTestId('snap-toggle')).toHaveText('Snap on');
  await page.getByTestId('snap-toggle').click();
  await expect(page.getByTestId('snap-toggle')).toHaveText('Snap off');
  await expect(page.locator('.statusbar')).toContainText('Grid off');
  await page.getByTestId('snap-toggle').click();
  await expect(page.locator('.statusbar')).toContainText('Grid 5 cm');

  // Alt drag at 0.2× speed: 200 px of mouse travel moves the chair 40 px worth.
  const floor = (await page.locator('path.floor').boundingBox())!;
  const pxPerTick = floor.width / 120_000; // 12 m room
  const from = await centreOf(page, 'chair-1');
  const start = (await items(page, id))['chair-1']!.position.x;
  await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 100, from.y, { steps: 5 });
  await page.mouse.move(from.x + 200, from.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const travelled = ((await items(page, id))['chair-1']!.position.x - start) * pxPerTick;
  expect(travelled).toBeGreaterThan(30);
  expect(travelled).toBeLessThan(50);

  // Right-button drag pans the view and leaves the design alone.
  const rev = await revisions(page, id);
  const floorBefore = (await page.locator('path.floor').boundingBox())!;
  await page.mouse.move(floorBefore.x + 20, floorBefore.y + 20);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(floorBefore.x + 120, floorBefore.y + 60, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const floorAfter = (await page.locator('path.floor').boundingBox())!;
  expect(floorAfter.x - floorBefore.x).toBeCloseTo(100, 0);
  expect(await revisions(page, id)).toBe(rev);
});

test('in 3D an item slides over the floor and Shift+drag raises it', async ({ page }) => {
  const id = await newProject(page, '3D Hall', 10, 8);
  await page.locator('[data-add="stage"]').click(); // 4 × 2 m, placed in the middle of the room
  const start = (await items(page, id))['stage-1']!;
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const view = page.getByTestId('view3d');
  await expect(view.locator('canvas')).toBeVisible();
  await page.waitForTimeout(300);
  const box = (await view.locator('canvas').boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y, { steps: 5 });
  await page.mouse.move(centre.x + 120, centre.y, { steps: 5 });
  await page.mouse.up();
  const slid = (await items(page, id))['stage-1']!;
  expect(slid.position.x).toBeGreaterThan(start.position.x + 5000); // moved east by more than 50 cm
  await expect(view).toHaveAttribute('data-selected', 'stage-1');

  await page.keyboard.down('Shift');
  await page.mouse.move(centre.x + 120, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 120, centre.y - 40, { steps: 5 });
  await page.mouse.move(centre.x + 120, centre.y - 80, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const raised = (await items(page, id))['stage-1']!;
  expect(raised.elevation ?? 0).toBeGreaterThan(0);
  expect((raised.elevation ?? 0) % 500).toBe(0); // raise step is 5 cm
  expect(raised.position).toEqual(slid.position);
  await page.screenshot({ path: 'e2e-results/3d-drag.png' });
});

test('the client report shows the plan, the 3D picture, the quantities and the issues, ready to print', async ({ page }) => {
  await newProject(page, 'Client Hall', 12, 9);
  await page.locator('[data-add="table-180"]').click();
  for (let i = 0; i < 4; i++) await page.locator('[data-add="chair"]').click();
  await saved(page);
  await page.getByRole('link', { name: 'Client report' }).click();

  const report = page.getByTestId('report');
  await expect(report.locator('h1')).toHaveText('Client Hall');
  await expect(page.getByTestId('report-seats')).toHaveText('4');
  await expect(page.getByTestId('report-bom').locator('tbody tr')).toHaveCount(2);
  await expect(page.getByTestId('report-bom')).toContainText('180 × 80 × 75 cm');
  await expect(report.locator('[data-report-item]')).toHaveCount(5);
  await expect(page.getByTestId('report-picture')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('report-verdict')).toBeVisible();
  await page.screenshot({ path: 'e2e-results/report.png', fullPage: true });

  // Printing lays out on A4 without the buttons.
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print or save PDF' })).toBeHidden();
  const pdf = await page.pdf({ format: 'A4' });
  expect(pdf.byteLength).toBeGreaterThan(10_000);
  await page.emulateMedia({ media: 'screen' });

  await page.getByRole('link', { name: 'Back to plan' }).click();
  await expect(page.locator('[data-item-id]')).toHaveCount(5);
});
