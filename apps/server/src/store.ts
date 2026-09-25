import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  apply,
  deserializeProject,
  serializeProject,
  validateProject,
  type Command,
  type Project,
  type Rejection,
} from '@space-planner/core';

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly itemCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RevisionInfo {
  readonly revision: number;
  readonly actor: string;
  readonly summary: string;
  readonly commandCount: number;
  readonly createdAt: string;
}

export interface AgentRun {
  readonly id: string;
  readonly projectId: string;
  readonly agent: string;
  readonly prompt: string;
  readonly status: 'running' | 'done' | 'failed' | 'stopped';
  readonly log: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export type ApplyResult =
  | { readonly ok: true; readonly project: Project }
  | { readonly ok: false; readonly status: 404 }
  | { readonly ok: false; readonly status: 409; readonly project: Project }
  | { readonly ok: false; readonly status: 422; readonly rejection: Rejection };

/** Change notifications for live views. */
export interface StoreEvents {
  project: [{ projectId: string; revision: number; actor: string; summary: string }];
  projects: [];
  run: [{ runId: string; projectId: string; status: AgentRun['status']; line?: string }];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL,
  item_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  actor TEXT NOT NULL,
  summary TEXT NOT NULL,
  commands TEXT NOT NULL,
  command_count INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, revision)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  log TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
`;

const MAX_LOG = 200_000;

/**
 * The local database: projects, every revision (who changed what, with a full snapshot),
 * settings and agent runs. All project changes go through core commands here, so people,
 * coding agents and API agents share one path and one history.
 */
export class Store extends EventEmitter<StoreEvents> {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    super();
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    // Runs that were active when the app last stopped cannot still be running.
    this.db.prepare("UPDATE agent_runs SET status = 'stopped', ended_at = ? WHERE status = 'running'").run(now());
  }

  close(): void {
    this.db.close();
  }

  listProjects(): ProjectSummary[] {
    const rows = this.db
      .prepare('SELECT id, name, revision, item_count, created_at, updated_at FROM projects ORDER BY updated_at DESC')
      .all() as Array<Record<string, string | number>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      revision: Number(r.revision),
      itemCount: Number(r.item_count),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  /** Store a new project; its id is replaced by a fresh one. */
  createProject(project: Project, actor: string, summary = 'Created the project'): Project {
    const id = `p-${randomUUID().slice(0, 8)}`;
    const fresh: Project = { ...project, id, revision: 0 };
    const problems = validateProject(fresh);
    if (problems.length > 0) throw new Error(`invalid project: ${problems.map((p) => p.path).join(', ')}`);
    const at = now();
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO projects (id, name, revision, item_count, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)')
        .run(id, fresh.name, Object.keys(fresh.items).length, at, at);
      this.insertRevision(fresh, actor, summary, [], at);
    });
    this.emit('projects');
    return fresh;
  }

  getProject(id: string): Project | null {
    const row = this.db
      .prepare('SELECT snapshot FROM revisions WHERE project_id = ? ORDER BY revision DESC LIMIT 1')
      .get(id) as { snapshot: string } | undefined;
    return row ? this.parse(row.snapshot) : null;
  }

  getRevision(id: string, revision: number): Project | null {
    const row = this.db
      .prepare('SELECT snapshot FROM revisions WHERE project_id = ? AND revision = ?')
      .get(id, revision) as { snapshot: string } | undefined;
    return row ? this.parse(row.snapshot) : null;
  }

  /**
   * Apply commands as one revision. With `baseRevision`, refuse (409) when someone else
   * changed the project in the meantime, so an editor never overwrites an agent or vice versa.
   */
  applyCommands(
    id: string,
    commands: readonly Command[],
    options: { actor: string; summary?: string; baseRevision?: number },
  ): ApplyResult {
    const current = this.getProject(id);
    if (!current) return { ok: false, status: 404 };
    if (options.baseRevision !== undefined && options.baseRevision !== current.revision) {
      return { ok: false, status: 409, project: current };
    }
    const command: Command = commands.length === 1 ? commands[0]! : { type: 'batch', commands };
    const outcome = apply(current, command);
    if (!outcome.ok) return { ok: false, status: 422, rejection: outcome.rejection };
    const summary = options.summary?.trim() || describeCommands(commands);
    this.commit(outcome.project, options.actor, summary, commands);
    return { ok: true, project: outcome.project };
  }

  /** Bring back an earlier revision as a new revision; nothing is erased. */
  restore(id: string, revision: number, actor: string): ApplyResult {
    const current = this.getProject(id);
    const old = this.getRevision(id, revision);
    if (!current || !old) return { ok: false, status: 404 };
    const restored: Project = { ...old, revision: current.revision + 1 };
    this.commit(restored, actor, `Restored revision ${revision}`, []);
    return { ok: true, project: restored };
  }

  history(id: string, limit = 100): RevisionInfo[] {
    const rows = this.db
      .prepare(
        'SELECT revision, actor, summary, command_count, created_at FROM revisions WHERE project_id = ? ORDER BY revision DESC LIMIT ?',
      )
      .all(id, limit) as Array<Record<string, string | number>>;
    return rows.map((r) => ({
      revision: Number(r.revision),
      actor: String(r.actor),
      summary: String(r.summary),
      commandCount: Number(r.command_count),
      createdAt: String(r.created_at),
    }));
  }

  deleteProject(id: string): boolean {
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (result.changes > 0) this.emit('projects');
    return result.changes > 0;
  }

  duplicateProject(id: string, actor: string): Project | null {
    const source = this.getProject(id);
    if (!source) return null;
    return this.createProject({ ...source, name: `${source.name} (copy)` }, actor, `Copied from ${source.name}`);
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  createRun(projectId: string, agent: string, prompt: string): AgentRun {
    const run: AgentRun = {
      id: `run-${randomUUID().slice(0, 8)}`,
      projectId,
      agent,
      prompt,
      status: 'running',
      log: '',
      startedAt: now(),
      endedAt: null,
    };
    this.db
      .prepare('INSERT INTO agent_runs (id, project_id, agent, prompt, status, log, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(run.id, projectId, agent, prompt, run.status, '', run.startedAt);
    this.emit('run', { runId: run.id, projectId, status: 'running' });
    return run;
  }

  appendRunLog(runId: string, line: string): void {
    const run = this.getRun(runId);
    if (!run) return;
    const log = (run.log + line + '\n').slice(-MAX_LOG);
    this.db.prepare('UPDATE agent_runs SET log = ? WHERE id = ?').run(log, runId);
    this.emit('run', { runId, projectId: run.projectId, status: run.status, line });
  }

  finishRun(runId: string, status: Exclude<AgentRun['status'], 'running'>): void {
    const run = this.getRun(runId);
    if (!run || run.status !== 'running') return;
    this.db.prepare('UPDATE agent_runs SET status = ?, ended_at = ? WHERE id = ?').run(status, now(), runId);
    this.emit('run', { runId, projectId: run.projectId, status });
  }

  getRun(runId: string): AgentRun | null {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as Record<string, string> | undefined;
    return row ? toRun(row) : null;
  }

  listRuns(projectId: string, limit = 20): AgentRun[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(projectId, limit) as Array<Record<string, string>>;
    return rows.map(toRun);
  }

  private commit(project: Project, actor: string, summary: string, commands: readonly Command[]): void {
    const at = now();
    this.transaction(() => {
      this.insertRevision(project, actor, summary, commands, at);
      this.db
        .prepare('UPDATE projects SET name = ?, revision = ?, item_count = ?, updated_at = ? WHERE id = ?')
        .run(project.name, project.revision, Object.keys(project.items).length, at, project.id);
    });
    this.emit('project', { projectId: project.id, revision: project.revision, actor, summary });
    this.emit('projects');
  }

  private insertRevision(project: Project, actor: string, summary: string, commands: readonly Command[], at: string): void {
    this.db
      .prepare(
        'INSERT INTO revisions (project_id, revision, actor, summary, commands, command_count, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(project.id, project.revision, actor, summary, JSON.stringify(commands), commands.length, serializeProject(project), at);
  }

  private parse(snapshot: string): Project {
    const result = deserializeProject(snapshot);
    if (!result.ok) throw new Error(`stored project is invalid: ${result.problems[0]?.path ?? ''}`);
    return result.project;
  }

  private transaction(work: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function now(): string {
  return new Date().toISOString();
}

function toRun(row: Record<string, string>): AgentRun {
  return {
    id: row.id!,
    projectId: row.project_id!,
    agent: row.agent!,
    prompt: row.prompt!,
    status: row.status as AgentRun['status'],
    log: row.log!,
    startedAt: row.started_at!,
    endedAt: row.ended_at ?? null,
  };
}

const COMMAND_WORDS: Record<string, string> = {
  'item.add': 'Added',
  'item.move': 'Moved',
  'item.rotate': 'Rotated',
  'item.elevate': 'Raised',
  'item.remove': 'Removed',
  'item.lock': 'Locked',
  'catalog.define': 'Item type saved',
  'catalog.remove': 'Item type removed',
  'space.set': 'Room changed',
  'project.rename': 'Renamed',
  batch: 'Several changes',
};

/** A short summary such as "Added ×3, Moved". */
export function describeCommands(commands: readonly Command[]): string {
  const counts = new Map<string, number>();
  const walk = (c: Command) => {
    if (c.type === 'batch') c.commands.forEach(walk);
    else counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  };
  commands.forEach(walk);
  return [...counts].map(([type, n]) => `${COMMAND_WORDS[type] ?? type}${n > 1 ? ` ×${n}` : ''}`).join(', ') || 'Changed';
}
