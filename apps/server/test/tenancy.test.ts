import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fromUnit, serializeProject } from '@space-planner/core';
import { demoHall } from '@space-planner/starter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../src/http.js';
import { Store } from '../src/store.js';
import { runTool } from '../src/tools.js';
import { client, PASSWORD, type Client } from './helpers.js';

const m = (v: number) => fromUnit(v, 'm');
const body = (value: unknown) => JSON.stringify(value);

let dir: string;
let store: Store;
let app: App;
let base: string;
/** A clock the tests move forward to reach timeouts and expiry. */
let clock = Date.parse('2026-09-26T09:00:00Z');

async function start(): Promise<void> {
  store = new Store(join(dir, 'planner.db'), { passwordCost: 10, now: () => new Date(clock) });
  app = createApp({ store, dataDir: dir, mcpScript: 'unused' });
  base = `http://127.0.0.1:${await app.listen(0)}`;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'planner-tenancy-'));
  clock = Date.parse('2026-09-26T09:00:00Z');
  await start();
});

afterEach(async () => {
  await app.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** First company through setup; its owner is signed in. */
async function setupFirst(): Promise<{ owner: Client; companyId: string }> {
  const owner = client(base);
  const res = await owner.call('/api/setup', { method: 'POST', body: body({ companyName: 'Nile Logistics', name: 'Mona Adel', email: 'mona@nile.example', password: PASSWORD }) });
  expect(res.status).toBe(201);
  return { owner, companyId: res.body.company.id };
}

/** Invite someone with a role and let them accept with a new account; returns their signed-in client. */
async function addMember(admin: Client, email: string, role: string, name = email.split('@')[0]!): Promise<Client> {
  const invited = await admin.call('/api/company/invitations', { method: 'POST', body: body({ email, role }) });
  expect(invited.status).toBe(201);
  const person = client(base);
  const accepted = await person.call(`/api/invitations/${invited.body.token}/accept`, { method: 'POST', body: body({ name, password: PASSWORD }) });
  expect(accepted.status).toBe(200);
  return person;
}

/** A second, independent company whose owner created it after being invited to nothing. */
async function secondCompany(first: Client): Promise<{ owner: Client; companyId: string }> {
  const outsider = await addMember(first, 'karim@delta.example', 'viewer', 'Karim');
  const created = await outsider.call('/api/companies', { method: 'POST', body: body({ name: 'Delta Foods' }) });
  expect(created.status).toBe(201);
  // Karim leaves Nile so the two companies share nobody.
  const members = (await first.call('/api/company/members')).body as Array<{ id: string; email: string }>;
  await first.call(`/api/company/members/${members.find((x) => x.email === 'karim@delta.example')!.id}`, { method: 'DELETE' });
  return { owner: outsider, companyId: created.body.company.id };
}

describe('first run and sign-in', () => {
  it('sets up the first company once, adopting the projects made before accounts', async () => {
    const old = store.createProject(demoHall(), 'human');
    const anonymous = client(base);
    expect((await anonymous.call('/api/session')).body).toMatchObject({ setupNeeded: true });
    const { owner, companyId } = await setupFirst();
    const session = (await owner.call('/api/session')).body;
    expect(session).toMatchObject({ user: { email: 'mona@nile.example', platformAdmin: true }, company: { id: companyId, name: 'Nile Logistics' }, role: 'owner' });
    expect((await owner.call('/api/projects')).body.map((p: { id: string }) => p.id)).toEqual([old.id]);
    const again = await client(base).call('/api/setup', { method: 'POST', body: body({ companyName: 'Evil', name: 'Eve', email: 'eve@evil.example', password: PASSWORD }) });
    expect(again.status).toBe(409);
    expect((await anonymous.call('/api/session')).body).toMatchObject({ setupNeeded: false });
  });

  it('opens a database from before accounts and keeps its projects', async () => {
    await app.close();
    store.close();
    const legacyDir = mkdtempSync(join(tmpdir(), 'planner-legacy-'));
    const legacy = new DatabaseSync(join(legacyDir, 'planner.db'));
    legacy.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL, item_count INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE revisions (project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision INTEGER NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL, commands TEXT NOT NULL, command_count INTEGER NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (project_id, revision));`);
    const hall = { ...demoHall(), id: 'p-legacy01' };
    legacy.prepare("INSERT INTO projects VALUES ('p-legacy01', ?, 0, 0, '2026-01-01', '2026-01-01')").run(hall.name);
    legacy.prepare("INSERT INTO revisions VALUES ('p-legacy01', 0, 'human', 'Created', '[]', 0, ?, '2026-01-01')").run(serializeProject(hall));
    legacy.close();
    rmSync(dir, { recursive: true, force: true });
    dir = legacyDir;
    await start();
    const { owner } = await setupFirst();
    expect((await owner.call('/api/projects/p-legacy01')).body).toMatchObject({ id: 'p-legacy01', name: hall.name });
  });

  it('answers a wrong email and a wrong password the same way, and locks an account after five failures', async () => {
    await setupFirst();
    const guest = client(base);
    const wrongEmail = await guest.call('/api/login', { method: 'POST', body: body({ email: 'nobody@nile.example', password: PASSWORD }) });
    const wrongPassword = await guest.call('/api/login', { method: 'POST', body: body({ email: 'mona@nile.example', password: 'not the password' }) });
    expect([wrongEmail.status, wrongEmail.body.error]).toEqual([wrongPassword.status, wrongPassword.body.error]);
    for (let i = 0; i < 4; i++) await guest.call('/api/login', { method: 'POST', body: body({ email: 'mona@nile.example', password: 'still wrong!' }) });
    // Locked: even the right password is refused, with the same answer.
    const locked = await guest.call('/api/login', { method: 'POST', body: body({ email: 'mona@nile.example', password: PASSWORD }) });
    expect([locked.status, locked.body.error]).toEqual([wrongPassword.status, wrongPassword.body.error]);
    clock += 16 * 60_000;
    expect((await guest.call('/api/login', { method: 'POST', body: body({ email: 'MONA@nile.example ', password: PASSWORD }) })).status).toBe(200);
  });

  it('keeps passwords as salted scrypt hashes with their parameters, and session tokens only as hashes', async () => {
    const { owner } = await setupFirst();
    const db = new DatabaseSync(join(dir, 'planner.db'));
    const user = db.prepare("SELECT password_hash FROM users WHERE email = 'mona@nile.example'").get() as { password_hash: string };
    expect(user.password_hash).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(user.password_hash).not.toContain(PASSWORD);
    const token = decodeURIComponent(owner.cookie.split('=')[1]!);
    const sessions = db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
    expect(sessions.map((s) => s.token_hash)).toContain(createHash('sha256').update(token).digest('hex'));
    expect(sessions.map((s) => s.token_hash)).not.toContain(token);
    db.close();
  });

  it('sets a HttpOnly SameSite=Strict cookie, ends sessions at sign-out, after 2 idle hours and after 12 hours', async () => {
    const guest = client(base);
    const res = await guest.call('/api/setup', { method: 'POST', body: body({ companyName: 'Nile', name: 'Mona', email: 'mona@nile.example', password: PASSWORD }) });
    expect(res.setCookie).toMatch(/HttpOnly/);
    expect(res.setCookie).toMatch(/SameSite=Strict/);
    const stolen = guest.cookie;
    await guest.call('/api/logout', { method: 'POST' });
    expect((await fetch(`${base}/api/projects`, { headers: { cookie: stolen } })).status).toBe(401);

    await guest.call('/api/login', { method: 'POST', body: body({ email: 'mona@nile.example', password: PASSWORD }) });
    clock += 2 * 60 * 60_000 + 1000;
    expect((await guest.call('/api/projects')).status).toBe(401);

    await guest.call('/api/login', { method: 'POST', body: body({ email: 'mona@nile.example', password: PASSWORD }) });
    for (let hour = 0; hour < 12; hour++) {
      clock += 60 * 60_000;
      const status = (await guest.call('/api/projects')).status;
      expect(status).toBe(hour < 11 ? 200 : 401);
    }
  });
});

describe('isolation between companies', () => {
  it('answers "not found" on every project route for another company’s project', async () => {
    const nile = await setupFirst();
    const delta = await secondCompany(nile.owner);
    const project = (await nile.owner.call('/api/projects', { method: 'POST', body: body({ name: 'Nile hub', template: 'warehouse-reference' }) })).body;
    const share = (await nile.owner.call(`/api/projects/${project.id}/shares`, { method: 'POST', body: body({ days: 7 }) })).body;
    const calls: Array<[string, string, unknown?]> = [
      ['GET', `/api/projects/${project.id}`],
      ['GET', `/api/projects/${project.id}/history`],
      ['GET', `/api/projects/${project.id}/revisions/0`],
      ['POST', `/api/projects/${project.id}/commands`, { commands: [{ type: 'project.rename', name: 'mine now' }] }],
      ['POST', `/api/projects/${project.id}/restore`, { revision: 0 }],
      ['POST', `/api/projects/${project.id}/duplicate`, {}],
      ['GET', `/api/projects/${project.id}/shares`],
      ['POST', `/api/projects/${project.id}/shares`, { days: 30 }],
      ['GET', `/api/projects/${project.id}/approvals`],
      ['POST', `/api/projects/${project.id}/approvals`, { revision: 0 }],
      ['GET', `/api/projects/${project.id}/agent-runs`],
      ['POST', `/api/projects/${project.id}/agent-runs`, { agent: 'api', prompt: 'x' }],
      ['DELETE', `/api/shares/${share.share.id}`],
      ['DELETE', `/api/projects/${project.id}`],
    ];
    for (const [method, path, payload] of calls) {
      const res = await delta.owner.call(path, { method, ...(payload === undefined ? {} : { body: body(payload) }) });
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
    expect((await delta.owner.call('/api/projects')).body).toEqual([]);
    // Nothing happened to Nile's project.
    expect(store.getProject(project.id)).toMatchObject({ name: 'Nile hub', revision: 0 });
    expect(store.accounts.shares(nile.companyId, project.id)[0]).toMatchObject({ revoked: false });
  });

  it('cannot reach another company’s members, invitations or keys by id', async () => {
    const nile = await setupFirst();
    const delta = await secondCompany(nile.owner);
    const invitation = (await nile.owner.call('/api/company/invitations', { method: 'POST', body: body({ email: 'sara@nile.example', role: 'designer' }) })).body.invitation;
    const key = (await nile.owner.call('/api/company/api-keys', { method: 'POST', body: body({ name: 'Nile agent', role: 'designer' }) })).body.key;
    const monaId = (await nile.owner.call('/api/session')).body.user.id;
    expect((await delta.owner.call(`/api/company/invitations/${invitation.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await delta.owner.call(`/api/company/api-keys/${key.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await delta.owner.call(`/api/company/members/${monaId}`, { method: 'PATCH', body: body({ role: 'viewer' }) })).status).toBe(404);
    expect((await delta.owner.call(`/api/company/members/${monaId}`, { method: 'DELETE' })).status).toBe(404);
    expect((await delta.owner.call('/api/company/members')).body.map((x: { email: string }) => x.email)).toEqual(['karim@delta.example']);
    expect((await delta.owner.call('/api/company/audit')).body.events.every((e: { action: string; target: string }) => !e.target.includes('sara'))).toBe(true);
  });

  it('keeps agent keys and agent tools inside their company', async () => {
    const nile = await setupFirst();
    const delta = await secondCompany(nile.owner);
    const nileProject = (await nile.owner.call('/api/projects', { method: 'POST', body: body({ name: 'Nile hub', template: 'warehouse-reference' }) })).body;
    const deltaKey = (await delta.owner.call('/api/company/api-keys', { method: 'POST', body: body({ name: 'delta-bot', role: 'designer' }) })).body.token as string;
    const agent = client(base);
    const tool = (name: string, input: object) => agent.call(`/api/tools/${name}`, { method: 'POST', token: deltaKey, body: body({ input, actor: 'agent:pretending-to-be-nile' }) });
    expect((await tool('get_project', { project_id: nileProject.id })).body).toMatchObject({ isError: true });
    expect((await tool('place_items', { project_id: nileProject.id, items: [{ definition_id: 'warehouse-euro-pallet', x_m: 2, y_m: 2 }] })).body).toMatchObject({ isError: true });
    expect((await tool('list_projects', {})).body.text).not.toContain(nileProject.id);
    const created = await tool('create_project', { name: 'Delta line', activity: 'production', reference: true });
    const id = /Created (p-\w+)/.exec(created.body.text)![1]!;
    expect(store.projectCompany(id)).toBe(delta.companyId);
    // The history names the key, not whatever the caller claimed to be.
    expect(store.history(id)[0]?.actor).toBe('agent:delta-bot');
    // A key cannot manage people or keys, and does not reach the key's company's projects of others.
    expect((await agent.call('/api/company/invitations', { method: 'POST', token: deltaKey, body: body({ email: 'x@y.example', role: 'owner' }) })).status).toBe(403);
    expect((await agent.call(`/api/projects/${nileProject.id}`, { token: deltaKey })).status).toBe(404);
  });

  it('sends live events only to the company that owns the project', async () => {
    const nile = await setupFirst();
    const delta = await secondCompany(nile.owner);
    const deltaProject = (await delta.owner.call('/api/projects', { method: 'POST', body: body({ name: 'Delta plant', template: 'production-reference' }) })).body;
    const nileProject = (await nile.owner.call('/api/projects', { method: 'POST', body: body({ name: 'Nile hub', template: 'warehouse-reference' }) })).body;
    const controller = new AbortController();
    const stream = await fetch(`${base}/api/events`, { signal: controller.signal, headers: { cookie: delta.owner.cookie } });
    const reader = stream.body!.getReader();
    await nile.owner.call(`/api/projects/${nileProject.id}/commands`, { method: 'POST', body: body({ commands: [{ type: 'project.rename', name: 'Nile secret plan' }] }) });
    await delta.owner.call(`/api/projects/${deltaProject.id}/commands`, { method: 'POST', body: body({ commands: [{ type: 'project.rename', name: 'Delta plan' }] }) });
    let text = '';
    while (!text.includes(deltaProject.id)) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    expect(text).not.toContain(nileProject.id);
    expect(text).not.toContain('Nile secret plan');
  });

  it('refuses to link a share or an approval to a project of another company, even inside the database', () => {
    const db = new DatabaseSync(join(dir, 'planner.db'));
    db.exec('PRAGMA foreign_keys = ON');
    db.exec("INSERT INTO companies VALUES ('c-a', 'A', '2026'), ('c-b', 'B', '2026')");
    db.exec("INSERT INTO projects (id, company_id, name, revision, item_count, created_at, updated_at) VALUES ('p-a', 'c-a', 'A plan', 0, 0, '2026', '2026')");
    expect(() => db.exec("INSERT INTO share_links (id, token_hash, company_id, project_id, revision, created_by, created_at, expires_at) VALUES ('s', 'h', 'c-b', 'p-a', 0, 'x', '2026', '2027')")).toThrow(/FOREIGN KEY/);
    db.close();
  });
});

describe('roles', () => {
  it('gives each role what its title says, and nothing more', async () => {
    const { owner } = await setupFirst();
    const project = (await owner.call('/api/projects', { method: 'POST', body: body({ name: 'Hall', template: 'demo' }) })).body;
    const viewer = await addMember(owner, 'v@nile.example', 'viewer');
    const operator = await addMember(owner, 'o@nile.example', 'operator');
    const reviewer = await addMember(owner, 'r@nile.example', 'reviewer');
    const designer = await addMember(owner, 'd@nile.example', 'designer');
    const admin = await addMember(owner, 'a@nile.example', 'admin');
    const move = { commands: [{ type: 'item.add', item: { id: 'extra-chair', definitionId: 'chair', position: { x: m(8), y: m(6) }, rotation: 0, locked: false } }] };
    const rename = { commands: [{ type: 'project.rename', name: 'Renamed' }] };

    expect((await viewer.call(`/api/projects/${project.id}`)).status).toBe(200);
    expect((await viewer.call(`/api/projects/${project.id}/commands`, { method: 'POST', body: body(move) })).status).toBe(403);
    expect((await viewer.call('/api/projects', { method: 'POST', body: body({ name: 'x', template: 'demo' }) })).status).toBe(403);

    expect((await operator.call(`/api/projects/${project.id}/commands`, { method: 'POST', body: body(move) })).status).toBe(200);
    expect((await operator.call(`/api/projects/${project.id}/commands`, { method: 'POST', body: body(rename) })).status).toBe(403);
    expect((await operator.call(`/api/projects/${project.id}/commands`, { method: 'POST', body: body({ commands: [{ type: 'batch', commands: [...move.commands, ...rename.commands] }] }) })).status).toBe(403);

    expect((await reviewer.call(`/api/projects/${project.id}/approvals`, { method: 'POST', body: body({ note: 'Looks right' }) })).status).toBe(201);
    expect((await reviewer.call(`/api/projects/${project.id}/commands`, { method: 'POST', body: body(rename) })).status).toBe(403);

    expect((await designer.call(`/api/projects/${project.id}/commands`, { method: 'POST', body: body(rename) })).status).toBe(200);
    expect((await designer.call(`/api/projects/${project.id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await designer.call('/api/company/audit')).status).toBe(403);
    expect((await designer.call('/api/company/invitations', { method: 'POST', body: body({ email: 'n@nile.example', role: 'viewer' }) })).status).toBe(403);
    expect((await designer.call('/api/settings', { method: 'PUT', body: body({ timeoutMinutes: 5 }) })).status).toBe(403);

    // An admin runs the team but cannot make owners.
    expect((await admin.call('/api/company/invitations', { method: 'POST', body: body({ email: 'n@nile.example', role: 'viewer' }) })).status).toBe(201);
    expect((await admin.call('/api/company/invitations', { method: 'POST', body: body({ email: 'boss@nile.example', role: 'owner' }) })).status).toBe(403);
    const members = (await owner.call('/api/company/members')).body as Array<{ id: string; email: string }>;
    const idOf = (email: string) => members.find((x) => x.email === email)!.id;
    expect((await admin.call(`/api/company/members/${idOf('d@nile.example')}`, { method: 'PATCH', body: body({ role: 'owner' }) })).status).toBe(403);
    // The last owner stays.
    expect((await owner.call(`/api/company/members/${idOf('mona@nile.example')}`, { method: 'PATCH', body: body({ role: 'viewer' }) })).status).toBe(409);
    expect((await owner.call(`/api/company/members/${idOf('mona@nile.example')}`, { method: 'DELETE' })).status).toBe(409);
  });

  it('takes effect immediately when someone is removed or their role changes', async () => {
    const { owner } = await setupFirst();
    const designer = await addMember(owner, 'd@nile.example', 'designer');
    expect((await designer.call('/api/projects', { method: 'POST', body: body({ name: 'x', template: 'demo' }) })).status).toBe(201);
    const id = ((await owner.call('/api/company/members')).body as Array<{ id: string; email: string }>).find((x) => x.email === 'd@nile.example')!.id;
    await owner.call(`/api/company/members/${id}`, { method: 'PATCH', body: body({ role: 'viewer' }) });
    expect((await designer.call('/api/projects', { method: 'POST', body: body({ name: 'y', template: 'demo' }) })).status).toBe(403);
    await owner.call(`/api/company/members/${id}`, { method: 'DELETE' });
    expect((await designer.call('/api/projects')).status).toBe(401);
  });

  it('lets only the server administrator change the programs agents run', async () => {
    const { owner } = await setupFirst();
    const admin = await addMember(owner, 'a@nile.example', 'admin');
    expect((await admin.call('/api/settings')).body).toMatchObject({ canEdit: false });
    expect((await admin.call('/api/settings', { method: 'PUT', body: body({ timeoutMinutes: 5 }) })).status).toBe(403);
    expect((await owner.call('/api/settings', { method: 'PUT', body: body({ timeoutMinutes: 5 }) })).status).toBe(200);
  });
});

describe('invitations, keys and share links', () => {
  it('uses an invitation once, and never after it is revoked or expired', async () => {
    const { owner } = await setupFirst();
    const first = (await owner.call('/api/company/invitations', { method: 'POST', body: body({ email: 'sara@nile.example', role: 'designer' }) })).body;
    expect((await client(base).call(`/api/invitations/${first.token}`)).body).toMatchObject({ email: 'sara@nile.example', role: 'designer', company: { name: 'Nile Logistics' }, accountExists: false });
    const sara = client(base);
    const accepted = sara.call(`/api/invitations/${first.token}/accept`, { method: 'POST', body: body({ name: 'Sara', password: PASSWORD }) });
    const raced = client(base).call(`/api/invitations/${first.token}/accept`, { method: 'POST', body: body({ name: 'Imposter', password: PASSWORD }) });
    const statuses = [(await accepted).status, (await raced).status].sort();
    expect(statuses).toEqual([200, 404]);
    expect((await client(base).call(`/api/invitations/${first.token}`)).status).toBe(404);

    const revoked = (await owner.call('/api/company/invitations', { method: 'POST', body: body({ email: 'omar@nile.example', role: 'viewer' }) })).body;
    await owner.call(`/api/company/invitations/${revoked.invitation.id}`, { method: 'DELETE' });
    expect((await client(base).call(`/api/invitations/${revoked.token}/accept`, { method: 'POST', body: body({ name: 'Omar', password: PASSWORD }) })).status).toBe(404);

    const expiring = (await owner.call('/api/company/invitations', { method: 'POST', body: body({ email: 'hana@nile.example', role: 'viewer' }) })).body;
    clock += 8 * 24 * 60 * 60_000;
    expect((await client(base).call(`/api/invitations/${expiring.token}/accept`, { method: 'POST', body: body({ name: 'Hana', password: PASSWORD }) })).status).toBe(404);
  });

  it('asks a person who already has an account to sign in as the invited email', async () => {
    const nile = await setupFirst();
    const delta = await secondCompany(nile.owner);
    const invite = (await delta.owner.call('/api/company/invitations', { method: 'POST', body: body({ email: 'mona@nile.example', role: 'reviewer' }) })).body;
    expect((await client(base).call(`/api/invitations/${invite.token}/accept`, { method: 'POST', body: body({ name: 'x', password: PASSWORD }) })).status).toBe(403);
    expect((await nile.owner.call(`/api/invitations/${invite.token}/accept`, { method: 'POST' })).status).toBe(200);
    const session = (await nile.owner.call('/api/session')).body;
    expect(session.companies.map((c: { name: string; role: string }) => `${c.name}:${c.role}`).sort()).toEqual(['Delta Foods:reviewer', 'Nile Logistics:owner']);
    expect(session.company.name).toBe('Delta Foods');
    // Switching company is checked against the memberships.
    expect((await nile.owner.call('/api/session/company', { method: 'POST', body: body({ companyId: nile.companyId }) })).body.company.name).toBe('Nile Logistics');
    expect((await delta.owner.call('/api/session/company', { method: 'POST', body: body({ companyId: nile.companyId }) })).status).toBe(404);
  });

  it('stops a revoked or expired key at once', async () => {
    const { owner } = await setupFirst();
    const made = (await owner.call('/api/company/api-keys', { method: 'POST', body: body({ name: 'Claude on the office PC', role: 'viewer', days: 1 }) })).body;
    const agent = client(base);
    expect((await agent.call('/api/projects', { token: made.token })).status).toBe(200);
    expect((await agent.call('/api/projects', { method: 'POST', token: made.token, body: body({ name: 'x', template: 'demo' }) })).status).toBe(403);
    // Made before the clock jumps: a day later the owner's own session has ended too.
    const other = (await owner.call('/api/company/api-keys', { method: 'POST', body: body({ name: 'Codex', role: 'designer' }) })).body;
    clock += 25 * 60 * 60_000;
    expect((await agent.call('/api/projects', { token: made.token })).status).toBe(401);
    expect((await agent.call('/api/projects', { token: other.token })).status).toBe(200);
    await owner.call('/api/login', { method: 'POST', body: body({ email: 'mona@nile.example', password: PASSWORD }) });
    await owner.call(`/api/company/api-keys/${other.key.id}`, { method: 'DELETE' });
    expect((await agent.call('/api/projects', { token: other.token })).status).toBe(401);
    expect((await owner.call('/api/company/api-keys', { method: 'POST', body: body({ name: 'too strong', role: 'owner' }) })).status).toBe(400);
  });

  it('shares the revision it was made for, until it expires or is revoked', async () => {
    const { owner } = await setupFirst();
    const project = (await owner.call('/api/projects', { method: 'POST', body: body({ name: 'Zamalek branch', template: 'restaurant-reference' }) })).body;
    const made = (await owner.call(`/api/projects/${project.id}/shares`, { method: 'POST', body: body({ days: 2 }) })).body;
    await owner.call(`/api/projects/${project.id}/commands`, { method: 'POST', body: body({ commands: [{ type: 'project.rename', name: 'Zamalek — draft 2' }] }) });
    const guest = client(base);
    const opened = await guest.call(`/api/shared/${made.token}`);
    expect(opened.body).toMatchObject({ revision: 0, project: { name: 'Zamalek branch' }, company: { name: 'Nile Logistics' } });
    expect(opened.body.company).not.toHaveProperty('id');
    expect(store.accounts.shares(store.projectCompany(project.id)!, project.id)[0]).toMatchObject({ openCount: 1 });
    const second = (await owner.call(`/api/projects/${project.id}/shares`, { method: 'POST', body: body({ days: 30 }) })).body;
    clock += 3 * 24 * 60 * 60_000;
    expect((await guest.call(`/api/shared/${made.token}`)).status).toBe(404);
    expect((await guest.call(`/api/shared/${second.token}`)).status).toBe(200);
    await owner.call('/api/login', { method: 'POST', body: body({ email: 'mona@nile.example', password: PASSWORD }) });
    await owner.call(`/api/shares/${second.share.id}`, { method: 'DELETE' });
    expect((await guest.call(`/api/shared/${second.token}`)).status).toBe(404);
    expect((await owner.call(`/api/projects/${project.id}/shares`, { method: 'POST', body: body({ days: 365 }) })).status).toBe(400);
  });

  it('shows the latest approved revision on the project list', async () => {
    const { owner } = await setupFirst();
    const project = (await owner.call('/api/projects', { method: 'POST', body: body({ name: 'Hall', template: 'demo' }) })).body;
    await owner.call(`/api/projects/${project.id}/approvals`, { method: 'POST', body: body({ revision: 0, note: 'OK for the client' }) });
    await owner.call(`/api/projects/${project.id}/commands`, { method: 'POST', body: body({ commands: [{ type: 'project.rename', name: 'Hall v2' }] }) });
    const listed = (await owner.call('/api/projects')).body[0];
    expect(listed).toMatchObject({ revision: 1, approvedRevision: 0, approvedBy: 'Mona Adel' });
  });
});

describe('audit log', () => {
  it('records who did what, refuses edits and deletions, and detects tampering', async () => {
    const { owner, companyId } = await setupFirst();
    await owner.call('/api/company/invitations', { method: 'POST', body: body({ email: 'sara@nile.example', role: 'designer' }) });
    const project = (await owner.call('/api/projects', { method: 'POST', body: body({ name: 'Hall', template: 'demo' }) })).body;
    await owner.call(`/api/projects/${project.id}/shares`, { method: 'POST', body: body({}) });
    await owner.call(`/api/projects/${project.id}`, { method: 'DELETE' });
    const log = (await owner.call('/api/company/audit')).body;
    expect(log.events.map((e: { action: string }) => e.action).reverse()).toEqual([
      'company.created', 'user.signed_in', 'member.invited', 'project.created', 'share.created', 'project.deleted',
    ]);
    expect(log.events[0].actor).toBe('Mona Adel <mona@nile.example>');
    expect(log.chain).toMatchObject({ valid: true, events: 6 });

    const db = new DatabaseSync(join(dir, 'planner.db'));
    expect(() => db.exec("UPDATE audit_events SET actor = 'someone else'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM audit_events')).toThrow(/append-only/);
    // Someone with the database file removes the protection and rewrites history: the chain notices.
    db.exec('DROP TRIGGER audit_no_update');
    db.exec("UPDATE audit_events SET target = 'nothing to see' WHERE action = 'project.deleted'");
    db.close();
    expect(store.accounts.verifyAudit(companyId)).toMatchObject({ valid: false });
  });

  it('records failed sign-ins and lockouts in the person’s companies', async () => {
    const { owner } = await setupFirst();
    for (let i = 0; i < 5; i++) await client(base).call('/api/login', { method: 'POST', body: body({ email: 'mona@nile.example', password: 'wrong wrong' }) });
    const actions = (await owner.call('/api/company/audit')).body.events.map((e: { action: string }) => e.action);
    expect(actions.filter((a: string) => a === 'user.sign_in_failed')).toHaveLength(4);
    expect(actions).toContain('user.locked');
    expect(JSON.stringify((await owner.call('/api/company/audit')).body)).not.toContain('wrong wrong');
  });
});

describe('tools with roles', () => {
  it('refuses tools the role does not allow, and lets operators place but not reshape', async () => {
    const { owner, companyId } = await setupFirst();
    const project = store.createProject(demoHall(), 'test', undefined, { companyId: companyId });
    const as = (role: 'viewer' | 'operator') => ({ store, actor: `agent:${role}`, companyId, role });
    expect(runTool(as('viewer'), 'get_project', { project_id: project.id }).isError).toBe(false);
    expect(runTool(as('viewer'), 'place_items', { project_id: project.id, items: [{ definition_id: 'chair', x_m: 8, y_m: 6 }] }).text).toContain('cannot do this');
    expect(runTool(as('operator'), 'place_items', { project_id: project.id, items: [{ definition_id: 'chair', x_m: 8, y_m: 6 }] }).isError).toBe(false);
    expect(runTool(as('operator'), 'set_room', { project_id: project.id, width_m: 20 }).text).toContain('cannot do this');
    expect(runTool(as('operator'), 'apply_commands', { project_id: project.id, commands: [{ type: 'project.rename', name: 'x' }] }).text).toContain('cannot do this');
    expect(runTool(as('operator'), 'create_project', { name: 'x', width_m: 5, depth_m: 5 }).text).toContain('cannot do this');
    expect(owner).toBeDefined();
  });
});
