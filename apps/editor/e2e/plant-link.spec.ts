import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect as base, test } from '@playwright/test';
import { send } from './helpers.js';

// Sealing and opening a key starts PowerShell (DPAPI, over a second each), so the first save, fetch and send are slow.
const expect = base.configure({ timeout: 20_000 });

const COMPANY = '0192f7c4-8a3e-7b21-9c55-3d1f2a4b6c7d';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const node = (n: number, code: string, en: string, type: string, parent?: { id: string; code: string }) => ({
  id: uuid(n), code, version: 1, origin: { app: 'gmes', type: 'plant_node', key: code }, name: { en, ar: en }, type, active: true, ...(parent ? { parent } : {}),
});
const NODES = [
  node(1, 'EG-NV1', 'Nile Vision plant', 'plant'),
  node(2, 'FA', 'Final assembly', 'area', { id: uuid(1), code: 'EG-NV1' }),
  node(3, 'FA-1', 'Line 1', 'line', { id: uuid(2), code: 'FA' }),
  node(10, 'FA-1-10', 'Panel loader', 'station', { id: uuid(3), code: 'FA-1' }),
  node(11, 'FA-1-20', 'Assembly bench', 'station', { id: uuid(3), code: 'FA-1' }),
  node(12, 'FA-1-30', 'Final test', 'station', { id: uuid(3), code: 'FA-1' }),
];

/** A fake GMES on the loopback: the plant export, an inbox that keeps what it receives, and the live event stream. */
function fakeGmes() {
  const inbox: Array<{ key: string | undefined; events: Array<Record<string, any>> }> = [];
  const streams: ServerResponse[] = [];
  let liveKey: string | undefined;
  let liveLines: string | null = null;
  let refusing = false; // after a drop GMES stays away, so the page's automatic reconnect cannot hide the "Disconnected" state
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://gmes');
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/plant/export') return json(200, { company_id: COMPANY, nodes: NODES });
    if (url.pathname === '/eco/v1/inbox' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { events: Array<Record<string, any>> };
        inbox.push({ key: req.headers['x-eco-key'] as string | undefined, events: body.events });
        json(200, { results: body.events.map((e) => ({ id: e.id, result: 'applied' })) });
      });
      return;
    }
    if (url.pathname === '/eco/v1/live') {
      if (refusing) return json(503, { error: { message: 'gone' } });
      liveKey = url.searchParams.get('k') ?? undefined;
      liveLines = url.searchParams.get('lines');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'access-control-allow-origin': 'http://127.0.0.1:4173', vary: 'Origin' });
      res.write(': connected\n\n');
      streams.push(res);
      return;
    }
    json(404, { error: { message: 'not found' } });
  });
  return {
    server, inbox, streams,
    seen: () => ({ liveKey, liveLines }),
    emit: (event: string, data: unknown) => { for (const s of streams) s.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); },
    dropStreams: () => { refusing = true; for (const s of streams.splice(0)) s.destroy(); },
    start: () => new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))),
    stop: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

