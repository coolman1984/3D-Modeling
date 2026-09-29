import { expect, test } from '@playwright/test';

// The six-day production plan exactly as the owner pasted it (29 Sep 2026).
const PLAN = [
  '        Part size            Production Plan                    ',
  'Model    Item Ref.    L (mm)    W(mm)    H(mm)    04/Oct    05/Oct    06/Oct    07/Oct    08/Oct    09/Oct',
  '77S85H    BN69-25994A Cushion Side    500    152    200                1400    1400    1200',
  '    BN69-25993A Cushion Top    1872    152    350                700    700    600',
  '    BN69-25993A Cushion Bot    1872    152    350                700    700    600',
  '55QN80H    BN69-28085A Cushion Top    1335    110    400    1750    1750    1750    1750        ',
  '    BN69-28085A Cushion Bot    1335    110    400    1750    1750    1750    1750        ',
  '32F6000    BN69-26767A Cushion Top    788    102    185    4200    800                ',
  '    BN69-26767A Cushion Bot    788    102    185    4200    800                ',
].join('\n');

test('a shipment: paste the production plan, see how many containers, view them side by side, play the stuffing, open one', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('plan-shipment').click();
  await page.locator('input[name="shipment-name"]').fill('Cushions 04/Oct');
  await page.getByText('Paste rows from a spreadsheet').click();
  await page.locator('textarea[name="shipment-paste"]').fill(PLAN);
  await page.getByTestId('read-paste').click();
  await expect(page.locator('[data-part-row]')).toHaveCount(7);
  await expect(page.getByLabel('Part 1 name')).toHaveValue('77S85H BN69-25994A Cushion Side');
  await expect(page.getByLabel('Part 7 quantity')).toHaveValue('4200');
  // Each quantity stays under its own day: 77S85H starts on 07/Oct.
  const day = page.locator('select[name="shipment-column"]');
  await expect(day.locator('option:checked')).toHaveText('04/Oct');
  await expect(page.getByLabel('Part 1 quantity')).toHaveValue('');
  await day.selectOption({ label: '07/Oct' });
  await expect(page.getByLabel('Part 1 quantity')).toHaveValue('1400');
  await expect(page.getByLabel('Part 7 quantity')).toHaveValue('');
  await day.selectOption({ label: '04/Oct' });
  // 3 500 + 8 400 cushions in 40′ high cubes (the default type).
  await expect(page.getByTestId('shipment-answer')).toContainText('11,900 pieces');
  const count = Number(await page.getByTestId('shipment-answer').locator('.big').textContent());
  expect(count).toBe(5);

  await page.getByTestId('create-shipment').click();
  await expect(page).toHaveURL(/#\/s\/s-[\w]+$/);
  await expect(page.getByTestId('shipment-title')).toHaveText('Cushions 04/Oct');
  await expect(page.getByTestId('shipment-summary')).toContainText('5 containers · 40′ high cube · 11,900 pieces');
  const view = page.getByTestId('shipment-3d');
  await expect(view).toHaveAttribute('data-containers', '5');
  await expect(view).toHaveAttribute('data-items', '11900');
  await expect(page.locator('[data-container]')).toHaveCount(5);
  // No mass is known, so payload, load on top and balance cannot be checked: unknown, never pass.
  await expect(page.getByTestId('checks-5')).toHaveText(/^No problems · \d+ checks unknown$/, { timeout: 30_000 });

  // The stuffing plays in every container at once, then one after another.
  await expect(page.getByTestId('shipment-play-label')).toHaveText('Fully loaded');
  await page.getByTestId('play-shipment').click();
  await expect(page.getByTestId('shipment-play-label')).toContainText(/^Layer \d+ of \d+$/);
  const partway = Number(await view.getAttribute('data-items'));
  expect(partway).toBeLessThan(11900);
  await page.getByTestId('play-shipment').click();
  await page.getByRole('button', { name: 'One after another' }).click();
  await expect(page.getByTestId('shipment-play-label')).toHaveText('Fully loaded');

  // The project list shows the shipment as one group; each container opens in the full editor.
  await page.getByTestId('open-container-2').click();
  await expect(page.locator('h1.project-name')).toHaveText('Cushions 04/Oct · container 2 of 5');
  await expect(page.getByTestId('shipment-link')).toContainText('Container 2 of 5 · Cushions 04/Oct');
  await expect(page.getByTestId('unpacked')).toHaveText('0');
  await page.goto('/#/');
  await expect(page.locator('.proj-group-head', { hasText: 'Cushions 04/Oct' })).toContainText('5 containers');
});
