import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { fromUnit, readRoom, type Project } from '@space-planner/core';
import { demoHall, newHome, nileGateRamadanDC } from '@space-planner/starter';

const newHomeProject = () => newHome('Empty', 6, 5);
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readableAgentLine } from '../src/agents.js';
import { createApp, type App } from '../src/http.js';
import { handleMessage } from '../src/mcp.js';
import { saveSettings } from '../src/settings.js';
import { Store } from '../src/store.js';
import { writeSamplePacks } from '../src/makePacks.js';
import { readPack } from '../src/packs.js';
import { runTool } from '../src/tools.js';

const m = (v: number) => fromUnit(v, 'm');
const fakeAgent = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url));

let dir: string;
let store: Store;
// The packs that come with the program, built once as the build does.
const packsDir = mkdtempSync(join(tmpdir(), 'planner-packs-'));
writeSamplePacks(packsDir);
afterAll(() => rmSync(packsDir, { recursive: true, force: true }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'planner-'));
  store = new Store(join(dir, 'planner.db'));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function until<T>(check: () => T | undefined | null | false, timeout = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('store', () => {
  it('rejects a readable backup whose revision identity does not match its database row', () => {
    const project = store.createProject(demoHall(), 'human');
    const database = new DatabaseSync(join(dir, 'planner.db'));
    try {
      database.prepare('UPDATE revisions SET snapshot = ? WHERE project_id = ?').run(JSON.stringify({ ...project, revision: 1 }), project.id);
    } finally { database.close(); }
    expect(() => store.backup(join(dir, 'backups'))).toThrow('Backup revision identity');
  });

  it('keeps every change as a revision with who and what', () => {
    const project = store.createProject(demoHall(), 'human');
    expect(project.id).toMatch(/^p-/);
    const result = store.applyCommands(
      project.id,
      [{ type: 'item.add', item: { id: 'chair-1', definitionId: 'chair', position: { x: m(7), y: m(6) }, rotation: 0, locked: false } }],
      { actor: 'agent:claude-code', baseRevision: 0 },
    );
    expect(result.ok).toBe(true);
    expect(store.getProject(project.id)?.revision).toBe(1);
    expect(store.history(project.id).map((h) => [h.revision, h.actor, h.summary])).toEqual([
      [1, 'agent:claude-code', 'Added'],
      [0, 'human', 'Created the project'],
    ]);
    expect(store.listProjects()[0]).toMatchObject({ id: project.id, revision: 1, itemCount: 1 });
  });

  it('refuses stale edits and broken commands', () => {
    const project = store.createProject(demoHall(), 'human');
    store.applyCommands(project.id, [{ type: 'project.rename', name: 'أ' }], { actor: 'human' });
    const stale = store.applyCommands(project.id, [{ type: 'project.rename', name: 'ب' }], { actor: 'human', baseRevision: 0 });
    expect(stale.ok === false && stale.status).toBe(409);
    const broken = store.applyCommands(project.id, [{ type: 'item.remove', id: 'ghost' }], { actor: 'human' });
    expect(broken.ok === false && broken.status === 422 && broken.rejection.code).toBe('not-found');
    expect(store.getProject(project.id)?.revision).toBe(1);
  });

  it('restores an old revision as a new one and survives reopening', () => {
    const project = store.createProject(demoHall(), 'human');
    store.applyCommands(project.id, [{ type: 'project.rename', name: 'جديد' }], { actor: 'human' });
    const restored = store.restore(project.id, 0, 'human');
    expect(restored.ok && restored.project).toMatchObject({ revision: 2, name: demoHall().name });
    store.close();
    store = new Store(join(dir, 'planner.db'));
    expect(store.getProject(project.id)).toMatchObject({ revision: 2, name: demoHall().name });
    expect(store.history(project.id)).toHaveLength(3);
  });

  it('opens a database made before project groups and keeps its projects, ungrouped', async () => {
    store.close();
    const path = join(dir, 'old.db');
    const { DatabaseSync } = await import('node:sqlite');
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL, item_count INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO projects VALUES ('p-old', 'Old hall', 0, 0, '2026-01-01', '2026-01-01');");
    old.close();
    store = new Store(path);
    expect(store.listProjects()).toEqual([expect.objectContaining({ id: 'p-old', name: 'Old hall', collection: null })]);
  });

  it('duplicates and deletes projects', () => {
    const project = store.createProject(demoHall(), 'human');
    const copy = store.duplicateProject(project.id, 'human');
    expect(copy?.id).not.toBe(project.id);
    expect(copy?.name).toContain('(copy)');
    expect(store.deleteProject(project.id)).toBe(true);
    expect(store.getProject(project.id)).toBeNull();
    expect(store.listProjects()).toHaveLength(1);
  });

  it('never returns the saved API key', async () => {
    const { publicSettings } = await import('../src/settings.js');
    const saved = saveSettings(store, { api: { provider: 'anthropic', apiKey: 'sk-ant-secret-1234', model: 'claude-opus-5', baseUrl: '' } });
    expect(publicSettings(saved).api).toMatchObject({ apiKey: '••••1234', hasKey: true });
    // Saving the masked value keeps the real key.
    const again = saveSettings(store, { api: { ...publicSettings(saved).api } });
    expect(again.api.apiKey).toBe('sk-ant-secret-1234');
  });
});

describe('agent tools', () => {
  it('partial furnishing names checks with missing information instead of claiming every check passed', () => {
    const ctx = { store, actor: 'agent:designer' };
    const built = runTool(ctx, 'build_apartment', { name: 'Kitchen only', rooms: [{ name: 'Kitchen', x_m: 0, y_m: 0, width_m: 5, depth_m: 4 }] });
    expect(built.isError).toBe(false);
    const id = /Created (p-[\w]+)/.exec(built.text)![1]!;
    const options = runTool(ctx, 'furnish_options', { project_id: id });
    expect(options.isError).toBe(false);
    expect(options.text).toContain('not checked (missing information)');
    expect(options.text).not.toContain('passes every check');
  });

  it('an AI designer: a flat from measurements, three furnished options with reasons, each kept as its own project', () => {
    const ctx = { store, actor: 'agent:designer' };
    const rooms = [
      { name: 'Reception', x_m: 0, y_m: 0, width_m: 8, depth_m: 4.5 },
      { name: 'غرفة نوم رئيسية', x_m: 0, y_m: 4.5, width_m: 4, depth_m: 4 },
      { name: 'Bath', x_m: 4, y_m: 4.5, width_m: 2.2, depth_m: 2.5 },
      { name: 'Kitchen', x_m: 6.2, y_m: 4.5, width_m: 1.8, depth_m: 4 },
    ];
    const built = runTool(ctx, 'build_apartment', {
      name: 'Client flat',
      rooms,
      doors: [{ between: ['Reception', 'غرفة نوم رئيسية'], at_m: 2.8 }, { between: ['Reception', 'Bath'], at_m: 0.5 }, { between: ['Reception', 'Kitchen'], at_m: 0.5 }],
      entrance: { room: 'Reception', side: 'south' },
      windows: [{ room: 'Reception', side: 'west', width_cm: 150 }, { room: 'غرفة نوم رئيسية', side: 'north' }],
    });
    expect(built.isError).toBe(false);
    const id = /Created (p-[\w]+)/.exec(built.text)![1]!;
    expect(built.text).toContain('Rooms from the walls (4)');
    expect(store.getProject(id)!.space.zones!.map((z) => z.kind)).toEqual(['living', 'bedroom', 'bathroom', 'kitchen']);
    const bad = runTool(ctx, 'build_apartment', { name: 'x', rooms: [rooms[0], { ...rooms[1], y_m: 4 }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('overlap');
    // A side that is not a side is refused, not turned into some wall.
    const wrongSide = runTool(ctx, 'build_apartment', { name: 'x', rooms: [rooms[0]], entrance: { room: 'Reception', side: 'up' } });
    expect(wrongSide.isError).toBe(true);
    expect(wrongSide.text).toContain('must be south, north, west or east');
    // Measurements copied from a file as text: "4,5" and "٤٫٥ م".
    const textNumbers = runTool(ctx, 'build_apartment', { name: 'text', rooms: [{ name: 'Living', x_m: '0', y_m: '0', width_m: '4,5', depth_m: '٤٫٥ م' }] });
    expect(textNumbers.isError).toBe(false);
    expect(textNumbers.text).toContain('18.49 m²'); // 4.5 × 4.5 m on the wall centre lines: 4.3 × 4.3 m inside 20 cm outer walls
    expect(runTool(ctx, 'build_apartment', { name: 'x', rooms: [{ ...rooms[0], width_m: 'wide' }] }).text).toContain('"width_m" must be a number (got "wide")');
    expect(runTool(ctx, 'build_apartment', { name: 'x', rooms: [rooms[0]], ceiling_m: 0 }).text).toContain('between 1.8 and 10 m');

    const options = runTool(ctx, 'furnish_options', { project_id: id });
    expect(options.isError).toBe(false);
    expect(options.text).toContain('Option A · Warm oak and linen');
    expect(options.text).toContain('Option C · Charcoal and white');
    expect(options.text).toMatch(/غرفة نوم رئيسية: Bed against the \w+ wall/);
    expect(options.text).not.toContain('error(s)');

    const applied = runTool(ctx, 'apply_furnishing', { project_id: id, option: 'B' });
    expect(applied.isError).toBe(false);
    expect(store.getProject(id)!.revision).toBe(1);
    expect(Object.keys(store.getProject(id)!.items).length).toBeGreaterThan(10);

    const before = store.listProjects().length;
    const kept = runTool(ctx, 'furnish_apartment_options', { project_id: id });
    expect(kept.isError).toBe(false);
    expect(store.listProjects().length).toBe(before + 3);
    expect(kept.text).toContain('Client flat · Option A · Warm oak and linen');

    // A hall is not rebuilt as a flat (it would lose its doors and kind); a locked piece stops a rebuild.
    const hall = store.createProject(demoHall(), 'human');
    const refused = runTool(ctx, 'build_apartment', { project_id: hall.id, rooms });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('is not an apartment');
    expect(store.getProject(hall.id)!.revision).toBe(0);
    const withLock = store.createProject(newHomeProject(), 'human');
    const piece = runTool(ctx, 'place_items', { project_id: withLock.id, items: [{ definition_id: 'home-sofa-linen', x_m: 3, y_m: 3 }] });
    expect(piece.isError).toBe(false);
    const pieceId = Object.keys(store.getProject(withLock.id)!.items)[0]!;
    runTool(ctx, 'apply_commands', { project_id: withLock.id, commands: [{ type: 'item.lock', id: pieceId, locked: true }] });
    const stuck = runTool(ctx, 'build_apartment', { project_id: withLock.id, rooms });
    expect(stuck.isError).toBe(true);
    expect(stuck.text).toContain(`locked and would be removed by the rebuild: ${pieceId}`);

    // The same flat, built into an existing project in one revision.
    const target = store.createProject(newHomeProject(), 'human');
    const into = runTool(ctx, 'build_apartment', { project_id: target.id, rooms });
    expect(into.isError).toBe(false);
    expect(store.getProject(target.id)!.revision).toBe(1);
    expect(store.getProject(target.id)!.space.walls!.length).toBeGreaterThan(6);

    expect(runTool(ctx, 'design_guide', {}).text).toContain('workflow: Working in Atrium as an interior designer');
    expect(runTool(ctx, 'design_guide', { topic: 'bedroom' }).text).toContain('command position');
  });

  it('draws walls, puts a door in one and removes it again, each as one revision; rooms come from the walls', () => {
    const ctx = { store, actor: 'agent:test' };
    const created = runTool(ctx, 'create_project', { name: 'Flat', activity: 'home', width_m: 4, depth_m: 3 });
    const id = /Created (p-[\w]+)/.exec(created.text)![1]!;
    // Inside 4 × 3 m from 0.2 m; a 10 cm partition at x = 2.5 from the south to the north wall centre line.
    const drawn = runTool(ctx, 'draw_walls', { project_id: id, walls: [{ from: [2.5, 0.1], to: [2.5, 3.3] }] });
    expect(drawn.isError).toBe(false);
    expect(drawn.text).toContain('Drew wall-1.');
    const door = runTool(ctx, 'add_openings', { project_id: id, openings: [{ wall: 'wall-1', kind: 'door', from_start_m: 1, width_cm: 80, hinge: 'start', side: 'left' }] });
    expect(door.isError).toBe(false);
    const described = runTool(ctx, 'get_project', { project_id: id }).text;
    expect(described).toContain('wall-1 | (2.5, 0.1) | (2.5, 3.3) | 10 cm | ceiling');
    expect(described).toContain('door-1 | door | wall-1 | 1.00 m | 80 cm | hinge at start, opens to the left');
    // West 2.25 × 3 = 6.75 m², east 1.65 × 3 = 4.95 m².
    expect(described).toContain('Rooms from the walls (2): 6.75 m²');
    expect(described).toContain('; 4.95 m²');
    expect(runTool(ctx, 'add_openings', { project_id: id, openings: [{ wall: 'wall-1', kind: 'window', from_start_m: 3, width_cm: 120 }] }).isError).toBe(true);
    expect(runTool(ctx, 'set_room', { project_id: id, width_m: 5 }).isError).toBe(true);
    expect(runTool(ctx, 'remove_walls', { project_id: id, ids: ['wall-1'] }).isError).toBe(false);
    const after = store.getProject(id)!;
    expect(after.revision).toBe(3);
    expect(after.space.walls?.map((w) => w.id)).toEqual(['wall-south', 'wall-east', 'wall-north', 'wall-west']);
    expect(after.space.openings?.map((o) => o.id)).toEqual(['front-door']);
  });

  it('creates a warehouse and adds an addressable rack through one revision', () => {
    const ctx = { store, actor: 'agent:test' };
    const created = runTool(ctx, 'create_project', { name: 'Warehouse', activity: 'warehouse', reference: true });
    expect(created.isError).toBe(false);
    const id = /Created (p-[\w]+)/.exec(created.text)![1]!;
    expect(runTool(ctx, 'warehouse_metrics', { project_id: id }).text).toContain('"positions":240');
    expect(runTool(ctx, 'find_warehouse_route', { project_id: id, dock_id: 'receiving', rack_id: 'R01' }).text).toContain('reachable');
    const added = runTool(ctx, 'add_warehouse_rack', { project_id: id, x_m: 15, y_m: 1.5, bays: 2, levels: 3, positions_per_level: 2 });
    expect(added.isError).toBe(false);
    expect(store.getProject(id)?.revision).toBe(1);
    expect(runTool(ctx, 'warehouse_metrics', { project_id: id }).text).toContain('"positions":252');
    expect(store.history(id)[0]).toMatchObject({ actor: 'agent:test', summary: 'Added rack row rack-1' });
    expect(runTool(ctx, 'add_warehouse_zone', { project_id: id, kind: 'charging', vertices: [{ x_m: 25, y_m: 15 }, { x_m: 29, y_m: 15 }, { x_m: 29, y_m: 19 }, { x_m: 25, y_m: 19 }] }).isError).toBe(false);
    expect(store.getProject(id)?.space.zones?.some((z) => z.kind === 'charging')).toBe(true);
    expect(runTool(ctx, 'add_warehouse_zone', { project_id: id, kind: 'no-go', vertices: [{ x_m: -1, y_m: 1 }, { x_m: 1, y_m: 1 }, { x_m: 1, y_m: 2 }] }).isError).toBe(true);
  });

  it('lets an agent read stock, move a pallet and re-slot a stocked warehouse, each as one revision', () => {
    const ctx = { store, actor: 'agent:test' };
    const dc = store.createProject(nileGateRamadanDC(), 'Sample data');
    const stock = JSON.parse(runTool(ctx, 'warehouse_stock', { project_id: dc.id, material_id: 'Q655' }).text);
    expect(stock.positions).toBe(1680);
    const from = stock.locations[0] as string;
    const moved = runTool(ctx, 'assign_stock', { project_id: dc.id, changes: [{ location: from, material_id: null }, { location: 'E04-B02-L03-P01', material_id: 'Q655' }] });
    expect(moved.isError).toBe(false);
    expect(JSON.parse(runTool(ctx, 'warehouse_stock', { project_id: dc.id, material_id: 'Q655' }).text).locations).toContain('E04-B02-L03-P01');
    expect(runTool(ctx, 'assign_stock', { project_id: dc.id, changes: [{ location: 'W01-B99-L01-P01', material_id: 'Q655' }] }).isError).toBe(true);
    const proposal = JSON.parse(runTool(ctx, 'optimize_slotting', { project_id: dc.id }).text);
    expect(proposal.saving).toBeGreaterThan(10);
    expect(store.getProject(dc.id)?.revision).toBe(1);
    expect(runTool(ctx, 'optimize_slotting', { project_id: dc.id, apply: true }).text).toMatch(/^Applied, revision 2/);
    expect(store.history(dc.id)[0]).toMatchObject({ actor: 'agent:test' });
  });

  it('lets an agent create a container, plan cargo, compare packing candidates and apply one as one revision', () => {
    const ctx = { store, actor: 'agent:test' };
    const created = runTool(ctx, 'create_project', { name: 'Order 7', activity: 'container', container_type: '20gp' });
    expect(created.isError).toBe(false);
    const id = /Created (p-[\w]+)/.exec(created.text)![1]!;
    expect(created.text).toContain('Container: type 20gp, doors at the east end');
    expect(runTool(ctx, 'define_item', { project_id: id, id: 'euro-pallet', name: 'Euro pallet', category: 'box', width_cm: 120, depth_cm: 80, height_cm: 150, mass_kg: 400, cargo: { quantity: 10 } }).isError).toBe(false);
    // The cargo data the type already had (stackable, load on top, this way up) is kept.
    expect(store.getProject(id)!.catalog['euro-pallet']!.meta).toMatchObject({ quantity: 10, stackable: true, allowTilt: false });
    const compared = runTool(ctx, 'pack_container', { project_id: id });
    expect(compared.text).toContain('Candidates (nothing changed)');
    expect(compared.text).toContain('placed 10 of 10 pieces');
    expect(Object.keys(store.getProject(id)!.items)).toHaveLength(0);
    const applied = runTool(ctx, 'pack_container', { project_id: id, strategy: 'heaviest-first', apply: true });
    expect(applied.isError).toBe(false);
    expect(Object.keys(store.getProject(id)!.items)).toHaveLength(10);
    expect(store.history(id)[0]).toMatchObject({ actor: 'agent:test', summary: 'Packed 10 pieces (heaviest first)' });
    expect(applied.text).toContain('payload: 4000 kg of 28200 kg: pass');
    expect(applied.text).toContain('planned pieces placed: 10 of 10: pass');
    // A piece laid on its side, with a stop, through place_items.
    expect(runTool(ctx, 'place_items', { project_id: id, items: [{ definition_id: 'carton-large', x_m: 5.5, y_m: 2, tilt: 'x', stop: 2 }] }).isError).toBe(false);
    expect(store.getProject(id)!.items['carton-large-1']).toMatchObject({ tilt: 'x', meta: { stop: 2 } });
    expect(runTool(ctx, 'pack_container', { project_id: (store.createProject(demoHall(), 'human')).id }).isError).toBe(true);
  });

  it('lets an agent plan a shipment: how many containers, each loaded, as the agent', () => {
    const ctx = { store, actor: 'agent:test' };
    const result = runTool(ctx, 'plan_shipment', { name: 'Boxes', container_type: '20gp', parts: [{ name: 'Box', length_mm: 1000, width_mm: 500, height_mm: 500, quantity: 100, may_tilt: false }] });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('100 pieces need 2 × 20′ standard');
    expect(result.text).toMatch(/Boxes · container 1 of 2: 88 × box/);
    expect(store.listProjects().filter((p) => p.collection?.startsWith('shipment:'))).toHaveLength(2);
    expect(store.history(store.listProjects()[0]!.id)[0]).toMatchObject({ actor: 'agent:test' });
    expect(runTool(ctx, 'plan_shipment', { name: 'Bad', parts: [{ name: 'Box', length_mm: 0, width_mm: 1, height_mm: 1, quantity: 1 }] }).text).toBe('Error: parts[0].length_mm must be a number above 0 up to 20000');
    expect(runTool(ctx, 'plan_shipment', { name: 'Tiny', parts: [{ name: 'Tiny', length_mm: 0.01, width_mm: 0.01, height_mm: 0.01, quantity: 1 }] }).text).toBe('Error: parts[0].length_mm is smaller than 1 mm: sizes are in millimetres');
    // what a part may carry decides its height: three layers stated (2 across × 3 × 11 walls = 66), or nothing on top (2 × 11 = 22)
    expect(runTool(ctx, 'plan_shipment', { name: 'Three', container_type: '20gp', parts: [{ name: 'Box', length_mm: 1000, width_mm: 500, height_mm: 500, quantity: 100, may_tilt: false, max_layers: 3 }] }).text).toMatch(/Three · container 1 of 2: 66 × box/);
    expect(runTool(ctx, 'plan_shipment', { name: 'Flat', container_type: '20gp', parts: [{ name: 'Box', length_mm: 1000, width_mm: 500, height_mm: 500, quantity: 30, may_tilt: false, stackable: false }] }).text).toMatch(/Flat · container 1 of 2: 22 × box/);
    expect(runTool(ctx, 'plan_shipment', { name: 'Bad', parts: [{ name: 'Box', length_mm: 1, width_mm: 1, height_mm: 1, quantity: 1, stackable: 'yes' }] }).text).toBe('Error: parts[0].stackable must be true or false');
  });

  it('keeps a container\'s data when the room is changed through set_room', () => {
    const ctx = { store, actor: 'agent:test' };
    const id = /Created (p-[\w]+)/.exec(runTool(ctx, 'create_project', { name: 'C', activity: 'container', container_type: '40hc' }).text)![1]!;
    runTool(ctx, 'set_room', { project_id: id, width_m: 12, depth_m: 2.35 });
    expect(store.getProject(id)!.space.meta).toMatchObject({ pack: 'container', containerType: '40hc' });
  });

  it('lets an agent set the room, define an item and place items, with clear feedback', () => {
    const ctx = { store, actor: 'agent:test' };
    const project = store.createProject(demoHall(), 'human');
    const room = runTool(ctx, 'set_room', {
      project_id: project.id,
      width_m: 14,
      depth_m: 10,
      doors: [{ wall: 'east', offset_m: 4, width_cm: 120 }],
      columns: [],
    });
    expect(room).toMatchObject({ isError: false });
    expect(readRoom(store.getProject(project.id)!.space)).toMatchObject({ width: m(14), depth: m(10), doors: [{ wall: 'east' }], columns: [] });

    expect(runTool(ctx, 'define_item', { project_id: project.id, id: 'bar', name: 'بار', category: 'counter', width_cm: 300, depth_cm: 70, height_cm: 110, clearance_cm: { front: 100 } }).isError).toBe(false);
    const placed = runTool(ctx, 'place_items', {
      project_id: project.id,
      items: [
        { definition_id: 'bar', x_m: 7, y_m: 9.5, rotation_deg: 180 },
        { definition_id: 'chair', x_m: 1, y_m: 1 },
      ],
    });
    expect(placed.text).toContain('Placed 2 item(s): bar-1, chair-1');
    const described = runTool(ctx, 'get_project', { project_id: project.id }).text;
    expect(described).toContain('Room: 14.00 m wide');
    expect(described).toContain('bar-1 | bar | 7 | 9.5 | 180 | 0');
    // Raise the chair 1.2 m (as if on a platform) and bring it back down, one revision each.
    expect(runTool(ctx, 'move_items', { project_id: project.id, moves: [{ id: 'chair-1', height_m: 1.2 }] }).isError).toBe(false);
    expect(store.getProject(project.id)!.items['chair-1']?.elevation).toBe(m(1.2));
    expect(runTool(ctx, 'get_project', { project_id: project.id }).text).toContain('chair-1 | chair | 1 | 1 | 0 | 1.2');
    expect(store.history(project.id)[0]?.summary).toBe('Moved items');
    runTool(ctx, 'move_items', { project_id: project.id, moves: [{ id: 'chair-1', height_m: 0 }] });
    expect(store.getProject(project.id)!.items['chair-1']).not.toHaveProperty('elevation');
    expect(runTool(ctx, 'move_items', { project_id: project.id, moves: [{ id: 'chair-1', height_m: -1 }] }).isError).toBe(true);
    // Hall rules: one guest behind the east door of a 14 × 10 m room, 140 m² for one seat.
    expect(described).toContain('Hall rules (banquet):');
    const checked = runTool(ctx, 'check_project', { project_id: project.id, hall_style: 'theatre' }).text;
    expect(checked).toContain('Hall rules (theatre):');
    expect(checked).toContain('walkway 100 cm from every seat to a door: pass');
    expect(checked).toContain('exits: 1 door(s) (needs 1): pass');
    expect(store.history(project.id)[0]?.actor).toBe('agent:test');
  });

  it('creates an office with the office catalog and checks it against the office rules', () => {
    const ctx = { store, actor: 'agent:test' };
    const created = runTool(ctx, 'create_project', { name: 'مكتب', width_m: 8, depth_m: 6, ceiling_m: 3, activity: 'office' }).text;
    const id = /Created (\S+)\./.exec(created)![1]!;
    expect(store.getProject(id)!.catalog['desk-140']).toBeDefined();
    expect(created).toContain('Office rules (open-plan):');
    // A desk at (2, 3) facing north, and a chair 30 cm in front of it: 48 m² for one person.
    runTool(ctx, 'place_items', { project_id: id, items: [{ definition_id: 'desk-140', x_m: 2, y_m: 3 }, { definition_id: 'office-chair', x_m: 2, y_m: 3.65, rotation_deg: 180 }] });
    const checked = runTool(ctx, 'check_project', { project_id: id, style: 'meeting' }).text;
    expect(checked).toContain('Office rules (meeting):');
    expect(checked).toContain('desks with a chair: 1 of 1: pass');
    expect(checked).toContain('floor per person: 48 m² (needs 2): pass');
    // The same project checked as a hall uses the hall's rules.
    expect(runTool(ctx, 'check_project', { project_id: id, activity: 'hall' }).text).toContain('Hall rules (banquet):');
  });

  it('gives round tables a round footprint, so chairs can circle them', () => {
    const ctx = { store, actor: 'agent:test' };
    const project = store.createProject(demoHall(), 'human');
    runTool(ctx, 'define_item', { project_id: project.id, id: 'round-180', name: 'مدورة ١٨٠', category: 'round-table', width_cm: 180, depth_cm: 180, height_cm: 75 });
    expect(store.getProject(project.id)!.catalog['round-180']?.footprint).toBe('round');
    const items: Array<Record<string, unknown>> = [{ definition_id: 'round-180', x_m: 7.5, y_m: 5.5 }];
    for (let k = 0; k < 10; k++) {
      const a = (k * Math.PI) / 5;
      items.push({ definition_id: 'chair', x_m: 7.5 + 1.2 * Math.cos(a), y_m: 5.5 + 1.2 * Math.sin(a), rotation_deg: (a * 180) / Math.PI + 90 });
    }
    expect(runTool(ctx, 'place_items', { project_id: project.id, items }).text).toContain('No issues.');
  });

  it('reports mistakes so the agent can correct them', () => {
    const ctx = { store, actor: 'agent:test' };
    const project = store.createProject(demoHall(), 'human');
    expect(runTool(ctx, 'place_items', { project_id: project.id, items: [{ definition_id: 'sofa-x', x_m: 1, y_m: 1 }] }).text).toMatch(/broken-reference/);
    expect(runTool(ctx, 'set_room', { project_id: project.id, doors: [{ wall: 'south', offset_m: 9.5, width_cm: 90 }] }).text).toMatch(/does not fit on the south wall/);
    expect(runTool(ctx, 'get_project', { project_id: 'nope' }).isError).toBe(true);
    expect(runTool(ctx, 'no_such_tool', {}).isError).toBe(true);
    const check = runTool(ctx, 'place_items', { project_id: project.id, items: [{ definition_id: 'chair', x_m: 5, y_m: 3.7 }] });
    expect(check.text).toContain('[error] on-obstacle');
  });
});

describe('agent output', () => {
  it('turns Claude Code stream events into short lines', () => {
    expect(readableAgentLine('{"type":"assistant","message":{"content":[{"type":"text","text":"أبدأ"},{"type":"tool_use","name":"mcp__planner__place_items"}]}}')).toBe('أبدأ\n🔧 place_items');
    expect(readableAgentLine('{"type":"system","subtype":"init"}')).toBeNull();
    expect(readableAgentLine('{"type":"result","subtype":"success"}')).toBe('✔ Done');
    expect(readableAgentLine('plain text from codex')).toBe('plain text from codex');
  });
});

describe('HTTP app', () => {
  let app: App;
  let base: string;

  beforeEach(async () => {
    app = createApp({ store, dataDir: dir, mcpScript: join(dir, 'missing-mcp.mjs'), packsDir });
    base = `http://127.0.0.1:${await app.listen(0)}`;
  });

  afterEach(async () => {
    await app.close();
  });

  const json = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json' } });
    return { status: response.status, body: (await response.json()) as any };
  };

  it('creates projects, applies commands with conflict detection, and restores', async () => {
    const created = await json('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'قاعة', width_m: 12, depth_m: 9, ceiling_m: 3 }) });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const add = (baseRevision: number) =>
      json(`/api/projects/${id}/commands`, {
        method: 'POST',
        body: JSON.stringify({ baseRevision, commands: [{ type: 'item.add', item: { id: `chair-${baseRevision}`, definitionId: 'chair', position: { x: m(3), y: m(3 + baseRevision) }, rotation: 0, locked: false } }] }),
      });
    expect((await add(0)).status).toBe(200);
    const stale = await add(0);
    expect(stale.status).toBe(409);
    expect(stale.body.project.revision).toBe(1);
    expect((await json(`/api/projects/${id}/commands`, { method: 'POST', body: JSON.stringify({ commands: [{ type: 'item.remove', id: 'x' }] }) })).status).toBe(422);
    expect((await json(`/api/projects/${id}/history`)).body).toHaveLength(2);
    // A restore names the revision this window last saw (1, after the add), so it can be refused if stale.
    const restored = await json(`/api/projects/${id}/restore`, { method: 'POST', body: JSON.stringify({ revision: 0, baseRevision: 1 }) });
    expect(restored.body.project).toMatchObject({ revision: 2, items: {} });
    expect((await json('/api/projects/nope')).status).toBe(404);
    expect((await json('/api/projects', { method: 'POST', body: JSON.stringify({ width_m: -1, depth_m: 3 }) })).status).toBe(400);
  });

  it('lists the included packs and installs one as ordinary stored projects, main site first', async () => {
    const packs = (await json('/api/packs')).body as { installed: unknown[]; included: Array<{ id: string; projectCount: number; installed: boolean }> };
    expect(packs.installed).toEqual([]);
    expect(packs.included.map((p) => [p.id, p.projectCount])).toEqual([['horizon-electronics', 10], ['nile-gate', 9], ['nile-vision', 3]]);
    const added = await json('/api/packs', { method: 'POST', body: JSON.stringify({ included: 'nile-gate' }) });
    expect(added.status).toBe(201);
    expect(added.body.projects).toHaveLength(9);
    const list = (await json('/api/projects')).body as Array<{ id: string; name: string; collection: string | null }>;
    expect(list).toHaveLength(9);
    expect(list[0]!.name).toContain('10th of Ramadan DC');
    expect(list[0]).toMatchObject({ collection: 'pack:nile-gate' });
    const history = (await json(`/api/projects/${list[0]!.id}/history`)).body as Array<{ actor: string; summary: string }>;
    expect(history).toEqual([expect.objectContaining({ actor: 'human', summary: 'Installed from the pack “Nile Gate Logistics”', revision: 0 })]);
    const after = (await json('/api/packs')).body as { installed: Array<{ id: string; projectCount: number }>; included: Array<{ id: string; installed: boolean }> };
    expect(after.installed).toMatchObject([{ id: 'nile-gate', projectCount: 9 }]);
    expect(after.included.find((p) => p.id === 'nile-gate')!.installed).toBe(true);
    expect((await json('/api/packs', { method: 'POST', body: JSON.stringify({ included: 'unknown' }) })).status).toBe(404);
  });

  it('installing a pack again asks first, then replaces only that pack’s projects', async () => {
    const own = store.createProject(demoHall(), 'human');
    await json('/api/packs', { method: 'POST', body: JSON.stringify({ included: 'nile-vision' }) });
    const first = store.listProjects().filter((p) => p.collection === 'pack:nile-vision').map((p) => p.id);
    const again = await json('/api/packs', { method: 'POST', body: JSON.stringify({ included: 'nile-vision' }) });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: 'installed', pack: { id: 'nile-vision', projectCount: 3 } });
    const replaced = await json('/api/packs', { method: 'POST', body: JSON.stringify({ included: 'nile-vision', replace: true }) });
    expect(replaced.status).toBe(201);
    const second = store.listProjects().filter((p) => p.collection === 'pack:nile-vision').map((p) => p.id);
    expect(second).toHaveLength(3);
    expect(second.some((id) => first.includes(id))).toBe(false);
    expect(store.getProject(own.id)).not.toBeNull();
  });

  it('removes a pack and only its projects', async () => {
    const own = store.createProject(demoHall(), 'human');
    await json('/api/packs', { method: 'POST', body: JSON.stringify({ included: 'nile-vision' }) });
    const removed = await json('/api/packs/nile-vision', { method: 'DELETE' });
    expect(removed.body).toMatchObject({ ok: true, removed: 3 });
    expect(store.listProjects().map((p) => p.id)).toEqual([own.id]);
    expect((await json('/api/packs')).body.installed).toEqual([]);
    expect((await json('/api/packs/nile-vision', { method: 'DELETE' })).status).toBe(404);
  });

  it('a pack goes round through a file: download it, remove it, install the file', async () => {
    await json('/api/packs', { method: 'POST', body: JSON.stringify({ included: 'nile-gate' }) });
    const names = store.listProjects().map((p) => p.name);
    const file = await fetch(`${base}/api/packs/nile-gate/file`);
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="nile-gate.atrium"');
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes[0]).toBe(0x1f); // compressed
    await json('/api/packs/nile-gate', { method: 'DELETE' });
    const installed = await json('/api/packs', { method: 'POST', body: JSON.stringify({ data: bytes.toString('base64') }) });
    expect(installed.status).toBe(201);
    expect(store.listProjects().map((p) => p.name)).toEqual(names);
  });

  it('refuses files that are not packs, in plain words, and installs nothing', async () => {
    const send = (data: string) => json('/api/packs', { method: 'POST', body: JSON.stringify({ data }) });
    const text = (t: string) => Buffer.from(t).toString('base64');
    expect((await send(text('hello'))).body).toMatchObject({ error: 'This file is not an Atrium pack.' });
    expect((await send(text(JSON.stringify({ format: 'atrium-pack', version: 9, id: 'x', name: 'X', projects: ['{}'] })))).body.error).toBe('This pack was made by a newer Atrium. Update Atrium to install it.');
    const damaged = await send(text(JSON.stringify({ format: 'atrium-pack', version: 1, id: 'x', name: 'X', projects: ['{"schemaVersion":2}'] })));
    expect(damaged.status).toBe(422);
    expect(damaged.body.error).toMatch(/^Project 1 in this pack cannot be opened/);
    expect(store.listProjects()).toEqual([]);
    expect((await json('/api/packs', { method: 'POST', body: '{}' })).status).toBe(400);
  });

  it('saves chosen projects as a new pack file, named after the pack', async () => {
    const one = store.createProject(demoHall(), 'human');
    const made = await fetch(`${base}/api/packs/file`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Client — Villa 12', projectIds: [one.id, 'missing'] }) });
    expect(made.headers.get('content-disposition')).toBe('attachment; filename="client-villa-12.atrium"');
    const pack = readPack(Buffer.from(await made.arrayBuffer()));
    expect(pack).toMatchObject({ id: 'client-villa-12', name: 'Client — Villa 12' });
    expect(pack.projects.map((p) => p.name)).toEqual([one.name]);
    expect((await json('/api/packs/file', { method: 'POST', body: JSON.stringify({ name: 'Empty', projectIds: [] }) })).status).toBe(400);
  });

  it('plans a shipment as loaded container projects in one group, container 1 listed first', async () => {
    const cushion = { name: 'TV55B Cushion Top', length_mm: 1335, width_mm: 110, height_mm: 400, quantity: 1750 };
    const created = await json('/api/shipments', {
      method: 'POST',
      body: JSON.stringify({ name: 'Cushions 04/Oct', container_type: '40hc', parts: [cushion, { ...cushion, name: 'TV55B Cushion Bot' }] }),
    });
    expect(created.status).toBe(201);
    // 3 500 cushions lying flat at 1 080 per 40′ high cube (hand-computed in the starter tests, decision 0024).
    expect(created.body.containers.map((c: { pieces: Record<string, number> }) => Object.values(c.pieces).reduce((s, n) => s + n, 0))).toEqual([1080, 1080, 1080, 260]);
    expect(created.body.containers.map((c: { pieces: unknown }) => c.pieces)).toEqual([
      { 'tv55b-cushion-top': 1080 },
      { 'tv55b-cushion-top': 670, 'tv55b-cushion-bot': 410 },
      { 'tv55b-cushion-bot': 1080 },
      { 'tv55b-cushion-bot': 260 },
    ]);
    const list = (await json('/api/projects')).body as Array<{ name: string; collection: string | null }>;
    expect(list.slice(0, 4).map((p) => p.name)).toEqual(['Cushions 04/Oct · container 1 of 4', 'Cushions 04/Oct · container 2 of 4', 'Cushions 04/Oct · container 3 of 4', 'Cushions 04/Oct · container 4 of 4']);
    expect(new Set(list.slice(0, 4).map((p) => p.collection))).toEqual(new Set([`shipment:${created.body.shipment}`]));
    const first = (await json(`/api/projects/${created.body.containers[0].id}`)).body as Project;
    expect(first.space.meta).toMatchObject({ pack: 'container', shipment: created.body.shipment, shipmentIndex: 1, shipmentCount: 4 });
    expect(first.catalog['tv55b-cushion-top']!.meta).toMatchObject({ quantity: 1080, allowTilt: true });

    const bad = (body: unknown) => json('/api/shipments', { method: 'POST', body: JSON.stringify(body) });
    expect((await bad({ name: 'x', parts: [] })).status).toBe(400);
    expect((await bad({ name: 'x', container_type: 'nope', parts: [cushion] })).status).toBe(400);
    expect((await bad({ name: 'x', parts: [{ ...cushion, length_mm: -5 }] })).body.error).toBe('parts[0].length_mm must be a number above 0 up to 20000');
    expect((await bad({ name: 'x', parts: [{ ...cushion, quantity: 'many' }] })).status).toBe(400);
    expect((await bad({ name: 'x', parts: [{ ...cushion, quantity: 150_000 }, { ...cushion, quantity: 60_000 }] })).body.error).toBe('the parts add up to 210000 pieces; one shipment takes at most 200000');
  });

  it('rejects incomplete shipments before storage through HTTP and the agent tool', async () => {
    const before = store.listProjects().map((p) => p.id);
    const small = { name: 'Small', length_mm: 500, width_mm: 500, height_mm: 500, quantity: 1 };
    const beam = { name: 'Beam', length_mm: 7000, width_mm: 100, height_mm: 100, quantity: 1, may_tilt: false };
    const bad = await json('/api/shipments', { method: 'POST', body: JSON.stringify({ name: 'Partial', container_type: '20gp', parts: [small, beam] }) });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('Shipment is incomplete');
    expect(bad.body.error).toContain('beam');
    const set = { length_mm: 4000, width_mm: 2200, height_mm: 2200, quantity: 1, model: 'M', may_tilt: false };
    const result = runTool({ store, actor: 'agent:test' }, 'plan_shipment', { name: 'Partial sets', container_type: '20gp', parts: [small, { ...set, name: 'A' }, { ...set, name: 'B' }] });
    expect(result.text).toContain('Unplanned models: M');
    expect(result.text).toContain('Nothing was saved');
    expect(store.listProjects().map((p) => p.id)).toEqual(before);
    const tiny = await json('/api/shipments', { method: 'POST', body: JSON.stringify({ parts: [{ ...small, width_mm: 0.99 }] }) });
    expect(tiny.status).toBe(400);
    expect(tiny.body.error).toContain('smaller than 1 mm');
  });

  it('backs up and rehearses all revisions, settings and agent history without changing the live store', async () => {
    const project = store.createProject(demoHall(), 'human');
    store.applyCommands(project.id, [{ type: 'project.rename', name: 'Revised' }], { actor: 'human' });
    store.restore(project.id, 0, 'human');
    store.setSetting('backup-test', { privateValue: 'test only', enabled: true });
    const run = store.createRun(project.id, 'fake', 'Rehearsal');
    store.appendRunLog(run.id, 'Test log');
    store.finishRun(run.id, 'done');
    const original = store.getProject(project.id);
    const history = store.history(project.id);
    const result = await json('/api/backups', { method: 'POST', body: '{}' });
    expect(result.status).toBe(201);
    expect(result.body.name).toMatch(/^planner-[a-zA-Z0-9-]+\.db$/);
    expect(result.body.rehearsal).toEqual({ ok: true, projects: 1, revisions: 3, settings: 1, agentRuns: 1 });
    expect(JSON.stringify(result.body)).not.toContain('privateValue');
    const snapshot = join(dir, 'backups', result.body.name);
    expect(existsSync(snapshot)).toBe(true);
    // Rehearse restoring a copy, keeping the named snapshot untouched.
    const restoreFile = join(dir, 'rehearsal.db');
    copyFileSync(snapshot, restoreFile);
    const restored = new Store(restoreFile);
    try {
      expect(restored.getProject(project.id)).toEqual(original);
      expect(restored.history(project.id)).toEqual(history);
      for (let revision = 0; revision <= 2; revision++) expect(restored.getRevision(project.id, revision)).toEqual(store.getRevision(project.id, revision));
      expect(restored.getSetting('backup-test')).toEqual(store.getSetting('backup-test'));
      expect(restored.getRun(run.id)).toEqual(store.getRun(run.id));
    } finally { restored.close(); }
    const second = await json('/api/backups', { method: 'POST', body: '{}' });
    expect(second.body.name).not.toBe(result.body.name);
    expect(store.getProject(project.id)).toEqual(original);
    expect(store.history(project.id)).toEqual(history);
    expect((await fetch(`${base}/api/backups`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' })).status).toBe(403);
  });

  it('pushes live events when anything changes', async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const project = store.createProject(demoHall(), 'human');
    runTool({ store, actor: 'agent:x' }, 'place_items', { project_id: project.id, items: [{ definition_id: 'chair', x_m: 8, y_m: 6 }] });
    let text = '';
    while (!text.includes('event: project')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain(`"projectId":"${project.id}"`);
    controller.abort();
  });

  it('answers MCP requests through the bridge', async () => {
    const project = store.createProject(demoHall(), 'human');
    const options = { url: base, actor: 'agent:claude-code' };
    const init = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, options)) as any;
    expect(init.result.protocolVersion).toBe('2025-06-18');
    const list = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, options)) as any;
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('place_items');
    const call = (await handleMessage(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'place_items', arguments: { project_id: project.id, items: [{ definition_id: 'chair', x_m: 8, y_m: 6 }] } } },
      options,
    )) as any;
    expect(call.result.isError).toBe(false);
    expect(store.history(project.id)[0]?.actor).toBe('agent:claude-code');
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, options)).toBeNull();
    const down = (await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { ...options, url: 'http://127.0.0.1:1' })) as any;
    expect(down.error.message).toContain('not running');
  });

  it('gives any MCP client the interior design skills as prompts and resources, even before the app answers', async () => {
    const options = { url: 'http://127.0.0.1:1', actor: 'agent:any' };
    const init = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, options)) as any;
    expect(init.result.capabilities).toEqual({ tools: {}, prompts: {}, resources: {} });
    expect(init.result.instructions).toContain('build_apartment');
    const prompts = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'prompts/list' }, options)) as any;
    expect(prompts.result.prompts.map((p: { name: string }) => p.name)).toEqual(['design_flat_from_measurements', 'furnish_like_a_designer', 'review_layout']);
    const brief = 'Reception 6 x 4.5, bedroom 4 x 3.5, bath 2 x 2.5';
    const got = (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: 'design_flat_from_measurements', arguments: { brief } } }, options)) as any;
    const text = got.result.messages[0].content.text as string;
    expect(text).toContain(brief);
    expect(text).toContain('build_apartment');
    expect(text).toContain('Main walkways');
    const missing = (await handleMessage({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'design_flat_from_measurements', arguments: {} } }, options)) as any;
    expect(missing.error.message).toContain('brief');
    const resources = (await handleMessage({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, options)) as any;
    expect(resources.result.resources.map((r: { uri: string }) => r.uri)).toContain('atrium://skills/bedroom');
    const read = (await handleMessage({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'atrium://skills/living-room' } }, options)) as any;
    expect(read.result.contents[0].text).toContain('Screen distance');
    const nope = (await handleMessage({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'atrium://skills/nope' } }, options)) as any;
    expect(nope.error.code).toBe(-32002);
    // The guides also answer as a tool call, with the program closed.
    const guide = (await handleMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'design_guide', arguments: { topic: 'bedroom' } } }, options)) as any;
    expect(guide.result.isError).toBe(false);
    expect(guide.result.content[0].text).toContain('command position');
    const closed = (await handleMessage({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }, options)) as any;
    expect(closed.result.content[0].text).toContain('Open the Atrium program');
  });

  it('runs a local coding agent that designs through the tools', async () => {
    saveSettings(store, {
      agents: { fake: { label: 'Fake agent', command: [process.execPath, fakeAgent, '{url}', '{projectId}', '{actor}'], promptOnStdin: true } },
    });
    const project = store.createProject(demoHall(), 'human');
    const started = await json(`/api/projects/${project.id}/agent-runs`, { method: 'POST', body: JSON.stringify({ agent: 'fake', prompt: 'اعمل قاعة ١٢×٩ فيها ترابيزة وكرسيين' }) });
    expect(started.status).toBe(201);
    const run = await until(() => {
      const r = store.getRun(started.body.id);
      return r && r.status !== 'running' ? r : null;
    });
    expect(run.status).toBe('done');
    expect(run.log).toContain('got prompt with project id');
    const designed = store.getProject(project.id)!;
    expect(readRoom(designed.space)).toMatchObject({ width: m(12), depth: m(9) });
    expect(Object.keys(designed.items).sort()).toEqual(['chair-1', 'chair-2', 'table-180-1']);
    expect(store.history(project.id).slice(0, 2).map((h) => [h.actor, h.summary])).toEqual([
      ['agent:fake', 'ترابيزة وكرسيين'],
      ['agent:fake', 'قاعة ١٢×٩'],
    ]);
    const agents = (await json('/api/agents')).body as Array<{ id: string; available: boolean }>;
    expect(agents.find((a) => a.id === 'fake')?.available).toBe(true);
    expect(agents.find((a) => a.id === 'api')?.available).toBe(false);
  });

  it('stops a running agent', async () => {
    saveSettings(store, {
      agents: { slow: { label: 'Slow', command: [process.execPath, '-e', 'setTimeout(() => {}, 60000)'], promptOnStdin: false } },
    });
    const project = store.createProject(demoHall(), 'human');
    const started = await json(`/api/projects/${project.id}/agent-runs`, { method: 'POST', body: JSON.stringify({ agent: 'slow', prompt: 'x' }) });
    expect((await json(`/api/agent-runs/${started.body.id}/stop`, { method: 'POST' })).body.stopped).toBe(true);
    const run = await until(() => {
      const r = store.getRun(started.body.id);
      return r && r.status !== 'running' ? r : null;
    });
    expect(run.status).toBe('stopped');
  });

  it('explains a missing agent program', async () => {
    saveSettings(store, { agents: { ghost: { label: 'Ghost', command: ['definitely-not-installed-xyz'], promptOnStdin: true } } });
    const project = store.createProject(demoHall(), 'human');
    const started = await json(`/api/projects/${project.id}/agent-runs`, { method: 'POST', body: JSON.stringify({ agent: 'ghost', prompt: 'x' }) });
    const run = store.getRun(started.body.id)!;
    expect(run.status).toBe('failed');
    expect(run.log).toContain('is not installed');
  });
});

