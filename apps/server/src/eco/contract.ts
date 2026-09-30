/**
 * A minimal JSON Schema validator for the ecosystem contracts (plan 40-SPACE-PLANNER WP-S2). Space Planner has no zod and no
 * dependency may be added (decided 2026-09-29), so this covers exactly the keywords the vendored contracts use. A schema that
 * uses another keyword is refused loudly instead of being half-checked: a contract copied from GMES that grows a new keyword
 * fails the test that lists them, not a customer's send.
 *
 * `format` is annotation only (as in JSON Schema): the date-time of the envelope is checked by its own `pattern`.
 */

export type Schema = { readonly [keyword: string]: unknown };

const ANNOTATIONS = new Set(['$id', '$schema', 'title', 'description', 'format']);
const CHECKED = new Set([
  'type', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'required', 'properties', 'additionalProperties', 'items', 'prefixItems', 'minItems', 'maxItems',
]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keywords of a schema (recursively) that this validator does not understand. Empty means every keyword is checked. */
export function unsupportedKeywords(schema: unknown, path = '$'): string[] {
  if (!isRecord(schema)) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (!ANNOTATIONS.has(key) && !CHECKED.has(key)) out.push(`${path}.${key}`);
    if (key === 'properties' && isRecord(value)) for (const [name, sub] of Object.entries(value)) out.push(...unsupportedKeywords(sub, `${path}.properties.${name}`));
    else if (key === 'items' || key === 'additionalProperties') out.push(...unsupportedKeywords(value, `${path}.${key}`));
    else if (key === 'prefixItems' && Array.isArray(value)) value.forEach((sub, i) => out.push(...unsupportedKeywords(sub, `${path}.prefixItems[${i}]`)));
  }
  return out;
}

const typeOk = (type: string, value: unknown): boolean => {
  switch (type) {
    case 'object': return isRecord(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
};

/** Why `value` does not satisfy `schema`: one sentence per problem, each starting with its path ("$.items[2].x"). Empty means valid. */
export function validate(schema: Schema, value: unknown, path = '$'): string[] {
  const unsupported = path === '$' ? unsupportedKeywords(schema) : [];
  if (unsupported.length) throw new Error(`schema uses keywords this validator does not check: ${unsupported.join(', ')}`);
  const problems: string[] = [];
  const add = (message: string) => problems.push(`${path}: ${message}`);

  const type = schema.type;
  if (typeof type === 'string' || Array.isArray(type)) {
    const types = (Array.isArray(type) ? type : [type]) as string[];
    if (!types.some((t) => typeOk(t, value))) {
      add(`must be ${types.join(' or ')}`);
      return problems;
    }
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) add(`must be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) add(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && [...value].length < schema.minLength) add(`must have at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'}`);
    if (typeof schema.maxLength === 'number' && [...value].length > schema.maxLength) add(`must have at most ${schema.maxLength} characters`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) add('has the wrong form');
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) add(`must be at least ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) add(`must be at most ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) add(`must be more than ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) add(`must be less than ${schema.exclusiveMaximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) add(`must have at least ${schema.minItems} entries`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) add(`must have at most ${schema.maxItems} entries`);
    const prefix = Array.isArray(schema.prefixItems) ? (schema.prefixItems as Schema[]) : [];
    value.forEach((entry, i) => {
      const at = `${path}[${i}]`;
      if (i < prefix.length) problems.push(...validate(prefix[i]!, entry, at));
      else if (schema.items === false) problems.push(`${at}: is not allowed here`);
      else if (isRecord(schema.items)) problems.push(...validate(schema.items, entry, at));
    });
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? (schema.properties as Record<string, Schema>) : {};
    if (Array.isArray(schema.required)) for (const key of schema.required as string[]) if (!(key in value)) problems.push(`${path}.${key}: is required`);
    for (const [key, entry] of Object.entries(value)) {
      const sub = properties[key];
      if (sub) problems.push(...validate(sub, entry, `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}.${key}: is not allowed here`);
      else if (isRecord(schema.additionalProperties)) problems.push(...validate(schema.additionalProperties as Schema, entry, `${path}.${key}`));
    }
  }
  return problems;
}
