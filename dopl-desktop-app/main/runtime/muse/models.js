// Muse's live model roster: `model/list` from a short-lived `muse serve` of its own, in Dopl's private home
// (so it lists what DOPL's sign-in may run, and never loads the operator's config). Bounded, never throws
// into a picker; a failure carries a `reason` (`model-catalog.js`: `unavailable`, not "no models").
// Measured 1.4.7: signed out, `model/list` answers `models: []` — an EMPTY catalog is a reason, not a roster.

const client = require('./client');
const { passThroughModelArg } = require('../kit/model-arg');
const configHome = require('./config-home');

const LIST_TIMEOUT_MS = 8000;
const MAX_EFFORT = 64;
const DIMENSION = 'reasoningEffort';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** One `ModelCatalogEntry` → one catalog entry, or null. */
function entryFrom(row) {
  if (!row || typeof row !== 'object') return null;
  const id = str(row.modelId);
  if (!id) return null;
  const label = str(row.displayLabel) || null;
  const options = [];
  for (const v of Array.isArray(row.reasoningEffortVariants) ? row.reasoningEffortVariants : []) {
    const value = str(v && v.tier);
    if (!value || value.length > MAX_EFFORT || options.some((o) => o.value === value)) continue;
    options.push({ value, label: value, description: str(v.description) || null });
  }
  const dimensions = {};
  if (options.length) {
    const fallback = str(row.defaultReasoningEffort);
    dimensions[DIMENSION] = { options, default: options.some((o) => o.value === fallback) ? fallback : null };
  }
  return { id, label, short: label, isDefault: row.isDefault === true, hidden: false, launch: null, dimensions };
}

const cacheKey = (gate) => `${str(gate && gate.path) || '?'}@${str(gate && gate.version) || '?'}`;
const failure = (key, reason) => ({ source: 'live', key, ids: [], models: [], defaultId: null, reason, truncated: false });

function rosterFrom(key, rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const entry = entryFrom(row);
    if (entry && !out.some((m) => m.id === entry.id)) out.push(entry);
  }
  if (!out.length) {
    return failure(key, 'Muse listed no models. Sign in to Muse (Settings › Agent sign-ins) — signed out, Muse offers none.');
  }
  const defaults = out.filter((m) => m.isDefault);
  return {
    source: 'live', key, ids: out.map((m) => m.id), models: out,
    defaultId: defaults.length === 1 ? defaults[0].id : null,
    reason: defaults.length === 1 ? '' : `Muse's model list declares ${defaults.length} defaults; exactly one is expected.`,
    truncated: false,
  };
}

/** Takes the caller's probe (a second `--version` spawn is waste). */
function fetchRoster(gate) {
  const key = cacheKey(gate);
  if (!gate || !gate.ok) return Promise.resolve(failure(key, (gate && gate.reason) || 'Dopl could not reach Muse.'));
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
    const timer = setTimeout(() => finish(failure(key, `\`muse serve\` did not answer \`model/list\` within ${LIST_TIMEOUT_MS}ms.`)), LIST_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      // PINNED to the binary the probe checked; the scrubbed env + Dopl's private home.
      const env = configHome.isolatedEnv(configHome.buildScrubbedEnv());
      conn = client.connect({ bin: gate.path, args: client.serveArgs({ provider: 'meta' }), env });
      client.handshake(conn, appVersion())
        .then(() => conn.request('model/list', {}))
        .then((result) => finish(rosterFrom(key, result && result.models)))
        .catch((err) => finish(failure(key, (err && err.message) || 'Muse refused `model/list`.')));
    } catch (err) {
      finish(failure(key, (err && err.message) || 'Dopl could not start `muse serve`.'));
    }
  });
}

const appVersion = () => require('../../app-version').appVersion();

/** ALWAYS LIVE: the one roster cache is the shared catalog's (`../model-catalog.js`). */
async function models() {
  return fetchRoster(await client.probe());
}

const descriptor = {
  source: 'live',
  dimensions: [DIMENSION],
  // No launchDefault: a no-pick launch sends no `modelId`, and Muse runs its own default.
  pick: {
    absent: '',
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$',
  },
  // Live: each model's own `reasoningEffortVariants`; the build's schema decides what may be SENT
  // (`launch-spec.js › effortFor`).
  dimensionOptions: {
    reasoningEffort: { live: true, default: null, fallback: 'absent' },
  },
};

/** Picks pass as given: `model/list › modelId` IS the launch value (`session/start.modelId`). */
const modelArg = passThroughModelArg;

module.exports = { models, modelArg, descriptor, entryFrom, rosterFrom, fetchRoster, DIMENSION, LIST_TIMEOUT_MS };
