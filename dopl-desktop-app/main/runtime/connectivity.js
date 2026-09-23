// WHICH REGISTERED RUNTIMES THIS MAC IS CONNECTED TO — every adapter's `available()`, leashed and
// cached. It never narrows the roster: every runtime is still offered, this only says which would
// start today; `index.js › acquire` re-asks at spawn and owns the refusal. Cached per process
// because the launch popup reads it on every mount and each probe spawns a binary.

/** Per-adapter leash. A probe that has not answered by now reads as NOT connected. */
const LEASH_MS = 1500;
/** How long one sweep stands. Deliberately stale: an unconnected pill stays selectable. */
const TTL_MS = 60000;

/** `{ at, ids }`, or null before the first sweep (the adapter set is fixed at load). */
let cache = null;
/** The sweep in flight: concurrent reads share one probe of each binary. */
let inflight = null;
/** Bumped by `expire`: a sweep that started before a change stamps its answer due (RC-14). */
let generation = 0;

/** One adapter's answer, bounded: every failure (reject, throw, timeout) is `false`. */
function leashed(call) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v === true);
    };
    const timer = setTimeout(() => finish(false), LEASH_MS);
    // Unref'd: a probe still running must never hold the app open at quit.
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
  const started = generation;
  // `allSettled`: one adapter that throws outside its leash decides nothing for the others.
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
  // Stamped when it ends (a full TTL); one that began before an `expire` answers its callers but
  // is due at once (RC-14).
  cache = { at: generation === started ? Date.now() : 0, ids: Object.freeze(ids) };
  return cache.ids;
}

/** The ids of `adapters` whose `available()` answered ok, in registry order. Takes the list rather
 *  than reaching for the registry, so this file names no runtime. */
function connectedIds(adapters) {
  const list = Array.isArray(adapters) ? adapters : [];
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.ids);
  if (inflight) return inflight;
  inflight = sweep(list).finally(() => { inflight = null; });
  return inflight;
}

/** Drop the cached sweep — for the suites only (a timed refresh is the spawn storm the cache prevents). */
function resetConnectivityCache() {
  cache = null;
  inflight = null;
  generation += 1;
}

/**
 * Expire the standing sweep because a change was observed (event-driven: `channel-runtime-reply.js`
 * calls it when a catalog settles into a new verdict). It leaves an in-flight sweep alone — one
 * probe per binary — and bumps the generation so that sweep's answer is not cached.
 */
function expire() {
  cache = null;
  generation += 1;
}

module.exports = { connectedIds, resetConnectivityCache, expire, LEASH_MS, TTL_MS };
