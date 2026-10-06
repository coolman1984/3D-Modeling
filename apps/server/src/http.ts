import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { TLSSocket } from 'node:tls';
import { deserializeProject, type Command, type Project } from '@space-planner/core';
import { demoHall, newContainer, newProductionLine, newRestaurant, newRoom, newVehicleDepot, newWarehouse, packOf, referenceProductionLine, referenceRestaurant, referenceVehicleDepot, referenceWarehouse } from '@space-planner/starter';
import { AccountError, labelOf, type Company, type KeyPrincipal, type SessionPrincipal, type User } from './accounts.js';
import { AgentRunner } from './agents.js';
import { can, itemsOnly, permissionsOf, type Permission, type Role } from './permissions.js';
import { loadSettings, publicSettings, saveSettings, type Settings } from './settings.js';
import type { Store } from './store.js';
import { runTool, toolSummaries } from './tools.js';

export interface AppOptions {
  readonly store: Store;
  readonly dataDir: string;
  /** Built editor to serve; when missing only the API is served. */
  readonly staticDir?: string;
  readonly mcpScript: string;
  /**
   * Host names (besides the loopback ones) this server answers to, for a company server on the
   * office network behind its own name and certificate. Empty: this computer only.
   */
  readonly allowedHosts?: readonly string[];
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
  '.woff2': 'font/woff2',
};

export const SESSION_COOKIE = 'planner_session';
const SESSION_MAX_AGE_S = 12 * 60 * 60;
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

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

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(text);
}

function positiveNumber(value: unknown, name: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    throw new HttpError(400, `${name} must be a number between 0 and ${max}`);
  }
  return value;
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

const secureRequest = (req: IncomingMessage) => req.socket instanceof TLSSocket || req.headers['x-forwarded-proto'] === 'https';

