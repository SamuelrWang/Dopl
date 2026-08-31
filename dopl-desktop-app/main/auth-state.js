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
//
// FIX (2026-08-30, the abort-churn incident) — A COOKIE SESSION IS NOT A CREDENTIAL
// WHEN THE BLOB CANNOT BE WRITTEN. The rule above rests on an assumption nobody stated:
// that the blob is merely STALE and therefore repairable from the jar. When the OS
// keychain refuses (`safeStorage` unavailable — a denied macOS prompt is enough), the
// blob is not stale, it is IMPOSSIBLE: `persist()` refuses and deletes the keys, so the
// rebuild below can never land, `getUserId()` stays null, and — the load-bearing part —
// `auth.refreshInner()` reads its `refresh_token` from THE BLOB, so nothing on this
// machine can rotate the jar's JWT either. What "signed in via cookie" then buys is one
// hour of a credential that cannot be renewed, followed by every cookie lane (listener,
// presence, reconcile, mcp-config) 401ing forever against its own retry ladder while the
// bearer lane — `auth-tokens.getAuthState()`, which is blob-only — reports SIGNED OUT to
// the renderer. That split brain is the churn: half the app retrying on a credential the
// other half already declared dead, with no state either half can reach that ends it.
//
// So the honest answer is signed out, and it is reached the moment the process learns it
// cannot store anything. `needsRefresh` goes false with it: probing the jar again cannot
// change an answer that turns on the keychain, and re-probing is how this became a storm.
// ⚠ RECOVERY IS BY GESTURE, NOT BY POLL. An explicit sign-in re-enters `persist()`, which
// re-asks the OS live (`auth-store.encryptionAvailable`) and re-prompts; a background
// probe doing the same on a 30s cooldown would re-prompt the operator forever.
// ⚠ UNKNOWN IS PERMISSIVE HERE, deliberately and against the house default: only an
// EXPLICIT `canPersist: false` narrows, so a caller that does not know (and every caller
// that predates this input) keeps the Q4 truth table exactly.
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
  // Nothing can be stored AND nothing is stored. (A readable blob proves the keychain
  // worked at least once, so the two are mutually exclusive by construction.)
  const storageUnavailable = state && state.canPersist === false && !hasBlob;
  return {
    signedIn: hasBlob || (cookieFresh && !storageUnavailable),
    source: mismatch
      ? 'conflict'
      : storageUnavailable
        ? 'storage-unavailable'
        : hasBlob && cookieFresh ? 'both' : hasBlob ? 'blob' : cookieFresh ? 'cookie' : 'none',
    cookieStale: hasCookie && !cookieFresh,
    // The jar and the blob name DIFFERENT users. We are still signed in (a usable
    // credential exists) but nothing may silently pick a winner: the blob is not
    // overwritten, and the listener drops its cached identity so it re-resolves.
    mismatch,
    // No keychain ⇒ no storable session. Reported so a caller can say WHY it is signed
    // out; never logged as a token, because it is not one.
    storageUnavailable: !!storageUnavailable,
    // Nothing usable right now → the sync caller should kick one bounded async
    // probe (cooldowned) so a cookie-only sign-in is picked up between reconciles.
    // ⚠ Not when storage is unavailable: the probe cannot change that answer.
    needsRefresh: !hasBlob && !cookieFresh && !storageUnavailable,
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
    canPersist: blob.encryptionAvailable(), // no keychain ⇒ the jar is not a credential
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
  // ⚠ ASK THE KEYCHAIN BEFORE DOING THE WORK (2026-08-30). Every freshness guard below is
  // written `if (stored && …)`, because FIX S9's write-storm bound assumed a blob that
  // EXISTS. With `safeStorage` unavailable `persist()` refuses AND deletes the keys, so
  // `stored` is null on the next probe too — the guards are skipped, `persist()` is
  // re-attempted, and this function logs "rebuilt session blob from cookie jar (no blob)"
  // on EVERY probe forever while nothing is ever rebuilt. That is FIX S9's own defect
  // (a read becoming a write storm) reached from the one direction its guard did not
  // cover, plus a log line that says the opposite of what happened.
  if (!blob.encryptionAvailable()) {
    // authFail throttles this to once a minute and never carries a token.
    blob.authFail('safeStorage unavailable — cannot adopt the cookie session; staying signed out', null);
    return false;
  }
  // ⚠ A DEAD TOKEN IS NOT A SESSION (the 2026-08-29 sign-out loop —
  // auth-store.js › markRefreshTokenRejected carries the field log). The jar
  // can hold a stale COPY of the very refresh token the server just rejected
  // N times; adopting it re-arms the drop cycle and the app flaps
  // 'signed-out' every ~30s until somebody signs in by hand. Refuse it here;
  // a jar with a genuinely different (fresh) session still adopts.
  if (blob.isRefreshTokenRejected(cookieSession.refresh_token)) {
    diag('auth: cookie jar holds the already-rejected refresh token — refusing to adopt it back');
    return false;
  }
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
  // ⚠ REPORT WHAT HAPPENED, not what was attempted — the same rule captureFromFragment
  // learned (auth.js). This answered `true` unconditionally, so a refused write was
  // logged as a rebuild and every caller believed the jar had been adopted.
  const wrote = blob.persist({
    access_token: cookieSession.access_token,
    refresh_token: cookieSession.refresh_token,
    token_type: cookieSession.token_type || 'bearer',
    expires_in: cookieSession.expires_in || 3600,
    expires_at: cookieSession.expires_at || cookieExp || Math.floor(Date.now() / 1000) + 3600,
    user: cookieSession.user || null,
  });
  if (!wrote) return false; // persist() has already logged the reason, throttled
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
// F-085 — AND THE SERVER-SIDE REVOKE. Deleting our local copies is not revocation:
// the token stayed valid for up to 90 days, so anything that had ALREADY read it (a
// Time Machine backup, an earlier `claude mcp add`, a process that could read the app's
// data dir) kept full API access to the account that just signed out. `DELETE
// /api/auth/mcp-device-token` stamps revoked_at, and validateAccessToken checks
// revoked_at before expiry, so the bearer dies on its next use.
//
// ORDER IS THE WHOLE POINT: the revoke route is sessionOnly — it authenticates on the
// very cookie jar this function is about to clear — so it MUST run first, before the
// blob, the jar or the local token copies are touched. It is bounded (3s) and
// best-effort: offline / captive portal / 5xx all fall through to the local teardown,
// because a sign-out that a bad network can block is worse than a residual token. When
// the revoke does not land, the diag line says so in words the operator can act on.
//
// THE THIRD CREDENTIAL (2026-07-31) — THE OPERATOR'S CLAUDE INFERENCE TOKEN. The
// enumeration above used to stop at the Dopl credentials and omit this one entirely:
// claude-token.js holds an `sk-ant-*` OAuth token, and BOTH spawn paths inject it as
// CLAUDE_CODE_OAUTH_TOKEN (claude-resolve.spawnEnv for headless, session-auth's
// withStoredCredential for the session window). So: sign out, hand the Mac to someone
// else, they sign in — and every agent session they run bills the FIRST operator's
// Anthropic account, against their rate limits. clearStoredOAuthToken() had ZERO
// callers; it does now. The decision is safe because that store has exactly one
// writer — Dopl's own `claude setup-token` flow (claude-auth.js) — so it can never
// hold a credential the operator made outside Dopl. What it CANNOT do is revoke the
// token at Anthropic, and the log line says that rather than implying otherwise.
//
// STILL NOT COVERED: the user-scope `dopl` entry in the CLI's own config. See
// mcp-config.clearDeviceToken's note — we cannot tell our entry from a hand-made one,
// and after a successful revoke its bearer is dead anyway. Residual in F-085.
//
// FIX M4 — THE LINE MUST NEVER CLAIM A REVOKE THAT DID NOT HAPPEN. revokeDeviceToken
// returns 'revoked' | 'none' | 'failed', and each gets its own words. 'none' (we hold
// no local copy, so nothing was asked of the server) used to be reported as a success:
// a live 90-day row could still exist — cleared by an earlier sign-out whose revoke
// failed, or by a wiped store — and the log said it was dead. A THROW is treated as
// 'failed', because a throw is the one case where we may have sent the DELETE and not
// learned its answer, and over-warning is the safe direction.
async function signOut() {
  // LAZY REQUIRE, deliberately: mcp-config requires ./auth, which requires this
  // module, so a top-level require would close a cycle. By the time anyone can sign
  // out, every module is loaded.
  let revoked = 'failed';
  try {
    revoked = await require('./mcp-config').revokeDeviceToken();
  } catch (err) {
    diag('auth: device-token revoke failed —', (err && err.message) || String(err));
  }
  blob.clearSession();
  invalidateCookieIdentity();
  // DISARM THE LOGIN-CSRF GATE TOO. A sign-in the operator started and then
  // abandoned (e.g. "email me a link", then Sign out) left a pending record
  // armed for the rest of its TTL, so any dopl://auth# fragment delivered in
  // that window was adopted into a machine they believe is signed out. Lazy
  // require: auth.js requires this module.
  try { require('./auth').clearPendingAuth(); } catch (err) {
    diag('auth: pending-auth disarm failed —', (err && err.message) || String(err));
  }
  const cleared = await cookies.clearSessionCookies();
  let device = false;
  try {
    device = require('./mcp-config').clearDeviceToken();
  } catch (err) {
    diag('auth: device-token teardown failed —', (err && err.message) || String(err));
  }
  // The Claude inference credential. Lazy-required like the others (claude-token pulls
  // in electron's safeStorage) and unconditional: a failure here is the one residual
  // that would let the NEXT operator spend the previous one's Anthropic quota.
  let claudeCred = false;
  try {
    claudeCred = require('./claude-token').clearStoredOAuthToken();
  } catch (err) {
    diag('auth: claude-token teardown failed —', (err && err.message) || String(err));
  }
  const revokeNote =
    revoked === 'revoked'
      ? '+ revoked server-side'
      : revoked === 'no-match'
        ? '+ NOT revoked (the server matched no token for this machine\'s label — any token it minted is STILL VALID; revoke it in web Settings > Connected apps)'
        : revoked === 'none'
          ? '+ no local token to revoke (nothing was revoked server-side — if this machine ever minted one, revoke it in web Settings > Connected apps)'
          : '+ NOT revoked server-side (still valid until it expires — revoke it in web Settings > Connected apps)';
  diag('auth: signed out — blob cleared, cookies', cleared ? 'cleared' : 'CLEAR FAILED',
    '— MCP device token', device ? 'cleared' : 'CLEAR FAILED', revokeNote,
    '— Claude sign-in token', claudeCred
      ? "cleared from this Mac (the token itself stays valid at Anthropic; revoke it there if you want it dead)"
      : 'CLEAR FAILED — the next person to sign in on this Mac would run agents on YOUR Anthropic account');
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
