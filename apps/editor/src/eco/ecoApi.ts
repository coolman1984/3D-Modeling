import type { PlantTree } from '@space-planner/starter';

/** What the page knows about the link; a key is never sent back, only whether one is stored. */
export interface EcoStatus {
  company_id: string;
  gmes_url: string;
  node: string;
  has_key: boolean;
  has_live_key: boolean;
  plant: { count: number; fetched_at: string; source: 'file' | 'gmes' } | null;
}

export interface StoredPlantView { fetchedAt: string | null; source: 'file' | 'gmes' | null; nodes: PlantTree }
export interface SendResult { ok: boolean; result: string; code?: string; message?: string; version: number; event_id: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export const ecoApi = {
  status: () => call<EcoStatus>('/api/eco'),
  save: (settings: { company_id?: string; gmes_url?: string; node?: string; gmes_key?: string; live_key?: string }) => call<EcoStatus>('/api/eco', { method: 'PUT', body: JSON.stringify(settings) }),
  plant: () => call<StoredPlantView>('/api/eco/plant'),
  importPlant: (text: string) => call<{ imported: number }>('/api/eco/plant/import', { method: 'POST', body: JSON.stringify({ text }) }),
  fetchPlant: () => call<{ imported: number }>('/api/eco/plant/fetch', { method: 'POST', body: '{}' }),
  snapshot: (projectId: string) => call<unknown>(`/api/projects/${projectId}/eco-snapshot`),
  send: (projectId: string) => call<SendResult>(`/api/projects/${projectId}/eco-send`, { method: 'POST', body: '{}' }),
  liveConfig: () => call<{ gmes_url: string; key: string }>('/api/eco/live-config'),
};
