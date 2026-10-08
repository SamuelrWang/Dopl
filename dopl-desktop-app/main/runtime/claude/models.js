// THE CLAUDE MODEL ROSTER — live (`roster.js` reads `supportedModels()` off a turn-free CLI
// handshake), with this build's table as the fallback when that read fails: the fallback roster is
// marked `stale`, so it labels but proves nothing (`model-catalog.js › vouches`).
// Electron-free at load: the loader and the credential probe are reached lazily (`defaultDeps`),
// because `session-profiles.js` reaches this adapter through the registry and is evaluated standalone.

const modelTable = require('./model-table');
const roster = require('./roster');
const { pickOf } = require('../selection-vocabulary');
const { notOfferedSentence } = require('../model-catalog');

// The fallback's display names; pinned against web `agent-models.ts › AGENT_MODELS` by
// `test/runtime-model-catalog.test.mjs`. A live roster carries the CLI's own names.
const LABELS = {
  'claude-fable-5-1': { label: 'Fable 5.1', short: 'Fable' },
  'claude-opus-5-5': { label: 'Opus 5.5', short: 'Opus' },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', short: 'Sonnet' },
  'claude-haiku-5-5': { label: 'Haiku 5.5', short: 'Haiku' },
};

// The pick grammar: a SHAPE gate for `--model <value>` on argv, not a roster check (the live roster
// decides). An id or alias, a `[1m]`-style suffix at the end only; bounded by the 120-char column.
const PICK_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,109}(\\[[A-Za-z0-9]{1,8}\\])?$';
const PICK_RE = new RegExp(PICK_PATTERN);

const legacyAliases = () => modelTable.MODEL_IDS.reduce((m, id) => {
  m[id] = modelTable.aliasForModelId(id);
  return m;
}, {});

/** The table this build shipped with, in the live roster's own shape. */
function frozenRoster(reason) {
  const fallback = descriptor.launchDefault;
  const models = modelTable.MODEL_IDS.map((id) => {
    const alias = modelTable.aliasForModelId(id);
    return {
      id,
      value: alias,
      label: (LABELS[id] && LABELS[id].label) || id,
      short: (LABELS[id] && LABELS[id].short) || null,
      isDefault: id === fallback,
      hidden: false,
      aliases: [alias, roster.baseId(id)].filter((v, i, a) => v && v !== id && a.indexOf(v) === i),
      dimensions: {},
    };
  });
  return {
    source: 'live',
    key: 'frozen',
    ids: models.map((m) => m.id),
    models,
    defaultId: fallback,
    // This build's memory, not the CLI's answer.
    stale: true,
    reason: reason || 'Dopl could not read Claude Code\'s model list, so it is showing the list this build shipped with.',
    truncated: false,
  };
}

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
    // The updater's active download, or null when launches run the bundle.
    downloadedBin: () => (require('../updates').activeFor(require('./update-source')) || {}).path || null,
    // A failed handshake on a downloaded binary sends new launches back to the last good one.
    rejectBinary: (bin) => require('../updates').reject(require('./update-source'), bin),
  };
}
let deps = defaultDeps();

let held = null; // { key, roster } — the last LIVE answer, never a fallback
let inflight = null; // { key, promise }

/** `<binary>@<binary version>#<credential source>`: synchronous so `model-catalog.js` notices a move on a
 *  look (a runtime update moves both halves); the credential source is in it because the roster is per
 *  account (signed out omits Fable). */
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

function rosterKey() {
  let bin = '?';
  try { bin = String(deps.bin() || '?'); } catch (_) { bin = '?'; }
  return `${bin}@${deps.sdkVersion()}#${deps.credentialSource()}`;
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

async function readLive(key) {
  const sdk = await deps.loadSdk();
  const { rows, moved } = await probeRows(sdk);
  return roster.rosterFrom(rows, {
    // A rejection moved the binary, so the roster is filed under the key of what launches run now.
    key: moved ? rosterKey() : key,
    legacy: legacyAliases(),
    fallbackId: descriptor.launchDefault,
    fallbackAlias: modelTable.aliasForModelId(descriptor.launchDefault),
  });
}

/** The offerable roster. Never throws: a failed read answers the fallback table (`stale`, with the
 *  reason), never an empty list or another runtime's. */
async function models() {
  // Without Dopl's token the probe would run on the operator's own login, so the table answers.
  if (deps.credentialSource() === 'none') return frozenRoster();
  const key = rosterKey();
  if (held && held.key === key) return held.roster;
  if (inflight && inflight.key === key) return inflight.promise;
  const promise = readLive(key)
    .then((live) => {
      if (!live.models.length) return frozenRoster(live.reason);
      held = { key: live.key || key, roster: live };
      return live;
    })
    .catch((err) => frozenRoster(`Dopl could not read Claude Code's model list (${(err && err.message) || 'unknown error'}), so it is showing the list this build shipped with.`))
    .finally(() => { if (inflight && inflight.promise === promise) inflight = null; });
  inflight = { key, promise };
  return promise;
}

/** The roster a SYNCHRONOUS caller resolves against: the live one when held, else the table. */
function current() {
  return (held && held.roster) || frozenRoster();
}

/**
 * The `--model` argument for a pick — `{ ok, arg, id, reason }`, synchronous: the matched row's own
 * `value`. No pick is `launchDefault` on the same roster; `ok: false` is a refusal, never a swap.
 */
function resolveLaunchModel(value) {
  const r = current();
  const v = pickOf(value);
  if (!v) {
    const fallback = descriptor.launchDefault;
    const alias = modelTable.aliasForModelId(fallback);
    const fb = roster.match(r.models, fallback) || roster.match(r.models, alias);
    return fb
      ? { ok: true, arg: fb.value, id: fb.id, reason: '' }
      : { ok: true, arg: alias, id: fallback, reason: '' };
  }
  // Exact id or alias only: a base-id match would resume a `[1m]` pick on the short row (RC-01).
  const row = roster.matchExact(r.models, v);
  if (row) return { ok: true, arg: row.value, id: row.id, reason: '' };
  return { ok: false, arg: '', id: '', reason: notOfferedSentence(require('./index').descriptor.label, v, r.models) };
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

/** Drop the live cache (tests, an explicit re-probe); `inject` swaps the dependencies. */
function forget() { held = null; inflight = null; }
function inject(overrides) { deps = Object.assign(defaultDeps(), overrides || {}); forget(); }

// Descriptor half.
const descriptor = {
  source: 'live',
  // null, not []: no second dimension (the CLI's effort levels are not wired).
  dimensions: null,
  // The model a no-pick launch runs on; this adapter spends it itself (`resolveLaunchModel('')`).
  launchDefault: modelTable.LAUNCH_MODEL_FALLBACK,
  // Storage shape-checks only; the live roster decides what may be selected and launched.
  pick: {
    absent: '',
    pattern: PICK_PATTERN,
  },
  dimensionOptions: null,
};

module.exports = {
  models, rosterKey, buildIdentity, resolveLaunchModel, launchArg, frozenRoster, forget, inject,
  descriptor, PICK_PATTERN, DOWNLOAD_RETRY_TIMEOUT_MS,
};
