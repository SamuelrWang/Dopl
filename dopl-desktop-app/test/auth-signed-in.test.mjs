// Q4 fix 1 — the cookie-fallback signed-in truth table.
//
// THE BUG THIS LOCKS OUT (diagnosed live, 2026-07-31). `isSignedIn()` was
// `!!loadSession()`: the encrypted deep-link blob and NOTHING else. That blob's
// refresh token rots independently of the web cookie session, and its only writer
// is the CSRF-gated deep-link capture — so when it died, every gate that consults
// isSignedIn() went dark at once:
//
//   channel-listener.js reconcile  -> stopLoops(), realtime.setWorkspaces([])
//   presence.js         beatOnce   -> no heartbeat, web shows the agent offline
//   consent-watcher.js  tick       -> no consent polling, no consent windows
//   mcp-config.js       ensure     -> "mcp-config: skip (signed out)"
//
// …while the app's own window rendered perfectly signed in on the cookie session,
// so nothing prompted for sign-in and there was no sign-out control. The observed
// end state was `realtime wake … (loop=miss)` and `want=0` persisting across
// reboots; the field recovery was deleting the app's Cookies store by hand.
//
// The fix is that a valid COOKIE session counts as signed in too. isSignedIn()
// must stay SYNC (presence/watcher ticks and the tray status call it) while cookie
// reads are async, so the async side caches a cookie identity {userId, at} and
// signedInFrom() decides over the two sources with an injected clock + TTL. This
// file locks that truth table, the blob-rebuild rule, and — critically — that the
// deep-link CSRF gate was NOT weakened on the way through.
//
// Run: `node --test dopl-desktop-app/test/auth-signed-in.test.mjs`
//
// WHY SOURCE EXTRACTION: auth-state.js is CommonJS and requires electron
// (safeStorage, session) + electron-store, so it cannot be imported under
// `node --test`. signedInFrom is fenced as a PURE function and
// rebuildBlobFromCookieSession takes its whole world through two module refs, so
// both are sliced and evaluated verbatim — the test stays honest to what ships.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const STATE = M("auth-state.js");
const AUTH = M("auth.js");
const COOKIES = M("auth-cookies.js");
const LISTENER = M("channel-listener.js");
const WATCHER = M("consent-watcher.js");
const PRESENCE = M("presence.js");
const MCP = M("mcp-config.js");
const ACTIONS = M("auth-actions.js");
const INDEX = M("index.js");

const { signedInFrom } = new Function(
  `${between(STATE, "// ─── BEGIN SIGNED-IN", "// ─── END SIGNED-IN", "signed-in block")}
   return { signedInFrom };`
)();

const NOW = 1_800_000_000_000; // fixed clock (ms)
const TTL = 10 * 60 * 1000;
const decide = (blob, cookie) => signedInFrom({ blob, cookie, nowMs: NOW, ttlMs: TTL });
const freshCookie = { userId: "u-1", at: NOW - 60_000 };
const staleCookie = { userId: "u-1", at: NOW - TTL - 1 };

// ── THE TRUTH TABLE ─────────────────────────────────────────────────────────

test("blob + fresh cookie: signed in, both sources", () => {
  const r = decide({ access_token: "a" }, freshCookie);
  assert.equal(r.signedIn, true);
  assert.equal(r.source, "both");
  assert.equal(r.needsRefresh, false);
  assert.equal(r.cookieStale, false);
});

test("blob only (no cookie yet): signed in — the legacy deep-link case still works", () => {
  const r = decide({ access_token: "a" }, null);
  assert.equal(r.signedIn, true);
  assert.equal(r.source, "blob");
  assert.equal(r.needsRefresh, false);
});

test("THE FIX: fresh cookie and a DEAD blob is signed in, not signed out", () => {
  const r = decide(null, freshCookie);
  assert.equal(r.signedIn, true, "a valid cookie session must keep the listener alive");
  assert.equal(r.source, "cookie");
  assert.equal(r.needsRefresh, false);
});

test("neither source: signed out, and the sync caller is told to re-probe", () => {
  const r = decide(null, null);
  assert.equal(r.signedIn, false);
  assert.equal(r.source, "none");
  assert.equal(r.needsRefresh, true, "so a cookie-only sign-in is picked up between reconciles");
  assert.equal(r.cookieStale, false);
});

