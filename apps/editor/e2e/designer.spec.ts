import { expect, test } from '@playwright/test';
import { openPanel, saved } from './helpers.js';

test('a kitchen-only proposal shows unavailable checks instead of a pass', async ({ page }) => {
  const built = await (await page.request.post('/api/tools/build_apartment', { data: { input: { name: 'Kitchen checks', rooms: [{ name: 'Kitchen', x_m: 0, y_m: 0, width_m: 5, depth_m: 4 }] }, actor: 'agent:test' } })).json();
  expect(built.isError).toBe(false);
  const id = /Created (p-\w+)/.exec(built.text)![1]!;
  await page.goto(`/#/p/${id}`);
  await saved(page);
  await openPanel(page, 'Space');
  await page.getByTestId('furnish-propose').click();
  const cards = page.locator('.furnish-card');
  await expect(cards).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(cards.nth(i).locator('.chip')).toContainText('not checked');
    await expect(cards.nth(i).locator('.chip')).not.toHaveClass(/\bok\b/);
  }
  await expect(page.getByText('Some checks need information')).toBeVisible();
  await expect(page.getByText('Every check passes', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/safe-merge-kitchen-checks.png' });
});

/**
 * The AI interior designer (decision 0029), without any AI: a flat built from its measurements
 * through the same tool an agent calls, then "Propose three options" in the program, a preview,
 * and one option applied as one revision that passes every check.
 */
test('a flat from measurements, furnished from three proposed options, each checked', async ({ page }) => {
  const input = {
    name: 'Client flat',
    rooms: [
      { name: 'Reception', x_m: 0, y_m: 0, width_m: 7.2, depth_m: 4.6 },
      { name: 'Kitchen', x_m: 7.2, y_m: 0, width_m: 3, depth_m: 4.6 },
      { name: 'Master bedroom', x_m: 0, y_m: 4.6, width_m: 4.2, depth_m: 4 },
      { name: 'Corridor', x_m: 4.2, y_m: 4.6, width_m: 1.4, depth_m: 4 },
      { name: 'Bath', x_m: 5.6, y_m: 6.4, width_m: 2.2, depth_m: 2.2 },
      { name: 'Bedroom 2', x_m: 7.8, y_m: 4.6, width_m: 2.4, depth_m: 4 },
      { name: 'WC', x_m: 5.6, y_m: 4.6, width_m: 2.2, depth_m: 1.8 },
    ],
    doors: [
      { between: ['Reception', 'Corridor'], width_cm: 100, at_m: 0.2 },
      { between: ['Corridor', 'Master bedroom'], at_m: 0.3 },
      { between: ['Corridor', 'Bath'], at_m: 0.3 },
      { between: ['Corridor', 'WC'], at_m: 0.3, width_cm: 70 },
      { between: ['Reception', 'Kitchen'], at_m: 1.2, width_cm: 90 },
    ],
    entrance: { room: 'Reception', side: 'south', at_m: 1 },
    windows: [{ room: 'Reception', side: 'south', at_m: 3.5, width_cm: 200 }, { room: 'Master bedroom', side: 'north' }, { room: 'Bedroom 2', side: 'north' }, { room: 'Kitchen', side: 'east' }],
  };
  const built = await (await page.request.post('/api/tools/build_apartment', { data: { input, actor: 'agent:test' } })).json();
  expect(built.isError).toBe(false);
  const id = /Created (p-\w+)/.exec(built.text)![1]!;
  await page.goto(`/#/p/${id}`);
  await saved(page);
  await expect(page.locator('[data-room]')).toHaveCount(7);

  await openPanel(page, 'Space');
  await page.getByTestId('furnish-propose').click();
  const cards = page.locator('.furnish-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Option A · Warm oak and linen');
  for (let i = 0; i < 3; i++) await expect(cards.nth(i)).toContainText(/Passes/);
  await expect(cards.nth(0)).toContainText('Master bedroom');

  // A preview changes nothing until applied.
  await page.getByTestId('furnish-preview-1').click();
  await expect(page.locator('[data-item-id]').first()).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('Saved · Revision 0');
  await page.getByTestId('furnish-apply-0').click();
  await expect(page.getByTestId('save-state')).toHaveText('Saved · Revision 1');
  const after = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(Object.keys(after.items).length).toBeGreaterThan(20);
  await expect(page.getByText(/No errors|No issues/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/safe-merge-furnished-flat.png' });
});
