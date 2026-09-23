// THE CLAUDE MODEL ROSTER — live (`roster.js` reads `supportedModels()` off a turn-free CLI
// handshake), with this build's table as the fallback when that read fails: the fallback roster is
// marked `stale`, so it labels but proves nothing (`model-catalog.js › vouches`).
// Electron-free at load: the loader and the credential probe are reached lazily (`defaultDeps`),
// because `session-profiles.js` reaches this adapter through the registry and is evaluated standalone.

const modelTable = require('../../session-model');
const roster = require('./roster');
const { pickOf } = require('../selection-vocabulary');
const { notOfferedSentence } = require('../model-catalog');

// The fallback's display names; pinned against web `agent-models.ts › AGENT_MODELS` by
// `test/runtime-model-catalog.test.mjs`. A live roster carries the CLI's own names.
const LABELS = {
  'claude-fable-5': { label: 'Fable 5', short: 'Fable' },
  'claude-opus-5': { label: 'Opus 5', short: 'Opus' },
  'claude-sonnet-5': { label: 'Sonnet 5', short: 'Sonnet' },
  'claude-haiku-4-5-20251001': { label: 'Haiku 4.5', short: 'Haiku' },
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
    env: () => require('../../session-auth').withStoredCredential(require('./loader').buildScrubbedEnv()),
    credentialSource: () => {
      try { return String(require('../../session-auth').credentialState().source || 'none'); } catch (_) { return 'none'; }
    },
    // The platform binary's package: the SDK's `exports` map does not export its `package.json`.
    sdkVersion: () => {
      try {
        return String(require(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`).version || '?');
      } catch (_) { return '?'; }
    },
    probe: roster.probe,
  };
}
let deps = defaultDeps();

let held = null; // { key, roster } — the last LIVE answer, never a fallback
let inflight = null; // { key, promise }

/** `<binary>@<sdk version>#<credential source>`: synchronous so `model-catalog.js` notices a move on a
 *  look; the credential source is in it because the roster is per account (signed out omits Fable). */
function rosterKey() {
  let bin = '?';
  try { bin = String(deps.bin() || '?'); } catch (_) { bin = '?'; }
  return `${bin}@${deps.sdkVersion()}#${deps.credentialSource()}`;
}

async function readLive(key) {
  const sdk = await deps.loadSdk();
  const options = { env: deps.env() };
  const bin = deps.bin();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  const rows = await deps.probe({ sdk, options });
  return roster.rosterFrom(rows, {
    key,
    legacy: legacyAliases(),
    fallbackId: descriptor.launchDefault,
    fallbackAlias: modelTable.aliasForModelId(descriptor.launchDefault),
  });
}

/** The offerable roster. Never throws: a failed read answers the fallback table (`stale`, with the
 *  reason), never an empty list or another runtime's. */
async function models() {
  const key = rosterKey();
  if (held && held.key === key) return held.roster;
  if (inflight && inflight.key === key) return inflight.promise;
  const promise = readLive(key)
    .then((live) => {
      if (!live.models.length) return frozenRoster(live.reason);
      held = { key, roster: live };
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
  models, rosterKey, resolveLaunchModel, launchArg, frozenRoster, forget, inject,
  descriptor, PICK_PATTERN,
};
