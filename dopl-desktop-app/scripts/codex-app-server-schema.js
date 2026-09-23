'use strict';

// Captures the installed `codex app-server`'s protocol into test/fixtures/codex-app-server.json, the only
// sanctioned source of its content (`npm run codex:schema`; `-- --print` writes nothing). Fails loudly and
// leaves the file untouched rather than writing an empty fixture. Stores only what the contract suite reads
// (`fixtureFrom`): no prompt, token or auth material.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const client = require('../main/runtime/codex/client.js');
const resolveBin = require('../main/runtime/codex/resolve-bin.js');
const configHome = require('../main/runtime/codex/config-home.js');

const FIXTURE = path.join(__dirname, '..', 'test', 'fixtures', 'codex-app-server.json');
const HANDSHAKE_TIMEOUT_MS = 20000;
const HELP_TIMEOUT_MS = 10000;
const SCHEMA_TIMEOUT_MS = 60000;

// A binary inside another `.app` bundle cannot define Dopl's public-CLI contract. Pure, so it is unit-tested.
function excludedFixtureSource(file) {
  return /(?:^|[/\\])[^/\\]+\.app(?:[/\\]|$)/i.test(String(file || ''));
}

// The generated schema is the method list (`initialize` declares none): each file enumerates methods as a
// `oneOf` of `method` consts. The subcommand is `[experimental]`.
const SCHEMA_FILES = Object.freeze({
  clientRequests: 'ClientRequest.json',
  serverRequests: 'ServerRequest.json',
  serverNotifications: 'ServerNotification.json',
  clientNotifications: 'ClientNotification.json',
});

// ── SHAPES ───────────────────────────────────────────────────────────────────────────────────

const MAX_DEPTH = 6;

/** Keys → types, recursively; arrays → `{ '[]': <first element>, length }`. Types, never values. */
function shapeOf(value, depth) {
  const d = depth || 0;
  if (d > MAX_DEPTH) return '…';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return { length: value.length, '[]': value.length ? shapeOf(value[0], d + 1) : 'empty' };
  }
  if (typeof value !== 'object') return typeof value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = shapeOf(value[key], d + 1);
  return out;
}

/** The ids `model/list` marks default (`{ data: [{ id, isDefault }] }`, measured). */
function defaultModels(list) {
  const rows = list && Array.isArray(list.data) ? list.data : [];
  return rows.filter((row) => row && row.isDefault === true).map((row) => row.id || null);
}

// ── SCHEMA ───────────────────────────────────────────────────────────────────────────────────

/** The `method` consts of one `oneOf` schema file — names only, never bodies. */
function methodsIn(file) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
  const variants = doc.oneOf || doc.anyOf || [];
  const names = [];
  for (const variant of variants) {
    const method = variant && variant.properties && variant.properties.method;
    if (!method) continue;
    const name = method.const || (Array.isArray(method.enum) ? method.enum[0] : null);
    if (typeof name === 'string' && name) names.push(name);
  }
  return names.length ? names.sort() : null;
}

/** `generate-json-schema` into a temp dir, reduced to method names; the bundle itself is deleted. */
async function generatedSchema(bin) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dopl-codex-schema-'));
  try {
    const run1 = await run(bin, ['app-server', 'generate-json-schema', '--out', out], SCHEMA_TIMEOUT_MS);
    if (!run1.ok) {
      return {
        ok: false,
        command: `${bin} app-server generate-json-schema --out <dir>`,
        reason: (run1.err.trim() || run1.error || 'the subcommand failed').slice(0, 400),
      };
    }
    const result = { ok: true, command: `${bin} app-server generate-json-schema --out <dir>` };
    for (const [key, file] of Object.entries(SCHEMA_FILES)) result[key] = methodsIn(path.join(out, file));
    result.files = fs.readdirSync(out).sort();
    return result;
  } finally {
    try { fs.rmSync(out, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
}

// ── CAPTURE ──────────────────────────────────────────────────────────────────────────────────

function fail(message, code) {
  process.stderr.write(`\ncodex:schema — NOTHING WAS WRITTEN.\n  ${message}\n\n`);
  process.stderr.write(`  The fixture at ${path.relative(process.cwd(), FIXTURE)} is unchanged.\n`);
  process.stderr.write('  ⚠ Do not hand-fill it. A synthetic protocol shape is what this unit exists to prevent.\n\n');
  process.exit(code || 1);
}

function run(bin, args, timeout) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || ''), error: err ? err.message : null });
    });
  });
}

