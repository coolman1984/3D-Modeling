import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

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

async function newProject(page: Page, name: string, width = 12, depth = 9) {
  await page.goto('/#/');
  await page.locator('input[name="project-name"]').fill(name);
  await page.locator('input[name="new-width"]').fill(String(width));
  await page.locator('input[name="new-depth"]').fill(String(depth));
  await page.getByRole('button', { name: 'اعمل المشروع' }).click();
  await expect(page.locator('.toolbar h1')).toHaveText(name);
  await expect(page.getByTestId('save-state')).toHaveText('محفوظ');
}

test('a person plans a hall, the database keeps it, and history brings back any version', async ({ page }) => {
  await newProject(page, 'قاعة الياسمين');
  await expect(page.getByTestId('issue-count')).toHaveText('مفيش');

  await page.locator('[data-add="table-180"]').click();
  await page.locator('[data-add="chair"]').click();
  await page.locator('[data-add="chair"]').click();
  await expect(page.locator('[data-item-id]')).toHaveCount(3);
  await expect(page.getByTestId('seats')).toHaveText('٢');
  await expect(page.getByTestId('issue-count')).toHaveText('مفيش');

  // The door is centred on the south wall (hinge at 5.55 m) and swings north.
  await drag(page, 'chair-2', await worldToScreen(page, 5.85, 0.45, 12, 9));
  await expect(page.locator('[data-issue="door-blocked"]')).toContainText('في طريق الباب');
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-issue="door-blocked"]')).toHaveCount(0);
  await expect(page.getByTestId('save-state')).toHaveText('محفوظ');

  // Reload: everything comes back from the database.
  await page.reload();
  await expect(page.locator('[data-item-id]')).toHaveCount(3);

  // History lists every change and can restore the empty hall.
  await page.getByRole('tab', { name: 'السجل' }).click();
  const history = page.getByLabel('السجل');
  await expect(history.locator('li')).toHaveCount(6); // created, 3 adds, drag, undo
  await expect(history.locator('li').first()).toContainText('إنت');
  await history.locator('[data-revision="0"]').getByRole('button', { name: 'رجّع للنسخة دي' }).click();
  await expect(page.locator('[data-item-id]')).toHaveCount(0);
  await expect(history.locator('li').first()).toContainText('رجوع للنسخة 0');
});

test('a person edits the room and creates an item type with real sizes, and sees it in 3D', async ({ page }) => {
  await newProject(page, 'قاعة المؤتمرات', 10, 8);

  // Room: make it 14 m wide, add a door on the east wall and a column.
  await page.getByRole('tab', { name: 'القاعة' }).click();
  await page.locator('input[name="room-width"]').fill('14');
  await page.getByRole('button', { name: 'ضيف باب' }).click();
  const door = page.locator('[data-door="door-2"]');
  await door.getByLabel('الحيطة').selectOption('east');
  await door.getByLabel('يبعد').fill('3');
  await page.getByRole('button', { name: 'ضيف عمود' }).click();
  await page.getByRole('button', { name: 'طبّق على القاعة' }).click();
  await expect(page.locator('text.dimension').first()).toHaveText('١٤ م');
  await expect(page.locator('path.door')).toHaveCount(2);
  await expect(page.locator('path.obstacle')).toHaveCount(1);

  // A door that does not fit is explained and cannot be applied.
  await door.getByLabel('يبعد').fill('7.5');
  await expect(page.getByLabel('القاعة').locator('.problems')).toContainText('مش داخل على الحيطة');
  await expect(page.getByRole('button', { name: 'طبّق على القاعة' })).toBeDisabled();
  await page.getByRole('button', { name: 'تراجع عن التعديل' }).click();

  // New item type: a big sofa.
  await page.getByRole('tab', { name: 'العناصر' }).click();
  await page.getByRole('button', { name: 'صنف جديد' }).click();
  await page.locator('input[name="type-name"]').fill('كنبة كبيرة');
  await page.locator('select[name="type-shape"]').selectOption('sofa');
  await page.locator('input[name="type-w"]').fill('260');
  await page.locator('input[name="type-d"]').fill('95');
  await page.locator('input[name="type-h"]').fill('80');
  await page.getByRole('button', { name: 'احفظ الصنف' }).click();
  await page.locator('[data-add="sofa-1"]').click();
  await expect(page.getByLabel('العنصر المختار')).toContainText('كنبة كبيرة');
  await expect(page.getByLabel('العنصر المختار')).toContainText('٢٫٦ م × ٩٥ سم');

  // Resize the type from the item: every copy follows.
  await page.getByRole('button', { name: 'عدّل مقاسات الصنف' }).click();
  await page.locator('input[name="type-w"]').fill('300');
  await page.getByRole('button', { name: 'احفظ الصنف' }).click();
  await expect(page.getByLabel('العنصر المختار')).toContainText('٣ م × ٩٥ سم');

  // 3D and side-by-side views.
  await page.getByRole('button', { name: 'مجسم' }).click();
  const view = page.getByTestId('view3d');
  await expect(view.locator('canvas')).toBeVisible();
  await expect(view).toHaveAttribute('data-items', '1');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e-results/3d-view.png' });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'احفظ صورة' }).click();
  expect((await downloadPromise).suggestedFilename()).toContain('مجسم');
  await page.getByRole('button', { name: 'الاتنين' }).click();
  await expect(page.locator('svg.plan')).toBeVisible();
  await expect(view.locator('canvas')).toBeVisible();
});

