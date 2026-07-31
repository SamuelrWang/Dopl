// "Is this app signed in?" — and the blob repair that keeps the answer true.
//
// SPLIT NOTE (Q4): extracted from auth.js (500-line cap). auth.js re-exports
// everything here, so no call site changed. Layered under auth.js on
// auth-store.js + auth-cookies.js, so there is no require cycle.

const cookies = require('./auth-cookies');
const blob = require('./auth-store');
const { diag } = require('./diag');

// ─── BEGIN SIGNED-IN (pure; unit-tested via source extraction) ─────────────
// WHAT "signed in" MEANS (Q4 root cause). The old rule was
// `isSignedIn() = !!loadSession()` — the encrypted deep-link blob ONLY. That
// blob's refresh token rots independently of the web cookie session and its only
// writer is the CSRF-gated deep-link capture, so once it died the listener,
// presence, the consent watcher and mcp-config ALL went dark while the app's own
// web UI stayed signed in on perfectly valid cookies. There was no sign-in
// prompt (the UI looked fine) and no sign-out control, so recovery meant deleting
// the Cookies store by hand.
//
// The fix: a valid COOKIE session counts as signed in too. isSignedIn() must stay
// SYNC (presence/watcher ticks and the tray status call it) and cookie reads are
// async, so the async side keeps a cached cookie identity {userId, at} and this
// pure predicate decides over the two sources. The cache is TTL'd so a jar that
// was cleared out from under us cannot keep the listener alive forever: the
// reconcile pass refreshes it every 5 minutes, well inside the TTL, and a stale
// cache reports `needsRefresh` so the sync caller can kick one bounded probe.
// Pure over its inputs (nowMs/ttlMs injected) so the truth table is testable.
//
// FIX S4 (Q5 review) — THE TWO SOURCES WERE NEVER COMPARED. `source: 'both'` was
// returned whenever a blob and a fresh cookie identity both existed, with no check
// that they name the SAME user, and rebuildBlobFromCookieSession adopted purely on
// `exp`. So a jar left behind by (or switched to) a different account could be
// adopted over the signed-in operator's blob, and every downstream consumer —
// getUserId(), the listener's `myUserId`, the Realtime 'stored' candidate — would
// then be routing one account's channel traffic under the other's identity, with
// nothing in the log saying so. `blobUserId` is the blob's own `sub`; when the two
// disagree the state is a CONFLICT, not 'both', and the adoption is refused.
function signedInFrom(state) {
  const hasBlob = !!(state && state.blob);
  const c = (state && state.cookie) || null;
  const nowMs = (state && state.nowMs) || 0;
  const ttlMs = (state && state.ttlMs) || 0;
  const hasCookie = !!(c && c.userId);
  const cookieFresh = hasCookie && nowMs - (c.at || 0) <= ttlMs;
  const blobUserId = (state && state.blobUserId) || null;
  // A mismatch needs BOTH ids to be readable. An unreadable one is ignorance, not
  // disagreement, and must not raise a conflict (fail toward today's behavior).
  const mismatch = !!(hasBlob && blobUserId && hasCookie && c.userId !== blobUserId);
  return {
    signedIn: hasBlob || cookieFresh,
    source: mismatch
      ? 'conflict'
      : hasBlob && cookieFresh ? 'both' : hasBlob ? 'blob' : cookieFresh ? 'cookie' : 'none',
    cookieStale: hasCookie && !cookieFresh,
    // The jar and the blob name DIFFERENT users. We are still signed in (a usable
    // credential exists) but nothing may silently pick a winner: the blob is not
    // overwritten, and the listener drops its cached identity so it re-resolves.
    mismatch,
    // Nothing usable right now → the sync caller should kick one bounded async
    // probe (cooldowned) so a cookie-only sign-in is picked up between reconciles.
    needsRefresh: !hasBlob && !cookieFresh,
  };
}
// ─── END SIGNED-IN ─────────────────────────────────────────────────────────

// How long a cached cookie identity is trusted without a re-read. reconcile()
// refreshes on every 5-minute pass (and on every powerMonitor wake), so this is
// a 2x margin, not a normal expiry path.
const COOKIE_IDENTITY_TTL_MS = 10 * 60 * 1000;
// A sync isSignedIn() that finds nothing kicks at most one probe this often
// (F-072: a read must never become a storm).
const COOKIE_PROBE_COOLDOWN_MS = 30_000;
let cookieIdentity = null; // { userId, at } — maintained by refreshSignedInState
let lastCookieProbeMs = 0;
let probe = null; // in-flight single-flight probe

