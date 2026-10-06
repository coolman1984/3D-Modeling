import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { isRole, KEY_ROLES, type Role } from './permissions.js';

/**
 * People, companies and everything that decides who may see what: memberships with roles,
 * sessions, invitations, company API keys, share links, approvals and the audit log. Lives in the
 * same database file as the projects so a project and its company change in one transaction.
 *
 * Secrets (session tokens, invitation and share links, API keys) are 256-bit random values; only
 * their SHA-256 is stored, so a copy of the database does not let anyone sign in or open a link.
 */

export const ACCOUNT_SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  platform_admin INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'designer', 'operator', 'reviewer', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (company_id, user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'designer', 'operator', 'reviewer', 'viewer')),
  invited_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('designer', 'operator', 'viewer')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  run_id TEXT
);
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS approvals (
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  approved_by TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, revision),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL,
  at TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_by_company ON audit_events(company_id, seq);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
`;

// OWASP password-storage guidance for scrypt: N = 2^17, r = 8, p = 1.
const DEFAULT_COST = 17;
const SESSION_IDLE_MS = 2 * 60 * 60_000;
const SESSION_ABSOLUTE_MS = 12 * 60 * 60_000;
const INVITE_MS = 7 * 24 * 60 * 60_000;
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;
const GENESIS = '0'.repeat(64);

export interface AccountsOptions {
  /** log2 of scrypt's N. Only tests lower it, to keep hundreds of sign-ups fast. */
  readonly passwordCost?: number;
  readonly now?: () => Date;
}

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly platformAdmin: boolean;
}

export interface Company {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface Membership {
  readonly company: Company;
  readonly role: Role;
}

export interface Member extends User {
  readonly role: Role;
  readonly joinedAt: string;
}

export interface InvitationInfo {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
  readonly invitedBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

export interface ApiKeyInfo {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revoked: boolean;
}

export interface ShareInfo {
  readonly id: string;
  readonly projectId: string;
  readonly revision: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
  readonly openCount: number;
  readonly lastOpenedAt: string | null;
}

export interface Approval {
  readonly projectId: string;
  readonly revision: number;
  readonly approvedBy: string;
  readonly note: string;
  readonly createdAt: string;
}

export interface AuditEvent {
  readonly seq: number;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly detail: Record<string, unknown>;
  readonly at: string;
}

/** A human session, resolved and re-checked against the membership on every request. */
export interface SessionPrincipal {
  readonly kind: 'user';
  readonly user: User;
  readonly company: Company | null;
  readonly role: Role | null;
}

export interface KeyPrincipal {
  readonly kind: 'key';
  readonly keyId: string;
  readonly name: string;
  readonly company: Company;
  readonly role: Role;
}

/** A refusal the caller shows as is. */
export class AccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const shortId = (prefix: string) => `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, 32, options, (error, key) => (error ? reject(error) : resolve(key))));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new AccountError(400, 'Enter an email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 200 || !EMAIL.test(email)) throw new AccountError(400, 'Enter a valid email address.');
  return email;
}

export function cleanName(value: unknown, what = 'name'): string {
  if (typeof value !== 'string' || !value.trim()) throw new AccountError(400, `Enter a ${what}.`);
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length > 80) throw new AccountError(400, `The ${what} is too long (80 characters at most).`);
  return name;
}

const COMMON = new Set(['password', 'password1', '1234567890', '12345678910', 'qwertyuiop', 'iloveyou12', 'welcome123', 'admin12345', 'letmein123', 'password123']);

/** Length over composition rules (NIST SP 800-63B): at least 10 characters, not a well-known password, not the email. */
export function checkPassword(password: unknown, email?: string): string {
  if (typeof password !== 'string' || password.length < 10) throw new AccountError(400, 'The password needs at least 10 characters.');
  if (password.length > 200) throw new AccountError(400, 'The password is too long (200 characters at most).');
  if (COMMON.has(password.toLowerCase()) || (email && password.toLowerCase() === email)) throw new AccountError(400, 'Choose a less predictable password.');
  return password;
}

type Row = Record<string, string | number | null>;

