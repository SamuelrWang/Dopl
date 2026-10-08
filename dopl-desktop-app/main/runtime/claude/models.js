// THE CLAUDE MODEL ROSTER — always LIVE (`roster.js` reads `supportedModels()` off a turn-free CLI
// handshake). ⚠ NO CACHE AND NO SHIPPED TABLE HERE (2026-10-08, SDK resilience #2): the shared catalog
// (`model-catalog.js`) is the one cache, persisted per build key (`roster-key.js`), and a read that fails
// is a rejection the catalog renders (`stale` over held models, else `unavailable`). A model id typed into
// this build could only go stale; with no pick the CLI runs its OWN default (no `--model` is sent).
// Electron-free at load: the loader and the credential probe are reached lazily (`defaultDeps`),
// because `session-profiles.js` reaches this adapter through the registry and is evaluated standalone.

const roster = require('./roster');
const { pickOf } = require('../selection-vocabulary');
const { notOfferedSentence } = require('../model-catalog');

// The pick grammar: a SHAPE gate for `--model <value>` on argv, not a roster check (the live roster
// decides). An id or alias, a `[1m]`-style suffix at the end only; bounded by the 120-char column.
const PICK_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,109}(\\[[A-Za-z0-9]{1,8}\\])?$';
const PICK_RE = new RegExp(PICK_PATTERN);

// Injectable for the suite.
function defaultDeps() {
  return {
    loadSdk: () => require('./loader').getSdk(),
    bin: () => require('./loader').resolveClaudeExecutable(),
    env: () => require('./credential').withCredential(require('./loader').buildScrubbedEnv()),
    credentialSource: () => {
      try { return String(require('./credential').credentialState().source || 'none'); } catch (_) { return 'none'; }
    },
    // The ACTIVE binary's version (a verified download or the bundle), so a switch moves the key.
    sdkVersion: () => {
      try { return String((require('./loader').claudeRuntime() || {}).version || '?'); } catch (_) { return '?'; }
    },
    probe: roster.probe,
    observeShape: roster.observeShape,
    // The catalog's models now (the one cache), for SYNCHRONOUS launch resolution. Lazy: the registry
    // requires this module. Never throws; [] before any read.
    catalogModels: () => {
      try {
        const adapter = require('../index').resolve('claude');
        const c = require('../model-catalog').snapshot(adapter);
        return c && Array.isArray(c.models) ? c.models : [];
      } catch (_) { return []; }
    },
    // The updater's active download, or null when launches run the bundle.
    downloadedBin: () => (require('../updates').activeFor(require('./update-source')) || {}).path || null,
    // A failed handshake on a downloaded binary sends new launches back to the last good one.
    rejectBinary: (bin) => require('../updates').reject(require('./update-source'), bin),
  };
}
let deps = defaultDeps();

/** The build new launches run, for core's key (`roster-key.js`): binary, SDK version, credential source. */
function buildIdentity() {
  let bin = null;
  try { bin = deps.bin() || null; } catch (_) { bin = null; }
  let version = null;
  try { version = deps.sdkVersion() || null; } catch (_) { version = null; }
  let account = null;
  try { account = deps.credentialSource() || null; } catch (_) { account = null; }
  return { path: bin, version, account };
}

// A downloaded build's first handshake may wait out macOS's first-exec scan, so a failed probe on one is
// retried once with this budget before the build is rejected.
const DOWNLOAD_RETRY_TIMEOUT_MS = 60000;

/** `{ rows, moved }` from the binary new launches run. A download that fails twice is rejected and the rows
 *  come from what launches run after that (the last good build or the bundle), `moved` — never "no runtime". */
async function probeRows(sdk) {
  const options = { env: deps.env() };
  const bin = deps.bin();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  try {
    return { rows: await deps.probe({ sdk, options }), moved: false };
  } catch (err) {
    if (!bin || bin !== deps.downloadedBin()) throw err; // the bundle failing says nothing of a download
    try {
      return { rows: await deps.probe({ sdk, options, timeoutMs: DOWNLOAD_RETRY_TIMEOUT_MS }), moved: false };
    } catch (_) {
      deps.rejectBinary(bin);
      const next = deps.bin();
      if (!next || next === bin) throw err;
      const rows = await deps.probe({ sdk, options: Object.assign({}, options, { pathToClaudeCodeExecutable: next }) });
      return { rows, moved: true };
    }
  }
}

