import { expect, test } from '@playwright/test';
import { openPanel, saved } from './helpers.js';

/**
 * Stage H1 (decision 0028): a designer draws a client's two-bedroom flat from its measurements.
 * The empty flat is 12 × 9 m inside 20 cm outer walls (outside 12.40 × 9.40 m, inside from 0.2 m).
 * Partitions are 10 cm, drawn on their centre lines with typed lengths. Hand-computed rooms:
 * each bedroom 4.60 × 3.95 = 18.17 m² (inside x 0.2–4.8, y 5.25–9.2); the bath 2.60 × 2.95 =
 * 7.67 m²; the living space is the rest, 108 − 2 × 18.17 − 7.67 − partitions = 62 m².
 */
test('draw a two-bedroom flat from its measurements: walls by typed length, doors and windows, rooms and their areas', async ({ page }) => {
  const created = await page.request.post('/api/projects', { data: { name: 'Client flat', activity: 'home', width_m: 12, depth_m: 9 } });
  const { id } = await created.json();
  await page.goto(`/#/p/${id}`);
  await saved(page);
  await expect(page.locator('[data-wall]')).toHaveCount(4);
  await expect(page.locator('[data-room]')).toHaveText(['108 m²']);

  const floor = (await page.locator('svg.plan path.floor').boundingBox())!;
  const at = (x: number, y: number) => ({ x: floor.x + (x / 12.4) * floor.width, y: floor.y + floor.height - (y / 9.4) * floor.height });
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await page.mouse.click(p.x, p.y);
  };
  const aim = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 2 });
  };
  const typeLength = async (text: string) => {
    await page.keyboard.type(text);
    await expect(page.getByTestId('draw-length')).toContainText(text);
    await page.keyboard.press('Enter');
  };

  // W picks the wall tool. Main bedroom: from the west wall at 5.2 m, 4.75 m east, then 410 cm north.
  await page.keyboard.press('w');
  await expect(page.locator('[data-tool="wall"]')).toHaveAttribute('aria-pressed', 'true');
  await click(0.1, 5.2);
  await aim(3, 5.2);
  await typeLength('4.75');
  await aim(4.85, 8);
  await typeLength('410');
  await page.keyboard.press('Escape');
  // Bath: from the bedroom wall 2.70 m east. Second bedroom: from the east wall, west then north.
  await click(4.85, 6.2);
  await aim(6.5, 6.2);
  await typeLength('2.7');
  await page.keyboard.press('Escape');
  await click(12.3, 5.2);
  await aim(9, 5.2);
  await typeLength('4.75');
  await aim(7.55, 8);
  await typeLength('4.1');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('save-state')).toHaveText('Saved · Revision 5');

  // Doors open to the side clicked; windows go in the outer walls.
  for (const [tool, x, y] of [['door', 4.3, 5.25], ['door', 5.6, 6.25], ['door', 8.1, 5.25], ['window', 2.5, 9.3], ['window', 10, 9.3]] as const) {
    await page.locator(`[data-tool="${tool}"]`).click();
    await click(x, y);
  }
  await expect(page.getByTestId('save-state')).toHaveText('Saved · Revision 10');
  await expect(page.locator('[data-opening]')).toHaveCount(6);
  await expect(page.locator('[data-room]')).toHaveText(['62 m²', '18.17 m²', '18.17 m²', '7.67 m²']);
  await expect(page.getByText('No issues found').or(page.getByText(/No issues · \d+ unknown/))).toBeVisible();

  // A wall's length typed in its properties: the bath wall 2.70 → 2.20 m, then undone.
  await page.locator('[data-wall="wall-3"]').click({ force: true });
  await expect(page.getByTestId('wall-length')).toHaveText('2.70 m');
  await page.getByLabel('Wall length').fill('220');
  await page.getByLabel('Wall length').press('Enter');
  await expect(page.getByTestId('wall-length')).toHaveText('2.20 m');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('wall-length')).toHaveText('2.70 m');

  // A room is named in the Space panel and the plan shows the name with the area.
  await openPanel(page, 'Space');
  await page.getByLabel('Name of room 4').fill('Bath');
  await page.getByLabel('Name of room 4').press('Enter');
  await expect(page.locator('[data-room]').nth(3)).toHaveText(/BATH\s*7\.67 m²/);

  // Removing a wall takes its door with it and joins the rooms.
  await page.locator('[data-wall="wall-3"]').click({ force: true });
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-opening]')).toHaveCount(5);
  await expect(page.locator('[data-room]')).toHaveCount(3);

  // The same walls stand in 3D.
  await page.getByRole('button', { name: /3D/ }).first().click();
  await expect(page.getByTestId('view3d').locator('canvas')).toBeVisible();
});
