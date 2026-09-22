// WHAT A SETTINGS READ SAYS ABOUT **RUNTIMES** — the half of `channels:getLaunchPosture` and
// `channels:getAgentDefaults` that is about the registry rather than about a channel.
//
// ⚠ **SPLIT OUT OF `main/channel-dir-ipc.js` ON 2026-09-21 (U6), AT THE §1 CAP AND ON A REAL
// SEAM.** That file's one reason to change is *which per-channel SETTING has an op*; this one's is
// *what a settings reply tells the SPA about the runtimes this desktop ships*. They had already
// drifted into being two reasons in one file: both handlers assembled the same four fields by
// hand, so "the roster is never shortened" and "connectivity never fails the read" were two copies
// of one rule, and U6's catalogs would have made it three.
//
// ⚠ **IT ADDS NO IPC OP AND NO AUTHORITY.** It is called from inside the two handlers that are
// already `appWindowOnly`-bound and UUID-gated; nothing here registers a channel, reads a payload,
// or touches the store.
//
// ⚠ **IT DISCLOSES NOTHING PRIVILEGED**, on `channel-dir-ipc.js`'s own terms: what a runtime can
// do, its own mode vocabulary, the sentences a refusal carries, which adapters answered a probe,
// and each runtime's model list. No path, no credential, no token, no version string.
//
// ── ⚠ THE DESCRIPTOR TABLE, AND WHY IT SURVIVES THE HOP ──────────────────────────────────────
//
// `runtime/contract.js › sealAdapter` deep-freezes every descriptor and REFUSES one carrying a
// function, exactly so it survives the structured-clone hop and reaches the UI as DATA rather than
// as `undefined` — which is the one meaning ("capability absent") that must never be produced by
// accident.
//
// ── ⚠ THE ROSTER IS NEVER SHORTENED (2026-09-08, Samuel's correction) ────────────────────────
//
// Verbatim, after a pass that narrowed the popup's roster to the connected ones: *"No, even if the
// user does not have codex or cursor connected, I still want them to be options there so that the
// user knows that those are options, so they can connect them. It should just be logged in, like
// it is just put in their default, right? I did not say to remove them."* So `runtimes` is every
// registered adapter, always, and `connected` is a FACT ABOUT EACH ENTRY beside it. ⚠ A future
// reader shortening `runtimes` to `connected` is undoing this ruling.
//
// ⚠ `connected` IS A CACHED PROBE AND IS 60s STALE BY DESIGN (`runtime/connectivity.js` carries
// the whole argument): each adapter's `available()` under a 1500ms leash, a hang reading as
// ABSENT, and the sweep standing for a minute so opening a dialog does not spawn three binaries.
//
// ── ⚠ AND SINCE 2026-09-21 (U6) IT CARRIES EACH RUNTIME'S MODEL CATALOG ──────────────────────
//
// The catalogs ride these two reads for `runtime`'s and `model`'s stated reason — the same
// Settings rows read them, and a fourth op would be a fourth thing for the SPA to feature-probe
// for one more field on a record it already fetches. `renderer/app-preload.js` is at the §1 cap
// and `test/preload-parity.test.mjs` forbids it requiring anything but `electron`, so a new bridge
// NAMESPACE is not available here anyway.
//
// ⚠ **IT NEVER BLOCKS THE READ ON A CHILD PROCESS.** A live roster costs a `codex app-server`
// spawn; `runtime/model-catalog.js › snapshot` answers from cache and kicks a BACKGROUND read, so
// a cold process answers `status: 'loading'` — a DIFFERENT statement from "no models", which is
// exactly what that status exists to say (INVARIANTS §11 — UNKNOWN is not EMPTY).
//
// ⚠ **NOTHING HERE FAILS THE READ.** Every probe failure is "not connected" and every catalog
// failure is an empty map; a settings tab that would not open over a roster it does not need to
// render is a worse failure than a picker with no list. Both absences are read on the other side
// as "this build did not say", which is the same third state an older desktop produces.

const runtimeRegistry = require('./runtime');
const modelCatalog = require('./runtime/model-catalog');
const { diag } = require('./diag');

/** Every registered adapter, or `[]` when the registry has no such accessor (a mid-wave harness). */
function adapters() {
  try { return runtimeRegistry.all() || []; } catch (err) {
    diag('channel runtime reply: no adapter roster —', err && err.message);
    return [];
  }
}

/**
 * THE RUNTIME HALF OF A SETTINGS REPLY. ⚠ ALWAYS THE SAME FIVE KEYS, so the SPA's OWN-KEY probes
 * ("does this desktop have a runtime concept at all") answer the same on both ops.
 */
async function runtimeReply() {
  const connected = await Promise.resolve()
    .then(() => runtimeRegistry.connectedIds())
    .catch(() => []);
  let catalogs = {};
  try { catalogs = modelCatalog.catalogs(adapters()); } catch (err) {
    diag('channel runtime reply: model catalogs unavailable —', err && err.message);
  }
  return {
    runtimes: adapters().map((a) => a.descriptor),
    defaultRuntime: runtimeRegistry.DEFAULT_ID,
    // ⚠ A PLAIN ARRAY OF IDS, in registry order, and OPTIONAL by contract on the other end: a
    // desktop older than 2026-09-08 omits it entirely, and the SPA must read that absence as
    // "this build did not say" rather than as "nothing is connected" (INVARIANTS §8).
    connected: Array.isArray(connected) ? connected.slice() : [],
    // ⚠ THE VERSION IS WHAT THE SPA CHECKS BEFORE IT TRUSTS THE SHAPE — a renderer holding a
    // different one must fall back rather than assume.
    catalogVersion: modelCatalog.CATALOG_VERSION,
    catalogs,
  };
}

module.exports = { runtimeReply };
