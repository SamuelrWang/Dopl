// WHICH REGISTERED RUNTIMES THIS MAC IS ACTUALLY CONNECTED TO — `available()`, asked of every
// adapter at once, bounded, and cached.
//
// ⚠ WHY IT EXISTS AT ALL (2026-09-08, Samuel's correction). The New-agent popup lists EVERY
// registered runtime, always — *"even if the user does not have codex or cursor connected, I still
// want them to be options there so that the user knows that those are options, so they can connect
// them"* — and the thing it needed from main was not a shorter list but a FACT about each entry:
// *"It should just be logged in, like it is just put in their default, right?"* So this answers one
// question, `connected`, and REMOVES nothing: narrowing the roster is what the previous pass got
// wrong, and it is the one change this module must never be used to make.
//
// ⚠ IT IS THE SPAWN-TIME GATE'S QUESTION, ASKED EARLY — the same `available()`
// (`runtime/index.js › acquire`) with the same meaning per adapter: Claude answers "can the
// platform module load", Codex "is there a `codex` on PATH that runs", Cursor "can this build load
// the SDK". It is NOT the credential probe and NOT a promise that a launch will succeed; the
// refusal an operator actually sees still comes from `acquire`, which re-asks at spawn.
//
// ⚠ LEASHED, BECAUSE THESE PROBES SPAWN BINARIES. `codex/client.js` already states the rule for
// its own 5s probe — *"a binary that never answers must read as absent rather than as a stuck
// session"* — and a UI read cannot afford even that: the popup is waiting on this reply. So each
// adapter gets {@link LEASH_MS}, and a probe that has not answered by then is NOT CONNECTED. It is
// never an error: a rejection, a throw, an adapter with no `available` and a timeout are one
// answer, because on the surface that consumes this they mean one thing.
//
// ⚠ CACHED 60s PER PROCESS, AND THE STALENESS IS THE DESIGN. `channels:getLaunchPosture` is read
// on every mount of the popup, of the Settings tab and of every pop-out; probing three binaries
// per read would put an `execFile` storm behind a dialog opening. The cost of the staleness is
// bounded and one-directional in practice — an operator who installs Codex sees it within a
// minute, and an unconnected pill stays SELECTABLE, so a stale "not connected" never blocks a
// launch (spawn-time refusal is what explains a real one).

/** Per-adapter leash. A probe that has not answered by now reads as NOT connected. */
const LEASH_MS = 1500;
/** How long one probe sweep stands. ⚠ Deliberately stale — see the header. */
const TTL_MS = 60000;

/** `{ at, ids }`, or null before the first sweep. ⚠ Module-level: the adapter SET is fixed at
 *  load, so there is nothing to key it by. */
let cache = null;
/** The sweep in flight, so N concurrent posture reads run ONE probe rather than N. */
let inflight = null;

/**
 * One adapter's answer, bounded and reduced to a boolean.
 * ⚠ EVERY FAILURE IS `false`, INCLUDING THE TIMEOUT — see the header on why the four failure
 * shapes are one answer here.
 */
function leashed(call) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v === true);
    };
    const timer = setTimeout(() => finish(false), LEASH_MS);
    // ⚠ UNREF'D: a probe still running must never hold the app open at quit.
    if (timer && typeof timer.unref === 'function') timer.unref();
    Promise.resolve()
      .then(call)
      .then(
        (gate) => { clearTimeout(timer); finish(!!gate && gate.ok === true); },
        () => { clearTimeout(timer); finish(false); }
      );
  });
}

async function sweep(list) {
  // ⚠ `allSettled`, NOT `all`: one adapter that rejects must not decide the answer for the other
  // two. The leash already reduces each entry, so this is the belt for a throw thrown OUTSIDE it.
  const settled = await Promise.allSettled(
    list.map((a) => {
      const rt = a && a.runtime;
      if (!rt || typeof rt.available !== 'function') return false;
      return leashed(() => rt.available());
    })
  );
  const ids = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = settled[i];
    const id = list[i] && list[i].descriptor && list[i].descriptor.id;
    if (id && entry && entry.status === 'fulfilled' && entry.value === true) ids.push(id);
  }
  // ⚠ STAMPED WHEN THE SWEEP ENDS, not when it began: a sweep that spent its whole leash must
  // still stand for a full TTL rather than expiring the moment it lands.
  cache = { at: Date.now(), ids: Object.freeze(ids) };
  return cache.ids;
}

/**
 * The ids of every adapter in `adapters` that answered `available(): {ok:true}`, in REGISTRY
 * ORDER. ⚠ IT TAKES THE ADAPTER LIST rather than reaching for the registry, so this file names no
 * vendor and holds no second opinion about which runtimes exist (`runtime/index.js` is the only
 * place an adapter is named).
 */
function connectedIds(adapters) {
  const list = Array.isArray(adapters) ? adapters : [];
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.ids);
  if (inflight) return inflight;
  inflight = sweep(list).finally(() => { inflight = null; });
  return inflight;
}

/** Drop the cached sweep. ⚠ FOR THE SUITES AND FOR NOTHING ELSE — a caller that "refreshes"
 *  this on a timer is the `execFile` storm the cache exists to prevent. */
function resetConnectivityCache() {
  cache = null;
  inflight = null;
}

module.exports = { connectedIds, resetConnectivityCache, LEASH_MS, TTL_MS };