describe('API agent', () => {
  let fakeApi: Server;
  let fakeUrl: string;
  const requests: any[] = [];

  beforeAll(async () => {
    fakeApi = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const request = JSON.parse(body);
      requests.push({ url: req.url, headers: req.headers, body: request });
      const projectId = /Project to work on: (p-[0-9a-f]+)/.exec(JSON.stringify(request.messages[0]))?.[1];
      const first = request.messages.length === 1;
      const content = first
        ? [
            { type: 'text', text: 'هحط كرسيين.' },
            { type: 'tool_use', id: 'toolu_1', name: 'place_items', input: { project_id: projectId, items: [{ definition_id: 'chair', x_m: 8, y_m: 6 }, { definition_id: 'chair', x_m: 9, y_m: 6 }] } },
          ]
        : [{ type: 'text', text: 'خلصت: كرسيين.' }];
      res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_test' });
      res.end(
        JSON.stringify({
          id: `msg_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: request.model,
          content,
          stop_reason: first ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
    await new Promise<void>((r) => fakeApi.listen(0, '127.0.0.1', () => r()));
    const address = fakeApi.address();
    fakeUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(() => {
    fakeApi.close();
  });

  it('runs the tool loop against the Claude API and records changes under the model name', async () => {
    saveSettings(store, { api: { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-opus-5', baseUrl: fakeUrl } });
    const app = createApp({ store, dataDir: dir, mcpScript: 'unused' });
    try {
      const project = store.createProject(demoHall(), 'human');
      const run = app.runner.start(project.id, 'api', 'حط كرسيين');
      const finished = await until(() => {
        const r = store.getRun(run.id);
        return r && r.status !== 'running' ? r : null;
      });
      expect(finished.status).toBe('done');
      expect(finished.log).toContain('خلصت: كرسيين.');
      expect(Object.keys(store.getProject(project.id)!.items)).toEqual(['chair-1', 'chair-2']);
      expect(store.history(project.id)[0]?.actor).toBe('agent:api:claude-opus-5');
      const first = requests[0];
      expect(first.url).toBe('/v1/messages?beta=true');
      expect(first.body).toMatchObject({ model: 'claude-opus-5', thinking: { type: 'adaptive' }, fallbacks: 'default' });
      expect(first.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
      expect(first.body.tools.map((t: { name: string }) => t.name)).toContain('set_room');
      const second = requests[1];
      expect(second.body.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: false });
    } finally {
      await app.close();
    }
  });

  it('explains a missing API key instead of calling the service', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const app = createApp({ store, dataDir: dir, mcpScript: 'unused' });
    try {
      const project = store.createProject(demoHall(), 'human');
      const run = app.runner.start(project.id, 'api', 'x');
      const finished = await until(() => {
        const r = store.getRun(run.id);
        return r && r.status !== 'running' ? r : null;
      });
      expect(finished.status).toBe('failed');
      expect(finished.log).toContain('API key');
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
      await app.close();
    }
  });
});

describe('project data', () => {
  it('stores what the core produced, byte for byte', () => {
    const project: Project = store.createProject(demoHall(), 'human');
    expect(store.getProject(project.id)).toEqual(project);
  });
});

describe('protection against other websites', () => {
  let app: App;
  let port: number;

  beforeEach(async () => {
    app = createApp({ store, dataDir: dir, mcpScript: 'unused' });
    port = await app.listen(0);
  });

  afterEach(async () => {
    await app.close();
  });

  /** Raw request so the Host and Origin headers can be forged like a browser would send them. */
  async function raw(method: string, path: string, headers: Record<string, string>, body?: string): Promise<number> {
    const { request } = await import('node:http');
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  const evil = JSON.stringify({ agents: { x: { label: 'x', command: ['calc'], promptOnStdin: false } } });

  it('refuses requests from another website', async () => {
    expect(await raw('PUT', '/api/settings', { host: `127.0.0.1:${port}`, origin: 'https://evil.example', 'content-type': 'application/json' }, evil)).toBe(403);
  });

  it('refuses DNS-rebinding hosts', async () => {
    expect(await raw('GET', '/api/projects', { host: `evil.example:${port}` })).toBe(403);
  });

  it('refuses non-JSON changes that browsers could send without asking', async () => {
    expect(await raw('PUT', '/api/settings', { host: `127.0.0.1:${port}`, 'content-type': 'text/plain' }, evil)).toBe(415);
    expect(await raw('POST', '/api/projects', { host: `localhost:${port}` }, '{}')).toBe(415);
  });

  it('accepts the app itself', async () => {
    expect(await raw('PUT', '/api/settings', { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }, '{}')).toBe(200);
    expect(await raw('GET', '/api/projects', { host: `localhost:${port}` })).toBe(200);
  });
});
