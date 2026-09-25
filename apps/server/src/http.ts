import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { deserializeProject, fromUnit, type Command } from '@space-planner/core';
import { demoHall, newContainer, newDepot, newRestaurant, newFactory, newRoom, newWarehouse, packOf } from '@space-planner/starter';
import { AgentRunner } from './agents.js';
import { loadSettings, publicSettings, saveSettings, type Settings } from './settings.js';
import type { Store } from './store.js';
import { runTool, toolSummaries } from './tools.js';
import { compareFamily } from './variants.js';

export interface AppOptions {
  readonly store: Store;
  readonly dataDir: string;
  /** Built editor to serve; when missing only the API is served. */
  readonly staticDir?: string;
  readonly mcpScript: string;
}

export interface App {
  readonly server: Server;
  readonly runner: AgentRunner;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 20_000_000) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'body must be a JSON object');
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function positiveNumber(value: unknown, name: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    throw new HttpError(400, `${name} must be a number between 0 and ${max}`);
  }
  return value;
}

/**
 * The local app server: JSON API, live events, and the built editor.
 * It listens on the loopback address only; nothing is exposed to the network.
 */
export function createApp(options: AppOptions): App {
  const { store } = options;
  let port = 0;
  const runner = new AgentRunner({
    store,
    dataDir: options.dataDir,
    mcpScript: options.mcpScript,
    url: () => `http://127.0.0.1:${port}`,
  });
  const clients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  };
  store.on('project', (e) => broadcast('project', e));
  store.on('projects', () => broadcast('projects', {}));
  store.on('run', (e) => broadcast('run', e));
  const heartbeat = setInterval(() => broadcast('ping', {}), 25_000);
  heartbeat.unref();

  type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], url: URL) => Promise<void> | void;
  const routes: Array<[string, RegExp, Handler]> = [];
  const route = (method: string, pattern: string, handler: Handler) =>
    routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), handler]);

  const projectOr404 = (id: string) => {
    const project = store.getProject(id);
    if (!project) throw new HttpError(404, 'project not found');
    return project;
  };

  route('GET', '/api/health', (_q, res) => send(res, 200, { ok: true, name: 'space-planner' }));

  route('GET', '/api/projects', (_q, res) => send(res, 200, store.listProjects()));

  route('POST', '/api/projects', async (req, res) => {
    const body = await readJson(req);
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'New project';
    let project;
    if (body.template === 'demo') project = { ...demoHall(), name };
    else if (typeof body.file === 'string') {
      const opened = deserializeProject(body.file);
      if (!opened.ok) throw new HttpError(422, `This file is not a valid plan: ${opened.problems[0]?.path ?? ''}`);
      project = opened.project;
    } else {
      const ceiling = body.ceiling_m === undefined || body.ceiling_m === null ? undefined : positiveNumber(body.ceiling_m, 'ceiling_m', 50);
      const activity = packOf(typeof body.activity === 'string' ? body.activity : null).id;
      if (activity === 'container') {
        const type = typeof body.container_type === 'string' ? body.container_type : '20gp';
        send(res, 201, store.createProject(newContainer(name, type), 'human'));
        return;
      }
      if (activity === 'restaurant') {
        const width = body.width_m === undefined ? 20 : positiveNumber(body.width_m, 'width_m', 500);
        const depth = body.depth_m === undefined ? 14 : positiveNumber(body.depth_m, 'depth_m', 500);
        if (width < 6 || depth < 6) throw new HttpError(400, 'A restaurant needs sides of at least 6 m');
        send(res, 201, store.createProject(newRestaurant(name, { width: fromUnit(width, 'm'), depth: fromUnit(depth, 'm'), height: fromUnit(ceiling ?? 3.2, 'm') }), 'human'));
        return;
      }
      if (activity === 'depot') {
        const width = body.width_m === undefined ? 40 : positiveNumber(body.width_m, 'width_m', 500);
        const depth = body.depth_m === undefined ? 30 : positiveNumber(body.depth_m, 'depth_m', 500);
        if (width < 10 || depth < 10) throw new HttpError(400, 'A depot needs sides of at least 10 m');
        send(res, 201, store.createProject(newDepot(name, { width: fromUnit(width, 'm'), depth: fromUnit(depth, 'm'), ...(ceiling === undefined ? {} : { height: fromUnit(ceiling, 'm') }) }), 'human'));
        return;
      }
      if (activity === 'factory') {
        const width = body.width_m === undefined ? 40 : positiveNumber(body.width_m, 'width_m', 500);
        const depth = body.depth_m === undefined ? 20 : positiveNumber(body.depth_m, 'depth_m', 500);
        send(res, 201, store.createProject(newFactory(name, { width: fromUnit(width, 'm'), depth: fromUnit(depth, 'm'), height: fromUnit(ceiling ?? 6, 'm') }), 'human'));
        return;
      }
      if (activity === 'warehouse') {
        const width = body.width_m === undefined ? 48 : positiveNumber(body.width_m, 'width_m', 500);
        const depth = body.depth_m === undefined ? 30 : positiveNumber(body.depth_m, 'depth_m', 500);
        if (width < 10 || depth < 10) throw new HttpError(400, 'A warehouse needs sides of at least 10 m');
        send(res, 201, store.createProject(newWarehouse(name, { width: fromUnit(width, 'm'), depth: fromUnit(depth, 'm'), height: fromUnit(ceiling ?? 10, 'm') }), 'human'));
        return;
      }
      project = newRoom(name, positiveNumber(body.width_m, 'width_m', 500), positiveNumber(body.depth_m, 'depth_m', 500), ceiling, activity);
    }
    send(res, 201, store.createProject(project, 'human'));
  });

  route('GET', '/api/projects/:id', (_q, res, [id]) => send(res, 200, projectOr404(id!)));

  route('DELETE', '/api/projects/:id', (_q, res, [id]) => {
    runnerStopForProject(id!);
    send(res, store.deleteProject(id!) ? 200 : 404, { ok: true });
  });

  route('POST', '/api/projects/:id/duplicate', (_q, res, [id]) => {
    const copy = store.duplicateProject(id!, 'human');
    if (!copy) throw new HttpError(404, 'project not found');
    send(res, 201, copy);
  });

  route('POST', '/api/projects/:id/variants', async (req, res, [id]) => {
    const body = await readJson(req);
    const source = store.getProject(id!);
    if (!source) throw new HttpError(404, 'project not found');
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : `${source.name} · variant`;
    send(res, 201, store.createVariant(id!, name, 'human'));
  });

  route('GET', '/api/projects/:id/variants', (_q, res, [id]) => {
    if (!store.summary(id!)) throw new HttpError(404, 'project not found');
    send(res, 200, compareFamily(store, id!));
  });

  route('POST', '/api/projects/:id/adopt', (_q, res, [id]) => {
    const result = store.adoptVariant(id!, 'human');
    if (!result.ok && result.status === 404) throw new HttpError(404, 'project not found');
    if (!result.ok && result.status === 400) throw new HttpError(400, 'this project is not a variant');
    if (!result.ok && result.status === 422) throw new HttpError(422, `the base cannot take this variant: ${result.rejection.message}`);
    if (!result.ok) throw new HttpError(409, 'the base changed; try again');
    send(res, 200, result.project);
  });

  route('POST', '/api/projects/:id/commands', async (req, res, [id]) => {
    const body = await readJson(req);
    if (!Array.isArray(body.commands) || body.commands.length === 0) throw new HttpError(400, 'commands must be a non-empty array');
    const actor = typeof body.actor === 'string' && body.actor ? body.actor.slice(0, 80) : 'human';
    const result = store.applyCommands(id!, body.commands as Command[], {
      actor,
      ...(typeof body.summary === 'string' ? { summary: body.summary } : {}),
      ...(typeof body.baseRevision === 'number' ? { baseRevision: body.baseRevision } : {}),
    });
    if (result.ok) send(res, 200, { ok: true, project: result.project });
    else if (result.status === 404) send(res, 404, { ok: false, error: 'project not found' });
    else if (result.status === 409) send(res, 409, { ok: false, conflict: true, project: result.project });
    else send(res, 422, { ok: false, rejection: result.rejection });
  });

  route('GET', '/api/projects/:id/history', (_q, res, [id], url) => {
    projectOr404(id!);
    send(res, 200, store.history(id!, Math.min(500, Number(url.searchParams.get('limit') ?? 100) || 100)));
  });

  route('GET', '/api/projects/:id/revisions/:rev', (_q, res, [id, rev]) => {
    const project = store.getRevision(id!, Number(rev));
    if (!project) throw new HttpError(404, 'revision not found');
    send(res, 200, project);
  });

  route('POST', '/api/projects/:id/restore', async (req, res, [id]) => {
    const body = await readJson(req);
    const result = store.restore(id!, Number(body.revision), 'human');
    if (!result.ok) throw new HttpError(404, 'revision not found');
    send(res, 200, { ok: true, project: result.project });
  });

  route('GET', '/api/tools', (_q, res) => send(res, 200, toolSummaries()));

  route('POST', '/api/tools/:name', async (req, res, [name]) => {
    const body = await readJson(req);
    const actor = typeof body.actor === 'string' && body.actor ? body.actor.slice(0, 80) : 'agent:mcp';
    send(res, 200, runTool({ store, actor }, decodeURIComponent(name!), body.input ?? {}));
  });

  route('GET', '/api/settings', (_q, res) => send(res, 200, publicSettings(loadSettings(store))));

  route('PUT', '/api/settings', async (req, res) => {
    const body = (await readJson(req)) as Partial<Settings>;
    send(res, 200, publicSettings(saveSettings(store, body)));
  });

  route('GET', '/api/agents', (_q, res) => send(res, 200, runner.availability()));

  route('GET', '/api/projects/:id/agent-runs', (_q, res, [id]) => send(res, 200, store.listRuns(id!)));

  route('POST', '/api/projects/:id/agent-runs', async (req, res, [id]) => {
    projectOr404(id!);
    const body = await readJson(req);
    if (typeof body.agent !== 'string' || typeof body.prompt !== 'string' || !body.prompt.trim()) {
      throw new HttpError(400, 'agent and prompt are required');
    }
    send(res, 201, runner.start(id!, body.agent, body.prompt));
  });

  route('GET', '/api/agent-runs/:runId', (_q, res, [runId]) => {
    const run = store.getRun(runId!);
    if (!run) throw new HttpError(404, 'run not found');
    send(res, 200, run);
  });

  route('POST', '/api/agent-runs/:runId/stop', (_q, res, [runId]) => send(res, 200, { stopped: runner.stop(runId!) }));

  route('GET', '/api/events', (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  function runnerStopForProject(projectId: string) {
    for (const run of store.listRuns(projectId)) if (run.status === 'running') runner.stop(run.id);
  }

  /**
   * The API can start programs on this computer (agents), so only this app may call it:
   * - the Host header must be the loopback address (blocks DNS-rebinding sites);
   * - a browser Origin, when sent, must be this server (blocks other websites);
   * - changes must be JSON, which browsers cannot send cross-site without a preflight
   *   this server never approves.
   */
  function guard(req: IncomingMessage, method: string): void {
    const host = (req.headers.host ?? '').toLowerCase();
    const hostName = host.replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostName)) throw new HttpError(403, 'forbidden host');
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) throw new HttpError(403, 'forbidden origin');
    if (method !== 'GET' && method !== 'HEAD') {
      const type = (req.headers['content-type'] ?? '').toLowerCase();
      if (!type.startsWith('application/json')) throw new HttpError(415, 'send JSON');
    }
  }

  function serveStatic(url: URL, res: ServerResponse): boolean {
    const root = options.staticDir;
    if (!root || !existsSync(root)) return false;
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!path.startsWith(normalize(root + sep)) && path !== normalize(root)) return false;
    if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
    if (!existsSync(path)) return false;
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'cache-control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(path).pipe(res);
    return true;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    void (async () => {
      try {
        if (url.pathname.startsWith('/api/')) {
          guard(req, method);
          for (const [m, pattern, handler] of routes) {
            const match = pattern.exec(url.pathname);
            if (match && m === method) {
              await handler(req, res, match.slice(1), url);
              return;
            }
          }
          throw new HttpError(404, 'not found');
        }
        if (method === 'GET' && serveStatic(url, res)) return;
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('The editor is not built yet. Run the launcher (start) or `pnpm build`.');
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) send(res, status, { ok: false, error: message });
        else res.end();
      }
    })();
  });

  return {
    server,
    runner,
    listen: (wanted, host = '127.0.0.1') =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(wanted, host, () => {
          const address = server.address();
          port = typeof address === 'object' && address ? address.port : wanted;
          resolve(port);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        runner.stopAll();
        clearInterval(heartbeat);
        for (const res of clients) res.end();
        clients.clear();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
