// THE MODEL CATALOG — one normalized shape for every runtime's roster, in one of four states
// (INVARIANTS §11 — unknown is not empty; collapsing any two is the bug):
//   ready        read and current; `models` is what may be picked.
//   loading      nothing read yet; the empty list means NOTHING (render the platform default).
//   unavailable  a read was attempted and failed; `reason` says why.
//   stale        holds old models (a failed refresh, or an adapter's build-time fallback): they
//                LABEL, they cannot be newly selected, and they prove nothing present or absent.
// A `ready` catalog with zero models is coerced to `unavailable`. Nothing here names a vendor or
// holds a model id. `snapshot` never blocks on a child process; `settle` is the only awaited read.

const { pickOf } = require('./selection-vocabulary');

const CATALOG_VERSION = 1;

const STATUS = Object.freeze({
  READY: 'ready',
  LOADING: 'loading',
  UNAVAILABLE: 'unavailable',
  STALE: 'stale',
});

// A failed read is retried at the next LOOK past this floor (never on a timer); a good one is kept.
const FAILURE_TTL_MS = 5000;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * One model, normalized. Every field but `id` is optional and absent is `null`, never `''`.
 * `dimensions` is per MODEL (Codex's supported efforts differ between models).
 */
function normalizeEntry(row) {
  if (typeof row === 'string') {
    const id = str(row);
    return id ? { id, label: null, short: null, isDefault: false, hidden: false, aliases: [], dimensions: {} } : null;
  }
  if (!row || typeof row !== 'object') return null;
  const id = str(row.id);
  if (!id) return null;
  const label = str(row.label) || str(row.displayName) || null;
  return {
    id,
    label,
    // Falls back to the full label, never to a truncation.
    short: str(row.short) || label,
    isDefault: row.isDefault === true,
    // Kept (out of ordinary pickers) so a session already on a hidden model is still labelled.
    hidden: row.hidden === true,
    // Other spellings of this model (legacy id, launch alias): matched by `findModel`, never offered.
    aliases: aliasesOf(row.aliases, id),
    dimensions: normalizeDimensions(row.dimensions),
  };
}

function aliasesOf(raw, id) {
  const out = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const a = str(v);
    if (a && a !== id && out.indexOf(a) === -1) out.push(a);
  }
  return out;
}

/** `{ <dimensionKey>: { options: [{value,label,description}], default } }`, or `{}`. */
function normalizeDimensions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of Object.keys(raw)) {
    const d = raw[key];
    if (!d || typeof d !== 'object') continue;
    const options = [];
    for (const opt of Array.isArray(d.options) ? d.options : []) {
      const value = typeof opt === 'string' ? str(opt) : str(opt && opt.value);
      if (!value || options.some((o) => o.value === value)) continue;
      options.push({
        value,
        label: (opt && str(opt.label)) || value,
        description: (opt && str(opt.description)) || null,
      });
    }
    if (!options.length) continue; // a dimension with no options is a control that writes nowhere
    const fallback = str(d.default);
    out[key] = {
      options,
      default: options.some((o) => o.value === fallback) ? fallback : null,
    };
  }
  return out;
}

/** The catalog a renderer receives: the same keys on every status. */
function makeCatalog(runtimeId, source, status, extra) {
  return Object.assign({
    version: CATALOG_VERSION,
    runtime: str(runtimeId),
    source: str(source) || null,
    status,
    reason: '',
    key: null,
    models: [],
    defaultId: null,
    dimensions: [],
    truncated: false,
  }, extra || {});
}

/**
 * An adapter's roster reply as a catalog. Malformed rows are dropped; exactly one default survives
 * (the first `isDefault` wins).
 */
function catalogFromRoster(runtimeId, descriptor, roster) {
  const declared = (descriptor && descriptor.models) || {};
  const source = str(declared.source) || (roster && str(roster.source)) || null;
  const dims = Array.isArray(declared.dimensions) ? declared.dimensions.slice() : [];
  if (!roster || typeof roster !== 'object') {
    return makeCatalog(runtimeId, source, STATUS.UNAVAILABLE, {
      dimensions: dims,
      reason: 'this runtime did not answer with a model roster',
    });
  }
  const reason = str(roster.reason);
  const key = str(roster.key) || null;
  const rows = Array.isArray(roster.models) ? roster.models : [];
  const models = [];
  for (const row of rows) {
    const entry = normalizeEntry(row);
    if (entry && !models.some((m) => m.id === entry.id)) models.push(entry);
  }
  let defaultId = null;
  for (const m of models) {
    if (!m.isDefault) continue;
    if (defaultId === null) defaultId = m.id;
    else m.isDefault = false;
  }
  const asked = str(roster.defaultId);
  if (!defaultId && asked && models.some((m) => m.id === asked)) {
    defaultId = asked;
    for (const m of models) m.isDefault = m.id === asked;
  }
  // The declared launch default outranks the server's marker (non-stale rosters only), so the
  // picker names what a no-pick launch spends (`launch-default.js`).
  const preferred = roster.stale === true ? null : findModel({ models }, declared.launchDefault);
  if (preferred) {
    defaultId = preferred.id;
    for (const m of models) m.isDefault = m === preferred;
  }
  if (!models.length) {
    return makeCatalog(runtimeId, source, STATUS.UNAVAILABLE, {
      dimensions: dims,
      key,
      reason: reason || 'Dopl could not read this runtime\'s model list.',
    });
  }
  // An adapter that answered its build's own table after a failed live read marks it stale.
  const status = roster.stale === true ? STATUS.STALE : STATUS.READY;
  return makeCatalog(runtimeId, source, status, {
    dimensions: dims,
    key,
    models,
    defaultId,
    truncated: roster.truncated === true,
    // On `ready` the reason is a note (truncated, no single default); consumers read the status.
    reason,
  });
}

