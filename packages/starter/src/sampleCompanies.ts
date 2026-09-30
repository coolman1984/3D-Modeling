import { nileGateSample, SAMPLE_COMPANY, type SampleProject } from './samples.js';
import { HORIZON_COMPANY, horizonSample } from './horizon.js';

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
    id: 'horizon-electronics',
    name: HORIZON_COMPANY,
    description: 'TV, monitor, phone and tablet maker (invented): campus, plants, warehouse, staff parking, HR, meetings, events and canteen. Illustrative layout built from public figures, not a survey.',
    build: horizonSample,
  },
  {
    id: 'nile-gate',
    name: SAMPLE_COMPANY,
    description: 'Fictional electronics distributor: stocked distribution centres, a port cross-dock, loaded containers, a retail trailer and a van yard.',
    build: nileGateSample,
  },
];

export function sampleCompany(id: string): SampleCompany | undefined {
  return SAMPLE_COMPANIES.find((c) => c.id === id);
}
