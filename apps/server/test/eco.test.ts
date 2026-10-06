import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, type Command, type Project } from '@space-planner/core';
import { referenceProductionLine, tagItemCommand, tagZoneCommand, type PlantNode } from '@space-planner/starter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unsupportedKeywords, validate } from '../src/eco/contract.js';
import { uuidV5 } from '../src/eco/ids.js';
import { parsePlantExport, PlantImportError } from '../src/eco/plant.js';
import { openSecret, sealSecret } from '../src/eco/secret.js';
import { SCHEMAS } from '../src/eco/schemas.js';
import { buildEnvelope, checkedEnvelope, layoutCode } from '../src/eco/snapshot.js';
import type { FetchLike } from '../src/eco/routes.js';
import { createApp, type App } from '../src/http.js';
import { Store } from '../src/store.js';
import { client, PASSWORD } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const COMPANY = '0192f7c4-8a3e-7b21-9c55-3d1f2a4b6c7d';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-01T08:00:00.000Z';

const node = (n: number, code: string, type: PlantNode['type'], parent?: PlantNode): PlantNode => ({
  id: uuid(n), code, type, name: { en: code, ar: code }, active: true, ...(parent ? { parent: { id: parent.id, code: parent.code } } : {}),
});
const plant = node(1, 'EG-NV1', 'plant');
const line = node(3, 'FA-1', 'line', node(2, 'FA', 'area', plant));
const stations = [10, 20].map((op, i) => node(10 + i, `FA-1-${op}`, 'station', line));
const contractNode = (n: PlantNode) => ({ ...n, version: 1, origin: { app: 'gmes', type: 'plant_node', key: n.code } });
const exportOf = () => ({ company_id: COMPANY, nodes: [plant, node(2, 'FA', 'area', plant), line, ...stations].map(contractNode) });

const run = (project: Project, command: Command | undefined): Project => {
  const result = apply(project, command!);
  if (!result.ok) throw new Error('command refused');
  return result.project;
};

function taggedPlan(): Project {
  let p = referenceProductionLine('Final assembly FA-1');
  const zone = { id: 'Z-FA-1', kind: 'line', polygon: [{ x: 0, y: 0 }, { x: 100_000, y: 0 }, { x: 100_000, y: 80_000 }, { x: 0, y: 80_000 }] };
  p = run(p, { type: 'space.set', space: { ...p.space, zones: [zone] } });
  p = run(p, tagZoneCommand(p, 'Z-FA-1', line));
  p = run(p, tagItemCommand(p, 'S01', stations[0]!));
  return p;
}

describe('ids', () => {
  it('UUID v5 matches the published test vector', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });
});

describe('the minimal contract validator', () => {
  it('checks type, required, enum, const, pattern, length, range and items', () => {
    const schema = {
      type: 'object', required: ['a', 'list'],
      properties: {
        a: { type: 'string', minLength: 2, maxLength: 3, pattern: '^[a-z]+$' },
        n: { type: 'integer', minimum: 0, maximum: 5, exclusiveMinimum: -1 },
        kind: { type: 'string', enum: ['x', 'y'] },
        unit: { const: '0.1mm' },
        list: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'integer' } },
        pair: { type: 'array', prefixItems: [{ type: 'integer' }, { type: 'integer' }], items: false },
      },
    };
    expect(validate(schema, { a: 'ab', list: [1], n: 5, kind: 'x', unit: '0.1mm', pair: [1, 2] })).toEqual([]);
    const bad = validate(schema, { a: 'ABCD', list: [1.5, 2, 3], n: 6, kind: 'z', unit: 'mm', pair: [1, 2, 3] });
    expect(bad).toEqual(expect.arrayContaining([
      '$.a: must have at most 3 characters', '$.a: has the wrong form', '$.list: must have at most 2 entries', '$.list[0]: must be integer',
      '$.n: must be at most 5', '$.kind: must be one of "x", "y"', '$.unit: must be "0.1mm"', '$.pair[2]: is not allowed here',
    ]));
    expect(validate(schema, {})).toEqual(['$.a: is required', '$.list: is required']);
    expect(validate(schema, [])).toEqual(['$: must be object']);
    expect(validate({ type: 'integer' }, 1.5)).toEqual(['$: must be integer']);
    expect(validate({ type: 'integer', exclusiveMinimum: 0 }, 0)).toEqual(['$: must be more than 0']);
  });

  it('refuses a schema that uses a keyword it does not check, and the vendored contracts use none', () => {
    expect(() => validate({ type: 'object', oneOf: [] }, {})).toThrow(/oneOf/);
    expect(unsupportedKeywords({ properties: { x: { anyOf: [] } } })).toEqual(['$.properties.x.anyOf']);
    for (const [name, schema] of Object.entries(SCHEMAS)) expect(unsupportedKeywords(schema), name).toEqual([]);
  });
});

