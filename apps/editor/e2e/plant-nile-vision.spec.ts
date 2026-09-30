import { expect, test } from '@playwright/test';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FA_OPS = ['CHS', 'LED', 'BLT', 'OPT', 'OCM', 'FLP', 'BRD', 'BCV', 'SWD', 'AGE', 'WB', 'FT', 'HPT', 'VIS', 'ACC', 'PKG', 'WCK', 'PAL', 'RPR'];

/** What GMES would export for the final assembly part of the plant. */
function plantExport() {
  let n = 1;
  const make = (code: string, type: string, parent?: { id: string; code: string }) => ({
    id: uuid(n++), code, version: 1, origin: { app: 'gmes', type: 'plant_node', key: code }, name: { en: code, ar: code }, type, active: true, ...(parent ? { parent } : {}),
  });
  const plant = make('EG-NV1', 'plant');
  const hall = make('A-FA', 'area', { id: plant.id, code: plant.code });
  const lines = ['FA-1', 'FA-2'].map((c) => make(c, 'line', { id: hall.id, code: hall.code }));
  const stations = lines.flatMap((l) => FA_OPS.map((op) => make(`${l.code}-${op}`, 'station', { id: l.id, code: l.code })));
  return { nodes: [plant, hall, ...lines, ...stations] };
}

test('Nile Vision sample: stations carry GMES codes and "Link by code" tags the whole plan in one revision', async ({ page }) => {
  const added = await (await page.request.post('/api/samples/nile-vision', { data: {} })).json() as Array<{ id: string; name: string }>;
  expect(added.map((p) => p.name)).toContain('Nile Vision · Final assembly hall (FA-1, FA-2)');
  const id = added.find((p) => p.name.includes('Final assembly'))!.id;
  const before = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(Object.keys(before.items)).toHaveLength(38);
  expect(before.items['FA-2-OCM'].meta['eco.code']).toBe('FA-2-OCM');
  expect(before.items['FA-2-OCM'].meta['eco.ref']).toBeUndefined();

  await page.goto(`/#/p/${id}/plant`);
  await expect(page.getByRole('heading', { name: 'Link to plant' })).toBeVisible();
  // (the plant tree is one per planner, kept from an earlier test in this run: this test imports its own)

  await page.getByTestId('plant-file').setInputFiles({ name: 'plant.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plantExport())) });
  await expect(page.getByText(/plant nodes imported from plant\.json/)).toBeVisible();
  await page.getByRole('button', { name: 'Link by code' }).click();
  await expect(page.getByText(/Link by code: 40 linked/)).toBeVisible();

  const after = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(after.revision).toBe(before.revision + 1); // one revision for all the tags
  expect(after.items['FA-2-OCM'].meta).toMatchObject({ step: 5, 'eco.code': 'FA-2-OCM', 'eco.type': 'station', 'eco.ref': `plant_node:${uuid(2 + 2 + 19 + 5)}` });
  for (const check of ['node-exists', 'station-unique', 'station-placed']) await expect(page.locator(`[data-check="${check}"]`)).toHaveAttribute('data-status', 'pass');

  // one undo puts every code back to "not linked"
  await page.getByRole('button', { name: /Undo last tag/ }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${id}`)).json()).items['FA-2-OCM'].meta['eco.ref']).toBeUndefined();
});
