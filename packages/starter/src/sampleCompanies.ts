import { nileGateSample, SAMPLE_COMPANY, type SampleProject } from './samples.js';
import { NILE_VISION_COMPANY, nileVisionSample } from './nileVision.js';
import { SAMSUNG_COMPANY, samsungSample } from './samsung.js';

export interface SampleCompany {
  /** Stable id: the store keeps it on every project the sample adds, so the projects page can group them. */
  readonly id: string;
  readonly name: string;
  /** One line for the projects page: what the sample shows and how far to trust it. */
  readonly description: string;
  readonly build: () => SampleProject[];
}

export const SAMPLE_COMPANIES: readonly SampleCompany[] = [
  {
    id: 'samsung-egypt',
    name: SAMSUNG_COMPANY,
    description: 'TV, monitor, phone and tablet factory in Kom Abu Radi, Al Wasta: campus, plants, warehouse, staff parking, HR, meetings, events and canteen. Illustrative layout built from public figures, not a survey.',
    build: samsungSample,
  },
  {
    id: 'nile-gate',
    name: SAMPLE_COMPANY,
    description: 'Fictional electronics distributor: stocked distribution centres, a port cross-dock, loaded containers, a retail trailer and a van yard.',
    build: nileGateSample,
  },
  {
    id: 'nile-vision',
    name: NILE_VISION_COMPANY,
    description: 'Fictional TV plant of the whole-company demo (Mizan, GMES, HR-System, Space Planner): plant, final assembly lines FA-1 and FA-2, SMT line and THT cell. Every station carries its GMES code, so Link to plant can tag the whole plan by code.',
    build: nileVisionSample,
  },
];

export function sampleCompany(id: string): SampleCompany | undefined {
  return SAMPLE_COMPANIES.find((c) => c.id === id);
}
