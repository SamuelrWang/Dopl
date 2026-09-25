// The RUNTIME half of `channels:getLaunchPosture` / `channels:getAgentDefaults` replies: the adapter
// roster, which ones this Mac is connected to, and each runtime's model catalog. Adds no IPC op and
// no authority (called inside the two `appWindowOnly` handlers); discloses no path, credential or
// version. Descriptors are deep-frozen data (`contract.js › sealAdapter`) so they survive the
// structured-clone hop. `runtimes` is EVERY registered adapter, never shortened to `connected`
// (Samuel): the roster is how an operator learns a runtime exists. It never fails the read and
// never blocks on a child process: catalogs answer from cache (`loading` is not "no models").

const runtimeRegistry = require('./runtime');
const modelCatalog = require('./runtime/model-catalog');
const permissionLevel = require('./runtime/permission-level');
const { diag } = require('./diag');

/** Every registered adapter, or `[]` when the registry has no such accessor (a mid-wave harness). */
function adapters() {
  try { return runtimeRegistry.all() || []; } catch (err) {
    diag('channel runtime reply: no adapter roster —', err && err.message);
    return [];
  }
}

// `connected` (60s sweep) and each catalog are two caches over one fact — can this Mac run that
// runtime — so each one's CHANGE invalidates the other (event-driven, no timer): a runtime entering
// or leaving `connected` invalidates its catalog; a catalog whose settled verdict changes expires the
// sweep. Both hooks are optional (stubs lack them); a cache hint never fails the read.

let lastConnected = null; // Set of ids from the previous read, or null before the first

function noteConnected(ids) {
  const now = new Set(ids);
  const before = lastConnected;
  lastConnected = now;
  if (!before || typeof modelCatalog.invalidate !== 'function') return;
  for (const id of new Set([...before, ...now])) {
    if (before.has(id) === now.has(id)) continue;
    try {
      modelCatalog.invalidate(id, now.has(id)
        ? 'this runtime just connected, so its model list is being re-read'
        : 'this runtime just disconnected, so its model list could not be confirmed');
    } catch (_) { /* a cache hint never fails the read */ }
  }
}

if (typeof modelCatalog.onSettled === 'function') {
  modelCatalog.onSettled(() => {
    try {
      if (typeof runtimeRegistry.expireConnectivity === 'function') runtimeRegistry.expireConnectivity();
    } catch (_) { /* a cache hint never fails the read */ }
  });
}

/** Always the same keys, so the SPA's own-key probes answer the same on both ops. */
async function runtimeReply() {
  const connected = await Promise.resolve()
    .then(() => runtimeRegistry.connectedIds())
    .catch(() => []);
  noteConnected(Array.isArray(connected) ? connected : []);
  let catalogs = {};
  try { catalogs = modelCatalog.catalogs(adapters()); } catch (err) {
    diag('channel runtime reply: model catalogs unavailable —', err && err.message);
  }
  return {
    runtimes: adapters().map((a) => a.descriptor),
    defaultRuntime: runtimeRegistry.DEFAULT_ID,
    // Ids in registry order; the SPA reads an absent key as "did not say", not "none" (INVARIANTS §8).
    connected: Array.isArray(connected) ? connected.slice() : [],
    // The SPA checks this before trusting the catalog shape.
    catalogVersion: modelCatalog.CATALOG_VERSION,
    catalogs,
    // Each runtime's reading of Ask / Auto / Full, so the SPA renders it and never derives it.
    permissionLevels: Object.fromEntries(adapters().map((a) => [a.descriptor.id, permissionLevel.levelTableFor(a.descriptor)])),
  };
}

module.exports = { runtimeReply };