test('link to plant: settings, plant tree, tags, checks, layout snapshot and live view', async ({ page }) => {
  test.setTimeout(120_000);
  const gmes = fakeGmes();
  const gmesUrl = await gmes.start();
  try {
    // a production line with a zone for the line
    const created = await (await page.request.post('/api/projects', { data: { name: 'FA-1 layout', template: 'production-reference' } })).json();
    const id = created.id as string;
    await send(page, id, [{ type: 'space.set', space: { ...created.space, zones: [{ id: 'Z-FA-1', kind: 'line', polygon: [{ x: 0, y: 0 }, { x: 300_000, y: 0 }, { x: 300_000, y: 80_000 }, { x: 0, y: 80_000 }] }] } }]);

    await page.goto(`/#/p/${id}`);
    await page.getByRole('link', { name: 'Plant link' }).click();
    await expect(page.getByRole('heading', { name: 'Link to plant' })).toBeVisible();

    // settings: the keys are never shown again
    await page.locator('input[name="eco-company"]').fill(COMPANY);
    await page.locator('input[name="eco-url"]').fill(gmesUrl);
    await page.locator('input[name="eco-key"]').fill('write-key-1');
    await page.locator('input[name="eco-live-key"]').fill('read-key-1');
    await page.getByRole('button', { name: 'Save link settings' }).click();
    await expect(page.getByText('Saved. Keys are stored sealed')).toBeVisible();
    await expect(page.locator('input[name="eco-key"]')).toHaveAttribute('placeholder', /Leave empty to keep the saved key/);

    // a malformed plant file is refused with a clear message and nothing is imported
    await page.getByTestId('plant-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"nodes":[{"code":"X"}]}') });
    await expect(page.getByRole('alert')).toContainText('not a valid plant export');
    await expect(page.getByRole('list', { name: 'Plant nodes' })).toHaveCount(0);

    // the plant tree comes from GMES on the person's command
    await page.getByRole('button', { name: 'Fetch from GMES' }).click();
    await expect(page.getByText('6 plant nodes imported from GMES.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Plant nodes' }).getByRole('listitem')).toHaveCount(6);

    // nothing is tagged yet: the checks say "unknown", never "pass"
    await expect(page.locator('[data-check="station-placed"]')).toHaveAttribute('data-status', 'unknown');

    // tag the zone with the line and two stations; each tag is one revision
    await page.getByLabel('Plant node of zone Z-FA-1').selectOption({ label: 'FA-1 · Line 1' });
    await expect(page.getByLabel('Plant node of zone Z-FA-1')).toHaveValue(uuid(3));
    await page.getByLabel('Plant node of item S01').selectOption({ label: 'FA-1-10 · Panel loader' });
    await page.getByLabel('Plant node of item S02').selectOption({ label: 'FA-1-20 · Assembly bench' });
    await expect(page.getByLabel('Plant node of item S02')).toHaveValue(uuid(11));
    const project = await (await page.request.get(`/api/projects/${id}`)).json();
    expect(project.items.S01.meta).toMatchObject({ step: 1, 'eco.ref': `plant_node:${uuid(10)}`, 'eco.code': 'FA-1-10', 'eco.type': 'station' });
    expect(project.revision).toBe(4); // revision 0 as created, then the zone and three tags: one revision each

    // the station of the linked line that is not on the plan yet is named
    const placed = page.locator('[data-check="station-placed"]');
    await expect(placed).toHaveAttribute('data-status', 'fail');
    await expect(placed).toContainText('FA-1-30');

    // undo the last tag
    await page.getByRole('button', { name: /Undo last tag/ }).click();
    await expect(page.getByLabel('Plant node of item S02')).toHaveValue('');
    await page.getByLabel('Plant node of item S02').selectOption({ label: 'FA-1-20 · Assembly bench' });
    await expect(page.getByLabel('Plant node of item S02')).toHaveValue(uuid(11));

    // send the layout snapshot: the fake GMES receives a valid envelope with the tags
    await page.getByRole('button', { name: 'Send to GMES' }).click();
    await expect(page.getByText(/GMES answered “applied” for layout version/)).toBeVisible();
    expect(gmes.inbox).toHaveLength(1);
    expect(gmes.inbox[0]!.key).toBe('write-key-1');
    const event = gmes.inbox[0]!.events[0]!;
    expect(event).toMatchObject({ type: 'eco.layout.snapshot.v1', source: `eco://${COMPANY}/space/planner-1` });
    expect(event.data.items.find((i: any) => i.item_id === 'S01').eco_ref).toEqual({ type: 'plant_node', id: uuid(10), code: 'FA-1-10' });
    expect(event.data.zones[0].eco_ref).toEqual({ type: 'plant_node', id: uuid(3), code: 'FA-1' });

    // download as a file
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download snapshot' }).click();
    expect((await download).suggestedFilename()).toMatch(/^layout-FA-1-LAYOUT-v\d+\.json$/);

    // live view: the browser opens GMES's stream with the read-only key and the lines of this plan
    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await expect(page.getByTestId('live-plan')).toBeVisible();
    await expect.poll(() => gmes.streams.length).toBe(1);
    expect(gmes.seen()).toEqual({ liveKey: 'read-key-1', liveLines: 'FA-1' });
    gmes.emit('station.state', { station: 'FA-1-10', line: 'FA-1', state: 'stopped', since: '2026-10-01T10:00:00Z', reason: 'Feeder jam' });
    gmes.emit('station.state', { station: 'FA-1-20', line: 'FA-1', state: 'running' });
    gmes.emit('line.output', { line: 'FA-1', good: 120, scrap: 3, day: '2026-10-01' });
    await expect(page.locator('[data-item-id="S01"]')).toHaveAttribute('data-state', 'stopped');
    await expect(page.locator('[data-item-id="S02"]')).toHaveAttribute('data-state', 'running');
    await expect(page.locator('[data-item-id="S03"]')).toHaveAttribute('data-state', 'untagged');
    await expect(page.locator('[data-item-id="S01"] title')).toHaveText(/FA-1-10: Stopped — Feeder jam/);
    await expect(page.getByTestId('output-FA-1')).toHaveText('FA-1 · good 120 · scrap 3');
    await expect(page.getByTestId('live-caption')).toContainText('Live · last update');
    gmes.emit('station.state', { station: 'FA-1-10', line: 'FA-1', state: 'running' });
    await expect(page.locator('[data-item-id="S01"]')).toHaveAttribute('data-state', 'running');

    // the connection drops: the picture stays, marked old, with the time of the last update
    gmes.dropStreams();
    await expect(page.getByTestId('live-caption')).toContainText('Disconnected · last update');
    await expect(page.locator('[data-item-id="S01"]')).toHaveAttribute('data-state', 'running');
  } finally {
    await gmes.stop();
  }
});
