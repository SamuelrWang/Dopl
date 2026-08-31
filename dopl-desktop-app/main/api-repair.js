// THE 401 REPAIR — one implementation, shared by every cookie-authenticated
// main-process transport.
//
// WHY THIS MODULE EXISTS: the 1.8.x Channels outage. api.js:2 stated the split
// plainly — "The Channels listener keeps its own copy (E2E-verified — not
// refactored here)" — so when Phase 2 gave api.js a 401 repair, listener-io.js
// never received it. listener-io is the transport under listWorkspaces,
// listChannels, every `/await` long-poll, channel-post's task-lifecycle posts,
// the roster, threads and consent: the ENTIRE Channels subsystem.
//
// That was survivable while a remote page ran in the window, because supabase-js
// kept the cookie jar fresh. The bundled SPA removes the page and with it the
// refresher, and `auth.getAuthCookie()` only repairs an EMPTY jar, never a STALE
// one (the jar cookie is written with a 400-day expiry, so it long outlives the
// JWT inside it). So on 1.8.x the listener forwarded an expired credential,
// every Channels call 401'd, and the subsystem recovered only BY LUCK — when some
// other api.js caller happened to 401 first and repaired the shared jar.
//
// Field symptom, from one stale cookie: the operator never appears online to a
// peer (reconcile returns before presence ever learns a workspace set) and "Open
// thread" answers "This channel isn't available on this machine" (no channel
// loops were ever started). Hours of it, with `reconcile self-heal: retrying …`
// every 30s as the only trace.
//
// SO IT IS SHARED, NOT COPIED A THIRD TIME. A third divergent copy is precisely
// how this bug happened. Each transport keeps its OWN `send()` — the listener's
// carries the caller abort signal the wake kick needs plus the long-poll timeout
// semantics awaitOrCheap depends on; api.js's carries `Cache-Control: no-store`
// and its own timeout — and hands it here as a thunk. NOTHING about either
// request changes; only what happens on a 401 does.
//
// THE RULE (unchanged from api.js's Phase-2 version, now the only copy of it):
//   * Force ONE rotation through the token authority. `authTokens.forceRefresh()`
//     shares auth.js's SINGLE-FLIGHT refresh, so N concurrent callers — the
//     reconcile pass and every channel loop at once — join ONE rotation and never
//     race each other against a refresh token Supabase rotates on use (FIX S6).
//   * Write the fresh session back into the JAR. These transports authenticate
//     with the cookie jar, so a refreshed blob is worthless to the retry until the
//     jar carries it (auth-flows.md §4 — the token authority is additive until
//     Phase 4).
//   * Retry EXACTLY ONCE. A 401 that survives a fresh token is a real
//     authorization answer (a revoked session, a sessionOnly route, the wrong
//     workspace) and must SURFACE, not spin. `shouldRepairAuth(status, false)` is
//     the shared rule and there is no loop here to make it lie.
//
// BOUNDEDNESS, stated because the field log carries a 39,000-attempt refresh
// storm from an unrelated caller: this adds at most ONE extra request and at most
// ONE rotation per call, the rotation is single-flighted across all callers, and
// there is no timer, no queue and no self-scheduling. Callers keep their own
// backoff (channelLoop's capped exponential, listChannelsWithRetry's ladder), so
// nothing here can stack.

const auth = require('./auth');
const authTokens = require('./auth-tokens');
const { diag } = require('./diag');

/**
 * Run `send()`, repairing the cookie jar and retrying ONCE on a 401.
 *
 * @param {string} label   log prefix naming the transport ('api' / 'listener')
 * @param {string} what    the request being made, for the log (a pathname)
 * @param {() => Promise<Response>} send  a fresh attempt — called at most twice.
 *   It MUST re-read the cookie jar each time (both transports do, via
 *   `auth.getAuthCookie()`), or the retry carries the same dead credential.
 * @returns {Promise<Response>} the retry's response when one happened, else the
 *   original. Rejections (AbortError, network) propagate untouched.
 */
/**
 * RELEASE A RESPONSE NOBODY WILL READ (2026-08-30, the 17 GB dev incident).
 *
 * ⚠ AN UNREAD `Response` IS NOT FREE, and that is the whole reason this exists. Node's `fetch`
 * is undici: until the body is consumed or cancelled the request counts as IN FLIGHT, its socket
 * is never returned to the pool, and the next call opens ANOTHER connection. The retained state
 * is native — socket buffers plus TLS session — so it never pressures GC, never appears in a
 * heap snapshot, and shows up only as RSS.
 *
 * ⚠ THE BRANCHES THAT LEAK ARE THE ERROR BRANCHES, which is exactly backwards from where anyone
 * looks: the success path reads `res.json()` and is fine, while `if (!res.ok) { backoff; continue; }`
 * — the path a saturated server puts every caller on — drops the body on the floor once per
 * poll, per channel, forever.
 *
 * Best-effort by construction: a body already consumed, already errored, or absent must not
 * throw into a caller that had finished with it.
 */
function discardBody(res) {
  try {
    if (res && res.body && typeof res.body.cancel === 'function' && !res.bodyUsed) {
      const p = res.body.cancel();
      if (p && typeof p.catch === 'function') p.catch(() => { /* nothing left to release */ });
    }
  } catch (_) { /* nothing left to release */ }
  return res;
}

async function fetchWithAuthRepair(label, what, send) {
  const res = await send();
  if (!authTokens.shouldRepairAuth(res.status, false)) return res;

  const fresh = await authTokens.forceRefresh();
  if (!fresh || !fresh.access_token) {
    // NOT a sign-out. auth-tokens classifies 5xx/429/timeouts as TRANSIENT and
    // keeps the stored session, so the honest answer is the original 401 plus a
    // line saying the repair could not run — never an emitted 'signed-out' that
    // would flip the renderer to the login screen on a network blip.
    diag(`${label}: 401 and the refresh did not produce a session —`, what);
    return res;
  }
  try {
    await auth.writeSessionCookies(fresh);
  } catch (err) {
    diag(`${label}: jar repair after 401 failed —`, (err && err.message) || String(err));
  }
  // ⚠ THE ORIGINAL 401 IS UNREACHABLE FROM HERE ON — release it before opening a second
  // connection to the same origin, or a stale-cookie episode (this module's header records
  // "hours of it") pins one socket per repaired call for the life of the process.
  discardBody(res);
  const retried = await send();
  if (retried.status === 401) {
    diag(`${label}: 401 survived a forced refresh —`, what);
    // ⚠ LATCHED, not merely announced (2026-08-30). A bare `emitAuthState('signed-out')`
    // here left the stored blob untouched, so the next caller's repair rotated again and
    // announced signed-IN — an auth flap per 401, which the renderer answers with a full
    // cache wipe. `auth-tokens.js › noteSessionRejected` carries the loop.
    authTokens.noteSessionRejected(`${label}: ${what}`);
  }
  return retried;
}

module.exports = { fetchWithAuthRepair, discardBody };
