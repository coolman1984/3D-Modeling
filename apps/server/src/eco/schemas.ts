import envelope from './schemas/eco.envelope.v1.schema.json';
import layoutSnapshot from './schemas/eco.layout.snapshot.v1.schema.json';
import plantNode from './schemas/eco.plant_node.v1.schema.json';
import type { Schema } from './contract.js';

/**
 * The three contracts Space Planner speaks, copied byte for byte from `GMES/packages/eco-contracts/schemas/` (never edited here:
 * a change is made in GMES and copied again; `test/eco-pin.test.ts` pins their SHA-256). Bundled into the server file by esbuild.
 */
export const SCHEMAS = {
  'eco.envelope.v1': envelope as Schema,
  'eco.layout.snapshot.v1': layoutSnapshot as Schema,
  'eco.plant_node.v1': plantNode as Schema,
} as const;

export type ContractName = keyof typeof SCHEMAS;
