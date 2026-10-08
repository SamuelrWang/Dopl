// THE MODEL CATALOG — one normalized shape for every runtime's roster, in one of four states
// (INVARIANTS §11 — unknown is not empty; collapsing any two is the bug):
//   ready        read and current; `models` is what may be picked.
//   loading      nothing read yet; the empty list means NOTHING (render the platform default).
//   unavailable  a read was attempted and failed; `reason` says why.
//   stale        holds old models (a failed refresh, or an adapter's build-time fallback): they
//                LABEL, they cannot be newly selected, and they prove nothing present or absent.
// A `ready` catalog with zero models is coerced to `unavailable`. Nothing here names a vendor or
// holds a model id. `snapshot` never blocks on a child process; `settle` is the only awaited read.

const liveStore = require('./live-store');
const { rosterKeyOf, rosterIdentityOf } = require('./roster-key');

// The operator's preferred family, or null — never throws into a catalog read.
function preferenceOf(runtimeId, models) {
  try { return require('./model-preferences').preferredModel(runtimeId, models); } catch (_) { return null; }
}

const CATALOG_VERSION = 1;

const { STATUS } = require('./catalog-status');
// The pure readers (what a pick names, what a model offers, whether a catalog vouches), re-exported below.
const { findModel, offeredDimensions, vouches, offers, modelRefusal, notOfferedSentence } = require('./catalog-readers');

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
    // The runtime's own launch argument for this row (a CLI alias, `opus[1m]`), or null = the id itself.
    // Kept so an adapter resolves a launch off this cache alone (2026-10-08: adapters keep no roster).
    launch: str(row.launch) || null,
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
  // The declared launch default — else the operator's preferred FAMILY's newest member (a setting,
  // `model-preferences.js`) — outranks the server's marker (non-stale rosters only), so the picker names
  // what a no-pick launch spends (`launch-default.js`).
  const preferred = roster.stale === true ? null
    : (findModel({ models }, declared.launchDefault) || preferenceOf(runtimeId, models));
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
let readGeneration = 0;

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

// `onLiveReady`: every LIVE read that settles READY (never a persisted stand-in), transition or not.
const readyListeners = [];

/** Call `fn(runtimeId, catalog)` after each live READY read (`catalog-publish.js` subscribes). */
function onLiveReady(fn) {
  if (typeof fn !== 'function') return () => {};
  readyListeners.push(fn);
  return () => {
    const at = readyListeners.indexOf(fn);
    if (at !== -1) readyListeners.splice(at, 1);
  };
}

function noteLiveReady(id, catalog) {
  if (!catalog || catalog.status !== STATUS.READY || catalog.persisted) return;
  for (const fn of readyListeners.slice()) {
    try { fn(id, catalog); } catch (_) { /* a hook never fails a read */ }
  }
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
  if (entry.catalog.persisted === true) return true; // a stand-in from disk: read live behind it
  // READY is cached for the process unless the build key moved (a sign-in, an upgrade; `roster-key.js`).
  if (entry.catalog.status === STATUS.READY) return keyMoved(entry, adapter);
  // `stale` and `unavailable` share the floor; `invalidate` stamps `at: 0` (due at the next look).
  return now - entry.at >= FAILURE_TTL_MS;
}

// A runtime answering no key (null) keeps its READY roster for the process.
function keyMoved(entry, adapter) {
  if (!entry.catalog.key) return false;
  const now = rosterKeyOf(adapter);
  return !!now && now !== entry.catalog.key;
}

// ── THE LAST-LIVE ROSTER (`live-store.js`) ── the ONE persisted copy; adapters keep no roster cache.
// Keyed by the build key: a cold boot on the SAME build and account answers its last live read as READY
// (it is that build's own list) while a live read runs behind it; any other key, or a runtime with no key,
// answers nothing persisted. A stored value is re-normalized on read, so a partial one is dropped, not used.

// ⚠ THE ENTRY SHAPE A STORED ROSTER WAS WRITTEN IN (2026-10-08, cross-review L3): every field
// `normalizeEntry` answers, DERIVED from it, never typed. A roster stored before a field existed (one with
// no `launch`, so a launch would send the full id where the runtime's own alias belongs) is dropped and
// read live, and the next field anyone adds invalidates old stores with nothing to remember to bump.
const ENTRY_SHAPE = Object.keys(normalizeEntry({ id: 'x' })).sort().join(',');

function persistedCatalog(adapter) {
  const { key, accountScoped } = rosterIdentityOf(adapter);
  if (!key) return null;
  const id = adapter.descriptor.id;
  const stored = liveStore.read('roster', id, key);
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.models)) return null;
  if (stored.entryShape !== ENTRY_SHAPE) return null;
  const catalog = catalogFromRoster(id, adapter.descriptor, {
    models: stored.models,
    defaultId: stored.defaultId,
    truncated: stored.truncated === true,
    reason: stored.reason,
    key,
  });
  if (catalog.status !== STATUS.READY) return null;
  // ⚠ PER ACCOUNT (cross-review M2): a key with no account fingerprint proves the BUILD, not whose list
  // this is, so the stand-in only LABELS (`stale`: it cannot refuse or offer a pick) until the live read.
  return Object.assign(catalog, accountScoped ? { persisted: true } : { persisted: true, status: STATUS.STALE });
}