test("STALE cached cookie + no blob: NOT signed in — the cache cannot outlive its TTL", () => {
  const r = decide(null, staleCookie);
  assert.equal(r.signedIn, false, "a jar cleared out from under us must not stay 'signed in' forever");
  assert.equal(r.source, "none");
  assert.equal(r.cookieStale, true);
  assert.equal(r.needsRefresh, true);
});

test("stale cookie + live blob: signed in via the blob, and no probe is needed", () => {
  const r = decide({ access_token: "a" }, staleCookie);
  assert.equal(r.signedIn, true);
  assert.equal(r.source, "blob");
  assert.equal(r.cookieStale, true);
  assert.equal(r.needsRefresh, false);
});

test("a cookie record with no userId is not a credential", () => {
  const r = decide(null, { userId: null, at: NOW });
  assert.equal(r.signedIn, false);
  assert.equal(r.source, "none");
  assert.equal(r.cookieStale, false, "nothing was ever cached, so nothing is stale");
});

test("TTL boundary: exactly at the TTL is still fresh, one ms past is not", () => {
  assert.equal(decide(null, { userId: "u", at: NOW - TTL }).signedIn, true);
  assert.equal(decide(null, { userId: "u", at: NOW - TTL - 1 }).signedIn, false);
});

test("the TTL is a real margin over the 5-minute reconcile that refreshes it", () => {
  const ttl = Number(/COOKIE_IDENTITY_TTL_MS = (\d+) \* 60 \* 1000/.exec(STATE)[1]);
  assert.ok(ttl >= 10, `cookie identity TTL is ${ttl}m; reconcile refreshes every 5m`);
});

test("the sync probe is cooldowned, so a signed-out tick cannot storm the jar", () => {
  assert.match(STATE, /COOKIE_PROBE_COOLDOWN_MS = 30_000/);
  const fn = fnOf(STATE, "isSignedIn");
  assert.match(fn, /st\.needsRefresh/, "only probes when nothing is usable");
  assert.match(fn, /!probe/, "single-flight: never a second concurrent probe");
  assert.match(fn, /COOKIE_PROBE_COOLDOWN_MS/, "and never more often than the cooldown");
  assert.ok(!/await/.test(fn), "isSignedIn must stay SYNC — the gate call sites are sync");
});

// ── BLOB REBUILD ────────────────────────────────────────────────────────────
// The other half of the fix: a dead blob is REPAIRED from the cookie jar, so
// getUserId(), refresh() and the 'stored' Realtime candidate all come back to
// life. Done entirely client-side — the @supabase/ssr cookie carries the whole
// Session, refresh_token included — so this needs no server change.

// Token shape for these fixtures: `exp:<n>` carries only an exp; `u<id>@exp:<n>` also
// carries a subject, so the FIX S4 identity cross-check can be driven.
const fakeSub = (t) => {
  const m = /^(u[^@]*)@/.exec(String(t || ""));
  return m ? m[1] : null;
};
const fakeExp = (t) => {
  const m = /exp:(\d+)$/.exec(String(t || ""));
  return m ? Number(m[1]) : null;
};

function loadRebuild(stored) {
  const calls = { persisted: [], logged: [] };
  const blob = {
    loadSession: () => stored,
    persist: (s) => calls.persisted.push(s),
    jwtExp: (t) => fakeExp(t),
    decodeJwt: (t) => (fakeSub(t) ? { sub: fakeSub(t) } : null),
  };
  const diag = (...a) => calls.logged.push(a.join(" "));
  const fn = new Function(
    "blob",
    "diag",
    `${fnOf(STATE, "rebuildBlobFromCookieSession")}\n return rebuildBlobFromCookieSession;`
  )(blob, diag);
  return { fn, calls };
}

test("a MISSING blob is rebuilt from the cookie session", () => {
  const { fn, calls } = loadRebuild(null);
  assert.equal(fn({ access_token: "exp:200", refresh_token: "r", expires_at: 200 }), true);
  assert.equal(calls.persisted.length, 1);
  assert.equal(calls.persisted[0].refresh_token, "r", "the cookie's refresh token is the whole point");
  assert.equal(calls.persisted[0].access_token, "exp:200");
});

test("a STALER blob is overwritten by the fresher cookie session", () => {
  const { fn, calls } = loadRebuild({ access_token: "exp:100" });
  assert.equal(fn({ access_token: "exp:200", refresh_token: "r" }), true);
  assert.equal(calls.persisted.length, 1);
});

