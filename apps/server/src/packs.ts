import { deserializeProject, serializeProject, type Project } from '@space-planner/core';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Pack files (decision 0027): ready-made projects in one file — a sample company, a set of
 * apartments, a client's job to hand over — that are installed into the program and removed
 * again, instead of being built into it. A pack is gzip-compressed JSON:
 *
 *   { "format": "atrium-pack", "version": 1, "id": "nile-gate", "name": "…", "description": "…",
 *     "projects": ["<a project in the save format>", …] }
 *
 * Each project is the same text as a saved project file, so a pack opens with the same
 * validation and migrations as any save, and stays readable as long as saves do.
 */

export const PACK_FORMAT = 'atrium-pack';
export const PACK_VERSION = 1;
/** The file name ending people see and the program's file pickers ask for. */
export const PACK_EXTENSION = '.atrium';
const MAX_PROJECTS = 500;
const MAX_BYTES = 200 * 1024 * 1024; // uncompressed

export interface PackInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface Pack extends PackInfo {
  readonly projects: readonly Project[];
}

/** Why a file is not a pack, in words for the person who chose it. */
export class PackError extends Error {}

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A pack id from a name: lower case, dashes, at most 63 characters. */
export function packId(name: string): string {
  const id = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '');
  return id || 'pack';
}

/** Reads a pack from its file bytes (compressed or plain JSON); every project must open. */
export function readPack(bytes: Uint8Array): Pack {
  let text: string;
  try {
    const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const raw = compressed ? gunzipSync(bytes, { maxOutputLength: MAX_BYTES }) : Buffer.from(bytes);
    if (raw.length > MAX_BYTES) throw new PackError('This pack is too large.');
    text = raw.toString('utf8');
  } catch (error) {
    if (error instanceof PackError) throw error;
    throw new PackError('This file is not an Atrium pack (it could not be unpacked).');
  }
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    data = parsed as Record<string, unknown>;
  } catch {
    throw new PackError('This file is not an Atrium pack.');
  }
  if (data.format !== PACK_FORMAT) throw new PackError('This file is not an Atrium pack.');
  if (typeof data.version !== 'number' || data.version > PACK_VERSION) throw new PackError('This pack was made by a newer Atrium. Update Atrium to install it.');
  if (typeof data.id !== 'string' || !ID.test(data.id)) throw new PackError('This pack has no valid id.');
  if (typeof data.name !== 'string' || !data.name.trim()) throw new PackError('This pack has no name.');
  if (!Array.isArray(data.projects) || data.projects.length === 0) throw new PackError('This pack holds no projects.');
  if (data.projects.length > MAX_PROJECTS) throw new PackError(`A pack can hold at most ${MAX_PROJECTS} projects.`);
  const projects = data.projects.map((file, i) => {
    if (typeof file !== 'string') throw new PackError(`Project ${i + 1} in this pack is damaged.`);
    const opened = deserializeProject(file);
    if (!opened.ok) throw new PackError(`Project ${i + 1} in this pack cannot be opened (${opened.problems[0]?.path ?? 'unknown'}).`);
    return opened.project;
  });
  return {
    id: data.id,
    name: data.name.trim().slice(0, 200),
    description: typeof data.description === 'string' ? data.description.slice(0, 1000) : '',
    projects,
  };
}

/** The file bytes of a pack: compressed, projects in the save format, in the given order. */
export function writePack(pack: Pack): Buffer {
  if (!ID.test(pack.id)) throw new PackError('A pack id is lower-case letters, digits and dashes.');
  const text = JSON.stringify({ format: PACK_FORMAT, version: PACK_VERSION, id: pack.id, name: pack.name, description: pack.description, projects: pack.projects.map(serializeProject) });
  // mtime 0 and no file name: the same projects always give the same bytes.
  return gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
}

/** A pack that comes with the program: in the packs folder next to the server. */
export interface BundledPack extends PackInfo {
  readonly file: string;
  readonly projectCount: number;
}

/** The packs in a folder, sorted by name; files that are not packs are skipped. */
export function bundledPacks(dir: string | undefined): BundledPack[] {
  if (!dir || !existsSync(dir)) return [];
  const found: BundledPack[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(PACK_EXTENSION)).sort()) {
    try {
      const pack = readPack(readFileSync(join(dir, name)));
      found.push({ id: pack.id, name: pack.name, description: pack.description, file: name, projectCount: pack.projects.length });
    } catch {
      // Not a pack, or damaged: it is simply not offered.
    }
  }
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
