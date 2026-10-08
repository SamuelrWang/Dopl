// CODEX DESCRIBES ITSELF (2026-10-08). `codex app-server generate-json-schema --out <dir>` writes the
// build's whole protocol as JSON Schema; this file turns it into the shared Shape (`../sdk-shape.js`)
// that the launch gate and the updater check `requiredShape` against — per build, never per version.
//
//   methods        every `ClientRequest` method name
//   results        method → the field paths of its response (`<X>Params` → `<X>Response`, the schema's
//                  own naming; resolved in the v2 bundle's definitions, then the top-level files)
//   notifications  every `ServerNotification` name → the field paths of its `params`
//   requests       every `ServerRequest` name → the field paths of its `params`
//   replies        server request → its RESPONSE schema, for `replyFor` (not part of the Shape)
//
// Field paths are dotted and RELATIVE to the params/result object; arrays are transparent
// (`data.displayName` = the `displayName` of each `data[]` row); `oneOf`/`anyOf`/`allOf` contribute the
// union of their properties. Nothing here names a Codex field: it reads whatever the build declares.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEMA_TIMEOUT_MS = 60000;
const MAX_DEPTH = 8;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const refName = (ref) => (typeof ref === 'string' && ref.startsWith('#/definitions/') ? ref.slice('#/definitions/'.length) : '');

/** Every dotted property path under `schema`, resolving `#/definitions/` refs in `defs`. Pure. */
function fieldPaths(schema, defs, prefix, out, seen, depth) {
  const acc = out || new Set();
  const d = depth || 0;
  if (!schema || typeof schema !== 'object' || d > MAX_DEPTH) return acc;
  const name = refName(schema.$ref);
  if (name) {
    const stack = seen || [];
    if (stack.includes(name) || !defs[name]) return acc; // a cycle, or a ref this file does not hold
    return fieldPaths(defs[name], defs, prefix, acc, stack.concat(name), d + 1);
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(schema[key])) for (const s of schema[key]) fieldPaths(s, defs, prefix, acc, seen, d + 1);
  }
  if (schema.items) fieldPaths(schema.items, defs, prefix, acc, seen, d + 1);
  if (schema.properties && typeof schema.properties === 'object') {
    for (const k of Object.keys(schema.properties)) {
      const p = prefix ? `${prefix}.${k}` : k;
      acc.add(p);
      fieldPaths(schema.properties[k], defs, p, acc, seen, d + 1);
    }
  }
  return acc;
}

/** `[{ name, params }]` from a `oneOf` of `{ method: {enum:[name]}, params: <schema> }` variants. */
function variants(file) {
  const out = [];
  for (const v of Array.isArray(file && file.oneOf) ? file.oneOf : []) {
    const m = v && v.properties && v.properties.method;
    const name = m && Array.isArray(m.enum) && typeof m.enum[0] === 'string' ? m.enum[0] : '';
    if (name) out.push({ name, params: v.properties.params || null });
  }
  return out;
}

/** The response schema for a request whose params are `<X>Params`, looked up as `<X>Response`. */
function responseFor(paramsSchema, bundles) {
  const base = refName(paramsSchema && paramsSchema.$ref).replace(/Params$/, '');
  if (!base) return null;
  for (const b of bundles) {
    const def = b.defs[`${base}Response`];
    if (def) return { schema: def, defs: b.defs };
  }
  return null;
}

/** The Shape (+ reply schemas) of a schema directory written by `generate-json-schema`. Pure over files. */
function shapeFromDir(dir) {
  const client = readJson(path.join(dir, 'ClientRequest.json'));
  const notes = readJson(path.join(dir, 'ServerNotification.json'));
  const serverReq = readJson(path.join(dir, 'ServerRequest.json'));
  const bundles = [];
  const v2 = path.join(dir, 'codex_app_server_protocol.v2.schemas.json');
  if (fs.existsSync(v2)) bundles.push({ defs: readJson(v2).definitions || {} });
  const top = path.join(dir, 'codex_app_server_protocol.schemas.json');
  if (fs.existsSync(top)) bundles.push({ defs: readJson(top).definitions || {} });

  const shape = { methods: [], results: {}, notifications: {}, requests: {} };
  for (const { name, params } of variants(client)) {
    shape.methods.push(name);
    const res = responseFor(params, bundles);
    shape.results[name] = res ? Array.from(fieldPaths(res.schema, res.defs)) : [];
  }
  for (const { name, params } of variants(notes)) {
    shape.notifications[name] = Array.from(fieldPaths(params, notes.definitions || {}));
  }
  const replies = {};
  for (const { name, params } of variants(serverReq)) {
    shape.requests[name] = Array.from(fieldPaths(params, serverReq.definitions || {}));
    const res = responseFor(params, bundles.concat([{ defs: serverReq.definitions || {} }]));
    if (res) replies[name] = res;
  }
  return { shape, replies };
}