// ── THE SNAPSHOT CACHE ── keyed by runtime id; one refresh in flight per runtime (never two app-servers).

const snapshots = new Map();

// Settled verdicts for `onSettled`; `loading` is never recorded (a retry in flight is no transition).
const settledStatus = new Map();
const listeners = [];

/**
 * Call `fn(runtimeId, from, to)` when a runtime's settled verdict changes; the first verdict is not a
 * transition. A hook, so this module need not require the connectivity layer
 * (`channel-runtime-reply.js` subscribes). A listener that throws never fails a read.
 */
function onSettled(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.push(fn);
  return () => {
    const at = listeners.indexOf(fn);
    if (at !== -1) listeners.splice(at, 1);
  };
}

function noteSettled(id, status) {
  const from = settledStatus.has(id) ? settledStatus.get(id) : null;
  settledStatus.set(id, status);
  if (from === null || from === status) return;
  for (const fn of listeners.slice()) {
    try { fn(id, from, status); } catch (_) { /* a hook never fails a read */ }
  }
}

function due(entry, now, adapter) {
  if (!entry) return true;
  if (entry.inflight) return false;
  if (entry.due === true) return true; // invalidated while holding models (RC-02)
  // READY is cached for the process unless `runtime.rosterKey()` moved (a sign-in, an upgrade).
  if (entry.catalog.status === STATUS.READY) return keyMoved(entry, adapter);
  // `stale` and `unavailable` share the floor; `invalidate` stamps `at: 0` (due at the next look).
  return now - entry.at >= FAILURE_TTL_MS;
}

// A runtime answering no key (null) keeps its READY roster for the process.
function keyMoved(entry, adapter) {
  const fn = adapter && adapter.runtime && adapter.runtime.rosterKey;
  if (typeof fn !== 'function' || !entry.catalog.key) return false;
  try {
    const now = str(fn.call(adapter.runtime));
    return !!now && now !== entry.catalog.key;
  } catch (_) { return false; }
}

const loadingCatalog = (id, declared) => makeCatalog(id, (declared && str(declared.source)) || null, STATUS.LOADING, {
  dimensions: Array.isArray(declared && declared.dimensions) ? declared.dimensions.slice() : [],
});

/**
 * The only place `runtime.models()` is called; a rejection becomes an `unavailable` catalog and never
 * escapes. A retry over a model-less catalog reads `loading` (the renderer re-polls only on
 * `loading`); a catalog that holds models keeps them, and its status, while it re-reads.
 */
function refresh(adapter, now) {
  const id = adapter.descriptor.id;
  const declared = adapter.descriptor.models || {};
  const prior = snapshots.get(id) || null;
  const holds = !!(prior && prior.catalog && prior.catalog.models.length);
  const entry = {
    catalog: holds ? prior.catalog : loadingCatalog(id, declared),
    at: now,
    inflight: null,
    dirty: false,
  };
  entry.inflight = Promise.resolve()
    .then(() => adapter.runtime.models())
    .then((roster) => catalogFromRoster(id, adapter.descriptor, roster))
    .catch((err) => makeCatalog(id, declared.source, STATUS.UNAVAILABLE, {
      dimensions: Array.isArray(declared.dimensions) ? declared.dimensions.slice() : [],
      reason: (err && err.message) || 'the model roster could not be read',
    }))
    .then((next) => {
      const held = snapshots.get(id);
      const kept = held && held.catalog && held.catalog.models.length ? held.catalog : null;
      // A failed refresh over held models is `stale` (they still label), not `unavailable`.
      const settled = next.status === STATUS.UNAVAILABLE && kept
        ? Object.assign({}, kept, { status: STATUS.STALE, reason: next.reason })
        : next;
      // Invalidated while in flight: the read may predate the repair, so a failure is due at once.
      const dirty = !!(held && held.dirty);
      snapshots.set(id, { catalog: settled, at: dirty && settled.status !== STATUS.READY ? 0 : Date.now(), inflight: null, dirty: false });
      noteSettled(id, settled.status);
      return settled;
    });
  snapshots.set(id, entry);
  return entry.inflight;
}

