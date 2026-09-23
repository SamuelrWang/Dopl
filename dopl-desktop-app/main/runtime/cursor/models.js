// THE CURSOR MODEL ROSTER — `models.list()` off the in-process SDK (no second process). Never throws
// into a picker and never hangs one: bounded, cached once it holds models, and any failure answers an
// empty roster WITH a reason (`model-catalog.js` reads that as `unavailable`).

const client = require('./client');

const LIST_TIMEOUT_MS = 8000;

let cached = null;

// The result shape is undocumented, so ids are taken from whichever plausible shape arrives.
function idsFrom(result) {
  const rows = (result && (result.models || result.data || result.items))
    || (Array.isArray(result) ? result : []);
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (typeof row === 'string' && row) { out.push(row); continue; }
    const id = row && (row.id || row.model || row.name);
    if (typeof id === 'string' && id) out.push(id);
  }
  return out;
}

/** `Cursor.models.list()` under either export shape the beta SDK might use. */
function listFn(sdk) {
  const ns = sdk || {};
  const roots = [ns, ns.default, ns.Cursor, ns.default && ns.default.Cursor];
  for (const root of roots) {
    const models = root && root.models;
    if (models && typeof models.list === 'function') return () => models.list();
  }
  return null;
}

// This platform names nothing: `label` is null and the picker renders the raw id.
const failure = (reason) =>
  ({ source: 'live', key: null, ids: [], models: [], defaultId: null, reason, truncated: false });

function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(onTimeout()), ms);
    promise.then((v) => { clearTimeout(timer); finish(v); },
      (err) => { clearTimeout(timer); finish(failure((err && err.message) || 'models.list failed')); });
  });
}

async function fetchRoster() {
  const gate = await client.probe();
  if (!gate.ok) return failure(gate.reason || 'Dopl could not reach this runtime.');
  let list = null;
  try {
    list = listFn(await client.loadSdk());
  } catch (err) {
    return failure((err && err.message) || 'the SDK would not load');
  }
  if (!list) {
    return failure('this SDK build exposes no models.list()');
  }
  return withTimeout(
    Promise.resolve().then(list).then((result) => {
      const ids = idsFrom(result);
      if (!ids.length) return failure('this runtime answered models.list() with no models Dopl could read');
      return {
        source: 'live',
        // In-process SDK: no binary or version to key on.
        key: null,
        ids,
        // No `isDefault`: the platform declares none, and Dopl does not invent one.
        models: ids.map((id) => ({ id, label: null, short: null, isDefault: false, hidden: false, dimensions: {} })),
        defaultId: null,
        reason: '',
        truncated: false,
      };
    }),
    LIST_TIMEOUT_MS,
    () => failure('models.list() did not answer in time')
  );
}

/** The offerable roster. Only a roster with models in it is cached, so a failure is retried. */
async function models() {
  if (cached) return cached;
  const roster = await fetchRoster();
  if (roster.models.length) cached = roster;
  return roster;
}

/** Drop the cache (tests, an explicit re-probe). */
function forget() { cached = null; }

// Descriptor half.
const descriptor = {
  source: 'live',
  // null: effort variants are separate model ids here, not a dimension.
  dimensions: null,
  // A shape gate only (the value becomes a platform argument); the live roster decides the rest.
  pick: {
    absent: '',
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$',
  },
  dimensionOptions: null,
};

module.exports = { models, forget, descriptor, LIST_TIMEOUT_MS };
