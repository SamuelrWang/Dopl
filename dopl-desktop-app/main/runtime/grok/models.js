// Grok's live model roster: `_x.ai/models/list` from a short-lived `grok agent` of its own, in Dopl's private
// home (so it lists what DOPL's sign-in may run, and never loads the operator's config). Bounded, never throws
// into a picker; a failure carries a `reason` (`model-catalog.js`: `unavailable`, not "no models").
// ⚠ SIGNED OUT, GROK STILL ANSWERS — with its BUILT-IN FALLBACK list (`had_real_catalog:false`; it says
// `grok-4.6` has a 500k window where the signed-in roster says 256k, LIVE 2026-10-13). So without the cached
// token advertised (`client.js › cachedTokenOffered`) the roster is NOT read: a reason, never that list.

const client = require('./client');
const { passThroughModelArg } = require('../kit/model-arg');
const configHome = require('./config-home');

const LIST_TIMEOUT_MS = 10000;
const MAX_EFFORT = 64;
const DIMENSION = 'reasoningEffort';
const SIGNED_OUT = 'Grok is not signed in for Dopl. Sign in to Grok (Settings › Agent sign-ins) — signed out, '
  + 'Grok offers only a built-in list Dopl does not use.';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** One `availableModels[]` row → one catalog entry, or null. */
function entryFrom(row, defaultId) {
  if (!row || typeof row !== 'object') return null;
  const id = str(row.modelId);
  if (!id) return null;
  const label = str(row.name) || null;
  const meta = obj(row._meta);
  const options = [];
  let fallback = '';
  for (const v of Array.isArray(meta.reasoningEfforts) ? meta.reasoningEfforts : []) {
    const value = str(v && v.value);
    if (!value || value.length > MAX_EFFORT || options.some((o) => o.value === value)) continue;
    options.push({ value, label: str(v.label) || value, description: str(v.description) || null });
    if (v.default === true) fallback = value;
  }
  const dimensions = {};
  if (options.length && meta.supportsReasoningEffort !== false) {
    if (!fallback) fallback = str(meta.reasoningEffort);
    dimensions[DIMENSION] = { options, default: options.some((o) => o.value === fallback) ? fallback : null };
  }
  return { id, label, short: label, isDefault: id === defaultId, hidden: false, launch: null, dimensions };
}

const cacheKey = (gate) => `${str(gate && gate.path) || '?'}@${str(gate && gate.version) || '?'}`;
const failure = (key, reason) => ({ source: 'live', key, ids: [], models: [], defaultId: null, reason, truncated: false });

/** `_x.ai/models/list`'s result (double-wrapped: `{ result: { currentModelId, availableModels } }`, LIVE). */
function rosterFrom(key, result) {
  const inner = obj(obj(result).result);
  const state = Array.isArray(inner.availableModels) ? inner : obj(result);
  const defaultId = str(state.currentModelId);
  const out = [];
  for (const row of Array.isArray(state.availableModels) ? state.availableModels : []) {
    const entry = entryFrom(row, defaultId);
    if (entry && !out.some((m) => m.id === entry.id)) out.push(entry);
  }
  if (!out.length) return failure(key, 'Grok listed no models.');
  const def = out.find((m) => m.isDefault);
  return {
    source: 'live', key, ids: out.map((m) => m.id), models: out,
    defaultId: def ? def.id : null,
    reason: def ? '' : 'Grok\'s model list names no current model.',
    truncated: false,
  };
}

/** Takes the caller's probe (a second `--version` spawn is waste). */
function fetchRoster(gate, o) {
  const key = cacheKey(gate);
  const opts = o || {};
  if (!gate || !gate.ok) return Promise.resolve(failure(key, (gate && gate.reason) || 'Dopl could not reach Grok.'));
  return new Promise((resolve) => {
    let conn = null;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (conn) conn.close(); } catch (_) { /* best effort */ }
      resolve(value);
    };
    const ms = opts.timeoutMs || LIST_TIMEOUT_MS;
    const timer = setTimeout(() => finish(failure(key, `\`grok agent\` did not answer \`_x.ai/models/list\` within ${ms}ms.`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      // PINNED to the binary the probe checked; the scrubbed env + Dopl's private home.
      const env = opts.env || configHome.isolatedEnv(configHome.buildScrubbedEnv());
      conn = (opts.connect || client.connect)({ bin: gate.path, args: client.agentArgs(), env });
      client.handshake(conn, appVersion())
        .then((init) => {
          if (!client.cachedTokenOffered(init)) return finish(failure(key, SIGNED_OUT));
          return conn.request('_x.ai/models/list', {}).then((result) => finish(rosterFrom(key, result)));
        })
        .catch((err) => finish(failure(key, (err && err.message) || 'Grok refused `_x.ai/models/list`.')));
    } catch (err) {
      finish(failure(key, (err && err.message) || 'Dopl could not start `grok agent`.'));
    }
  });
}

const appVersion = () => { try { return require('../../app-version').appVersion(); } catch (_) { return '0.0.0'; } };

/** ALWAYS LIVE: the one roster cache is the shared catalog's (`../model-catalog.js`). */
async function models() {
  return fetchRoster(await client.probe());
}

const descriptor = {
  source: 'live',
  dimensions: [DIMENSION],
  // No launchDefault: a no-pick launch sets no model, and Grok runs its own current model.
  pick: {
    absent: '',
    pattern: '^grok-[A-Za-z0-9._-]{1,58}$',
  },
  // Live: each model's own `_meta.reasoningEfforts`.
  dimensionOptions: {
    reasoningEffort: { live: true, default: null, fallback: 'absent' },
  },
};

/** Picks pass as given: `availableModels[].modelId` IS the launch value (`session/set_config_option`). */
const modelArg = passThroughModelArg;

module.exports = { models, modelArg, descriptor, entryFrom, rosterFrom, fetchRoster, DIMENSION, LIST_TIMEOUT_MS, SIGNED_OUT };