describe('the vendored contracts are byte-identical copies from GMES', () => {
  const PIN: Record<string, string> = {
    'eco.envelope.v1': '53131ad0d6b78da8ace3d3597013b37a7685808403ca065eb84a1c2354d92fab',
    'eco.layout.snapshot.v1': 'ca0e3de969ecdd022ddb72bc3534c5b84d2537530c25d122aa77a8879cc1417f',
    'eco.plant_node.v1': 'c8064001770585df087b98f7ff2af917f3b6059db985a085117c45a6219ae654',
  };
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

  it.each(Object.entries(PIN))('%s keeps its SHA-256', (name, hash) => {
    expect(sha(join(here, '..', 'src', 'eco', 'schemas', `${name}.schema.json`))).toBe(hash);
  });

  it('and equals the file in a GMES checkout next to this repository, when there is one', () => {
    const gmes = resolve(here, '..', '..', '..', '..', 'GMES', 'packages', 'eco-contracts', 'schemas');
    if (!existsSync(gmes)) return;
    for (const name of Object.keys(PIN)) expect(sha(join(gmes, `${name}.schema.json`)), name).toBe(PIN[name]);
  });
});

describe('the layout snapshot', () => {
  const options = { companyId: COMPANY, node: 'planner-1', now: NOW, seq: 7 };

  it('is valid against the contracts, with the plan revision as its version and the tags carried', () => {
    const plan = taggedPlan();
    const checked = checkedEnvelope(plan, options);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const { envelope } = checked;
    expect(envelope.source).toBe(`eco://${COMPANY}/space/planner-1`);
    expect(envelope.data.id).toBe(uuidV5(COMPANY, `space:layout:${plan.id}`));
    expect(envelope.data.version).toBe(plan.revision + 1);
    expect(envelope.data.revision).toBe(plan.revision);
    expect(envelope.data.length_unit).toBe('0.1mm');
    expect(envelope.data.items).toHaveLength(6);
    expect(envelope.data.items[0]).toMatchObject({ item_id: 'S01', eco_ref: { type: 'plant_node', id: uuid(10), code: 'FA-1-10' }, rotation_mdeg: 270_000 });
    expect(envelope.data.items[1]).not.toHaveProperty('eco_ref');
    expect(envelope.data.zones).toEqual([{ id: 'Z-FA-1', kind: 'line', polygon: [[0, 0], [100_000, 0], [100_000, 80_000], [0, 80_000]], eco_ref: { type: 'plant_node', id: uuid(3), code: 'FA-1' } }]);
  });

  it('carries sizes and positions in ticks exactly as the plan holds them, nothing converted', () => {
    const plan = taggedPlan();
    const item = Object.values(plan.items).find((i) => i.id === 'S02')!;
    const definition = plan.catalog[item.definitionId]!;
    expect(buildEnvelope(plan, options).data.items.find((i) => i.item_id === 'S02')).toMatchObject({ x: item.position.x, y: item.position.y, w: definition.size.w, d: definition.size.d, h: definition.size.h });
  });

  it('is deterministic, and a new revision is a new version and a new event id', () => {
    const plan = taggedPlan();
    expect(JSON.stringify(buildEnvelope(plan, options))).toBe(JSON.stringify(buildEnvelope(plan, options)));
    const later = run(plan, tagItemCommand(plan, 'S02', stations[1]!));
    expect(later.revision).toBe(plan.revision + 1);
    const a = buildEnvelope(plan, options), b = buildEnvelope(later, options);
    expect(b.data.version).toBe(a.data.version + 1);
    expect(b.id).not.toBe(a.id);
    expect(b.data.id).toBe(a.data.id);
  });

  it('refuses a plan that breaks the contract, naming the problem', () => {
    const checked = checkedEnvelope(taggedPlan(), { ...options, companyId: 'not-a-company' });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.problems.join(' ')).toContain('envelope $.source');
    expect(checkedEnvelope(taggedPlan(), { ...options, seq: 0 }).ok).toBe(false);
  });

  it('makes a code from the name', () => {
    expect(layoutCode('Final assembly FA-1')).toBe('FINAL-ASSEMBLY-FA-1');
    expect(layoutCode('  ---  ')).toBe('PLAN');
    expect(layoutCode('x'.repeat(100)).length).toBe(64);
  });
});