function runFile(bin, args, timeout) {
  return new Promise((resolve) => {
    require('child_process').execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || '') });
    });
  });
}

/**
 * Ask the build at `bin` to describe its protocol → `{ shape, replies }`. REJECTS (never answers an empty
 * shape) when the schema cannot be written or read: a failed probe is `shape-unknown`, not a gap.
 * `run(file, args, opts)` → `{ code }` is the updater's runner (`updates/index.js`), same contract.
 */
async function describeBuild(bin, run, env) {
  if (!bin) throw new Error('no Codex binary to describe');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dopl-codex-schema-'));
  try {
    const args = ['app-server', 'generate-json-schema', '--out', dir];
    const r = typeof run === 'function'
      ? await run(bin, args, { timeout: SCHEMA_TIMEOUT_MS, env })
      : await runFile(bin, args, SCHEMA_TIMEOUT_MS);
    if (!r || r.code !== 0) throw new Error(`\`codex app-server generate-json-schema\` exited ${r ? r.code : '?'}`);
    const out = shapeFromDir(dir);
    if (!out.shape.methods.length) throw new Error('the build described no methods');
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── replyFor: an answer to a server request, in the shape ITS schema states ──────────────────────

const WORDS = { accept: ['accept', 'approved', 'allow'], decline: ['decline', 'denied', 'deny'] };

/**
 * The reply to a server request Dopl has no hand-written answer for, built ONLY from the build's own
 * response schema: one required property whose enum names the decision (`accept`/`decline` or a
 * synonym), and no other required property. Anything else → null (Dopl will not guess a shape).
 */
function replyFromSchema(reply, decision) {
  if (!reply || !reply.schema) return null;
  const defs = reply.defs || {};
  const resolve = (s) => { const n = refName(s && s.$ref); return n ? defs[n] : s; };
  const schema = resolve(reply.schema);
  if (!schema || !schema.properties) return null;
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (required.length !== 1) return null;
  const key = required[0];
  const values = new Set();
  const collect = (s, depth) => {
    const r = resolve(s);
    if (!r || depth > 4) return;
    if (Array.isArray(r.enum)) for (const v of r.enum) if (typeof v === 'string') values.add(v);
    for (const k of ['oneOf', 'anyOf', 'allOf']) if (Array.isArray(r[k])) for (const x of r[k]) collect(x, depth + 1);
  };
  collect(schema.properties[key], 0);
  const word = (WORDS[decision] || []).find((w) => values.has(w));
  return word ? { [key]: word } : null;
}

// The reply schemas of the last description of each build (path → replies), for `replyFor`. Filled by
// `describe` (the adapter's `runtime.shape()`); a build never described answers no reply (null).
const repliesByPath = new Map();

/** `runtime.shape()`: describe the build new launches run, remember its reply schemas, answer its Shape. */
async function describe(bin) {
  const out = await describeBuild(bin);
  repliesByPath.set(bin, out.replies);
  return out.shape;
}

/** The schema-built reply to `method` on the build at `bin`, or null (`replyFromSchema`). */
function replyFor(bin, method, decision) {
  const replies = repliesByPath.get(bin);
  return replies && replies[method] ? replyFromSchema(replies[method], decision) : null;
}

module.exports = { describeBuild, describe, replyFor, shapeFromDir, fieldPaths, replyFromSchema, SCHEMA_TIMEOUT_MS };