async function readLive() {
  const sdk = await deps.loadSdk();
  const { rows } = await probeRows(sdk);
  // A probe answers `{ rows, liveModel }` (`roster.js › probe`); a bare array is rows with no live model.
  const answer = Array.isArray(rows) ? { rows, liveModel: null } : (rows || {});
  return roster.rosterFrom(answer.rows, { liveDefault: answer.liveModel });
}

/** The offerable roster, read LIVE every call (the catalog decides when to call). Rejects with a
 *  readable reason; never answers a table. */
async function models() {
  // Without Dopl's token the probe would run on the operator's own login.
  if (deps.credentialSource() === 'none') {
    throw new Error('Claude Code is not signed in to Dopl on this Mac, so its model list cannot be read.');
  }
  let live;
  try {
    live = await readLive();
  } catch (err) {
    throw new Error(`Dopl could not read Claude Code's model list (${(err && err.message) || 'unknown error'}).`);
  }
  if (!live.models.length) throw new Error(live.reason || 'Claude Code answered with no models Dopl could read.');
  return live;
}

/**
 * The `--model` argument for a pick — `{ ok, arg, id, reason }`, synchronous, against the catalog's
 * models: the matched row's own launch value. ⚠ NO PICK SENDS NO MODEL (2026-10-08): the CLI runs its
 * own default, so no model name is typed into Dopl; `id` is the row the CLI's `default` marks (for the
 * label), else ''. With NO roster read yet, a grammatical pick is sent as itself: an unreadable roster
 * is not evidence a model is absent (RC-03). A read roster that lacks the pick refuses, never swaps.
 */
function resolveLaunchModel(value) {
  const models = deps.catalogModels();
  const v = pickOf(value);
  if (!v) {
    const def = models.find((m) => m && m.isDefault);
    return { ok: true, arg: '', id: def ? def.id : '', reason: '' };
  }
  // Exact id or alias only: a base-id match would resume a `[1m]` pick on the short row (RC-01).
  const row = roster.matchExact(models, v);
  if (row) return { ok: true, arg: row.launch || row.id, id: row.id, reason: '' };
  if (!models.length && PICK_RE.test(v)) return { ok: true, arg: v, id: v, reason: '' };
  return { ok: false, arg: '', id: '', reason: notOfferedSentence(require('./index').descriptor.label, v, models) };
}

/**
 * What `buildOptions` spends. An unmatched value that passes the grammar is sent as itself (the funnel
 * already refused unknown picks, so it is a resumed session's recorded model); anything else never
 * reaches argv.
 */
function launchArg(value) {
  const r = resolveLaunchModel(value);
  if (r.ok) return r.arg;
  const v = String(value).trim();
  return PICK_RE.test(v) ? v : resolveLaunchModel('').arg;
}

/** The pairing new launches run (bundled SDK + the ACTIVE CLI), as it describes itself — turn-free
 *  (`roster.js › observeShape`). `runtime.shape()`; checked against `descriptor.requiredShape`. */
async function shape() {
  const sdk = await deps.loadSdk();
  const options = { env: deps.env() };
  const bin = deps.bin();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  return deps.observeShape({ sdk, options });
}

/** `inject` swaps the dependencies (tests); there is no cache to drop. */
function inject(overrides) { deps = Object.assign(defaultDeps(), overrides || {}); }

// Descriptor half.
const descriptor = {
  source: 'live',
  // null, not []: no second dimension (the CLI's effort levels are not wired).
  dimensions: null,
  // None: a no-pick launch sends no `--model` and the CLI runs its own default, which its `default`
  // roster row names and the catalog marks (`roster.js › rosterFrom`). No model name lives here.
  launchDefault: null,
  // Storage shape-checks only; the live roster decides what may be selected and launched.
  pick: {
    absent: '',
    pattern: PICK_PATTERN,
  },
  dimensionOptions: null,
};

/** The catalog's models now (the one cache); [] before any read. */
function catalogModels() { return deps.catalogModels(); }

module.exports = {
  models, shape, buildIdentity, resolveLaunchModel, launchArg, catalogModels, inject,
  descriptor, PICK_PATTERN, DOWNLOAD_RETRY_TIMEOUT_MS,
};