function persist(adapter, catalog) {
  // Filed under the key the READ ran on: a build switched mid-read must not file its list under the new key.
  const key = catalog.key;
  if (!key || catalog.status !== STATUS.READY || catalog.persisted) return;
  liveStore.save('roster', adapter.descriptor.id, key, {
    entryShape: ENTRY_SHAPE,
    models: catalog.models,
    defaultId: catalog.defaultId,
    truncated: catalog.truncated,
    reason: catalog.reason,
  });
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
  const prior = snapshots.get(id) || seedFromDisk(adapter);
  // The key is CORE's, stamped at read time — never the adapter's own spelling of one (`roster-key.js`).
  const readKey = rosterKeyOf(adapter);
  const holds = !!(prior && prior.catalog && prior.catalog.models.length);
  const gen = ++readGeneration;
  const entry = {
    catalog: holds ? prior.catalog : loadingCatalog(id, declared),
    at: now,
    inflight: null,
    dirty: false,
    // The build the read is FOR, and which read this is (Codex self-audit M1): a read answers only for its
    // own key, and a superseded read never files its answer.
    key: readKey,
    gen,
  };
  entry.inflight = Promise.resolve()
    .then(() => adapter.runtime.models())
    .then((roster) => Object.assign(catalogFromRoster(id, adapter.descriptor, roster), { key: readKey }))
    .catch((err) => makeCatalog(id, declared.source, STATUS.UNAVAILABLE, {
      dimensions: Array.isArray(declared.dimensions) ? declared.dimensions.slice() : [],
      reason: (err && err.message) || 'the model roster could not be read',
    }))
    .then((next) => {
      const held = snapshots.get(id);
      // Superseded (a newer read for another key started) or forgotten: this answer is not filed anywhere.
      if (!held || held.gen !== gen) return Object.assign({}, next, { moved: true });
      // The build or account moved while the list was read: it may be either one's, so it is filed under
      // NEITHER — not persisted, not published — and the entry is due a fresh read at the next look.
      if (rosterKeyOf(adapter) !== readKey) {
        snapshots.set(id, { catalog: entry.catalog, at: 0, inflight: null, dirty: false, due: true, key: null });
        return Object.assign({}, next, { moved: true });
      }
      const kept = held && held.catalog && held.catalog.models.length ? held.catalog : null;
      // A failed refresh over held models is `stale` (they still label), not `unavailable`.
      const settled = next.status === STATUS.UNAVAILABLE && kept
        // `persisted` is dropped: a stand-in that failed its live read is held on the failure floor like
        // any stale roster, not re-read on every look.
        ? Object.assign({}, kept, { status: STATUS.STALE, reason: next.reason, persisted: false })
        : next;
      // Invalidated while in flight: the read may predate the repair, so a failure is due at once.
      const dirty = !!(held && held.dirty);
      snapshots.set(id, { catalog: settled, at: dirty && settled.status !== STATUS.READY ? 0 : Date.now(), inflight: null, dirty: false });
      persist(adapter, settled);
      noteSettled(id, settled.status);
      noteLiveReady(id, settled);
      return settled;
    });
  snapshots.set(id, entry);
  return entry.inflight;
}

/** A cold runtime's entry from its last live read on this same build, or null. Never throws. */
function seedFromDisk(adapter) {
  let catalog = null;
  try { catalog = persistedCatalog(adapter); } catch (_) { catalog = null; }
  if (!catalog) return null;
  const entry = { catalog, at: 0, inflight: null, dirty: false };
  snapshots.set(adapter.descriptor.id, entry);
  return entry;
}

/** This runtime's catalog now, never blocking: answers from cache and kicks a background read (the
 *  first answer on a cold process is `loading`). */
function snapshot(adapter) {
  const descriptor = adapter && adapter.descriptor;
  if (!descriptor) return null;
  const id = descriptor.id;
  const declared = descriptor.models || {};
  const now = Date.now();
  const entry = snapshots.get(id) || seedFromDisk(adapter);
  if (due(entry, now, adapter)) refresh(adapter, now);
  const held = snapshots.get(id);
  return (held && held.catalog) || loadingCatalog(id, declared);
}

/** The catalog held for `runtimeId` right now, or null — no read is kicked, nothing waits. */
function peek(runtimeId) {
  const held = snapshots.get(str(runtimeId));
  return (held && held.catalog) || null;
}

/** This runtime's catalog once a read has settled — only a launch may wait on it (`session-launch.js`). */
async function settle(adapter) {
  const descriptor = adapter && adapter.descriptor;
  if (!descriptor) return null;
  const key = rosterKeyOf(adapter);
  let held = snapshots.get(descriptor.id) || null;
  // An in-flight read answers only for the build it is reading (Codex self-audit M1).
  let out;
  if (held && held.inflight && held.key === key) out = await held.inflight;
  else if (held && held.inflight) out = await refresh(adapter, Date.now());
  else if (due(held, Date.now(), adapter)) out = await refresh(adapter, Date.now());
  else return held.catalog;
  // The build switched mid-read: one fresh read for the build this launch will actually run.
  if (out && out.moved) {
    held = snapshots.get(descriptor.id) || null;
    out = held && held.inflight && held.key === rosterKeyOf(adapter) ? await held.inflight : await refresh(adapter, Date.now());
  }
  if (out && out.moved) {
    return makeCatalog(descriptor.id, (descriptor.models && descriptor.models.source) || null, STATUS.UNAVAILABLE, {
      reason: 'the runtime changed builds while Dopl was reading its model list',
    });
  }
  return out;
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
  peek,
  settle,
  findModel,
  offeredDimensions,
  vouches,
  offers,
  modelRefusal,
  notOfferedSentence,
  catalogs,
  invalidate,
  onSettled,
  onLiveReady,
  forget,
};