/** One bounded app-server session. ⚠ The child is closed on EVERY path, including a throw. */
async function withAppServer(fn) {
  // Spawned by `client.js` with the isolated home, exactly as the app spawns — never `~/.codex` (CX-34).
  const conn = client.connect({ args: [], env: configHome.isolatedEnv(process.env) });
  let timer = null;
  const budget = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the app-server did not finish the handshake within ${HANDSHAKE_TIMEOUT_MS}ms`)),
      HANDSHAKE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([Promise.resolve().then(() => fn(conn)), budget]);
  } finally {
    clearTimeout(timer);
    try { conn.close(); } catch (_) { /* best effort */ }
    await new Promise((done) => {
      const child = conn.child;
      if (!child || child.exitCode !== null) { done(); return; }
      const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }, 1500);
      const give = setTimeout(done, 3500);
      child.once('exit', () => { clearTimeout(hard); clearTimeout(give); done(); });
    });
  }
}

async function capture() {
  const found = resolveBin.resolveCodexBin();
  if (!found.ok) fail(found.reason, 2);
  if (excludedFixtureSource(found.path)) {
    fail(
      `\`${found.path}\` is inside another application's bundle. It may be used for an explicit smoke test, but it cannot generate Dopl's supported Codex CLI fixture.`,
      2,
    );
  }

  const version = await run(found.path, ['--version'], HELP_TIMEOUT_MS);
  if (!version.ok) fail(`\`${found.path} --version\` failed: ${version.error}`, 2);
  const versionText = version.out.trim() || version.err.trim();

  const schema = await generatedSchema(found.path);

  const handshake = await withAppServer(async (conn) => {
    const out = { initialize: null, declaredMethods: null, modelDefaults: [], errors: [] };
    const init = await conn.request('initialize', client.initializeParams(versionText));
    out.initialize = { shape: shapeOf(init), raw: null };
    // The CLI's own enumeration wins; `initialize` is only a fallback.
    if (schema.ok && Array.isArray(schema.clientRequests)) {
      out.declaredMethods = { from: 'generate-json-schema/ClientRequest', names: schema.clientRequests };
    }
    // A list-shaped `initialize` key is recorded under its own name; none leaves `declaredMethods` null,
    // which fails the contract suite.
    for (const key of ['methods', 'supportedMethods', 'capabilities']) {
      if (out.declaredMethods) break;
      const value = init && init[key];
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        out.declaredMethods = { from: `initialize.${key}`, names: value.slice().sort() };
        break;
      }
    }
    try {
      out.modelDefaults = defaultModels(await conn.request('model/list', {}));
    } catch (err) {
      out.errors.push({ method: 'model/list', message: (err && err.message) || String(err), code: (err && err.code) || null });
    }
    return out;
  });

  return {
    fixture: fixtureFrom({ found, versionText, handshake, capturedAt: new Date().toISOString() }),
    modelDefaults: handshake.modelDefaults,
  };
}

/** The committed fixture: exactly what `codex-app-server-contract.test.mjs` reads. Pure. */
function fixtureFrom({ found, versionText, handshake, capturedAt }) {
  return {
    fixtureFormat: 'dopl:codex-app-server/1',
    status: 'MEASURED',
    statusNote: 'Captured from a real Codex CLI by scripts/codex-app-server-schema.js. Shapes are key names and value types; no prompt, token or transcript content is stored.',
    regenerate: 'cd dopl-desktop-app && npm run codex:schema',
    generatedBy: 'dopl-desktop-app/scripts/codex-app-server-schema.js',
    capturedAt,
    cli: {
      version: versionText,
      versionCommand: `${found.path} --version`,
      path: found.path,
      source: found.source,
    },
    handshake: {
      initialize: handshake.initialize ? { shape: handshake.initialize.shape } : null,
      declaredMethods: handshake.declaredMethods,
    },
    doplRequires: {
      note: 'THIS BLOCK IS NOT A MEASUREMENT — it is Dopl\'s own requirement, mirrored from `main/runtime/codex/protocol.js › REQUIRED_METHODS` so the contract suite can prove the two have not drifted.',
      methods: client.REQUIRED_METHODS.slice(),
    },
  };
}

// ── ADVICE ───────────────────────────────────────────────────────────────────────────────────

function advise(fixture, modelDefaults) {
  const detected = fixture.cli.version;
  const lines = ['', `codex:schema — measured ${detected} at ${fixture.cli.path} (${fixture.cli.source}).`];
  const floor = client.versionGate(detected);
  if (!floor.ok) lines.push('', `⚠ Dopl refuses this CLI: ${floor.reason}`);
  const declared = fixture.handshake.declaredMethods;
  if (!declared) {
    lines.push('');
    lines.push('⚠ This CLI declared NO method list — neither `generate-json-schema` nor `initialize`');
    lines.push('  produced one, so the contract suite cannot check the methods Dopl sends.');
  } else {
    const have = new Set(declared.names);
    const absent = client.REQUIRED_METHODS.filter((m) => !have.has(m));
    lines.push(`methods: ${declared.names.length} declared via ${declared.from}`
      + (absent.length ? ` — ⚠ MISSING ${absent.join(', ')}` : ' — all of Dopl\'s required methods present'));
  }
  const defaults = modelDefaults || [];
  if (defaults.length !== 1) {
    lines.push('');
    lines.push(`⚠ The model catalog declares ${defaults.length} defaults. The contract suite requires exactly one.`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const print = process.argv.includes('--print');
  const { fixture, modelDefaults } = await capture();
  if (print) {
    process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
  } else {
    fs.writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
    process.stdout.write(`codex:schema — wrote ${path.relative(process.cwd(), FIXTURE)}\n`);
  }
  process.stdout.write(advise(fixture, modelDefaults));
}

if (require.main === module) {
  main().catch((err) => fail((err && err.message) || String(err), 1));
}

module.exports = { excludedFixtureSource, fixtureFrom };
