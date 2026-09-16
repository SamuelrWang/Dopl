// THE SUPABASE REFRESH POST, BOUNDED — the one network call in `auth.js` that had no deadline.
//
// 🔒 **`refresh()` IS SINGLE-FLIGHT, SO AN UNBOUNDED POST HERE WEDGES EVERY LANE THAT NEEDS A
// CREDENTIAL** (F-698, 2026-09-14). After a sleep/wake the undici pool can hold a dead socket
// (`api.js › resetPool`) and a POST on one hangs until the OS gives up — measured at ~25 minutes,
// during which the session-state push, the listener's first reconcile and presence's first beat
// all awaited the same promise, and the two with their own single-flight guard stayed wedged for
// the life of the process.
//
// ⚠ WHY A MODULE. `auth.js` sits at the 500-line cap, and the seam is real: this is the TRANSPORT
// (url, headers, body, deadline) and nothing about what the answer MEANS — the status/code rules
// stay in `auth.js` beside `auth-token-rules.js`. Dependency-free, so
// `test/auth-refresh-transport.test.mjs` drives the REAL function with a fake fetch and clock.
//
// ⚠ THE DEADLINE IS GENEROUS ON PURPOSE. A refresh that takes 20s is broken, not slow — the same
// call answers in well under a second on a working network — and a false abort is only a transient
// (`refreshInner`'s catch counts it as one and backs off). It must stay comfortably above
// `api.js`'s 15s so a repair chain that includes a refresh is bounded by the LONGER of the two, not
// by two timers racing.

const REFRESH_TIMEOUT_MS = 20000;

/**
 * POST the refresh token. Resolves with the Response; rejects on network error OR on the deadline
 * (an AbortError, which the caller already treats as transient).
 * ⚠ `fetchImpl` / `timers` are the test seams and default to the real globals.
 */
async function postRefresh({ supabaseUrl, anonKey, refreshToken, fetchImpl, timeoutMs, timers }) {
  const doFetch = fetchImpl || fetch;
  const ms = timeoutMs || REFRESH_TIMEOUT_MS;
  const set = (timers && timers.setTimeout) || setTimeout;
  const clear = (timers && timers.clearTimeout) || clearTimeout;
  const ctrl = new AbortController();
  const timer = set(() => ctrl.abort(), ms);
  // ⚠ `unref` so a pending deadline never holds the process open on the quit path.
  if (timer && typeof timer.unref === 'function') timer.unref();
  try {
    return await doFetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: ctrl.signal,
    });
  } finally {
    clear(timer);
  }
}

module.exports = { REFRESH_TIMEOUT_MS, postRefresh };