function signedInState() {
  const stored = blob.loadSession();
  const claims = stored && stored.access_token ? blob.decodeJwt(stored.access_token) : null;
  return signedInFrom({
    blob: stored,
    blobUserId: (claims && claims.sub) || null, // FIX S4: the identity cross-check input
    cookie: cookieIdentity,
    nowMs: Date.now(),
    ttlMs: COOKIE_IDENTITY_TTL_MS,
  });
}

// Adopt the cookie session as the stored blob when the jar is strictly fresher.
// The blob is what getUserId(), refresh() and the 'stored' Realtime candidate all
// read; leaving it dead while the cookies are alive is the exact drift that took
// the listener down. Rebuilt CLIENT-SIDE, no server call and no new route: the
// @supabase/ssr cookie carries the whole Session, refresh_token included.
//
// Not a CSRF hole: the jar is writable only by our own origin's pages (see
// auth-cookies.js), so this is not the attacker-supplied deep-link case
// captureFromFragment's pending-auth gate defends against. No write storm — once
// adopted the exps match and this returns false until the renderer rotates.
function rebuildBlobFromCookieSession(cookieSession) {
  if (!cookieSession || !cookieSession.access_token || !cookieSession.refresh_token) return false;
  const cookieExp = blob.jwtExp(cookieSession.access_token);
  const stored = blob.loadSession();
  const storedExp = stored ? blob.jwtExp(stored.access_token) : null;
  // FIX S4 — IDENTITY BEFORE FRESHNESS. Adoption used to turn on `exp` alone, so a
  // jar belonging to a DIFFERENT account simply had to be newer to overwrite the
  // signed-in operator's blob. Refuse, loudly: an ambiguous machine is for the
  // operator to resolve with an explicit sign-out, not for a background probe to
  // silently pick a winner on.
  const storedClaims = stored && stored.access_token ? blob.decodeJwt(stored.access_token) : null;
  const cookieClaims = blob.decodeJwt(cookieSession.access_token);
  const storedUser = (storedClaims && storedClaims.sub) || null;
  const cookieUser = (cookieClaims && cookieClaims.sub) || null;
  if (storedUser && cookieUser && storedUser !== cookieUser) {
    diag('auth: IDENTITY MISMATCH — cookie jar user', String(cookieUser).slice(0, 8),
      'vs stored blob user', String(storedUser).slice(0, 8), '— refusing to adopt; sign out to clear');
    return false;
  }
  // FIX S9 — an UNREADABLE exp is not "the cookie is fresher". The guard was one
  // `&&` chain, so a null exp on either side made the whole condition false and the
  // blob was rewritten on EVERY probe (F-072: a read must never become a write
  // storm). With no stored blob there is nothing to compare and the rebuild is the
  // whole point, so the refusal applies only when a blob already exists.
  if (stored && (storedExp == null || cookieExp == null)) return false;
  if (stored && storedExp >= cookieExp) return false;
  blob.persist({
    access_token: cookieSession.access_token,
    refresh_token: cookieSession.refresh_token,
    token_type: cookieSession.token_type || 'bearer',
    expires_in: cookieSession.expires_in || 3600,
    expires_at: cookieSession.expires_at || cookieExp || Math.floor(Date.now() / 1000) + 3600,
    user: cookieSession.user || null,
  });
  diag('auth: rebuilt session blob from cookie jar', stored ? '(stale blob)' : '(no blob)');
  return true;
}

// Re-read the cookie jar, refresh the cached identity, and repair the blob.
// Single-flight: concurrent callers share one jar read.
function refreshSignedInState() {
  if (probe) return probe;
  lastCookieProbeMs = Date.now();
  probe = (async () => {
    let cookieSession = null;
    try {
      cookieSession = await cookies.readCookieSession();
    } catch (err) {
      blob.authFail('cookie session read failed', err);
    }
    const claims =
      cookieSession && cookieSession.access_token
        ? blob.decodeJwt(cookieSession.access_token)
        : null;
    const was = cookieIdentity && cookieIdentity.userId;
    cookieIdentity = claims && claims.sub ? { userId: claims.sub, at: Date.now() } : null;
    const now = cookieIdentity && cookieIdentity.userId;
    if (was !== now) diag('auth: cookie identity', now ? `present ${String(now).slice(0, 8)}` : 'GONE');
    if (cookieIdentity) rebuildBlobFromCookieSession(cookieSession);
    const st = signedInState();
    // FIX S4: say it out loud on every probe, not only on the refused adoption —
    // a conflicting pair can persist for as long as the operator leaves it there.
    if (st.mismatch) diag('auth: signed-in state is CONFLICTED — the cookie jar and the stored blob name different users; sign out to clear');
    return st;
  })().finally(() => {
    probe = null;
  });
  return probe;
}

