// MUSE DESCRIBES ITSELF. `muse schema generate-json-schema --out <dir> --experimental` writes the build's
// whole MSP surface (stable + experimental, offline, "exact for this binary") as one `msp.schema.json`;
// this file turns it into the shared Shape (`../sdk-shape.js`) the launch gate and the updater check
// `requiredShape` against — per build, never per version.
//
//   methods        every client→server method name (`methods`)
//   results        method → field paths of its result
//   notifications  name → field paths of its params
//   requests       server→client request name → field paths of its params
//   values         `<method> <field>` → the closed vocabulary a param declares (`session/start approvalMode`)
//
// Field paths are dotted, relative to the params/result object; arrays are transparent; `oneOf`/`anyOf`/
// `allOf` contribute the union of their properties. Nothing here names an MSP field.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEMA_TIMEOUT_MS = 60000;
const MAX_DEPTH = 8;
const SCHEMA_FILE = 'msp.schema.json';

const refName = (ref) => (typeof ref === 'string' && ref.startsWith('#/$defs/') ? ref.slice('#/$defs/'.length) : '');

/** Every dotted property path under `schema`, resolving `#/$defs/` refs. Pure. */
function fieldPaths(schema, defs, prefix, out, seen, depth) {
  const acc = out || new Set();
  const d = depth || 0;
  if (!schema || typeof schema !== 'object' || d > MAX_DEPTH) return acc;
  const name = refName(schema.$ref);
  if (name) {
    const stack = seen || [];
    if (stack.includes(name) || !defs[name]) return acc;
    return fieldPaths(defs[name], defs, prefix, acc, stack.concat(name), d + 1);
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(schema[key])) for (const s of schema[key]) fieldPaths(s, defs, prefix, acc, seen, d + 1);
  }
  if (schema.items) fieldPaths(schema.items, defs, prefix, acc, seen, d + 1);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    fieldPaths(schema.additionalProperties, defs, prefix, acc, seen, d + 1);
  }
  if (schema.properties && typeof schema.properties === 'object') {
    for (const k of Object.keys(schema.properties)) {
      const p = prefix ? `${prefix}.${k}` : k;
      acc.add(p);
      fieldPaths(schema.properties[k], defs, p, acc, seen, d + 1);
    }
  }
  return acc;
}

/** The closed string vocabulary of one schema (refs resolved, unions merged), or [] when open. */
function enumOf(schema, defs, depth) {
  const d = depth || 0;
  if (!schema || typeof schema !== 'object' || d > MAX_DEPTH) return [];
  const name = refName(schema.$ref);
  if (name) return defs[name] ? enumOf(defs[name], defs, d + 1) : [];
  const out = [];
  if (Array.isArray(schema.enum)) for (const v of schema.enum) if (typeof v === 'string') out.push(v);
  if (typeof schema.const === 'string') out.push(schema.const);
  for (const key of ['oneOf', 'anyOf']) {
    if (Array.isArray(schema[key])) for (const s of schema[key]) out.push(...enumOf(s, defs, d + 1));
  }
  return Array.from(new Set(out));
}

function paramValues(method, paramsSchema, defs) {
  const out = {};
  const name = refName(paramsSchema && paramsSchema.$ref);
  const schema = name ? defs[name] : paramsSchema;
  const props = schema && schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  for (const field of Object.keys(props)) {
    const vals = enumOf(props[field], defs);
    if (vals.length) out[`${method} ${field}`] = vals;
  }
  return out;
}

/** The Shape of one parsed `msp.schema.json`. Pure. */
function shapeFromSchema(doc) {
  const defs = (doc && doc.$defs) || {};
  const shape = { methods: [], results: {}, notifications: {}, requests: {}, values: {} };
  for (const [name, m] of Object.entries((doc && doc.methods) || {})) {
    shape.methods.push(name);
    shape.results[name] = Array.from(fieldPaths(m && m.result, defs));
    Object.assign(shape.values, paramValues(name, m && m.params, defs));
  }
  for (const [name, n] of Object.entries((doc && doc.notifications) || {})) {
    shape.notifications[name] = Array.from(fieldPaths(n && n.params, defs));
  }
  for (const [name, r] of Object.entries((doc && doc.requests) || {})) {
    shape.requests[name] = Array.from(fieldPaths(r && r.params, defs));
  }
  return shape;
}

function runFile(bin, args, timeout) {
  return new Promise((resolve) => {
    require('child_process').execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0 });
    });
  });
}

/**
 * Ask the build at `bin` to describe its protocol → `{ shape, fingerprint }`. REJECTS when the schema
 * cannot be written or read: a failed probe is `shape-unknown`, never an empty shape.
 */
async function describeBuild(bin, run) {
  if (!bin) throw new Error('no Muse binary to describe');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dopl-muse-schema-'));
  try {
    const args = ['schema', 'generate-json-schema', '--out', dir, '--experimental'];
    const r = typeof run === 'function' ? await run(bin, args, { timeout: SCHEMA_TIMEOUT_MS }) : await runFile(bin, args, SCHEMA_TIMEOUT_MS);
    if (!r || r.code !== 0) throw new Error(`\`muse schema generate-json-schema\` exited ${r ? r.code : '?'}`);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, SCHEMA_FILE), 'utf8'));
    let fingerprint = null;
    try { fingerprint = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).fingerprint || null; } catch (_) { /* recorded only */ }
    const shape = shapeFromSchema(doc);
    if (!shape.methods.length) throw new Error('the build described no methods');
    return { shape, fingerprint };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** `runtime.shape()`: describe the build new launches run, answer its Shape. */
async function describe(bin) {
  return (await describeBuild(bin)).shape;
}

module.exports = { describeBuild, describe, shapeFromSchema, fieldPaths, enumOf, SCHEMA_TIMEOUT_MS, SCHEMA_FILE };
