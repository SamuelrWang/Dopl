// THE 2026-08-29 SIGN-OUT LOOP — the whole defect, pinned end to end.
//
// Field listener.log, verbatim shape: the bearer authority drops the blob after
// 3 definitive refresh rejections → the next auth-state probe finds "no blob"
// and adopts the COOKIE JAR's session — a stale COPY of the very refresh token
// the server just rejected (nothing rotated the jar once the remote page's
// supabase-js left) → refresh 400s ×3 → drop → re-adopt, forever, flapping
// 'signed-out' every ~30s and forcing a manual sign-in "way too often".
//
// Three fixes, three pins:
//   1. auth.js refreshInner writes a successful rotation into BOTH stores
//      (blob + jar) — the drift that armed the loop is gone at the source.
//   2. auth-store.js remembers the definitively rejected token and
//      auth-state.js › rebuildBlobFromCookieSession refuses to adopt it back.
//   3. auth-cookies.js › clearCookiesIfSameRefreshToken clears a jar holding
//      the SAME dead session at the drop; a different (fresh) one is kept.
//
// Same source-extraction idiom as auth-signed-in.test.mjs (the modules are
// CommonJS and require electron, so they cannot be imported under node --test).
//
// Run: `node --test dopl-desktop-app/test/auth-rejected-token.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const STATE = M("auth-state.js");
const AUTH = M("auth.js");
const COOKIES = M("auth-cookies.js");
const STORE = M("auth-store.js");

// ── Harness: rebuildBlobFromCookieSession with its world mocked ─────────────
// (auth-signed-in.test.mjs's loadRebuild, plus the rejected-token knob.)
const fakeSub = (t) => {
  const m = /^(u[^@]*)@/.exec(String(t || ""));
  return m ? m[1] : null;
};
const fakeExp = (t) => {
  const m = /exp:(\d+)$/.exec(String(t || ""));
  return m ? Number(m[1]) : null;
};

function loadRebuild(stored, rejectedRefreshToken = null) {
  const calls = { persisted: [], logged: [] };
  const blob = {
    loadSession: () => stored,
    persist: (s) => { calls.persisted.push(s); return true; },
    // 2026-08-30: the rebuild asks the keychain before doing any work, and reports the
    // write's real outcome. Both are the ordinary machine here.
    encryptionAvailable: () => true,
    authFail: () => {},
    jwtExp: (t) => fakeExp(t),
    decodeJwt: (t) => (fakeSub(t) ? { sub: fakeSub(t) } : null),
    isRefreshTokenRejected: (rt) =>
      rejectedRefreshToken != null && rt === rejectedRefreshToken,
  };
  const diag = (...a) => calls.logged.push(a.join(" "));
  const fn = new Function(
    "blob",
    "diag",
    `${fnOf(STATE, "rebuildBlobFromCookieSession")}\n return rebuildBlobFromCookieSession;`
  )(blob, diag);
  return { fn, calls };
}

// ── Fix 2: the adoption refusal ─────────────────────────────────────────────

test("the already-rejected refresh token is never adopted back (the sign-out loop)", () => {
  const { fn, calls } = loadRebuild(null, "r-dead");
  assert.equal(
    fn({ access_token: "exp:200", refresh_token: "r-dead", expires_at: 200 }),
    false,
    "a jar holding the token the server just rejected must not resurrect it"
  );
  assert.equal(calls.persisted.length, 0);
  assert.ok(
    calls.logged.some((l) => /already-rejected refresh token/.test(l)),
    "the refusal is said out loud, not silent"
  );
});

test("…but a DIFFERENT cookie session still adopts — the marker blocks one token, not the jar", () => {
  const { fn, calls } = loadRebuild(null, "r-dead");
  assert.equal(
    fn({ access_token: "exp:200", refresh_token: "r-new", expires_at: 200 }),
    true,
    "a genuinely fresh session (renderer re-signed-in) must keep adopting"
  );
  assert.equal(calls.persisted.length, 1);
  assert.equal(calls.persisted[0].refresh_token, "r-new");
});

// ── The marker itself (auth-store.js) ───────────────────────────────────────

test("the marker is exact-match and in-memory: no value, no match; never persisted", () => {
  const mark = fnOf(STORE, "markRefreshTokenRejected");
  const check = fnOf(STORE, "isRefreshTokenRejected");
  const mod = new Function(
    `let rejectedRefreshToken = null;
     ${mark}
     ${check}
     return { markRefreshTokenRejected, isRefreshTokenRejected };`
  )();
  assert.equal(mod.isRefreshTokenRejected("r1"), false, "nothing rejected yet");
  mod.markRefreshTokenRejected("r1");
  assert.equal(mod.isRefreshTokenRejected("r1"), true);
  assert.equal(mod.isRefreshTokenRejected("r2"), false, "one token, not a family");
  assert.equal(mod.isRefreshTokenRejected(""), false, "empty never matches");
  mod.markRefreshTokenRejected(null);
  assert.equal(mod.isRefreshTokenRejected("r1"), true, "a bogus mark must not clear a real one");
  assert.ok(
    !/store\.(set|get)\([^)]*[Rr]eject/.test(STORE),
    "the rejected token never reaches disk — a dead credential is not worth persisting"
  );
});

// ── Fixes 1 + 3: what refreshInner is actually wired to ─────────────────────

test("refreshInner marks the rejected token at the drop and rotates the jar with the blob", () => {
  const fn = fnOf(AUTH, "refreshInner");
  assert.match(
    fn,
    /verdict\.dropSession[\s\S]*markRefreshTokenRejected\(s\.refresh_token\)/,
    "the drop is what arms the adoption refusal"
  );
  assert.match(
    fn,
    /clearCookiesIfSameRefreshToken\(s\.refresh_token\)/,
    "…and the jar's copy of the dead session is cleared through the one jar-owning module"
  );
  assert.match(
    fn,
    /persist\(next\);[\s\S]*writeSessionCookies\(next\)/,
    "a successful rotation reaches BOTH stores — jar drift is what armed the loop"
  );
});

test("clearCookiesIfSameRefreshToken clears only the SAME session, and never throws outward", () => {
  const fn = fnOf(COOKIES, "clearCookiesIfSameRefreshToken");
  assert.match(
    fn,
    /jar\.refresh_token === rejectedRefreshToken[\s\S]*clearSessionCookies\(\)/,
    "equality with the rejected token is the ONLY clearing condition"
  );
  assert.match(fn, /return 'differs'/, "a different jar session is reported, not cleared");
  assert.match(fn, /catch[\s\S]*return 'error'/, "a jar read failure degrades to a report");
});