test('an AI agent designs from a written specification and the change appears live', async ({ page }) => {
  await page.request.put('/api/settings', {
    data: { agents: { fake: { label: 'وكيل تجريبي', command: [process.execPath, fakeAgent, '{url}', '{projectId}', '{actor}'], promptOnStdin: true } } },
  });
  await newProject(page, 'قاعة الوكيل', 10, 8);
  await page.getByRole('tab', { name: 'الوكيل الذكي' }).click();
  await page.locator('textarea[name="agent-prompt"]').fill('اعمل قاعة ١٢×٩ وسقف ٣٫٢ م، فيها ترابيزة وكرسيين');
  await page.getByLabel('الوكيل', { exact: true }).selectOption('fake');
  await page.getByRole('button', { name: 'ابدأ' }).click();

  await expect(page.locator('.run')).toHaveAttribute('data-run-status', 'done', { timeout: 15_000 });
  await expect(page.locator('.run-log')).toContainText('Placed 3 item(s)');
  // Live: the plan shows the agent's work without reloading.
  await expect(page.locator('[data-item-id]')).toHaveCount(3);
  await expect(page.locator('text.dimension').first()).toHaveText('١٢ م');
  // The plan re-fits to the bigger room: the whole floor is inside the canvas.
  const floor = (await page.locator('path.floor').boundingBox())!;
  const pane = (await page.locator('svg.plan').boundingBox())!;
  expect(floor.x).toBeGreaterThanOrEqual(pane.x);
  expect(floor.x + floor.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
  await page.getByRole('tab', { name: 'السجل' }).click();
  await expect(page.getByLabel('السجل').locator('li').first()).toContainText('وكيل (fake)');
  await page.screenshot({ path: 'e2e-results/agent-done.png' });

  // Undo reaches the agent's work too: restore the version before it.
  await page.getByLabel('السجل').locator('[data-revision="0"]').getByRole('button', { name: 'رجّع للنسخة دي' }).click();
  await expect(page.locator('[data-item-id]')).toHaveCount(0);
});

test('projects page lists, copies and deletes projects', async ({ page }) => {
  await newProject(page, 'مشروع للنسخ', 8, 6);
  await page.goto('/#/');
  const row = page.locator('tr', { hasText: 'مشروع للنسخ' }).first();
  await row.getByRole('button', { name: 'نسخة' }).click();
  await expect(page.locator('tr', { hasText: 'مشروع للنسخ (نسخة)' })).toHaveCount(1);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('tr', { hasText: 'مشروع للنسخ (نسخة)' }).getByRole('button', { name: 'امسح' }).click();
  await expect(page.locator('tr', { hasText: 'مشروع للنسخ (نسخة)' })).toHaveCount(0);
  await page.screenshot({ path: 'e2e-results/projects.png' });
});

test('settings show the agents and keep the API key secret', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.locator('[data-agent="claude-code"]')).toContainText('Claude Code');
  await expect(page.locator('[data-agent="codex"]')).toContainText('Codex');
  await page.getByLabel('المفتاح').fill('sk-ant-test-9876');
  await page.getByRole('button', { name: 'احفظ الإعدادات' }).click();
  await expect(page.getByRole('status')).toHaveText('اتحفظ ✓');
  await page.reload();
  await expect(page.getByLabel('المفتاح')).toHaveAttribute('placeholder', 'محفوظ (••••9876)');
  const body = await (await page.request.get('/api/settings')).text();
  expect(body).not.toContain('sk-ant-test');
});
