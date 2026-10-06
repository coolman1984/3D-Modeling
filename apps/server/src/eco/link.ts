import type { PlantTree } from '@space-planner/starter';
import { UUID_PATTERN } from './ids.js';
import { openSecret, sealSecrets } from './secret.js';
import type { Store } from './store-port.js';

/**
 * The link to GMES: the settings (`eco.company_id`, `eco.gmes_url`, `eco.gmes_key`, plus the read key of the live view), the plant
 * tree last imported and the sender's sequence. Nothing here calls out by itself: `routes.ts` calls GMES only when the person
 * presses a button.
 */

export interface EcoSaved {
  companyId: string;
  gmesUrl: string;
  node: string;
  /** Sealed (see secret.ts): the key that writes to GMES's inbox and reads its plant export. */
  gmesKey: string;
  /** Sealed: the read-only key of the live view; it travels to the browser page, so it must be able to do nothing else. */
  liveKey: string;
  seq: number;
}

const EMPTY: EcoSaved = { companyId: '', gmesUrl: '', node: 'planner-1', gmesKey: '', liveKey: '', seq: 0 };

export interface StoredPlant { readonly fetchedAt: string; readonly source: 'file' | 'gmes'; readonly nodes: PlantTree }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function loadEco(store: Store): EcoSaved {
  const saved = store.getSetting<Partial<EcoSaved>>('eco') ?? {};
  return {
    companyId: typeof saved.companyId === 'string' ? saved.companyId : EMPTY.companyId,
    gmesUrl: typeof saved.gmesUrl === 'string' ? saved.gmesUrl : EMPTY.gmesUrl,
    node: typeof saved.node === 'string' && saved.node ? saved.node : EMPTY.node,
    gmesKey: typeof saved.gmesKey === 'string' ? saved.gmesKey : EMPTY.gmesKey,
    liveKey: typeof saved.liveKey === 'string' ? saved.liveKey : EMPTY.liveKey,
    seq: typeof saved.seq === 'number' && Number.isInteger(saved.seq) && saved.seq >= 0 ? saved.seq : 0,
  };
}

/** What the browser is told: never a key, only whether one is stored. */
export function publicEco(eco: EcoSaved, plant: StoredPlant | null) {
  return {
    company_id: eco.companyId, gmes_url: eco.gmesUrl, node: eco.node, has_key: eco.gmesKey !== '', has_live_key: eco.liveKey !== '',
    plant: plant ? { count: plant.nodes.length, fetched_at: plant.fetchedAt, source: plant.source } : null,
  };
}

/** Why a settings change cannot be saved, or an empty list. */
export function ecoProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['settings must be an object'];
  const problems: string[] = [];
  const { company_id: company, gmes_url: url, node, gmes_key: key, live_key: live } = body;
  if (company !== undefined && (typeof company !== 'string' || (company !== '' && !UUID_PATTERN.test(company.trim().toLowerCase())))) problems.push('company_id must be the company id from pairing (a UUID)');
  if (url !== undefined) {
    if (typeof url !== 'string') problems.push('gmes_url must be text');
    else if (url.trim() !== '') {
      try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') problems.push('gmes_url must start with http:// or https://');
      } catch {
        problems.push('gmes_url is not an address');
      }
    }
  }
  if (node !== undefined && (typeof node !== 'string' || !/^[A-Za-z0-9._-]{1,40}$/.test(node))) problems.push('node must be 1-40 letters, digits, dots, dashes or underscores');
  for (const [name, value] of [['gmes_key', key], ['live_key', live]] as const) if (value !== undefined && (typeof value !== 'string' || value.length > 500)) problems.push(`${name} must be text`);
  return problems;
}

const keeps = (value: unknown): boolean => value === undefined || value === '' || (typeof value === 'string' && value.startsWith('••'));

/** Save settings; an empty or masked key keeps the stored one. Keys are sealed before they are stored. */
export function saveEco(store: Store, body: Record<string, unknown>): EcoSaved {
  const current = loadEco(store);
  // both keys are sealed in one operating-system call: starting it takes over a second
  const [gmesKey, liveKey] = sealSecrets([keeps(body.gmes_key) ? '' : (body.gmes_key as string).trim(), keeps(body.live_key) ? '' : (body.live_key as string).trim()]);
  const next: EcoSaved = {
    ...current,
    ...(typeof body.company_id === 'string' ? { companyId: body.company_id.trim().toLowerCase() } : {}),
    ...(typeof body.gmes_url === 'string' ? { gmesUrl: body.gmes_url.trim().replace(/\/+$/, '') } : {}),
    ...(typeof body.node === 'string' ? { node: body.node } : {}),
    gmesKey: gmesKey || current.gmesKey,
    liveKey: liveKey || current.liveKey,
  };
  store.setSetting('eco', next);
  return next;
}

export const loadPlant = (store: Store): StoredPlant | null => store.getSetting<StoredPlant>('eco.plant') ?? null;
export const savePlant = (store: Store, plant: StoredPlant): void => store.setSetting('eco.plant', plant);

/** The next sender sequence number (kept across restarts, so it only ever goes up). */
export function takeSequence(store: Store): number {
  const eco = loadEco(store);
  const seq = eco.seq + 1;
  store.setSetting('eco', { ...eco, seq });
  return seq;
}

export const keyOf = (sealed: string): string => openSecret(sealed);
