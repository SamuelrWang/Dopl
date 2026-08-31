// THE 2026-08-30 ABORT-CHURN INCIDENT — the failing-auth path, end to end.
//
// WHAT HAPPENED. macOS Keychain denied Electron's safeStorage key (`userCanceledErr`),
// so `auth-store.persist()` correctly REFUSED to write the Supabase refresh token in
// cleartext — and, on the way out, deleted both store keys. From then on
// `loadSession()` answered null for the whole run, and the app entered a state nothing
// in it could describe:
//
//   • `auth-state.isSignedIn()` said TRUE (a fresh cookie identity counts), so the
//     listener, presence, reconcile and mcp-config all kept running and kept issuing
//     HTTP — on a jar whose JWT NOTHING on the machine could rotate, because
//     `auth.refreshInner()` reads its refresh token from the blob that cannot exist.
//   • `auth-tokens.getAuthState()` said FALSE (blob-only), so the bearer seam sent no
//     Authorization header and ui-sync failed closed forever.
//
// A split brain with no state either half could reach that ends it. Every request
// 401'd or — against a saturated local API — aborted on `ui-bridge`'s own 30s timeout
// and REJECTED the IPC with a status-less error the renderer cannot read as "signed
// out", so the SPA never landed on the sign-in screen either.
//
// THREE RULES CAME OUT OF IT, and this file is all three:
//   (1) a cookie session is NOT a credential when the blob cannot be written;
//   (2) the rebuild must ASK the keychain before doing the work, and must report what
//       actually happened rather than what it attempted;
//   (3) a request that can only 401 must not be sent — the synthetic 401 is the same
//       answer in zero round trips, and it is the one the renderer routes to
//       SignedOutScreen.
//
// Run: `node --test dopl-desktop-app/test/auth-storage-unavailable.test.mjs`
//
// WHY SOURCE EXTRACTION: these modules are CommonJS and require electron
// (safeStorage, session) + electron-store, so they cannot be imported under
// `node --test`. `signedInFrom` is fenced PURE and `rebuildBlobFromCookieSession`
// takes its whole world through two module refs, so both are sliced and evaluated
// verbatim — the test stays honest to what ships.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const STATE = M("auth-state.js");
const STORE = M("auth-store.js");
const TOKENS = M("auth-tokens.js");
const BRIDGE = M("ui-bridge.js");
const REPAIR = M("api-repair.js");

const { signedInFrom } = new Function(
  `${between(STATE, "// ─── BEGIN SIGNED-IN", "// ─── END SIGNED-IN", "signed-in block")}
   return { signedInFrom };`
)();

const NOW = 1_800_000_000_000;
const TTL = 10 * 60 * 1000;
const freshCookie = { userId: "u-1", at: NOW - 60_000 };
const decide = (blob, cookie, canPersist) =>
  signedInFrom({ blob, cookie, nowMs: NOW, ttlMs: TTL, canPersist });

// ── (1) THE TRUTH TABLE'S NEW ROW ───────────────────────────────────────────

test("no keychain + no blob: SIGNED OUT, even with a perfectly fresh cookie identity", () => {
  const r = decide(null, freshCookie, false);
  assert.equal(r.signedIn, false, "the jar cannot be rotated, so it buys an hour and then 401s forever");
  assert.equal(r.source, "storage-unavailable", "'cookie' would claim a credential this machine cannot keep");
  assert.equal(r.storageUnavailable, true, "the caller must be able to say WHY it is signed out");
});

test("…and it does NOT ask for another probe — that is what made it a storm", () => {
  const r = decide(null, freshCookie, false);
  assert.equal(r.needsRefresh, false, "re-reading the jar cannot change an answer that turns on the keychain");
  // isSignedIn()'s background probe is gated on needsRefresh, so this is the whole brake.
  assert.match(fnOf(STATE, "isSignedIn"), /st\.needsRefresh/);
});

test("UNKNOWN is permissive: a caller that does not pass canPersist keeps the Q4 table", () => {
  // Deliberately against the house fail-closed default. Every pre-2026-08-30 caller
  // omits the input, and narrowing on ignorance would sign those machines out.
  assert.equal(decide(null, freshCookie, undefined).signedIn, true);
  assert.equal(decide(null, freshCookie, undefined).source, "cookie");
  assert.equal(decide(null, freshCookie, true).signedIn, true);
});

