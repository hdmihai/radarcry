/**
 * Minimal JSON Schema (draft 2020-12 subset) validator — zero dependencies.
 * Supports: type (incl. arrays of types), required, properties, additionalProperties(false),
 * items, enum, const, minimum, maximum, minItems, maxItems, pattern, $ref to #/$defs/*.
 * Enough to guard the backend → frontend contract; not a general-purpose validator.
 */
export function validateSchema(value, schema, root = schema, path = '$', errors = []) {
  if (errors.length > 50) return errors;
  if (schema.$ref) {
    const ref = schema.$ref.replace(/^#\/\$defs\//, '');
    const target = root.$defs?.[ref];
    if (!target) { errors.push(`${path}: $ref necunoscut ${schema.$ref}`); return errors; }
    return validateSchema(value, target, root, path, errors);
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: trebuie să fie ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: valoare ${JSON.stringify(value)} în afara enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(value, t))) {
      errors.push(`${path}: tip ${describe(value)}, așteptat ${types.join('|')}`);
      return errors;
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} < ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} > ${schema.maximum}`);
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: nu respectă ${schema.pattern}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: minim ${schema.minItems} elemente`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: maxim ${schema.maxItems} elemente`);
    if (schema.items) value.forEach((v, i) => validateSchema(v, schema.items, root, `${path}[${i}]`, errors));
  } else if (value && typeof value === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}: lipsește "${key}"`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) if (key in value) validateSchema(value[key], sub, root, `${path}.${key}`, errors);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) errors.push(`${path}: proprietate nepermisă "${key}"`);
    }
  }
  return errors;
}

function typeOk(v, t) {
  switch (t) {
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'integer': return Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    default: return true;
  }
}

const describe = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
