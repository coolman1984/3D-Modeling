import { ecoProblems, keyOf, loadEco, loadPlant, publicEco, savePlant, saveEco, takeSequence } from './link.js';
import { parsePlantExport, PlantImportError } from './plant.js';
import { checkedEnvelope } from './snapshot.js';
import type { Store } from './store-port.js';

/**
 * The GMES link as HTTP routes (plan 40-SPACE-PLANNER WP-S1, S2, S3). Calls to GMES happen only inside the two routes the person
 * triggers with a button ("Fetch from GMES", "Send to GMES"), from this server, with the stored key. Everything else works offline.
 */

export class EcoError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface EcoDeps {
  readonly store: Store;
  readonly fetch?: FetchLike;
  /** ISO time now; the tests pass a fixed one. */
  readonly now?: () => string;
}

export interface EcoRoute {
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly pattern: string;
  readonly handler: (input: { body: Record<string, unknown>; params: string[] }) => Promise<{ status?: number; body: unknown }> | { status?: number; body: unknown };
}

const TIMEOUT_MS = 10_000;

export function ecoRoutes(deps: EcoDeps): EcoRoute[] {
  const { store } = deps;
  const call: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => new Date().toISOString());

  const configured = () => {
    const eco = loadEco(store);
    if (eco.gmesUrl === '') throw new EcoError(400, 'Set the GMES address in the link settings first.');
    if (eco.gmesKey === '') throw new EcoError(400, 'Set the GMES key in the link settings first.');
    return eco;
  };

  const talk = async (url: string, key: string, init: { method?: string; body?: string } = {}) => {
    let response;
    try {
      response = await call(url, { ...init, headers: { 'x-eco-key': key, ...(init.body ? { 'content-type': 'application/json' } : {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new EcoError(502, `GMES did not answer at ${url.replace(/^(https?:\/\/[^/]+).*$/, '$1')}. Check the address and that GMES is running.`);
    }
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = undefined;
    }
    if (response.status === 401 || response.status === 403) throw new EcoError(502, 'GMES refused the key. Check the key and that it may do this.');
    if (!response.ok) {
      const message = (json as { error?: { message?: string } } | undefined)?.error?.message;
      throw new EcoError(502, `GMES answered ${response.status}${message ? `: ${message}` : ''}.`);
    }
    return json;
  };

  const importPlant = (input: unknown, source: 'file' | 'gmes') => {
    let parsed;
    try {
      parsed = parsePlantExport(input);
    } catch (error) {
      if (error instanceof PlantImportError) throw new EcoError(422, error.message);
      throw error;
    }
    const company = loadEco(store).companyId;
    if (parsed.companyId && company && parsed.companyId.toLowerCase() !== company) {
      throw new EcoError(422, 'This plant export belongs to another company than the one set in the link settings. Nothing was imported.');
    }
    const stored = { fetchedAt: now(), source, nodes: parsed.nodes } as const;
    savePlant(store, stored);
    return { imported: parsed.nodes.length, fetched_at: stored.fetchedAt, source };
  };

  const projectOr404 = (id: string) => {
    const project = store.getProject(id);
    if (!project) throw new EcoError(404, 'project not found');
    return project;
  };

  const snapshotFor = (id: string, seq: number) => {
    const eco = loadEco(store);
    if (eco.companyId === '') throw new EcoError(400, 'Set the company id (from pairing) in the link settings first.');
    const checked = checkedEnvelope(projectOr404(id), { companyId: eco.companyId, node: eco.node, now: now(), seq });
    if (!checked.ok) throw new EcoError(422, `The layout does not satisfy the contract: ${checked.problems.slice(0, 5).join('; ')}.`);
    return checked.envelope;
  };

  return [
    { method: 'GET', pattern: '/api/eco', handler: () => ({ body: publicEco(loadEco(store), loadPlant(store)) }) },

    {
      method: 'PUT', pattern: '/api/eco',
      handler: ({ body }) => {
        const problems = ecoProblems(body);
        if (problems.length) throw new EcoError(400, `link settings not saved: ${problems.join('; ')}`);
        return { body: publicEco(saveEco(store, body), loadPlant(store)) };
      },
    },

    { method: 'GET', pattern: '/api/eco/plant', handler: () => ({ body: loadPlant(store) ?? { fetchedAt: null, source: null, nodes: [] } }) },

    // The plant export as a file the person picked: the text is checked, and a bad file changes nothing.
    { method: 'POST', pattern: '/api/eco/plant/import', handler: ({ body }) => ({ status: 201, body: importPlant(body.text ?? body.nodes ?? body, 'file') }) },

    // "Fetch from GMES": a GET with the stored key, on the person's command.
    {
      method: 'POST', pattern: '/api/eco/plant/fetch',
      handler: async () => {
        const eco = configured();
        const json = await talk(`${eco.gmesUrl}/api/plant/export`, keyOf(eco.gmesKey));
        return { status: 201, body: importPlant(json, 'gmes') };
      },
    },

    // The snapshot as a file: what "Download snapshot" saves. It does not use up a sequence number.
    { method: 'GET', pattern: '/api/projects/:id/eco-snapshot', handler: ({ params }) => ({ body: snapshotFor(params[0]!, loadEco(store).seq + 1) }) },

    // "Send to GMES": the same envelope, posted to its inbox with the stored key.
    {
      method: 'POST', pattern: '/api/projects/:id/eco-send',
      handler: async ({ params }) => {
        const eco = configured();
        const envelope = snapshotFor(params[0]!, takeSequence(store));
        const json = (await talk(`${eco.gmesUrl}/eco/v1/inbox`, keyOf(eco.gmesKey), { method: 'POST', body: JSON.stringify({ events: [envelope] }) })) as { results?: Array<{ result?: string; code?: string; message?: string }> } | undefined;
        const first = json?.results?.[0];
        if (!first?.result) throw new EcoError(502, 'GMES answered without a result for the layout.');
        return { body: { ok: first.result !== 'rejected', result: first.result, ...(first.code ? { code: first.code } : {}), ...(first.message ? { message: first.message } : {}), version: envelope.data.version, event_id: envelope.id } };
      },
    },

    // What the live page needs to open GMES's event stream from the browser: the read-only key (loopback only, like every route here).
    {
      method: 'GET', pattern: '/api/eco/live-config',
      handler: () => {
        const eco = loadEco(store);
        if (eco.gmesUrl === '' || eco.liveKey === '') throw new EcoError(400, 'Set the GMES address and the live (read-only) key in the link settings first.');
        return { body: { gmes_url: eco.gmesUrl, key: keyOf(eco.liveKey) } };
      },
    },
  ];
}
