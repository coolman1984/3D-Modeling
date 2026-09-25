import type { Project } from '../model/types.js';
import { SCHEMA_VERSION } from '../model/types.js';
import { validateProject, type Problem } from '../model/validate.js';

/**
 * Upgrades from older schema versions, keyed by the version they upgrade FROM.
 * Each step takes raw JSON of version N and returns raw JSON of version N + 1.
 * Empty while only version 1 exists; add a step here whenever SCHEMA_VERSION goes up.
 */
export const MIGRATIONS: Readonly<Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>> = {};

/**
 * Canonical text form of a project: object keys sorted, two-space indent, trailing newline.
 * The same project always produces the same text, so saves diff cleanly and
 * save → open → save is byte-identical.
 */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(sortKeys(project), null, 2)}\n`;
}

/** Canonical JSON of any plain value (sorted keys, no undefined): equal data gives equal text. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, sortKeys(source[key])]),
    );
  }
  return value;
}

export type OpenResult =
  | { readonly ok: true; readonly project: Project; readonly migratedFrom?: number }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** Parse, migrate and validate a saved project. Never throws. */
export function deserializeProject(text: string): OpenResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, problems: [{ code: 'wrong-type', path: 'file', message: `not valid JSON: ${message}` }] };
  }

  let migratedFrom: number | undefined;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    let current = raw as Record<string, unknown>;
    const start = current.schemaVersion;
    if (typeof start === 'number' && Number.isInteger(start) && start < SCHEMA_VERSION) {
      for (let version = start; version < SCHEMA_VERSION; version++) {
        const step = MIGRATIONS[version];
        if (!step) {
          const message = `no migration from schema version ${version}`;
          return { ok: false, problems: [{ code: 'unsupported-version', path: 'schemaVersion', message }] };
        }
        current = step(current);
      }
      migratedFrom = start;
    }
    raw = current;
  }

  const problems = validateProject(raw);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, project: raw as Project, ...(migratedFrom === undefined ? {} : { migratedFrom }) };
}