describe('importing a plant export', () => {
  it('accepts the GMES export, a bare list and a JSON string, ordered plant to equipment then by code', () => {
    const fromObject = parsePlantExport(exportOf());
    expect(fromObject.companyId).toBe(COMPANY);
    expect(fromObject.nodes.map((n) => n.code)).toEqual(['EG-NV1', 'FA', 'FA-1', 'FA-1-10', 'FA-1-20']);
    expect(parsePlantExport(exportOf().nodes).nodes).toHaveLength(5);
    expect(parsePlantExport(JSON.stringify(exportOf())).nodes).toHaveLength(5);
    expect(fromObject.nodes[3]).toEqual({ id: uuid(10), code: 'FA-1-10', type: 'station', name: { en: 'FA-1-10', ar: 'FA-1-10' }, active: true, parent: { id: uuid(3), code: 'FA-1' } });
  });

  it('refuses a malformed export with a clear message and never a half tree', () => {
    const broken = exportOf();
    (broken.nodes[3] as { name: unknown }).name = { en: 'x' };
    expect(() => parsePlantExport(broken)).toThrow(/node 4 \(FA-1-10\): name\.ar: is required/);
    expect(() => parsePlantExport('not json')).toThrow(PlantImportError);
    expect(() => parsePlantExport({ nodes: [] })).toThrow(/no nodes/);
    expect(() => parsePlantExport({ hello: 1 })).toThrow(/expected a list of plant nodes/);
    const twice = exportOf();
    twice.nodes.push(twice.nodes[0]!);
    expect(() => parsePlantExport(twice)).toThrow(/appears twice/);
    const orphan = exportOf();
    (orphan.nodes[3] as { parent: unknown }).parent = { id: uuid(99), code: 'GONE' };
    expect(() => parsePlantExport(orphan)).toThrow(/parent \(GONE\)/);
  });
});

describe('sealed keys', { timeout: 30_000 }, () => {
  it('open again to the same text and are not stored as plain text on Windows', () => {
    const sealed = sealSecret('key-abc-123');
    expect(openSecret(sealed)).toBe('key-abc-123');
    if (process.platform === 'win32') expect(sealed.startsWith('dpapi:') && !sealed.includes('key-abc-123')).toBe(true);
    expect(sealSecret('')).toBe('');
  });
});