test("no write storm: an already-current blob is left alone", () => {
  const { fn, calls } = loadRebuild({ access_token: "exp:200" });
  assert.equal(fn({ access_token: "exp:200", refresh_token: "r" }), false);
  assert.equal(calls.persisted.length, 0, "equal exps must not rewrite the store on every probe");
});

test("a cookie with no refresh_token cannot rebuild anything", () => {
  const { fn, calls } = loadRebuild(null);
  assert.equal(fn({ access_token: "exp:200" }), false);
  assert.equal(calls.persisted.length, 0, "a blob without a refresh token would rot immediately");
});

test("no cookie session at all is a no-op", () => {
  const { fn, calls } = loadRebuild(null);
  assert.equal(fn(null), false);
  assert.equal(calls.persisted.length, 0);
});

// ── THE CSRF GATE IS NOT WEAKENED ───────────────────────────────────────────
// The rebuild adopts a session WITHOUT a pending-auth nonce, which is only safe
// because the jar is writable solely by our own origin. That must not bleed into
// the deep-link path, where the fragment IS attacker-suppliable.

test("captureFromFragment still consumes the pending-auth nonce before persisting", () => {
  const fn = fnOf(AUTH, "captureFromFragment");
  const gate = fn.indexOf("consumePendingAuth(params.get('state'))");
  const write = fn.indexOf("persist({");
  assert.notEqual(gate, -1, "the M4 login-CSRF gate is gone from captureFromFragment");
  assert.notEqual(write, -1);
  assert.ok(gate < write, "the gate must run BEFORE anything is persisted");
  assert.match(fn, /if \(!consumePendingAuth/, "and a failed gate must return false");
});

test("the blob rebuild is reachable only from the cookie jar, never from a fragment", () => {
  assert.ok(
    !/rebuildBlobFromCookieSession/.test(AUTH),
    "auth.js (which owns the deep-link path) must not call the rebuild"
  );
  assert.match(
    fnOf(STATE, "refreshSignedInState"),
    /cookies\.readCookieSession\(\)/,
    "the rebuild's only input is the Electron cookie jar"
  );
});

// FIX S3 — the old version of this test asserted the jar was documented as "writable only
// by our own origin", and that documented claim was FALSE: both readers filtered by cookie
// NAME only (so a `.usedopl.com` DOMAIN cookie from any sibling subdomain was read as ours)
// and in-window navigation admitted every *.usedopl.com host (so a sibling subdomain page
// ran inside the window and could set them). The claim was the sole justification for
// rebuilding the session blob without a CSRF nonce. Both halves are now real, and this test
// pins the MECHANISM rather than the prose.
test("the jar readers are HOST-locked, which is what actually makes the rebuild safe", () => {
  const read = fnOf(COOKIES, "readCookieSession");
  const header = fnOf(COOKIES, "getSessionCookieHeader");
  assert.match(read, /isOurAuthCookie/, "readCookieSession must filter host-only");
  assert.match(header, /isOurAuthCookie/, "…and so must the Cookie-header assembly");
  const pred = fnOf(COOKIES, "isOurAuthCookie");
  assert.match(pred, /APP_HOST/, "the host is the discriminator, not just the name");
  assert.match(pred, /replace\(\/\^\\\.\/, ''\)/, "a leading-dot DOMAIN cookie normalizes and then fails the ===");
  assert.ok(!/c\.name === COOKIE_BASE \|\| c\.name\.startsWith/.test(read), "the name-only filter is gone");
  const prose = COOKIES.replace(/\n\/\/ ?/g, " ");
  assert.match(prose, /host-only/i, "and the comment states the real guarantee");
});

test("a torn / duplicate chunk set returns null instead of throwing", () => {
  // Every caller treats a throw as "the jar read FAILED" (authFail), which is a different
  // and louder thing than "there is nothing usable in the jar".
  const fn = fnOf(COOKIES, "readCookieSession");
  assert.match(fn, /try \{\s*parsed = JSON\.parse\(json\);\s*\} catch/, "the parse is guarded");
  assert.match(fn, /catch \(err\) \{[\s\S]*return null;/, "and answers null");
});

test("in-window navigation is locked to the EXACT app origin, not the domain family", () => {
  const fn = fnOf(ACTIONS, "isAppOrigin");
  assert.match(fn, /new URL\(urlStr\)\.origin === APP_ORIGIN/);
  assert.ok(!/hostname\.endsWith/.test(ACTIONS), "no *.usedopl.com family match may survive");
  assert.ok(!/isAppUrl\(/.test(ACTIONS + INDEX), "and the loose predicate has no call site left");
  assert.match(INDEX, /if \(!isAppOrigin\(url\)\) \{/, "the will-navigate branch uses it");
});

// ── EVERY GATE CALL SITE ACTUALLY USES THE NEW ANSWER ───────────────────────

test("auth.isSignedIn is the cookie-aware one, so no call site had to change", () => {
  assert.match(AUTH, /isSignedIn: state\.isSignedIn/, "auth.js must re-export auth-state's gate");
  assert.ok(
    !/^function isSignedIn/m.test(AUTH),
    "a second, blob-only isSignedIn must not survive in auth.js"
  );
});

test("the four dark-listener gates all consult the shared gate", () => {
  assert.match(PRESENCE, /auth\.isSignedIn\(\)/, "presence heartbeat");
  assert.match(WATCHER, /auth\.isSignedIn\(\)/, "consent watcher tick");
  assert.match(LISTENER, /auth\.isSignedIn\(\)/, "tray status line");
});

test("the two async gates await ensureSignedIn, so a cold cache never skips them", () => {
  // reconcile and mcp-config both run at boot, BEFORE any probe has warmed the
  // cookie cache. A sync read there would answer 'signed out' from a cold start
  // with a dead blob — the exact skip that wedged want=0 across reboots.
  assert.match(fnOf(LISTENER, "reconcileInner"), /await auth\.ensureSignedIn\(\)/);
  assert.match(fnOf(MCP, "ensureMcpConfigInner"), /await auth\.ensureSignedIn\(\)/);
});

test("auth failures reach listener.log, not just an invisible console", () => {
  const store = M("auth-store.js");
  assert.match(fnOf(store, "loadSession"), /authFail\('session blob load\/decrypt failed'/);
  assert.match(fnOf(store, "persist"), /authFail\('persist failed'/);
  assert.match(fnOf(AUTH, "refreshInner"), /authFail\('refresh failed'/);
  assert.match(fnOf(store, "authFail"), /diag\(/, "authFail must write the diag file log");
  assert.match(
    fnOf(store, "authFail"),
    /FAIL_LOG_COOLDOWN_MS/,
    "throttled — isSignedIn runs every tick and must not turn a bad blob into a log storm"
  );
});

test("sign-out clears BOTH the blob and the cookie jar", () => {
  const fn = fnOf(STATE, "signOut");
  assert.match(fn, /blob\.clearSession\(\)/, "the encrypted blob");
  assert.match(fn, /cookies\.clearSessionCookies\(\)/, "and the jar — which is what renders the UI signed in");
  assert.match(fn, /invalidateCookieIdentity\(\)/, "and the cached identity, or the next tick lies");
});

// ── FIX S4: THE TWO CREDENTIALS ARE CROSS-CHECKED ───────────────────────────
// signedInFrom returned `source:'both'` whenever a blob and a fresh cookie identity both
// existed, without ever comparing WHO they name, and rebuildBlobFromCookieSession adopted
// on `exp` alone. A jar belonging to a different account therefore only had to be newer to
// overwrite the signed-in operator's blob — after which getUserId(), the listener's cached
// `myUserId` and the Realtime 'stored' candidate were all routing one account's channel
// traffic under the other's identity, silently.

const decideWith = (blob, blobUserId, cookie) =>
  signedInFrom({ blob, blobUserId, cookie, nowMs: NOW, ttlMs: TTL });

test("same user on both sources: 'both', no conflict (the ordinary signed-in machine)", () => {
  const r = decideWith({ access_token: "a" }, "u-1", freshCookie);
  assert.equal(r.mismatch, false);
  assert.equal(r.source, "both");
  assert.equal(r.signedIn, true);
});

test("DIFFERENT users: 'conflict', still signed in, and the mismatch is reported", () => {
  const r = decideWith({ access_token: "a" }, "u-OTHER", freshCookie);
  assert.equal(r.mismatch, true, "the disagreement must be visible to the caller");
  assert.equal(r.source, "conflict", "'both' would claim the two sources agree");
  assert.equal(r.signedIn, true, "a usable credential still exists — this is not a sign-out");
});

test("an UNREADABLE id on either side is ignorance, not disagreement", () => {
  // Fail toward the old behavior: a blob whose JWT we cannot decode (or a cookie identity
  // with no userId) must not raise a conflict, or an odd token shape would wedge the app.
  assert.equal(decideWith({ access_token: "a" }, null, freshCookie).mismatch, false);
  assert.equal(decideWith({ access_token: "a" }, "u-1", { userId: null, at: NOW }).mismatch, false);
  assert.equal(decideWith(null, null, freshCookie).mismatch, false, "no blob, nothing to disagree with");
  assert.equal(decideWith({ access_token: "a" }, "u-1", null).mismatch, false, "no cookie either");
});

test("a STALE cookie of another user still conflicts — the cache is not the credential", () => {
  const r = decideWith({ access_token: "a" }, "u-OTHER", staleCookie);
  assert.equal(r.mismatch, true, "staleness is about freshness, not about who it names");
  assert.equal(r.signedIn, true, "…and the blob still signs us in");
});

test("the rebuild REFUSES a cookie session belonging to a different user", () => {
  const { fn, calls } = loadRebuild({ access_token: "u-me@exp:100" });
  assert.equal(fn({ access_token: "u-other@exp:900", refresh_token: "r" }), false,
    "fresher is not the same as ours");
  assert.equal(calls.persisted.length, 0, "the operator's blob must survive");
  assert.match(calls.logged.join("\n"), /IDENTITY MISMATCH/, "and it must be LOUD, not silent");
});

test("…and still adopts a fresher session from the SAME user", () => {
  const { fn, calls } = loadRebuild({ access_token: "u-me@exp:100" });
  assert.equal(fn({ access_token: "u-me@exp:900", refresh_token: "r" }), true);
  assert.equal(calls.persisted.length, 1);
});

test("the listener drops its cached identity while the machine is conflicted", () => {
  // channel-listener resolves myUserId once and caches it for the life of the process
  // (`if (!myUserId)`), so without this the first-resolved identity would keep classifying.
  const fn = fnOf(LISTENER, "reconcileInner");
  assert.match(fn, /if \(auth\.identityMismatch\(\)\) myUserId = null;/);
  assert.match(AUTH, /identityMismatch: state\.identityMismatch/, "auth.js re-exports the accessor");
  assert.match(LISTENER, /if \(!myUserId\)/, "…which is only useful because the id IS cached");
});

// ── FIX S9: AN UNREADABLE exp IS NOT "THE COOKIE IS FRESHER" ────────────────

test("an existing blob is NOT rewritten when either exp is unreadable", () => {
  // The guard was one `&&` chain, so a null exp made the whole condition false and the
  // store was rewritten on EVERY probe — a read turning into a write storm (F-072).
  const { fn, calls } = loadRebuild({ access_token: "u-me@nope" }); // stored exp unreadable
  assert.equal(fn({ access_token: "u-me@exp:900", refresh_token: "r" }), false);
  const b = loadRebuild({ access_token: "u-me@exp:100" });
  assert.equal(b.fn({ access_token: "u-me@nope", refresh_token: "r" }), false, "cookie exp unreadable");
  assert.equal(calls.persisted.length + b.calls.persisted.length, 0);
});

test("…but a MISSING blob is still rebuilt even with no readable exp anywhere", () => {
  // There is nothing to compare against, and the rebuild is the whole point of the fix.
  const { fn, calls } = loadRebuild(null);
  assert.equal(fn({ access_token: "nope", refresh_token: "r" }), true);
  assert.equal(calls.persisted.length, 1);
});

// ── FIX S2: SIGN-OUT TEARS DOWN THE MCP DEVICE TOKEN TOO ────────────────────
// Sign-out cleared the Supabase blob and the cookie jar and stopped, leaving a 90-day
// dopl.read+dopl.write bearer live in electron-store AND in userData/mcp-spawn.json — full
// API access to the account that had just signed out, sitting on the disk.

test("signOut clears the device token as well as the blob and the jar", () => {
  const fn = fnOf(STATE, "signOut");
  assert.match(fn, /clearDeviceToken\(\)/, "the 90-day MCP bearer is a credential too");
  assert.match(fn, /require\('\.\/mcp-config'\)/, "lazily, because mcp-config requires ./auth");
  const blobAt = fn.indexOf("blob.clearSession()");
  const deviceAt = fn.indexOf("clearDeviceToken");
  assert.ok(blobAt !== -1 && deviceAt > blobAt, "all three, in one action");
});

test("clearDeviceToken removes BOTH on-disk copies and the in-memory one", () => {
  const fn = fnOf(MCP, "clearDeviceToken");
  assert.match(fn, /store\.delete\(DT_KEY\)/, "the safeStorage-encrypted key");
  assert.match(fn, /store\.delete\(DT_KEY_PLAIN\)/, "…and the plaintext fallback key");
  assert.match(fn, /fs\.rmSync\(spawnConfigPath\(\)/, "…and mcp-spawn.json, whose bearer the CLI reads");
  assert.match(fn, /spawnToken = ''/, "…and the memoized copy buildMcpServers injects");
  assert.match(MCP, /clearDeviceToken, \/\/ S2/, "exported for auth-state.signOut");
});

// F-085 closed the server half: the endpoint is no longer mint-only, and signOut now calls
// the revoke BEFORE the local teardown. The full contract lives in
// test/device-token-revoke.test.mjs; what this file keeps is the pairing — a future reader
// must not mistake the LOCAL teardown for a revocation on its own.
test("the local teardown says out loud that it is only half the job", () => {
  const prose = MCP.replace(/\n\/\/ ?/g, " ");
  assert.match(prose, /LOCAL HALF ONLY/i);
  assert.match(prose, /Deleting our copies does not invalidate the credential/i);
  assert.match(prose, /F-085/, "the remaining residual is tracked, not just noted");
});

test("signOut revokes server-side FIRST, while the cookie session still authenticates it", () => {
  const fn = fnOf(STATE, "signOut");
  const revokeAt = fn.indexOf("revokeDeviceToken()");
  assert.notEqual(revokeAt, -1, "the server-side revoke must be part of sign-out");
  assert.ok(revokeAt < fn.indexOf("blob.clearSession()"), "before the blob");
  assert.ok(revokeAt < fn.indexOf("cookies.clearSessionCookies()"), "and before the jar it authenticates on");
  assert.match(MCP, /revokeDeviceToken, \/\/ F-085/, "exported for auth-state.signOut");
});

// ── SMALL: A BROKEN KEYCHAIN MUST NOT DOWNGRADE A CREDENTIAL TO CLEARTEXT ───

test("persist REFUSES to write the session unencrypted when safeStorage is unavailable", () => {
  const fn = fnOf(M("auth-store.js"), "persist");
  assert.match(fn, /refusing to store the session unencrypted/, "and says so (throttled by authFail)");
  assert.ok(!/store\.set\(PLAIN_KEY/.test(fn), "a refresh token must never be written in cleartext");
  assert.match(fn, /store\.delete\(PLAIN_KEY\)/, "…and an older build's plaintext blob is removed");
});

// ── FIX S6: ONE REFRESH IN FLIGHT, AND A JAR THAT IS NEVER EMPTY ────────────

test("refresh() is single-flight, so N loops cannot rotate the token N ways", () => {
  // Supabase ROTATES the refresh token on use: concurrent refreshes mean one winner and
  // N-1 400s, and the 400 handler DROPS the stored blob. Only getAccessTokenInfo had a
  // cooldown; ensureFresh called refresh() directly with no coordination at all.
  const fn = fnOf(AUTH, "refresh");
  assert.match(fn, /if \(refreshing\) return refreshing;/, "concurrent callers share one promise");
  assert.match(fn, /refreshInner\(\)\.finally\(/, "…and it is released when it settles");
  assert.match(fnOf(AUTH, "ensureFresh"), /refresh\(\)/, "the path that had NO bound goes through it");
  assert.match(fnOf(AUTH, "refreshInner"), /res\.status === 400/, "the drop-the-blob branch it protects");
});

test("writeSessionCookies SETS before it prunes, so the jar is never empty mid-write", () => {
  const fn = fnOf(COOKIES, "writeSessionCookies");
  const set = fn.indexOf("cookies.set(");
  const prune = fn.indexOf("cookies.remove(");
  assert.ok(set !== -1 && prune !== -1, "it still does both");
  assert.ok(set < prune, "clear-then-set left a window where every reader saw 'signed out'");
  assert.ok(!/await clearSessionCookies\(\)/.test(fn), "the wholesale clear is gone");
  assert.match(fn, /if \(written\.has\(name\)\) continue;/, "…and only unoccupied names are removed");
});
