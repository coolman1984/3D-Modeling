import type { Command, Project, Rejection } from '@space-planner/core';

export interface ProjectSummary {
  id: string;
  name: string;
  revision: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  variantOf: string | null;
}

export interface VariantRow {
  project: ProjectSummary;
  base: boolean;
  pack: string;
  errors: number;
  warnings: number;
  rulesFailed: number;
  rulesUnknown: number;
  figures: Array<{
    id: string;
    label: string;
    value?: number;
    unit: 'count' | 'percent' | 'square-metres' | 'grams' | 'ticks';
    better?: 'higher' | 'lower';
  }>;
}

export interface RevisionInfo {
  revision: number;
  actor: string;
  summary: string;
  commandCount: number;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  projectId: string;
  agent: string;
  prompt: string;
  status: 'running' | 'done' | 'failed' | 'stopped';
  log: string;
  startedAt: string;
  endedAt: string | null;
}

export interface AgentAvailability {
  id: string;
  label: string;
  kind: 'cli' | 'api';
  available: boolean;
  detail: string;
}

export interface Settings {
  agents: Record<string, { label: string; command: string[]; promptOnStdin: boolean }>;
  api: { provider: 'anthropic' | 'openai-compatible'; apiKey: string; model: string; baseUrl: string; hasKey?: boolean };
  timeoutMinutes: number;
}

export type CommandResult =
  | { ok: true; project: Project }
  | { ok: false; conflict: true; project: Project }
  | { ok: false; rejection: Rejection }
  | { ok: false; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && response.status !== 409 && response.status !== 422) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return body;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  listProjects: () => request<ProjectSummary[]>('/api/projects'),
  createProject: (body: { name: string; width_m?: number; depth_m?: number; ceiling_m?: number; activity?: string; container_type?: string; template?: 'demo' | 'warehouse-reference' | 'production-reference' | 'depot-reference' | 'restaurant-reference'; file?: string }) =>
    post<Project>('/api/projects', body),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  deleteProject: (id: string) => request<unknown>(`/api/projects/${id}`, { method: 'DELETE' }),
  duplicateProject: (id: string) => post<Project>(`/api/projects/${id}/duplicate`, {}),
  createVariant: (id: string, name: string) => post<Project>(`/api/projects/${id}/variants`, { name }),
  variants: (id: string) => request<VariantRow[]>(`/api/projects/${id}/variants`),
  adopt: (variantId: string) => post<Project>(`/api/projects/${variantId}/adopt`, {}),
  sendCommands: (id: string, commands: Command[], baseRevision: number) =>
    post<CommandResult>(`/api/projects/${id}/commands`, { commands, baseRevision, actor: 'human' }),
  history: (id: string) => request<RevisionInfo[]>(`/api/projects/${id}/history?limit=200`),
  revision: (id: string, revision: number) => request<Project>(`/api/projects/${id}/revisions/${revision}`),
  restore: (id: string, revision: number) => post<{ ok: boolean; project: Project }>(`/api/projects/${id}/restore`, { revision }),
  agents: () => request<AgentAvailability[]>('/api/agents'),
  runs: (id: string) => request<AgentRun[]>(`/api/projects/${id}/agent-runs`),
  startRun: (id: string, agent: string, prompt: string) => post<AgentRun>(`/api/projects/${id}/agent-runs`, { agent, prompt }),
  getRun: (runId: string) => request<AgentRun>(`/api/agent-runs/${runId}`),
  stopRun: (runId: string) => post<{ stopped: boolean }>(`/api/agent-runs/${runId}/stop`, {}),
  getSettings: () => request<Settings>('/api/settings'),
  saveSettings: (settings: Partial<Settings>) => request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(settings) }),
};

export interface LiveEvents {
  project?: (e: { projectId: string; revision: number; actor: string; summary: string }) => void;
  projects?: () => void;
  run?: (e: { runId: string; projectId: string; status: AgentRun['status']; line?: string }) => void;
  /** The connection opened or came back: anything that changed while it was closed was missed. */
  open?: () => void;
}

/** Subscribe to the server's live events; returns an unsubscribe function. */
export function subscribe(handlers: LiveEvents): () => void {
  const source = new EventSource('/api/events');
  const on = (name: keyof LiveEvents) =>
    source.addEventListener(name, (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as never;
      (handlers[name] as ((e: never) => void) | undefined)?.(data);
    });
  on('project');
  on('projects');
  on('run');
  source.addEventListener('open', () => handlers.open?.());
  return () => source.close();
}

/** Who made a change, in words. */
export function actorName(actor: string): string {
  if (actor === 'human') return 'You';
  if (actor === 'agent:claude-code') return 'Claude Code';
  if (actor === 'agent:codex') return 'Codex';
  if (actor.startsWith('agent:api:')) return `${actor.slice('agent:api:'.length)} API`;
  if (actor.startsWith('agent:')) return `Agent ${actor.slice('agent:'.length)}`;
  return actor;
}

/** True for changes made by an AI agent rather than a person. */
export const isAgent = (actor: string) => actor.startsWith('agent:');
