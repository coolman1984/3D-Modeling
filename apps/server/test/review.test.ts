// Regression tests for the source-review findings in bugs.md (27 Sep 2026), one block per finding.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromUnit } from '@space-planner/core';
import { demoHall } from '@space-planner/starter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/http.js';
import { loadSettings, saveSettings } from '../src/settings.js';
import { Store } from '../src/store.js';
import { runTool } from '../src/tools.js';

const m = (v: number) => fromUnit(v, 'm');

let dir: string;
let store: Store;
let app: App;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'planner-review-'));
  store = new Store(join(dir, 'planner.db'));
  app = createApp({ store, dataDir: dir, mcpScript: join(dir, 'missing-mcp.mjs') });
  base = `http://127.0.0.1:${await app.listen(0)}`;
});

afterEach(async () => {
  app.runner.stopAll();
  await app.close();
  store.close();
  // Stopped agent processes can hold their run folder for a moment on Windows.
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const json = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json' } });
  return { status: response.status, body: (await response.json()) as any };
};
const post = (path: string, body: unknown) => json(path, { method: 'POST', body: JSON.stringify(body) });
const put = (path: string, body: unknown) => json(path, { method: 'PUT', body: JSON.stringify(body) });

async function until<T>(check: () => T | undefined | null | false, timeout = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('1 · built-in object names as ids', () => {
  it('refuses an item of a missing type named "constructor", and the project still opens', async () => {
    const project = store.createProject(demoHall(), 'human');
    for (const name of ['constructor', 'toString', '__proto__']) {
      const result = await post(`/api/projects/${project.id}/commands`, {
        baseRevision: 0,
        commands: [{ type: 'item.add', item: { id: `x-${name.replace(/_/g, '')}`, definitionId: name, position: { x: m(3), y: m(3) }, rotation: 0, locked: false } }],
      });
      expect(result.status, name).toBe(422);
      expect(result.body.rejection.code, name).toBe('broken-reference');
    }
    const reopened = await json(`/api/projects/${project.id}`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.revision).toBe(0);
  });

  it('moving an item named "toString" that does not exist is not found', async () => {
    const project = store.createProject(demoHall(), 'human');
    const result = await post(`/api/projects/${project.id}/commands`, { commands: [{ type: 'item.move', id: 'toString', to: { x: m(1), y: m(1) } }] });
    expect(result.status).toBe(422);
    expect(result.body.rejection.code).toBe('not-found');
    expect((await json(`/api/projects/${project.id}`)).status).toBe(200);
  });
});

describe('2 · restoring a revision never overwrites a newer change unseen', () => {
  it('refuses a restore made from an out-of-date view (409 with the latest project)', async () => {
    const project = store.createProject(demoHall(), 'human');
    // Window A sees revision 0; meanwhile an agent saves revision 1.
    store.applyCommands(project.id, [{ type: 'project.rename', name: 'Agent version' }], { actor: 'agent:x' });
    const stale = await post(`/api/projects/${project.id}/restore`, { revision: 0, baseRevision: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.project).toMatchObject({ revision: 1, name: 'Agent version' });
    expect(store.getProject(project.id)?.revision).toBe(1);
    // After seeing revision 1, the restore goes through as revision 2.
    const fresh = await post(`/api/projects/${project.id}/restore`, { revision: 0, baseRevision: 1 });
    expect(fresh.status).toBe(200);
    expect(fresh.body.project).toMatchObject({ revision: 2, name: demoHall().name });
  });

  it('requires the revision the caller last saw', async () => {
    const project = store.createProject(demoHall(), 'human');
    expect((await post(`/api/projects/${project.id}/restore`, { revision: 0 })).status).toBe(400);
    expect((await post(`/api/projects/${project.id}/restore`, { revision: 0, baseRevision: 'x' })).status).toBe(400);
    expect((await post(`/api/projects/${project.id}/restore`, { revision: 9, baseRevision: 0 })).status).toBe(404);
  });

  it('agents may pass the revision they last saw; without it they restore onto the latest', () => {
    const project = store.createProject(demoHall(), 'human');
    store.applyCommands(project.id, [{ type: 'project.rename', name: 'Newer' }], { actor: 'human' });
    const stale = runTool({ store, actor: 'agent:x' }, 'restore_revision', { project_id: project.id, revision: 0, base_revision: 0 });
    expect(stale.isError).toBe(true);
    expect(store.getProject(project.id)?.revision).toBe(1);
    const plain = runTool({ store, actor: 'agent:x' }, 'restore_revision', { project_id: project.id, revision: 0 });
    expect(plain.isError).toBeFalsy();
    expect(store.getProject(project.id)?.revision).toBe(2);
  });
});

describe('4 · malformed settings', () => {
  it('refuses settings with a broken agent or a bad timeout, and saves nothing', async () => {
    const before = loadSettings(store);
    for (const body of [
      { agents: { broken: {} } },
      { agents: { broken: { label: 'B', command: 'claude', promptOnStdin: true } } },
      { agents: { broken: { label: 'B', command: [], promptOnStdin: true } } },
      { agents: { broken: { label: 'B', command: ['x', 3], promptOnStdin: true } } },
      { agents: { broken: { label: 7, command: ['x'], promptOnStdin: true } } },
      { agents: { broken: { label: 'B', command: ['x'], promptOnStdin: 'yes' } } },
      { agents: [] },
      { timeoutMinutes: 'abc' },
      { timeoutMinutes: null },
      { api: { provider: 'other' } },
      { api: { model: 5 } },
    ]) {
      const result = await put('/api/settings', body);
      expect(result.status, JSON.stringify(body)).toBe(400);
    }
    expect(loadSettings(store)).toEqual(before);
    expect((await json('/api/agents')).status).toBe(200);
  });

  it('a broken agent already in the database is skipped, and starting it fails cleanly', async () => {
    // Written straight into the store, as an older version could have saved it.
    store.setSetting('settings', { agents: { broken: {} }, timeoutMinutes: 30 });
    const agents = await json('/api/agents');
    expect(agents.status).toBe(200);
    expect((agents.body as Array<{ id: string }>).some((a) => a.id === 'broken')).toBe(false);
    const project = store.createProject(demoHall(), 'human');
    const started = await post(`/api/projects/${project.id}/agent-runs`, { agent: 'broken', prompt: 'x' });
    expect(started.status).toBe(201);
    const run = store.getRun(started.body.id)!;
    expect(run.status).toBe('failed');
    expect(run.log).toContain('not set up');
  });

  it('any startup error still finishes the run', () => {
    saveSettings(store, { agents: { odd: { label: 'Odd', command: ['definitely-not-installed-xyz'], promptOnStdin: true } } });
    const project = store.createProject(demoHall(), 'human');
    // A data folder that cannot be created makes the start throw after the run is recorded.
    const broken = createApp({ store, dataDir: join(dir, 'planner.db', 'not-a-folder'), mcpScript: join(dir, 'x.mjs') });
    const run = broken.runner.start(project.id, 'odd', 'x');
    expect(store.getRun(run.id)?.status).toBe('failed');
    expect(broken.runner.isRunning(run.id)).toBe(false);
  });
});

describe('5 · deleting a project stops all of its agents', () => {
  it('stops every active run, not only the newest 20', async () => {
    // API-agent runs live inside the server, so 23 of them cost no processes. They stay active
    // because this stand-in service accepts the request and never answers.
    const hanging = createServer(() => undefined);
    await new Promise<void>((r) => hanging.listen(0, '127.0.0.1', r));
    const port = (hanging.address() as AddressInfo).port;
    try {
      saveSettings(store, { api: { provider: 'openai-compatible', apiKey: '', model: 'stand-in', baseUrl: `http://127.0.0.1:${port}/v1` } });
      const project = store.createProject(demoHall(), 'human');
      const other = store.createProject(demoHall(), 'human');
      const ids: string[] = [];
      for (let i = 0; i < 22; i++) ids.push(app.runner.start(project.id, 'api', `run ${i}`).id);
      const keep = app.runner.start(other.id, 'api', 'other project').id;
      expect(ids.every((id) => app.runner.isRunning(id))).toBe(true);
      expect(store.listRuns(project.id).length).toBe(20); // what the old code looked at
      expect((await json(`/api/projects/${project.id}`, { method: 'DELETE' })).status).toBe(200);
      await until(() => ids.every((id) => !app.runner.isRunning(id)));
      // Another project's agent keeps running.
      expect(app.runner.isRunning(keep)).toBe(true);
      app.runner.stop(keep);
      await until(() => !app.runner.isRunning(keep));
    } finally {
      hanging.closeAllConnections();
      hanging.close();
    }
  });
});

describe('6 · history limit', () => {
  it('clamps the limit to 1..500 and refuses one that is not a whole number', async () => {
    const project = store.createProject(demoHall(), 'human');
    for (let i = 0; i < 3; i++) store.applyCommands(project.id, [{ type: 'project.rename', name: `v${i}` }], { actor: 'human' });
    const at = (limit: string) => json(`/api/projects/${project.id}/history?limit=${limit}`);
    expect((await at('-1')).status).toBe(400);
    expect((await at('0')).status).toBe(400);
    expect((await at('abc')).status).toBe(400);
    expect((await at('1.5')).status).toBe(400);
    expect((await at('2')).body).toHaveLength(2);
    expect((await at('100000')).body).toHaveLength(4);
    expect((await json(`/api/projects/${project.id}/history`)).body).toHaveLength(4);
    // The store keeps the same bound for callers outside HTTP.
    expect(store.history(project.id, -1)).toHaveLength(1);
    expect(store.history(project.id, 10_000)).toHaveLength(4);
  });
});