/** This runtime's catalog now, never blocking: answers from cache and kicks a background read (the
 *  first answer on a cold process is `loading`). */
function snapshot(adapter) {
  const descriptor = adapter && adapter.descriptor;
  if (!descriptor) return null;
  const id = descriptor.id;
  const declared = descriptor.models || {};
  const now = Date.now();
  const entry = snapshots.get(id) || null;
  if (due(entry, now, adapter)) refresh(adapter, now);
  const held = snapshots.get(id);
  return (held && held.catalog) || loadingCatalog(id, declared);
}

/** This runtime's catalog once a read has settled — only a launch may wait on it (`session-launch.js`). */
async function settle(adapter) {
  const descriptor = adapter && adapter.descriptor;
  if (!descriptor) return null;
  const held = snapshots.get(descriptor.id) || null;
  if (held && held.inflight) return held.inflight;
  if (due(held, Date.now(), adapter)) return refresh(adapter, Date.now());
  return held.catalog;
}

/** The catalog entry a pick names — its `id`, else one of its `aliases`. `null` when none does. */
function findModel(catalog, pick) {
  const v = str(pick);
  const models = (catalog && Array.isArray(catalog.models)) ? catalog.models : [];
  if (!v) return null;
  return models.find((m) => m.id === v)
    || models.find((m) => Array.isArray(m.aliases) && m.aliases.indexOf(v) !== -1)
    || null;
}

/** Can this catalog vouch for a model's presence OR absence? Only a READY read can (RC-03). */
function vouches(catalog) {
  return !!catalog && catalog.status === STATUS.READY && Array.isArray(catalog.models) && catalog.models.length > 0;
}

/** Does this catalog prove `id` is offered? */
function offers(catalog, id) {
  return vouches(catalog) && !!findModel(catalog, id);
}

/**
 * Why a launch naming `pick` is refused, or `null`. An unknown model is refused with a sentence,
 * never swapped. Only a catalog that vouches can refuse ("could not read the list" is not "that
 * model does not exist"); no pick (absent / `'default'`) is never refused.
 */
function modelRefusal(catalog, pick, label) {
  const v = pickOf(pick);
  if (!v || !vouches(catalog)) return null;
  if (findModel(catalog, v)) return null;
  return notOfferedSentence(label, v, catalog.models);
}

/** The refusal sentence for a pick `models` lacks, listing what is offered (hidden rows omitted). */
function notOfferedSentence(label, pick, models) {
  const offered = (models || []).filter((m) => !m.hidden).map((m) => m.label || m.id).join(', ');
  return `${label || 'This runtime'} does not offer the model "${pick}" on this machine`
    + (offered ? ` — it offers: ${offered}` : '') + '.';
}

/** Every runtime's catalog, keyed by id (what a settings read sends). One adapter's throw takes
 *  nothing else with it. */
function catalogs(adapters) {
  const out = {};
  for (const adapter of Array.isArray(adapters) ? adapters : []) {
    const id = adapter && adapter.descriptor && adapter.descriptor.id;
    if (!id) continue;
    try { out[id] = snapshot(adapter); } catch (err) {
      out[id] = makeCatalog(id, null, STATUS.UNAVAILABLE, {
        reason: (err && err.message) || 'the model roster could not be read',
      });
    }
  }
  return out;
}

/**
 * Mark a runtime's catalog for re-read (reconnect / repair / version change). One that holds models
 * keeps them and its status, only marked due (the renderer re-polls only `loading`, RC-02); one that
 * holds none becomes `loading`. A read in flight is marked dirty, never raced (one app-server).
 */
function invalidate(runtimeId, _reason) {
  const id = str(runtimeId);
  const held = snapshots.get(id);
  if (!held || !held.catalog) return false;
  if (held.inflight) {
    held.dirty = true;
    return true;
  }
  if (held.catalog.models.length) {
    snapshots.set(id, { catalog: held.catalog, at: 0, inflight: null, dirty: false, due: true });
    return true;
  }
  const catalog = makeCatalog(id, held.catalog.source, STATUS.LOADING, { dimensions: held.catalog.dimensions.slice() });
  snapshots.set(id, { catalog, at: 0, inflight: null, dirty: false });
  return true;
}

/** Drop everything cached — for tests and an explicit re-probe only. */
function forget(runtimeId) {
  if (runtimeId === undefined) { snapshots.clear(); settledStatus.clear(); return; }
  snapshots.delete(str(runtimeId));
  settledStatus.delete(str(runtimeId));
}

module.exports = {
  CATALOG_VERSION,
  FAILURE_TTL_MS,
  catalogFromRoster,
  makeCatalog,
  snapshot,
  settle,
  findModel,
  vouches,
  offers,
  modelRefusal,
  notOfferedSentence,
  catalogs,
  invalidate,
  onSettled,
  forget,
};