function sessionCookie(req: IncomingMessage, token: string | null): string {
  const secure = secureRequest(req) ? '; Secure' : '';
  return token === null
    ? `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
    : `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_S}${secure}`;
}

/** Who is calling and in which company, resolved by the server on every request. */
interface Context {
  readonly principal: SessionPrincipal | KeyPrincipal;
  readonly company: Company;
  readonly role: Role;
  /** The name the history and the audit log record. */
  readonly actor: string;
  /** Set for people; agents with a key have none. */
  readonly user: User | null;
}

/**
 * The app server: JSON API, live events, and the built editor. By default it listens on the
 * loopback address only; a company server adds its own host names.
 */
export function createApp(options: AppOptions): App {
  const { store } = options;
  const accounts = store.accounts;
  const allowedHosts = new Set([...LOOPBACK_HOSTS, ...(options.allowedHosts ?? []).map((h) => h.toLowerCase())]);
  let port = 0;
  const runner = new AgentRunner({
    store,
    dataDir: options.dataDir,
    mcpScript: options.mcpScript,
    url: () => `http://127.0.0.1:${port}`,
  });

  // Live events go only to the sessions and keys of the company that owns the project.
  const clients = new Map<ServerResponse, string>();
  const broadcast = (event: string, data: unknown, companyId: string | null | undefined) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [res, company] of clients) if (companyId === undefined || company === companyId) res.write(payload);
  };
  store.on('project', (e) => broadcast('project', { projectId: e.projectId, revision: e.revision, actor: e.actor, summary: e.summary }, e.companyId));
  store.on('projects', (e) => broadcast('projects', {}, e.companyId));
  store.on('run', (e) => broadcast('run', e, store.projectCompany(e.projectId) ?? null));
  const heartbeat = setInterval(() => broadcast('ping', {}, undefined), 25_000);
  heartbeat.unref();

  type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], url: URL) => Promise<void> | void;
  const routes: Array<[string, RegExp, Handler]> = [];
  const route = (method: string, pattern: string, handler: Handler) =>
    routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), handler]);

  // ---------- who is calling ----------

  function principalOf(req: IncomingMessage): SessionPrincipal | KeyPrincipal | null {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return accounts.resolveKey(header.slice(7).trim());
    return accounts.resolveSession(cookie(req, SESSION_COOKIE));
  }

  /** Deny by default: no principal is 401, no company or a missing permission is 403. */
  function contextOf(req: IncomingMessage, permission?: Permission): Context {
    const principal = principalOf(req);
    if (!principal) throw new HttpError(401, 'Sign in first.');
    const { company, role } = principal;
    if (!company || !role) throw new HttpError(403, 'You are not a member of any company yet.');
    if (permission && !can(role, permission)) throw new HttpError(403, `Your role (${role}) cannot do this.`);
    return {
      principal,
      company,
      role,
      actor: principal.kind === 'key' ? `agent:${principal.name}` : labelOf(principal.user),
      user: principal.kind === 'user' ? principal.user : null,
    };
  }

  const personOnly = (ctx: Context): User => {
    if (!ctx.user) throw new HttpError(403, 'This needs a person signed in, not an agent key.');
    return ctx.user;
  };

  /** The company's project, or 404 exactly as if it did not exist (no hint that another company has it). */
  const projectIn = (ctx: Context, id: string): Project => {
    const project = store.getProjectIn(id, ctx.company.id);
    if (!project) throw new HttpError(404, 'project not found');
    return project;
  };

  const sessionView = (principal: SessionPrincipal) => ({
    user: principal.user,
    company: principal.company,
    role: principal.role,
    permissions: principal.role ? permissionsOf(principal.role) : [],
    companies: accounts.memberships(principal.user.id).map((m) => ({ id: m.company.id, name: m.company.name, role: m.role })),
  });

  // ---------- public: health, setup, sign-in, invitations, shared links ----------

  route('GET', '/api/health', (_q, res) => send(res, 200, { ok: true, name: 'space-planner' }));

  route('GET', '/api/session', (req, res) => {
    const principal = principalOf(req);
    if (!principal) return send(res, 401, { ok: false, error: 'Sign in first.', setupNeeded: accounts.userCount() === 0 });
    if (principal.kind === 'key') return send(res, 200, { agent: principal.name, company: principal.company, role: principal.role, permissions: permissionsOf(principal.role), companies: [] });
    send(res, 200, sessionView(principal));
  });

  route('POST', '/api/setup', async (req, res) => {
    // Only from this computer: on a network server, whoever reaches it first must not claim it.
    if (!LOOPBACK_ADDRESSES.includes(req.socket.remoteAddress ?? '')) throw new HttpError(403, 'Set up the server from the computer it runs on.');
    const body = await readJson(req);
    const { user, company } = await accounts.setup({ companyName: body.companyName, name: body.name, email: body.email, password: body.password });
    const adopted = store.adoptOrphans(company.id);
    if (adopted > 0) accounts.audit(company.id, labelOf(user), 'projects.adopted', company.id, { count: adopted });
    const token = accounts.startSession(user, company.id);
    accounts.recordSignIn(user, 'user.signed_in');
    send(res, 201, sessionView(accounts.resolveSession(token)!), { 'set-cookie': sessionCookie(req, token) });
  });

  route('POST', '/api/login', async (req, res) => {
    const body = await readJson(req);
    const user = await accounts.signIn(body.email, body.password);
    if (!user) throw new HttpError(401, 'The email or password is not right, or the account is locked for a few minutes after too many tries.');
    accounts.endSession(cookie(req, SESSION_COOKIE));
    const token = accounts.startSession(user, typeof body.companyId === 'string' ? body.companyId : undefined);
    accounts.recordSignIn(user, 'user.signed_in');
    send(res, 200, sessionView(accounts.resolveSession(token)!), { 'set-cookie': sessionCookie(req, token) });
  });

  route('POST', '/api/logout', (req, res) => {
    const token = cookie(req, SESSION_COOKIE);
    const principal = accounts.resolveSession(token);
    if (principal) accounts.recordSignIn(principal.user, 'user.signed_out');
    accounts.endSession(token);
    send(res, 200, { ok: true }, { 'set-cookie': sessionCookie(req, null) });
  });

  route('GET', '/api/invitations/:token', (_q, res, [token]) => {
    const info = accounts.lookupInvitation(decodeURIComponent(token!));
    if (!info) throw new HttpError(404, 'This invitation link is not valid any more. Ask for a new one.');
    send(res, 200, { company: { name: info.company.name }, email: info.email, role: info.role, invitedBy: info.invitedBy, expiresAt: info.expiresAt, accountExists: info.accountExists });
  });

  route('POST', '/api/invitations/:token/accept', async (req, res, [token]) => {
    const body = await readJson(req);
    const signedIn = accounts.resolveSession(cookie(req, SESSION_COOKIE))?.user ?? null;
    const { user, company } = await accounts.acceptInvitation(decodeURIComponent(token!), { signedIn, name: body.name, password: body.password });
    const session = accounts.startSession(user, company.id);
    if (!signedIn) accounts.recordSignIn(user, 'user.signed_in');
    else accounts.endSession(cookie(req, SESSION_COOKIE));
    send(res, 200, sessionView(accounts.resolveSession(session)!), { 'set-cookie': sessionCookie(req, session) });
  });

  route('GET', '/api/shared/:token', (_q, res, [token]) => {
    const share = accounts.openShare(decodeURIComponent(token!));
    const project = share ? store.getRevision(share.projectId, share.revision) : null;
    if (!share || !project) throw new HttpError(404, 'This link is not valid any more. Ask for a new one.');
    send(res, 200, { project, company: { name: share.company.name }, revision: share.revision, expiresAt: share.expiresAt });
  });

  // ---------- account and company ----------

  route('POST', '/api/account/password', async (req, res) => {
    const principal = principalOf(req);
    if (principal?.kind !== 'user') throw new HttpError(401, 'Sign in first.');
    const body = await readJson(req);
    await accounts.changePassword(principal.user.id, body.current, body.next);
    // Every session ended with the change; this one starts again with a fresh token.
    const token = accounts.startSession(principal.user, principal.company?.id);
    send(res, 200, sessionView(accounts.resolveSession(token)!), { 'set-cookie': sessionCookie(req, token) });
  });

  route('POST', '/api/session/company', async (req, res) => {
    const token = cookie(req, SESSION_COOKIE);
    const principal = accounts.resolveSession(token);
    if (!principal || !token) throw new HttpError(401, 'Sign in first.');
    const body = await readJson(req);
    accounts.switchCompany(token, String(body.companyId ?? ''));
    send(res, 200, sessionView(accounts.resolveSession(token)!));
  });

  route('POST', '/api/companies', async (req, res) => {
    const token = cookie(req, SESSION_COOKIE);
    const principal = accounts.resolveSession(token);
    if (!principal || !token) throw new HttpError(401, 'Sign in first.');
    const body = await readJson(req);
    const company = accounts.createCompany(body.name, principal.user);
    accounts.switchCompany(token, company.id);
    send(res, 201, sessionView(accounts.resolveSession(token)!));
  });

  route('GET', '/api/company', (req, res) => {
    const ctx = contextOf(req, 'project.read');
    send(res, 200, { company: ctx.company, role: ctx.role, members: accounts.members(ctx.company.id).length, projects: store.listProjects(ctx.company.id).length });
  });

  route('PATCH', '/api/company', async (req, res) => {
    const ctx = contextOf(req, 'company.manage');
    const body = await readJson(req);
    send(res, 200, accounts.renameCompany(ctx.company.id, body.name, ctx.actor));
  });

  route('GET', '/api/company/members', (req, res) => {
    const ctx = contextOf(req, 'project.read');
    send(res, 200, accounts.members(ctx.company.id));
  });

  route('PATCH', '/api/company/members/:userId', async (req, res, [userId]) => {
    const ctx = contextOf(req, 'members.manage');
    personOnly(ctx);
    const body = await readJson(req);
    accounts.changeRole(ctx.company.id, ctx.role, userId!, body.role, ctx.actor);
    send(res, 200, accounts.members(ctx.company.id));
  });

  route('DELETE', '/api/company/members/:userId', (req, res, [userId]) => {
    const ctx = contextOf(req, 'members.manage');
    personOnly(ctx);
    accounts.removeMember(ctx.company.id, ctx.role, userId!, ctx.actor);
    send(res, 200, accounts.members(ctx.company.id));
  });

  route('GET', '/api/company/invitations', (req, res) => {
    const ctx = contextOf(req, 'members.manage');
    send(res, 200, accounts.invitations(ctx.company.id));
  });

  route('POST', '/api/company/invitations', async (req, res) => {
    const ctx = contextOf(req, 'members.manage');
    personOnly(ctx);
    const body = await readJson(req);
    const { invitation, token } = accounts.invite(ctx.company.id, ctx.role, { email: body.email, role: body.role }, ctx.actor);
    // The only time the link exists in clear: there is no mail server, so the person copies it.
    send(res, 201, { invitation, token, link: `#/invite/${token}` });
  });

  route('DELETE', '/api/company/invitations/:id', (req, res, [id]) => {
    const ctx = contextOf(req, 'members.manage');
    accounts.revokeInvitation(ctx.company.id, id!, ctx.actor);
    send(res, 200, accounts.invitations(ctx.company.id));
  });

  route('GET', '/api/company/api-keys', (req, res) => {
    const ctx = contextOf(req, 'keys.manage');
    send(res, 200, accounts.keys(ctx.company.id));
  });

  route('POST', '/api/company/api-keys', async (req, res) => {
    const ctx = contextOf(req, 'keys.manage');
    personOnly(ctx);
    const body = await readJson(req);
    const { key, token } = accounts.createKey(ctx.company.id, { name: body.name, role: body.role ?? 'designer', days: body.days }, ctx.actor);
    send(res, 201, { key, token });
  });

  route('DELETE', '/api/company/api-keys/:id', (req, res, [id]) => {
    const ctx = contextOf(req, 'keys.manage');
    accounts.revokeKey(ctx.company.id, id!, ctx.actor);
    send(res, 200, accounts.keys(ctx.company.id));
  });

  route('GET', '/api/company/audit', (req, res, _p, url) => {
    const ctx = contextOf(req, 'audit.read');
    send(res, 200, { events: accounts.auditLog(ctx.company.id, Number(url.searchParams.get('limit') ?? 200) || 200), chain: accounts.verifyAudit(ctx.company.id) });
  });

  // ---------- projects ----------

  route('GET', '/api/projects', (req, res) => {
    const ctx = contextOf(req, 'project.read');
    const approvals = accounts.latestApprovals(ctx.company.id);
    send(
      res,
      200,
      store.listProjects(ctx.company.id).map((p) => {
        const approval = approvals.get(p.id);
        return { ...p, approvedRevision: approval?.revision ?? null, approvedBy: approval?.approvedBy ?? null };
      }),
    );
  });

  route('POST', '/api/projects', async (req, res) => {
    const ctx = contextOf(req, 'project.create');
    const body = await readJson(req);
    const create = (project: Project) => send(res, 201, store.createProject(project, ctx.actor, undefined, ctx.company.id));
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : 'New project';
    if (body.template === 'demo') return create({ ...demoHall(), name });
    if (body.template === 'warehouse-reference') return create(referenceWarehouse(name));
    if (body.template === 'production-reference') return create(referenceProductionLine(name));
    if (body.template === 'depot-reference') return create(referenceVehicleDepot(name));
    if (body.template === 'restaurant-reference') return create(referenceRestaurant(name));
    if (typeof body.file === 'string') {
      const opened = deserializeProject(body.file);
      if (!opened.ok) throw new HttpError(422, `This file is not a valid plan: ${opened.problems[0]?.path ?? ''}`);
      return create(opened.project);
    }
    const ceiling = body.ceiling_m === undefined || body.ceiling_m === null ? undefined : positiveNumber(body.ceiling_m, 'ceiling_m', 50);
    const activity = packOf(typeof body.activity === 'string' ? body.activity : null).id;
    if (activity === 'container') return create(newContainer(name, typeof body.container_type === 'string' ? body.container_type : '20gp'));
    const width = positiveNumber(body.width_m, 'width_m', 500);
    const depth = positiveNumber(body.depth_m, 'depth_m', 500);
    if (activity === 'warehouse') return create(newWarehouse(name, width, depth, ceiling ?? 8));
    if (activity === 'production') return create(newProductionLine(name, width, depth, ceiling ?? 4));
    if (activity === 'depot') return create(newVehicleDepot(name, width, depth, ceiling ?? 4));
    if (activity === 'restaurant') return create(newRestaurant(name, width, depth, ceiling ?? 3.2));
    create(newRoom(name, width, depth, ceiling, activity));
  });

  route('GET', '/api/projects/:id', (req, res, [id]) => send(res, 200, projectIn(contextOf(req, 'project.read'), id!)));

  route('DELETE', '/api/projects/:id', (req, res, [id]) => {
    const ctx = contextOf(req, 'project.delete');
    projectIn(ctx, id!);
    runnerStopForProject(id!);
    store.deleteProject(id!, ctx.actor);
    send(res, 200, { ok: true });
  });

  route('POST', '/api/projects/:id/duplicate', (req, res, [id]) => {
    const ctx = contextOf(req, 'project.create');
    projectIn(ctx, id!);
    send(res, 201, store.duplicateProject(id!, ctx.actor));
  });

  route('POST', '/api/projects/:id/commands', async (req, res, [id]) => {
    const ctx = contextOf(req, 'project.edit.items');
    projectIn(ctx, id!);
    const body = await readJson(req);
    if (!Array.isArray(body.commands) || body.commands.length === 0) throw new HttpError(400, 'commands must be a non-empty array');
    const commands = body.commands as Command[];
    if (!can(ctx.role, 'project.edit') && !itemsOnly(commands)) {
      throw new HttpError(403, `Your role (${ctx.role}) can place, move and remove items, but not change the room or the item types.`);
    }
    const result = store.applyCommands(id!, commands, {
      actor: ctx.actor,
      ...(typeof body.summary === 'string' ? { summary: body.summary } : {}),
      ...(typeof body.baseRevision === 'number' ? { baseRevision: body.baseRevision } : {}),
    });
    if (result.ok) send(res, 200, { ok: true, project: result.project });
    else if (result.status === 404) send(res, 404, { ok: false, error: 'project not found' });
    else if (result.status === 409) send(res, 409, { ok: false, conflict: true, project: result.project });
    else send(res, 422, { ok: false, rejection: result.rejection });
  });

  route('GET', '/api/projects/:id/history', (req, res, [id], url) => {
    projectIn(contextOf(req, 'project.read'), id!);
    send(res, 200, store.history(id!, Math.min(500, Number(url.searchParams.get('limit') ?? 100) || 100)));
  });

  route('GET', '/api/projects/:id/revisions/:rev', (req, res, [id, rev]) => {
    projectIn(contextOf(req, 'project.read'), id!);
    const project = store.getRevision(id!, Number(rev));
    if (!project) throw new HttpError(404, 'revision not found');
    send(res, 200, project);
  });

  route('POST', '/api/projects/:id/restore', async (req, res, [id]) => {
    const ctx = contextOf(req, 'project.restore');
    projectIn(ctx, id!);
    const body = await readJson(req);
    const result = store.restore(id!, Number(body.revision), ctx.actor);
    if (!result.ok) throw new HttpError(404, 'revision not found');
    send(res, 200, { ok: true, project: result.project });
  });

  route('GET', '/api/projects/:id/shares', (req, res, [id]) => {
    const ctx = contextOf(req, 'project.share');
    projectIn(ctx, id!);
    send(res, 200, accounts.shares(ctx.company.id, id!));
  });

  route('POST', '/api/projects/:id/shares', async (req, res, [id]) => {
    const ctx = contextOf(req, 'project.share');
    const project = projectIn(ctx, id!);
    const body = await readJson(req);
    const revision = body.revision === undefined ? project.revision : Number(body.revision);
    if (!Number.isInteger(revision) || !store.getRevision(id!, revision)) throw new HttpError(404, 'revision not found');
    const { share, token } = accounts.createShare(ctx.company.id, id!, revision, body.days, ctx.actor);
    send(res, 201, { share, token, link: `#/s/${token}` });
  });

  route('DELETE', '/api/shares/:shareId', (req, res, [shareId]) => {
    const ctx = contextOf(req, 'project.share');
    accounts.revokeShare(ctx.company.id, shareId!, ctx.actor);
    send(res, 200, { ok: true });
  });

  route('GET', '/api/projects/:id/approvals', (req, res, [id]) => {
    const ctx = contextOf(req, 'project.read');
    projectIn(ctx, id!);
    send(res, 200, accounts.approvals(ctx.company.id, id!));
  });

  route('POST', '/api/projects/:id/approvals', async (req, res, [id]) => {
    const ctx = contextOf(req, 'project.approve');
    const user = personOnly(ctx);
    const project = projectIn(ctx, id!);
    const body = await readJson(req);
    const revision = body.revision === undefined ? project.revision : Number(body.revision);
    if (!Number.isInteger(revision) || !store.getRevision(id!, revision)) throw new HttpError(404, 'revision not found');
    send(res, 201, accounts.approve(ctx.company.id, id!, revision, user, body.note));
  });

  // ---------- agent tools, settings, agents ----------

  route('GET', '/api/tools', (req, res) => {
    contextOf(req);
    send(res, 200, toolSummaries());
  });

  route('POST', '/api/tools/:name', async (req, res, [name]) => {
    const ctx = contextOf(req);
    const body = await readJson(req);
    // The caller's `actor` field is ignored: the server records who really made the change.
    send(res, 200, runTool({ store, actor: ctx.actor, companyId: ctx.company.id, role: ctx.role }, decodeURIComponent(name!), body.input ?? {}));
  });

  route('GET', '/api/settings', (req, res) => {
    const ctx = contextOf(req);
    send(res, 200, { ...publicSettings(loadSettings(store)), canEdit: Boolean(ctx.user?.platformAdmin) });
  });

  route('PUT', '/api/settings', async (req, res) => {
    const ctx = contextOf(req);
    // These settings start programs on the server's computer: only its administrator changes them.
    if (!ctx.user?.platformAdmin) throw new HttpError(403, 'Only the administrator of this server can change the AI providers.');
    const body = (await readJson(req)) as Partial<Settings>;
    const saved = saveSettings(store, body);
    accounts.audit(null, ctx.actor, 'settings.changed', 'settings', { keys: Object.keys(body) });
    send(res, 200, { ...publicSettings(saved), canEdit: true });
  });

  route('GET', '/api/agents', (req, res) => {
    contextOf(req);
    send(res, 200, runner.availability());
  });

  route('GET', '/api/projects/:id/agent-runs', (req, res, [id]) => {
    projectIn(contextOf(req, 'project.read'), id!);
    send(res, 200, store.listRuns(id!));
  });

  route('POST', '/api/projects/:id/agent-runs', async (req, res, [id]) => {
    const ctx = contextOf(req, 'agent.run');
    projectIn(ctx, id!);
    const body = await readJson(req);
    if (typeof body.agent !== 'string' || typeof body.prompt !== 'string' || !body.prompt.trim()) {
      throw new HttpError(400, 'agent and prompt are required');
    }
    send(res, 201, runner.start(id!, body.agent, body.prompt, { companyId: ctx.company.id, startedBy: ctx.actor }));
  });

  const runIn = (ctx: Context, runId: string) => {
    const run = store.getRun(runId);
    if (!run || store.projectCompany(run.projectId) !== ctx.company.id) throw new HttpError(404, 'run not found');
    return run;
  };

  route('GET', '/api/agent-runs/:runId', (req, res, [runId]) => send(res, 200, runIn(contextOf(req, 'project.read'), runId!)));

  route('POST', '/api/agent-runs/:runId/stop', (req, res, [runId]) => {
    const ctx = contextOf(req, 'agent.run');
    runIn(ctx, runId!);
    send(res, 200, { stopped: runner.stop(runId!) });
  });

  route('GET', '/api/events', (req, res) => {
    const ctx = contextOf(req);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.set(res, ctx.company.id);
    req.on('close', () => clients.delete(res));
  });

  function runnerStopForProject(projectId: string) {
    for (const run of store.listRuns(projectId)) if (run.status === 'running') runner.stop(run.id);
  }

  /**
   * Other websites must not drive this API with a signed-in person's cookie:
   * - the Host header must be one this server answers to (blocks DNS-rebinding sites);
   * - a browser Origin, when sent, must be this server (blocks other websites);
   * - changes must be JSON, which browsers cannot send cross-site without a preflight this server
   *   never approves; the session cookie is SameSite=Strict on top of that.
   */
  function guard(req: IncomingMessage, method: string): void {
    const host = (req.headers.host ?? '').toLowerCase();
    const hostName = host.replace(/:\d+$/, '');
    if (!allowedHosts.has(hostName)) throw new HttpError(403, 'forbidden host');
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) throw new HttpError(403, 'forbidden origin');
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
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
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
        const status = error instanceof HttpError || error instanceof AccountError ? error.status : 500;
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
        for (const res of clients.keys()) res.end();
        clients.clear();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