test("a READABLE blob outranks the flag — a decryptable blob proves the keychain worked", () => {
  const r = decide({ access_token: "a" }, freshCookie, false);
  assert.equal(r.signedIn, true, "the two states are mutually exclusive by construction");
  assert.equal(r.storageUnavailable, false);
  assert.equal(r.source, "both");
});

test("the live gate feeds the flag from the keychain, not from a guess", () => {
  assert.match(fnOf(STATE, "signedInState"), /canPersist: blob\.encryptionAvailable\(\)/);
  assert.match(STORE, /encryptionAvailable,/, "auth-store must export it");
});

test("availability is read LIVE, never latched — a granted keychain must recover", () => {
  const fn = fnOf(STORE, "encryptionAvailable");
  assert.match(fn, /safeStorage\.isEncryptionAvailable\(\)/);
  assert.ok(!/cached|latch|memo/i.test(fn), "a cached 'no' would outlive the condition");
  assert.match(fn, /catch/, "it is an OS call and may throw");
  // ONE reader of the OS call: persist and loadSession both go through it.
  assert.ok(
    !/safeStorage\.isEncryptionAvailable\(\)/.test(fnOf(STORE, "persist")),
    "persist must ask through encryptionAvailable(), not re-call the OS"
  );
});

// ── (2) THE REBUILD ASKS FIRST, AND REPORTS HONESTLY ────────────────────────

function loadRebuild(stored, opts = {}) {
  const calls = { persisted: [], logged: [], failed: [] };
  const blob = {
    loadSession: () => stored,
    persist: (s) => {
      calls.persisted.push(s);
      return opts.persistOk !== false;
    },
    jwtExp: (t) => {
      const m = /exp:(\d+)$/.exec(String(t || ""));
      return m ? Number(m[1]) : null;
    },
    decodeJwt: () => null,
    isRefreshTokenRejected: () => false,
    encryptionAvailable: () => opts.encryption !== false,
    authFail: (what) => calls.failed.push(what),
  };
  const diag = (...a) => calls.logged.push(a.join(" "));
  const fn = new Function(
    "blob",
    "diag",
    `${fnOf(STATE, "rebuildBlobFromCookieSession")}\n return rebuildBlobFromCookieSession;`
  )(blob, diag);
  return { fn, calls };
}

test("THE WRITE STORM: with no keychain the rebuild does not even attempt a persist", () => {
  // FIX S9's guard is `if (stored && …)`, and persist() DELETES the keys on refusal —
  // so `stored` was null on the next probe too, every guard was skipped, and this ran a
  // persist attempt + a "rebuilt" log line on EVERY probe while nothing was ever rebuilt.
  const { fn, calls } = loadRebuild(null, { encryption: false });
  assert.equal(fn({ access_token: "exp:200", refresh_token: "r" }), false);
  assert.equal(calls.persisted.length, 0, "asking the keychain first is the whole fix");
  assert.equal(calls.failed.length, 1, "and it says why, through the THROTTLED reporter");
  assert.match(calls.failed[0], /safeStorage unavailable/);
  assert.ok(
    !calls.logged.some((l) => /rebuilt session blob/.test(l)),
    "it must never log a rebuild that did not happen"
  );
});

test("a REFUSED write is reported as false, not as a rebuild", () => {
  // captureFromFragment learned this rule first: reporting an attempt as an outcome
  // made sign-in a silent dead end.
  const { fn, calls } = loadRebuild(null, { persistOk: false });
  assert.equal(fn({ access_token: "exp:200", refresh_token: "r" }), false);
  assert.equal(calls.persisted.length, 1, "it did try — the keychain said yes");
  assert.ok(!calls.logged.some((l) => /rebuilt session blob/.test(l)));
});

test("the ordinary machine is untouched: keychain yes, write yes, rebuild true", () => {
  const { fn, calls } = loadRebuild(null);
  assert.equal(fn({ access_token: "exp:200", refresh_token: "r" }), true);
  assert.equal(calls.persisted.length, 1);
  assert.match(calls.logged.join("\n"), /rebuilt session blob from cookie jar/);
});

// ── (3) A REQUEST THAT CAN ONLY 401 IS NOT SENT ─────────────────────────────

test("the bridge answers a synthetic 401 instead of a doomed round trip", () => {
  const fn = fnOf(BRIDGE, "performApiRequest");
  assert.match(fn, /if \(!getAuthState\(\)\.signedIn\) return unauthenticatedEnvelope\(\);/);
  assert.ok(
    fn.indexOf("unauthenticatedEnvelope()") < fn.indexOf("sendApiRequest"),
    "the short-circuit must precede the send, or it buys nothing"
  );
});