describe('the link routes', { timeout: 60_000 }, () => {
  let dir: string;
  let store: Store;
  let app: App;
  let base: string;
  const calls: Array<{ url: string; method: string; key: string | undefined; body: unknown }> = [];
  let answer: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
  const fake: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', key: init?.headers?.['x-eco-key'], body: init?.body ? JSON.parse(init.body) : undefined });
    const { status, body } = answer(url);
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  // The server's first person: administrator of the server (the link is one per server) and owner of its company.
  let admin: ReturnType<typeof client>;
  let companyId: string;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await admin.call(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, json: res.body };
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'planner-eco-'));
    store = new Store(join(dir, 'planner.db'), { passwordCost: 10 });
    calls.length = 0;
    answer = () => ({ status: 200, body: {} });
    app = createApp({ store, dataDir: dir, mcpScript: 'unused', ecoFetch: fake });
    base = `http://127.0.0.1:${await app.listen(0)}`;
    admin = client(base);
    const setup = await admin.call('/api/setup', { method: 'POST', body: JSON.stringify({ companyName: 'Link Co', name: 'Hany Fawzy', email: 'hany@link.example', password: PASSWORD }) });
    companyId = setup.body.company.id;
  });
  afterEach(async () => {
    await app.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const configure = () => api('PUT', '/api/eco', { company_id: COMPANY, gmes_url: 'http://gmes.local:4300/', node: 'planner-1', gmes_key: 'write-key-1', live_key: 'read-key-1' });

  it('saves the settings, never shows a key back and keeps a stored key when the field is left empty or masked', async () => {
    const saved = await configure();
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ company_id: COMPANY, gmes_url: 'http://gmes.local:4300', node: 'planner-1', has_key: true, has_live_key: true, plant: null });
    expect(JSON.stringify(saved.json)).not.toContain('write-key-1');
    expect(Object.keys(saved.json).sort()).toEqual(['company_id', 'gmes_url', 'has_key', 'has_live_key', 'node', 'plant']); // a key, even sealed, is never sent back
    expect(JSON.stringify((await api('GET', '/api/eco')).json)).not.toMatch(/dpapi:|plain:/);
    const stored = JSON.stringify(store.getSetting('eco'));
    if (process.platform === 'win32') expect(stored).not.toContain('write-key-1');
    await api('PUT', '/api/eco', { node: 'planner-2', gmes_key: '••••-1', live_key: '' });
    expect((await api('GET', '/api/eco')).json).toMatchObject({ node: 'planner-2', has_key: true, has_live_key: true });
    expect((await api('GET', '/api/eco/live-config')).json).toEqual({ gmes_url: 'http://gmes.local:4300', key: 'read-key-1' });
  });

  it('refuses a settings change that is not sound', async () => {
    const res = await api('PUT', '/api/eco', { company_id: 'abc', gmes_url: 'ftp://x', node: 'a b' });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/company_id.*gmes_url.*node/);
  });

  it('imports a plant file, refuses a bad one without changing what was stored, and refuses another company', async () => {
    await configure();
    const ok = await api('POST', '/api/eco/plant/import', { text: JSON.stringify(exportOf()) });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ imported: 5, source: 'file' });
    const bad = await api('POST', '/api/eco/plant/import', { text: '{"nodes": [{"code": "X"}]}' });
    expect(bad.status).toBe(422);
    expect(bad.json.error).toContain('not a valid plant export');
    expect((await api('GET', '/api/eco/plant')).json.nodes).toHaveLength(5);
    const foreign = await api('POST', '/api/eco/plant/import', { text: JSON.stringify({ ...exportOf(), company_id: '0192f7c4-8a3e-7b21-9c55-000000000000' }) });
    expect(foreign.status).toBe(422);
    expect(foreign.json.error).toContain('another company');
    expect(calls).toEqual([]); // reading a file never calls GMES
  });

  it('fetches the plant tree from GMES with the stored key, only when asked', async () => {
    expect((await api('POST', '/api/eco/plant/fetch', {})).status).toBe(400);
    await configure();
    answer = () => ({ status: 200, body: exportOf() });
    const res = await api('POST', '/api/eco/plant/fetch', {});
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ imported: 5, source: 'gmes' });
    expect(calls).toEqual([{ url: 'http://gmes.local:4300/api/plant/export', method: 'GET', key: 'write-key-1', body: undefined }]);
    answer = () => ({ status: 403, body: { error: { message: 'no' } } });
    const refused = await api('POST', '/api/eco/plant/fetch', {});
    expect(refused.status).toBe(502);
    expect(refused.json.error).toContain('refused the key');
    answer = () => { throw new Error('offline'); };
    expect((await api('POST', '/api/eco/plant/fetch', {})).json.error).toContain('did not answer');
  });

  it('downloads a snapshot without using a sequence number and sends it with the stored key', async () => {
    await configure();
    const project = store.createProject(taggedPlan(), 'human', undefined, { companyId });
    const first = await api('GET', `/api/projects/${project.id}/eco-snapshot`);
    const second = await api('GET', `/api/projects/${project.id}/eco-snapshot`);
    expect(first.status).toBe(200);
    expect(first.json.ecoseq).toBe(1);
    expect(second.json.ecoseq).toBe(1);
    expect(first.json.data.id).toBe(uuidV5(COMPANY, `space:layout:${project.id}`));

    answer = () => ({ status: 200, body: { results: [{ id: 'x', result: 'applied' }] } });
    const sent = await api('POST', `/api/projects/${project.id}/eco-send`, {});
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({ ok: true, result: 'applied', version: project.revision + 1 });
    const call = calls.at(-1)!;
    expect(call).toMatchObject({ url: 'http://gmes.local:4300/eco/v1/inbox', method: 'POST', key: 'write-key-1' });
    const event = (call.body as { events: Array<{ ecoseq: number; id: string; type: string }> }).events[0]!;
    expect(event).toMatchObject({ ecoseq: 1, type: 'eco.layout.snapshot.v1', id: sent.json.event_id });
    expect((await api('GET', `/api/projects/${project.id}/eco-snapshot`)).json.ecoseq).toBe(2);
  });

  it('reports what GMES made of it, including a refusal, and asks for missing settings first', async () => {
    const project = store.createProject(taggedPlan(), 'human', undefined, { companyId });
    expect((await api('POST', `/api/projects/${project.id}/eco-send`, {})).json.error).toContain('GMES address');
    await api('PUT', '/api/eco', { gmes_url: 'http://gmes.local:4300', gmes_key: 'k' });
    expect((await api('GET', `/api/projects/${project.id}/eco-snapshot`)).json.error).toContain('company id');
    await api('PUT', '/api/eco', { company_id: COMPANY });
    answer = () => ({ status: 200, body: { results: [{ id: 'x', result: 'rejected', code: 'eco.foreign_company', message: 'another company' }] } });
    const res = await api('POST', `/api/projects/${project.id}/eco-send`, {});
    expect(res.json).toMatchObject({ ok: false, result: 'rejected', code: 'eco.foreign_company' });
    expect((await api('POST', '/api/projects/p-nope/eco-send', {})).status).toBe(404);
  });
});