// The async gate, for the callers that CAN await — reconcile and mcp-config — so
// a boot with a dead blob and live cookies never sees a cold cache and skips
// itself. That cold-cache skip is what left `want=0` wedged across reboots.
async function ensureSignedIn() {
  await refreshSignedInState();
  return signedInState().signedIn;
}

// The sync gate every cheap tick uses (presence, consent watcher, tray status).
// Blob OR a fresh cached cookie identity. When neither is usable it kicks ONE
// cooldowned background probe so a cookie-only sign-in is adopted without waiting
// for the next reconcile — never awaited, never allowed to throw.
function isSignedIn() {
  const st = signedInState();
  if (st.needsRefresh && !probe && Date.now() - lastCookieProbeMs >= COOKIE_PROBE_COOLDOWN_MS) {
    try { refreshSignedInState().catch(() => {}); } catch (_) { /* never break a tick */ }
  }
  return st.signedIn;
}

// Token-free one-liner for the diag log: which source(s) currently authorize us.
function signedInSource() {
  return signedInState().source;
}

// FIX S4 — the listener's hook. channel-listener only re-resolves `myUserId` when it
// is null (it caches the id for the life of the process), so a machine whose two
// credentials disagree would keep classifying traffic under whichever identity it
// happened to resolve first. This lets reconcile drop that cache each pass while the
// conflict lasts, so `resolveIdentity` re-derives it every time instead of trusting a
// value it can no longer justify.
function identityMismatch() {
  return signedInState().mismatch;
}

// The deep-link capture just wrote a brand-new blob; drop the cached cookie view
// so the next probe re-reads the jar the completion page is about to set.
function invalidateCookieIdentity() {
  cookieIdentity = null;
  lastCookieProbeMs = 0;
}

// ── Explicit sign-out (Q4 fix 3) ───────────────────────────────────────────
// There was NO sign-out control: the only way out of a wedged state was deleting
// the app's Cookies store by hand. Clearing the blob alone would not have helped
// — the jar is what renders the web UI signed in — so this drops BOTH and resets
// the cached cookie identity so the very next isSignedIn() reports signed out.
//
// FIX S2 (Q5 review) — SIGN-OUT LEFT A LIVE 90-DAY BEARER BEHIND. The Supabase
// credential is not the only one this app holds: mcp-config mints a `dopl.read` +
// `dopl.write` MCP DEVICE TOKEN valid for 90 days and keeps it in TWO places —
// electron-store (`mcpDeviceToken` / `…Plain`) and `userData/mcp-spawn.json`, whose
// bearer is what every spawned session and every manual `claude` run authenticates
// with. Clearing only the blob and the jar therefore signed the OPERATOR out while
// leaving full API access to their account sitting on the disk, readable by the next
// person to use the machine and by anything that can read the app's data dir.
// clearDeviceToken() removes both copies.
//
// WHAT THIS CANNOT DO: there is NO server-side revoke endpoint for a device token.
// `/api/auth/mcp-device-token` is mint-only (POST), and issueDeviceToken revokes
// prior tokens only for the SAME label on re-mint. So the token stays valid
// server-side until it expires or the operator revokes it from the web "Connected
// apps" list. The teardown here is local, and that gap is F-085.
async function signOut() {
  blob.clearSession();
  invalidateCookieIdentity();
  const cleared = await cookies.clearSessionCookies();
  // LAZY REQUIRE, deliberately: mcp-config requires ./auth, which requires this
  // module, so a top-level require would close a cycle. By the time anyone can sign
  // out, every module is loaded.
  let device = false;
  try {
    device = require('./mcp-config').clearDeviceToken();
  } catch (err) {
    diag('auth: device-token teardown failed —', (err && err.message) || String(err));
  }
  diag('auth: signed out — blob cleared, cookies', cleared ? 'cleared' : 'CLEAR FAILED',
    '— MCP device token', device ? 'cleared' : 'CLEAR FAILED');
  return cleared;
}

module.exports = {
  isSignedIn,
  ensureSignedIn,
  refreshSignedInState,
  signedInSource,
  identityMismatch,
  invalidateCookieIdentity,
  signOut,
};