export class Accounts {
  private readonly cost: number;
  private readonly now: () => Date;
  /** Compared against when the email does not exist, so a wrong email costs as much time as a wrong password. */
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly db: DatabaseSync,
    options: AccountsOptions = {},
  ) {
    this.cost = options.passwordCost ?? DEFAULT_COST;
    this.now = options.now ?? (() => new Date());
  }

  private at(offsetMs = 0): string {
    return new Date(this.now().getTime() + offsetMs).toISOString();
  }

  // ---------- passwords ----------

  async hashPassword(password: string): Promise<string> {
    const N = 2 ** this.cost;
    const r = 8;
    const p = 1;
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, { N, r, p, maxmem: 256 * N * r });
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
  }

  /** Verifies against the parameters stored with the hash, so the cost can rise later without breaking old accounts. */
  async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, N, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !N || !r || !p || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const key = await scrypt(password, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * Number(N) * Number(r) });
    return key.length === expected.length && timingSafeEqual(key, expected);
  }

  // ---------- users and companies ----------

  userCount(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n);
  }

  private toUser(row: Row): User {
    return { id: String(row.id), email: String(row.email), name: String(row.name), platformAdmin: Number(row.platform_admin) === 1 };
  }

  getUser(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return row ? this.toUser(row) : null;
  }

  findUserByEmail(email: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Row | undefined;
    return row ? this.toUser(row) : null;
  }

  async createUser(input: { email: unknown; name: unknown; password: unknown; platformAdmin?: boolean }): Promise<User> {
    const email = normalizeEmail(input.email);
    const name = cleanName(input.name);
    const password = checkPassword(input.password, email);
    if (this.findUserByEmail(email)) throw new AccountError(409, 'An account with this email already exists. Sign in instead.');
    const hash = await this.hashPassword(password);
    const id = shortId('u');
    this.db
      .prepare('INSERT INTO users (id, email, name, password_hash, platform_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, email, name, hash, input.platformAdmin ? 1 : 0, this.at());
    return { id, email, name, platformAdmin: Boolean(input.platformAdmin) };
  }

  getCompany(id: string): Company | null {
    const row = this.db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as Row | undefined;
    return row ? { id: String(row.id), name: String(row.name), createdAt: String(row.created_at) } : null;
  }

  listCompanies(): Company[] {
    return (this.db.prepare('SELECT * FROM companies ORDER BY name').all() as Row[]).map((row) => ({ id: String(row.id), name: String(row.name), createdAt: String(row.created_at) }));
  }

  createCompany(nameInput: unknown, owner: User): Company {
    const name = cleanName(nameInput, 'company name');
    const company: Company = { id: shortId('c'), name, createdAt: this.at() };
    this.db.prepare('INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)').run(company.id, company.name, company.createdAt);
    this.db.prepare('INSERT INTO memberships (company_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(company.id, owner.id, 'owner', company.createdAt);
    this.audit(company.id, labelOf(owner), 'company.created', company.id, { name });
    return company;
  }

  renameCompany(companyId: string, nameInput: unknown, actor: string): Company {
    const name = cleanName(nameInput, 'company name');
    this.db.prepare('UPDATE companies SET name = ? WHERE id = ?').run(name, companyId);
    this.audit(companyId, actor, 'company.renamed', companyId, { name });
    return this.getCompany(companyId)!;
  }

  memberships(userId: string): Membership[] {
    const rows = this.db
      .prepare('SELECT c.id, c.name, c.created_at, m.role FROM memberships m JOIN companies c ON c.id = m.company_id WHERE m.user_id = ? ORDER BY c.name')
      .all(userId) as Row[];
    return rows.map((r) => ({ company: { id: String(r.id), name: String(r.name), createdAt: String(r.created_at) }, role: r.role as Role }));
  }

  roleIn(companyId: string, userId: string): Role | null {
    const row = this.db.prepare('SELECT role FROM memberships WHERE company_id = ? AND user_id = ?').get(companyId, userId) as { role: string } | undefined;
    return row && isRole(row.role) ? row.role : null;
  }

  addMember(companyId: string, userId: string, role: Role): void {
    this.db
      .prepare('INSERT INTO memberships (company_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(company_id, user_id) DO UPDATE SET role = excluded.role')
      .run(companyId, userId, role, this.at());
  }

  members(companyId: string): Member[] {
    const rows = this.db
      .prepare('SELECT u.*, m.role, m.created_at AS joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? ORDER BY u.name')
      .all(companyId) as Row[];
    return rows.map((r) => ({ ...this.toUser(r), role: r.role as Role, joinedAt: String(r.joined_at) }));
  }

  private owners(companyId: string): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE company_id = ? AND role = 'owner'").get(companyId) as { n: number }).n);
  }

  /** Only owners hand out or take away the owner role, and a company always keeps one owner. */
  changeRole(companyId: string, actorRole: Role, targetUserId: string, role: unknown, actor: string): void {
    if (!isRole(role)) throw new AccountError(400, 'Unknown role.');
    const current = this.roleIn(companyId, targetUserId);
    if (!current) throw new AccountError(404, 'This person is not a member of the company.');
    if ((current === 'owner' || role === 'owner') && actorRole !== 'owner') throw new AccountError(403, 'Only an owner can give or take away the owner role.');
    if (current === 'owner' && role !== 'owner' && this.owners(companyId) <= 1) throw new AccountError(409, 'A company needs at least one owner.');
    this.db.prepare('UPDATE memberships SET role = ? WHERE company_id = ? AND user_id = ?').run(role, companyId, targetUserId);
    this.audit(companyId, actor, 'member.role_changed', targetUserId, { from: current, to: role, email: this.getUser(targetUserId)?.email });
  }

  removeMember(companyId: string, actorRole: Role, targetUserId: string, actor: string): void {
    const current = this.roleIn(companyId, targetUserId);
    if (!current) throw new AccountError(404, 'This person is not a member of the company.');
    if (current === 'owner' && actorRole !== 'owner') throw new AccountError(403, 'Only an owner can remove an owner.');
    if (current === 'owner' && this.owners(companyId) <= 1) throw new AccountError(409, 'A company needs at least one owner.');
    const email = this.getUser(targetUserId)?.email;
    this.db.prepare('DELETE FROM memberships WHERE company_id = ? AND user_id = ?').run(companyId, targetUserId);
    // Their open sessions in this company end now; a session is re-checked on every request anyway.
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND company_id = ?').run(targetUserId, companyId);
    this.audit(companyId, actor, 'member.removed', targetUserId, { email, role: current });
  }

  // ---------- setup and sign-in ----------

  /** The first launch: the first person creates the first company and becomes its owner and the platform's administrator. */
  async setup(input: { companyName: unknown; name: unknown; email: unknown; password: unknown }): Promise<{ user: User; company: Company }> {
    if (this.userCount() > 0) throw new AccountError(409, 'This server is already set up. Sign in instead.');
    const companyName = cleanName(input.companyName, 'company name');
    const user = await this.createUser({ email: input.email, name: input.name, password: input.password, platformAdmin: true });
    // A second setup that raced this one would have found a user above; the email is unique regardless.
    const company = this.createCompany(companyName, user);
    return { user, company };
  }

  /**
   * One generic answer for a wrong email, a wrong password and a locked account (no account
   * enumeration); failures are counted per account and lock it for 15 minutes after five.
   */
  async signIn(emailInput: unknown, password: unknown): Promise<User | null> {
    let email: string;
    try {
      email = normalizeEmail(emailInput);
    } catch {
      return null;
    }
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Row | undefined;
    const pass = typeof password === 'string' ? password.slice(0, 200) : '';
    if (!row) {
      this.dummyHash ??= this.hashPassword('not a real password, only spends time');
      await this.verifyPassword(pass, await this.dummyHash);
      return null;
    }
    const lockedUntil = row.locked_until ? Date.parse(String(row.locked_until)) : 0;
    const ok = await this.verifyPassword(pass, String(row.password_hash));
    const nowMs = this.now().getTime();
    if (lockedUntil > nowMs) {
      this.auditForUser(String(row.id), labelOf(this.toUser(row)), 'user.sign_in_refused', { reason: 'locked' });
      return null;
    }
    if (!ok) {
      const failures = Number(row.failed_logins) + 1;
      const lock = failures >= LOCK_AFTER ? this.at(LOCK_MS) : null;
      this.db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failures, lock, String(row.id));
      this.auditForUser(String(row.id), labelOf(this.toUser(row)), lock ? 'user.locked' : 'user.sign_in_failed', { failures });
      return null;
    }
    this.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(String(row.id));
    return this.toUser(row);
  }

  async changePassword(userId: string, current: unknown, next: unknown): Promise<void> {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row | undefined;
    if (!row) throw new AccountError(404, 'Unknown account.');
    if (typeof current !== 'string' || !(await this.verifyPassword(current, String(row.password_hash)))) throw new AccountError(403, 'The current password is not right.');
    const password = checkPassword(next, String(row.email));
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await this.hashPassword(password), userId);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    this.auditForUser(userId, labelOf(this.toUser(row)), 'user.password_changed', {});
  }

  // ---------- sessions ----------

  /** A fresh token at every sign-in (no session fixation); the active company is the first membership unless one is asked for. */
  startSession(user: User, companyId?: string): string {
    const token = newToken();
    const memberships = this.memberships(user.id);
    const company = memberships.find((m) => m.company.id === companyId)?.company ?? memberships[0]?.company ?? null;
    const at = this.at();
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, company_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hashToken(token), user.id, company?.id ?? null, at, at, this.at(SESSION_ABSOLUTE_MS));
    return token;
  }

  resolveSession(token: string | undefined): SessionPrincipal | null {
    if (!token) return null;
    const hash = hashToken(token);
    const row = this.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash) as Row | undefined;
    if (!row) return null;
    const nowMs = this.now().getTime();
    if (Date.parse(String(row.expires_at)) <= nowMs || Date.parse(String(row.last_seen_at)) + SESSION_IDLE_MS <= nowMs) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    const user = this.getUser(String(row.user_id));
    if (!user) return null;
    if (nowMs - Date.parse(String(row.last_seen_at)) > 60_000) this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(this.at(), hash);
    let companyId = row.company_id ? String(row.company_id) : null;
    let role = companyId ? this.roleIn(companyId, user.id) : null;
    if (!role) {
      // Removed from the active company (or never had one): fall back to another membership.
      const first = this.memberships(user.id)[0];
      companyId = first?.company.id ?? null;
      role = first?.role ?? null;
      this.db.prepare('UPDATE sessions SET company_id = ? WHERE token_hash = ?').run(companyId, hash);
    }
    return { kind: 'user', user, company: companyId ? this.getCompany(companyId) : null, role };
  }

  switchCompany(token: string, companyId: string): void {
    const principal = this.resolveSession(token);
    if (!principal || !this.roleIn(companyId, principal.user.id)) throw new AccountError(404, 'Company not found.');
    this.db.prepare('UPDATE sessions SET company_id = ? WHERE token_hash = ?').run(companyId, hashToken(token));
  }

  endSession(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  // ---------- invitations ----------

  invite(companyId: string, actorRole: Role, input: { email: unknown; role: unknown }, actor: string): { invitation: InvitationInfo; token: string } {
    const email = normalizeEmail(input.email);
    if (!isRole(input.role)) throw new AccountError(400, 'Choose a role.');
    if (input.role === 'owner' && actorRole !== 'owner') throw new AccountError(403, 'Only an owner can invite another owner.');
    const existing = this.findUserByEmail(email);
    if (existing && this.roleIn(companyId, existing.id)) throw new AccountError(409, 'This person is already a member.');
    // A new invitation for the same email replaces an open one.
    this.db.prepare('UPDATE invitations SET revoked_at = ? WHERE company_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL').run(this.at(), companyId, email);
    const token = newToken();
    const id = shortId('inv');
    this.db
      .prepare('INSERT INTO invitations (id, token_hash, company_id, email, role, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, hashToken(token), companyId, email, input.role, actor, this.at(), this.at(INVITE_MS));
    this.audit(companyId, actor, 'member.invited', email, { role: input.role, invitation: id });
    return { invitation: this.invitationById(id)!, token };
  }

  private invitationStatus(row: Row): InvitationInfo['status'] {
    if (row.accepted_at) return 'accepted';
    if (row.revoked_at) return 'revoked';
    if (Date.parse(String(row.expires_at)) <= this.now().getTime()) return 'expired';
    return 'pending';
  }

  private toInvitation(row: Row): InvitationInfo {
    return {
      id: String(row.id),
      email: String(row.email),
      role: row.role as Role,
      invitedBy: String(row.invited_by),
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      status: this.invitationStatus(row),
    };
  }

  private invitationById(id: string): InvitationInfo | null {
    const row = this.db.prepare('SELECT * FROM invitations WHERE id = ?').get(id) as Row | undefined;
    return row ? this.toInvitation(row) : null;
  }

  invitations(companyId: string): InvitationInfo[] {
    return (this.db.prepare('SELECT * FROM invitations WHERE company_id = ? ORDER BY created_at DESC LIMIT 200').all(companyId) as Row[]).map((r) => this.toInvitation(r));
  }

  revokeInvitation(companyId: string, id: string, actor: string): void {
    const result = this.db.prepare('UPDATE invitations SET revoked_at = ? WHERE id = ? AND company_id = ? AND accepted_at IS NULL AND revoked_at IS NULL').run(this.at(), id, companyId);
    if (result.changes === 0) throw new AccountError(404, 'No open invitation with this id.');
    this.audit(companyId, actor, 'invitation.revoked', id, {});
  }

  /** What the invitation page shows before anyone signs in; the same answer for unknown, used, revoked and expired links. */
  lookupInvitation(token: string): { company: Company; email: string; role: Role; invitedBy: string; expiresAt: string; accountExists: boolean } | null {
    const row = this.db.prepare('SELECT * FROM invitations WHERE token_hash = ?').get(hashToken(token)) as Row | undefined;
    if (!row || this.invitationStatus(row) !== 'pending') return null;
    const company = this.getCompany(String(row.company_id));
    if (!company) return null;
    return { company, email: String(row.email), role: row.role as Role, invitedBy: String(row.invited_by), expiresAt: String(row.expires_at), accountExists: Boolean(this.findUserByEmail(String(row.email))) };
  }

  /**
   * Consumes the invitation exactly once (the UPDATE only succeeds while it is still open), then
   * adds the membership. An existing account must be the signed-in person with the invited email;
   * otherwise a new account is created with the invited email, never another one.
   */
  async acceptInvitation(token: string, input: { signedIn?: User | null; name?: unknown; password?: unknown }): Promise<{ user: User; company: Company }> {
    const info = this.lookupInvitation(token);
    if (!info) throw new AccountError(404, 'This invitation link is not valid any more. Ask for a new one.');
    let user = this.findUserByEmail(info.email);
    if (user) {
      if (!input.signedIn || input.signedIn.id !== user.id) throw new AccountError(403, `Sign in as ${info.email} to accept this invitation.`);
    } else {
      checkPassword(input.password, info.email);
      cleanName(input.name);
    }
    const consumed = this.db
      .prepare('UPDATE invitations SET accepted_at = ? WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?')
      .run(this.at(), hashToken(token), this.at());
    if (consumed.changes !== 1) throw new AccountError(404, 'This invitation link is not valid any more. Ask for a new one.');
    user ??= await this.createUser({ email: info.email, name: input.name, password: input.password });
    this.addMember(info.company.id, user.id, info.role);
    this.audit(info.company.id, labelOf(user), 'member.joined', user.id, { email: user.email, role: info.role });
    return { user, company: info.company };
  }

  // ---------- API keys ----------

  createKey(companyId: string, input: { name: unknown; role: unknown; days?: unknown }, actor: string, runId?: string, expiresAt?: string): { key: ApiKeyInfo; token: string } {
    const name = cleanName(input.name, 'key name');
    if (!isRole(input.role) || !KEY_ROLES.includes(input.role)) throw new AccountError(400, 'A key can be a designer, an operator or a viewer.');
    const days = input.days === undefined || input.days === null ? null : Number(input.days);
    if (days !== null && (!Number.isFinite(days) || days < 1 || days > 365)) throw new AccountError(400, 'A key lasts 1 to 365 days, or until revoked.');
    const token = `atr_${newToken()}`;
    const id = shortId('key');
    const expires = expiresAt ?? (days ? this.at(days * 86_400_000) : null);
    this.db
      .prepare('INSERT INTO api_keys (id, token_hash, company_id, name, role, created_by, created_at, expires_at, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, hashToken(token), companyId, name, input.role, actor, this.at(), expires, runId ?? null);
    if (!runId) this.audit(companyId, actor, 'apikey.created', id, { name, role: input.role, expiresAt: expires });
    return { key: this.keys(companyId, true).find((k) => k.id === id)!, token };
  }

  keys(companyId: string, includeRunKeys = false): ApiKeyInfo[] {
    const rows = this.db
      .prepare(`SELECT * FROM api_keys WHERE company_id = ? ${includeRunKeys ? '' : 'AND run_id IS NULL'} ORDER BY created_at DESC`)
      .all(companyId) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      role: r.role as Role,
      createdBy: String(r.created_by),
      createdAt: String(r.created_at),
      expiresAt: r.expires_at ? String(r.expires_at) : null,
      lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
      revoked: Boolean(r.revoked_at),
    }));
  }

  revokeKey(companyId: string, id: string, actor: string): void {
    const result = this.db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND company_id = ? AND revoked_at IS NULL').run(this.at(), id, companyId);
    if (result.changes === 0) throw new AccountError(404, 'No active key with this id.');
    this.audit(companyId, actor, 'apikey.revoked', id, {});
  }

  revokeRunKeys(runId: string): void {
    this.db.prepare('UPDATE api_keys SET revoked_at = ? WHERE run_id = ? AND revoked_at IS NULL').run(this.at(), runId);
  }

  resolveKey(token: string | undefined): KeyPrincipal | null {
    if (!token || !token.startsWith('atr_')) return null;
    const hash = hashToken(token);
    const row = this.db.prepare('SELECT * FROM api_keys WHERE token_hash = ?').get(hash) as Row | undefined;
    if (!row || row.revoked_at) return null;
    if (row.expires_at && Date.parse(String(row.expires_at)) <= this.now().getTime()) return null;
    const company = this.getCompany(String(row.company_id));
    if (!company || !isRole(row.role)) return null;
    this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE token_hash = ?').run(this.at(), hash);
    return { kind: 'key', keyId: String(row.id), name: String(row.name), company, role: row.role };
  }

  // ---------- share links ----------

  createShare(companyId: string, projectId: string, revision: number, daysInput: unknown, actor: string): { share: ShareInfo; token: string } {
    const days = daysInput === undefined ? 7 : Number(daysInput);
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new AccountError(400, 'A share link lasts 1 to 30 days.');
    const token = newToken();
    const id = shortId('sh');
    this.db
      .prepare('INSERT INTO share_links (id, token_hash, company_id, project_id, revision, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, hashToken(token), companyId, projectId, revision, actor, this.at(), this.at(days * 86_400_000));
    this.audit(companyId, actor, 'share.created', projectId, { share: id, revision, days });
    return { share: this.shares(companyId, projectId).find((s) => s.id === id)!, token };
  }

  shares(companyId: string, projectId: string): ShareInfo[] {
    const rows = this.db.prepare('SELECT * FROM share_links WHERE company_id = ? AND project_id = ? ORDER BY created_at DESC').all(companyId, projectId) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      revision: Number(r.revision),
      createdBy: String(r.created_by),
      createdAt: String(r.created_at),
      expiresAt: String(r.expires_at),
      revoked: Boolean(r.revoked_at),
      openCount: Number(r.open_count),
      lastOpenedAt: r.last_opened_at ? String(r.last_opened_at) : null,
    }));
  }

  revokeShare(companyId: string, id: string, actor: string): void {
    const row = this.db.prepare('SELECT project_id FROM share_links WHERE id = ? AND company_id = ? AND revoked_at IS NULL').get(id, companyId) as Row | undefined;
    if (!row) throw new AccountError(404, 'No active share link with this id.');
    this.db.prepare('UPDATE share_links SET revoked_at = ? WHERE id = ?').run(this.at(), id);
    this.audit(companyId, actor, 'share.revoked', String(row.project_id), { share: id });
  }

  /** The pinned revision a valid link opens; the same null for unknown, revoked and expired links. */
  openShare(token: string): { company: Company; projectId: string; revision: number; expiresAt: string } | null {
    const hash = hashToken(token);
    const row = this.db.prepare('SELECT * FROM share_links WHERE token_hash = ?').get(hash) as Row | undefined;
    if (!row || row.revoked_at || Date.parse(String(row.expires_at)) <= this.now().getTime()) return null;
    const company = this.getCompany(String(row.company_id));
    if (!company) return null;
    this.db.prepare('UPDATE share_links SET open_count = open_count + 1, last_opened_at = ? WHERE token_hash = ?').run(this.at(), hash);
    return { company, projectId: String(row.project_id), revision: Number(row.revision), expiresAt: String(row.expires_at) };
  }

  // ---------- approvals ----------

  approve(companyId: string, projectId: string, revision: number, user: User, noteInput: unknown): Approval {
    const note = typeof noteInput === 'string' ? noteInput.trim().slice(0, 500) : '';
    const at = this.at();
    this.db
      .prepare('INSERT INTO approvals (company_id, project_id, revision, user_id, approved_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, revision) DO UPDATE SET user_id = excluded.user_id, approved_by = excluded.approved_by, note = excluded.note, created_at = excluded.created_at')
      .run(companyId, projectId, revision, user.id, user.name, note, at);
    this.audit(companyId, labelOf(user), 'revision.approved', projectId, { revision, note });
    return { projectId, revision, approvedBy: user.name, note, createdAt: at };
  }

  approvals(companyId: string, projectId: string): Approval[] {
    const rows = this.db.prepare('SELECT * FROM approvals WHERE company_id = ? AND project_id = ? ORDER BY revision DESC').all(companyId, projectId) as Row[];
    return rows.map((r) => ({ projectId: String(r.project_id), revision: Number(r.revision), approvedBy: String(r.approved_by), note: String(r.note), createdAt: String(r.created_at) }));
  }

  /** The latest approved revision of each project of a company. */
  latestApprovals(companyId: string): Map<string, Approval> {
    const rows = this.db
      .prepare('SELECT * FROM approvals a WHERE company_id = ? AND revision = (SELECT MAX(revision) FROM approvals b WHERE b.project_id = a.project_id)')
      .all(companyId) as Row[];
    return new Map(rows.map((r) => [String(r.project_id), { projectId: String(r.project_id), revision: Number(r.revision), approvedBy: String(r.approved_by), note: String(r.note), createdAt: String(r.created_at) }]));
  }

  // ---------- audit ----------

  /**
   * Append one event to the company's chain: each row carries the hash of the previous row of the
   * same company, so editing or removing a row by hand breaks every hash after it.
   */
  audit(companyId: string | null, actor: string, action: string, target: string, detail: Record<string, unknown>): void {
    const at = this.at();
    const last = this.db
      .prepare(companyId === null ? 'SELECT hash FROM audit_events WHERE company_id IS NULL ORDER BY seq DESC LIMIT 1' : 'SELECT hash FROM audit_events WHERE company_id = ? ORDER BY seq DESC LIMIT 1')
      .get(...(companyId === null ? [] : [companyId])) as { hash: string } | undefined;
    const prev = last?.hash ?? GENESIS;
    const body = JSON.stringify(detail);
    const hash = chainHash(prev, companyId, actor, action, target, body, at);
    this.db
      .prepare('INSERT INTO audit_events (company_id, actor, action, target, detail, at, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(companyId, actor, action, target, body, at, prev, hash);
  }

  /** Sign-in events belong to every company the person is a member of. */
  private auditForUser(userId: string, actor: string, action: string, detail: Record<string, unknown>): void {
    const companies = this.memberships(userId).map((m) => m.company.id);
    if (companies.length === 0) this.audit(null, actor, action, userId, detail);
    for (const id of companies) this.audit(id, actor, action, userId, detail);
  }

  recordSignIn(user: User, action: 'user.signed_in' | 'user.signed_out'): void {
    this.auditForUser(user.id, labelOf(user), action, {});
  }

  auditLog(companyId: string, limit = 200): AuditEvent[] {
    const rows = this.db.prepare('SELECT * FROM audit_events WHERE company_id = ? ORDER BY seq DESC LIMIT ?').all(companyId, Math.min(1000, limit)) as Row[];
    return rows.map((r) => ({ seq: Number(r.seq), actor: String(r.actor), action: String(r.action), target: String(r.target), detail: JSON.parse(String(r.detail)) as Record<string, unknown>, at: String(r.at) }));
  }

  /** Recomputes the company's chain; false when any row was altered, removed or reordered. */
  verifyAudit(companyId: string): { valid: boolean; events: number; brokenAt?: number } {
    const rows = this.db.prepare('SELECT * FROM audit_events WHERE company_id = ? ORDER BY seq').all(companyId) as Row[];
    let prev = GENESIS;
    for (const r of rows) {
      const expected = chainHash(prev, companyId, String(r.actor), String(r.action), String(r.target), String(r.detail), String(r.at));
      if (r.prev_hash !== prev || r.hash !== expected) return { valid: false, events: rows.length, brokenAt: Number(r.seq) };
      prev = String(r.hash);
    }
    return { valid: true, events: rows.length };
  }
}

function chainHash(prev: string, companyId: string | null, actor: string, action: string, target: string, detail: string, at: string): string {
  return createHash('sha256').update(JSON.stringify([prev, companyId, actor, action, target, detail, at])).digest('hex');
}

/** How a person appears in histories and the audit log. */
export const labelOf = (user: User) => `${user.name} <${user.email}>`;
