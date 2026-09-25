import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromUnit, readRoom, type Project } from '@space-planner/core';
import { demoHall } from '@space-planner/starter';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readableAgentLine } from '../src/agents.js';
import { createApp, type App } from '../src/http.js';
import { handleMessage } from '../src/mcp.js';
import { saveSettings } from '../src/settings.js';
import { Store } from '../src/store.js';
import { runTool } from '../src/tools.js';

const m = (v: number) => fromUnit(v, 'm');
const fakeAgent = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url));

let dir: string;
let store: Store;

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
      [1, 'agent:claude-code', 'إضافة'],
      [0, 'human', 'إنشاء المشروع'],
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

  it('duplicates and deletes projects', () => {
    const project = store.createProject(demoHall(), 'human');
    const copy = store.duplicateProject(project.id, 'human');
    expect(copy?.id).not.toBe(project.id);
    expect(copy?.name).toContain('نسخة');
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
    expect(store.history(project.id)[0]?.summary).toBe('تحريك عناصر');
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
    expect(readableAgentLine('{"type":"result","subtype":"success"}')).toBe('✔ خلص');
    expect(readableAgentLine('plain text from codex')).toBe('plain text from codex');
  });
});

describe('HTTP app', () => {
  let app: App;
  let base: string;

  beforeEach(async () => {
    app = createApp({ store, dataDir: dir, mcpScript: join(dir, 'missing-mcp.mjs') });
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
    const restored = await json(`/api/projects/${id}/restore`, { method: 'POST', body: JSON.stringify({ revision: 0 }) });
    expect(restored.body.project).toMatchObject({ revision: 2, items: {} });
    expect((await json('/api/projects/nope')).status).toBe(404);
    expect((await json('/api/projects', { method: 'POST', body: JSON.stringify({ width_m: -1, depth_m: 3 }) })).status).toBe(400);
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
    expect(run.log).toContain('مش لاقي');
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
      expect(finished.log).toContain('مفتاح');
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
