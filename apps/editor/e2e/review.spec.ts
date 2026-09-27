// Browser journeys for the source-review findings in bugs.md that live in the editor.
import { expect, test } from '@playwright/test';
import { newProject, openTab, saved, send } from './helpers.js';

test('a restore from an out-of-date window is refused and the newer plan is shown instead (finding 2)', async ({ page }) => {
  const id = await newProject(page, 'Stale Window Hall');
  await page.locator('[data-add="chair"]').click();
  await saved(page);
  // This window stops hearing about changes made elsewhere, as when the live connection drops.
  await page.route('**/api/events', (route) => route.abort());
  await page.reload();
  await expect(page.locator('[data-item-id]')).toHaveCount(1);

  await openTab(page, 'History');
  const history = page.getByLabel('History', { exact: true });
  await history.locator('[data-revision="0"]').getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('preview-banner')).toContainText('Previewing revision 0');

  // Meanwhile an agent adds a second chair (revision 2), unseen by this window.
  await send(page, id, [{ type: 'item.add', item: { id: 'agent-chair', definitionId: 'chair', position: { x: 60_000, y: 60_000 }, rotation: 0, locked: false } }]);

  await page.getByTestId('preview-banner').getByRole('button', { name: 'Restore revision' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'nothing was restored' })).toBeVisible();
  // The agent's chair is kept and shown; no restore revision was written.
  await expect(page.locator('[data-item-id]')).toHaveCount(2);
  const stored = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(stored.revision).toBe(2);
  expect(Object.keys(stored.items).sort()).toEqual(['agent-chair', 'chair-1']);
});

test('edits made while the server is away save themselves when it answers again (finding 3)', async ({ page }) => {
  const id = await newProject(page, 'Offline Hall');
  // The server stops answering saves.
  await page.route('**/api/projects/*/commands', (route) => route.abort());
  await page.locator('[data-add="chair"]').click();
  const banner = page.locator('.offline-bar');
  await expect(banner).toContainText('not saved yet');

  // Leaving now would lose the chair: the browser asks first. Stay.
  let asked = false;
  page.once('dialog', (dialog) => {
    asked = dialog.type() === 'beforeunload';
    void dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true }).catch(() => undefined);
  await expect.poll(() => asked).toBe(true);
  expect(page.isClosed()).toBe(false);

  // The server answers again; nobody clicks "Try again".
  await page.unroute('**/api/projects/*/commands');
  await expect(banner).toBeHidden({ timeout: 20_000 });
  await saved(page);
  const stored = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(Object.keys(stored.items)).toEqual(['chair-1']);
});
