import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { newProject, openPanel, openTab, saved } from './helpers.js';

const fakeAgent = fileURLToPath(new URL('../../server/test/fixtures/fake-agent.mjs', import.meta.url));

async function itemCentre(page: Page, id: string) {
  const box = await page.locator(`[data-item-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`item ${id} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Screen point of a world position in metres, read from the drawn floor of a W × D room. */
async function worldToScreen(page: Page, xM: number, yM: number, roomW: number, roomD: number) {
  const floor = await page.locator('path.floor').boundingBox();
  if (!floor) throw new Error('floor not drawn');
  return { x: floor.x + (xM / roomW) * floor.width, y: floor.y + floor.height - (yM / roomD) * floor.height };
}

async function drag(page: Page, id: string, to: { x: number; y: number }) {
  const from = await itemCentre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

test('a person plans a hall, the database keeps it, and history previews and brings back any version', async ({ page }) => {
  await newProject(page, 'Jasmine Hall');
  await expect(page.getByTestId('status-validation')).toContainText('No issues');

  await page.locator('[data-add="table-180"]').click();
  await page.locator('[data-add="chair"]').click();
  await page.locator('[data-add="chair"]').click();
  await expect(page.locator('[data-item-id]')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('seats')).toHaveText('2');
  await expect(page.getByTestId('status-validation')).toContainText('No issues');

  // The door is centred on the south wall (hinge at 5.55 m) and swings north.
  await openTab(page, 'Review');
  await drag(page, 'chair-2', await worldToScreen(page, 5.85, 0.45, 12, 9));
  await expect(page.locator('[data-issue="door-blocked"]')).toContainText('blocks a door');
  await expect(page.getByTestId('status-validation')).toContainText('1 error');
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-issue="door-blocked"]')).toHaveCount(0);
  await saved(page);

  // Reload: everything comes back from the database.
  await page.reload();
  await expect(page.locator('[data-item-id]')).toHaveCount(3);

  // History lists every change; a preview shows an old revision without changing anything.
  await openTab(page, 'History');
  const history = page.getByLabel('History', { exact: true });
  await expect(history.locator('li')).toHaveCount(6); // created, 3 adds, drag, undo
  await expect(history.locator('li').first()).toContainText('You');
  await history.locator('[data-revision="1"]').getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('preview-banner')).toContainText('Previewing revision 1');
  await expect(page.locator('[data-item-id]')).toHaveCount(1);
  await page.getByTestId('preview-banner').getByRole('button', { name: 'Exit' }).click();
  await expect(page.locator('[data-item-id]')).toHaveCount(3);

  await history.locator('[data-revision="0"]').getByRole('button', { name: 'Restore revision' }).click();
  await expect(page.locator('[data-item-id]')).toHaveCount(0);
  await expect(history.locator('li').first()).toContainText('Restored revision 0');
});

test('a person edits the room and creates an item type with real sizes, and sees it in 3D', async ({ page }) => {
  await newProject(page, 'Conference Hall', 10, 8);

  // Room: make it 14 m wide, add a door on the east wall and a column.
  await openPanel(page, 'Space');
  await page.locator('input[name="room-width"]').fill('14');
  await page.getByRole('button', { name: 'Add door' }).click();
  const door = page.locator('[data-door="door-2"]');
  await door.getByLabel('Wall').selectOption('east');
  await door.getByLabel('Distance from the corner').fill('3');
  await page.getByRole('button', { name: 'Add column' }).click();
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByTestId('room-size')).toContainText('14.00 × 8.00 m');
  await expect(page.locator('path.door')).toHaveCount(2);
  await expect(page.locator('path.obstacle')).toHaveCount(1);

  // A door that does not fit is explained and cannot be applied.
  await door.getByLabel('Distance from the corner').fill('7.5');
  await expect(page.getByLabel('Room', { exact: true }).locator('.problems')).toContainText('does not fit');
  await expect(page.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset' }).click();

  // New item type: a big sofa.
  await openPanel(page, 'Library');
  await page.getByRole('button', { name: 'New item type' }).click();
  await page.locator('input[name="type-name"]').fill('Large sofa');
  await page.locator('select[name="type-shape"]').selectOption('sofa');
  await page.locator('input[name="type-w"]').fill('260');
  await page.locator('input[name="type-d"]').fill('95');
  await page.locator('input[name="type-h"]').fill('80');
  await page.getByRole('button', { name: 'Save item type' }).click();
  await page.locator('[data-add="sofa-1"]').click();
  const selected = page.getByLabel('Selected item', { exact: true });
  await expect(selected).toContainText('Large sofa');
  await expect(selected).toContainText('260 × 95 × 80 cm');

  // Resize the type from the item: every copy follows.
  await page.getByRole('button', { name: /Edit item type/ }).click();
  await page.locator('input[name="type-w"]').fill('300');
  await page.getByRole('button', { name: 'Save item type' }).click();
  await expect(selected).toContainText('300 × 95 × 80 cm');

  // Drag a tile from the library onto the plan: one more sofa where it was dropped.
  const floor = (await page.locator('path.floor').boundingBox())!;
  const planBox = (await page.locator('svg.plan').boundingBox())!;
  const target = { x: floor.x - planBox.x + floor.width * 0.3, y: floor.y - planBox.y + floor.height * 0.3 };
  await page.locator('[data-add="sofa-1"]').dragTo(page.locator('svg.plan'), { targetPosition: target });
  await expect(page.locator('[data-item-id]')).toHaveCount(2);

  // 3D and side-by-side views, with the camera tools.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const view = page.getByTestId('view3d');
  await expect(view.locator('canvas')).toBeVisible();
  await expect(view).toHaveAttribute('data-items', '2');
  await page.getByRole('button', { name: 'Top view' }).click();
  await expect(view.locator('.pane-title')).toContainText('Top view');
  await page.getByRole('button', { name: 'Orbit left' }).click();
  await expect(view.locator('.pane-title')).toContainText('Perspective');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e-results/3d-view.png' });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save image' }).click();
  expect((await downloadPromise).suggestedFilename()).toContain('3D');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('svg.plan')).toBeVisible();
  await expect(view.locator('canvas')).toBeVisible();
  // The plan re-fits to its narrower pane: the whole floor stays in view.
  await expect(async () => {
    const f = (await page.locator('path.floor').boundingBox())!;
    const pane = (await page.locator('svg.plan').boundingBox())!;
    expect(f.x + f.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
  }).toPass();
});