test("…gated on the AUTHORITY's state, never on a null token read", () => {
  // getBearerToken() also answers null for a signed-IN operator mid-backoff after a
  // network blip; answering 401 there is the renderer flap this whole wave is about.
  const fn = fnOf(BRIDGE, "performApiRequest");
  assert.ok(
    !/if \(!\s*\(?await getBearerToken/.test(fn),
    "a null token must not be the discriminator"
  );
});

test("the synthetic envelope decodes to the SAME ApiError the server would produce", () => {
  const fn = fnOf(BRIDGE, "unauthenticatedEnvelope");
  assert.match(fn, /status: 401/, "page-states.isUnauthorized reads the STATUS");
  assert.match(fn, /hasBody: true/, "a bodiless 401 decodes as INTERNAL_ERROR");
  // The flat `{ error, message }` shape src/shared/auth/with-auth.ts answers.
  assert.match(fn, /error: 'Authentication required'/);
  assert.match(fn, /message: 'Sign in to continue\.'/);
});

test("the bridge releases the first 401's body before opening a second connection", () => {
  const fn = fnOf(BRIDGE, "performApiRequest");
  assert.match(fn, /discardBody\(res\);\s*\n\s*res = await sendApiRequest/,
    "an unread undici body pins its socket for the life of the process");
  assert.match(BRIDGE, /require\('\.\/api-repair'\)/, "SHARED helper, never a fourth private copy");
});

// ── THE FLAP: a sign-out claim nothing recorded ─────────────────────────────

test("both 401-repair seams LATCH the rejection instead of just announcing it", () => {
  // ⚠ The negative is scoped to the CALL form (`authTokens.emitAuthState(...)`) rather
  // than to the bare name: both files discuss the old bare emit in prose, and a global
  // negative grep that matches a comment is the fail-open pattern source-probe.mjs's
  // header exists to name.
  for (const [name, fn] of [
    ["ui-bridge.js", fnOf(BRIDGE, "performApiRequest")],
    ["api-repair.js", fnOf(REPAIR, "fetchWithAuthRepair")],
  ]) {
    assert.match(fn, /authTokens\.noteSessionRejected\(/, `${name} must record the rejection`);
    assert.ok(
      !/authTokens\.emitAuthState\('signed-out'\)/.test(fn),
      `${name}: a bare emit changes nothing, so the next request resurrects signed-IN`
    );
  }
});

test("the latch outranks the blob everywhere the app asks 'are we signed in?'", () => {
  assert.match(fnOf(TOKENS, "getAuthState"), /!sessionRejected && !!\(s && s\.access_token\)/);
  assert.match(fnOf(TOKENS, "getAccessToken"), /if \(sessionRejected\) return null;/);
  // …and it stops the TRAFFIC too, not only the announcement: every 401 repair calls
  // refreshNow, which would otherwise rotate once per 401 forever.
  assert.match(fnOf(TOKENS, "refreshNow"), /if \(sessionRejected\)/);
  assert.match(fnOf(TOKENS, "kick"), /sessionRejected \? null : store\.loadSession\(\)/);
  assert.match(fnOf(TOKENS, "tick"), /sessionRejected \? null : store\.loadSession\(\)/);
});

test("only a human gesture clears it — a successful ROTATION must not", () => {
  // Rotating the same session mints a different token for the same rejected identity.
  assert.match(fnOf(TOKENS, "onSignIn"), /sessionRejected = false/);
  assert.match(fnOf(TOKENS, "onSignOut"), /sessionRejected = false/);
  assert.ok(
    !/sessionRejected = false/.test(fnOf(TOKENS, "refreshNow")),
    "a rotation is not evidence the API changed its mind"
  );
  assert.ok(
    !/sessionRejected = false/.test(fnOf(TOKENS, "noteRefreshOutcome")),
    "…nor is a refresh that merely succeeded"
  );
});

test("the latch does NOT drop the blob — that decision stays bounded elsewhere", () => {
  const fn = fnOf(TOKENS, "noteSessionRejected");
  assert.ok(!/clearSession/.test(fn), "a 401 from the app API is not proof the refresh token is dead");
  assert.match(fn, /clearTimer\(\)/, "but it must stop the proactive rotation");
  assert.match(fn, /diag\(/, "and say so once");
});