test('the AI Planner designs from a written request and the change appears live', async ({ page }) => {
  await page.request.put('/api/settings', {
    data: { agents: { fake: { label: 'Test agent', command: [process.execPath, fakeAgent, '{url}', '{projectId}', '{actor}'], promptOnStdin: true } } },
  });
  await newProject(page, 'Agent Hall', 10, 8);
  await page.getByRole('button', { name: 'AI Planner' }).click();
  await page.locator('textarea[name="agent-prompt"]').fill('Make the hall 12 × 9 m with a 3.2 m ceiling, a table and two chairs');
  await page.getByLabel('Agent', { exact: true }).selectOption('fake');
  await page.getByRole('button', { name: 'Start planning' }).click();

  await expect(page.locator('[data-run-status]')).toHaveAttribute('data-run-status', 'done', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Detailed log' }).click();
  await expect(page.getByTestId('run-log')).toContainText('Placed 3 item(s)');
  // Live: the plan shows the agent's work without reloading.
  await expect(page.locator('[data-item-id]')).toHaveCount(3);
  await expect(page.getByTestId('room-size')).toContainText('12.00 × 9.00 m');
  // The plan re-fits to the bigger room: the whole floor is inside the canvas.
  const floor = (await page.locator('path.floor').boundingBox())!;
  const pane = (await page.locator('svg.plan').boundingBox())!;
  expect(floor.x).toBeGreaterThanOrEqual(pane.x);
  expect(floor.x + floor.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
  await page.screenshot({ path: 'e2e-results/agent-done.png' });

  await page.getByRole('button', { name: 'Close AI Planner' }).click();
  await openTab(page, 'History');
  const history = page.getByLabel('History', { exact: true });
  await expect(history.locator('li').first()).toContainText('AI Planner');
  await expect(history.locator('li').first()).toContainText('via Agent fake');

  // Undo reaches the agent's work too: restore the version before it.
  await history.locator('[data-revision="0"]').getByRole('button', { name: 'Restore revision' }).click();
  await expect(page.locator('[data-item-id]')).toHaveCount(0);
});

test('projects page lists, copies and deletes projects', async ({ page }) => {
  await newProject(page, 'Copy me', 8, 6);
  await page.goto('/#/');
  const row = (name: string) => page.locator('.proj-row', { has: page.locator('.proj-name', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
  await expect(row('Copy me')).toHaveCount(1);
  await expect(row('Copy me')).toContainText('Event hall');
  await row('Copy me').getByRole('button', { name: 'More actions for Copy me' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(row('Copy me (copy)')).toHaveCount(1);
  page.once('dialog', (dialog) => void dialog.accept());
  await row('Copy me (copy)').getByRole('button', { name: /More actions/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(row('Copy me (copy)')).toHaveCount(0);
  // Grid layout and search.
  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page.locator('.proj-card', { hasText: 'Copy me' })).toHaveCount(1);
  await page.getByLabel('Search projects').fill('no such project');
  await expect(page.getByText('No projects match')).toBeVisible();
  await page.getByRole('button', { name: 'List' }).click();
  await page.screenshot({ path: 'e2e-results/projects.png' });
});

test('settings show the agents and keep the API key secret', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.locator('[data-agent="claude-code"]')).toContainText('Claude Code');
  await expect(page.locator('[data-agent="codex"]')).toContainText('Codex');
  await page.getByLabel('API key').fill('sk-ant-test-9876');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('settings-state')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.getByLabel('API key')).toHaveAttribute('placeholder', 'Saved (••••9876) · paste to replace');
  const body = await (await page.request.get('/api/settings')).text();
  expect(body).not.toContain('sk-ant-test');
  // The planner's tools are listed from the server.
  await page.getByRole('button', { name: 'Agent Tools' }).click();
  await expect(page.locator('.tool-row', { hasText: 'place_items' })).toHaveCount(1);
});
