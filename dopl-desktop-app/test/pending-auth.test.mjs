// The login-CSRF gate (M4) after the 2026-08-03 fleet audit hardening.
//
// WHAT THE AUDIT FOUND. The gate had degraded to "accept ANY dopl:// session for the
// next 10 minutes", armable on demand from the renderer:
//   1. `sendMagicLink` armed the record BEFORE the GoTrue call and never cleared it, so
//      a rejected address, a network failure, or a link the user never clicks all left
//      the window open for its full TTL.
//   2. The store held ONE record, and `passwordAuth` armed + immediately consumed it —
//      silently voiding an in-flight browser handoff (a just-emailed magic link went
//      permanently dead) and leaving no record for the OAuth return.
//   3. `signOut()` cleared the blob, the jar, the device token and the Claude
//      credential — and left the pending record armed on a machine the operator
//      believes is signed out.
// The web leg still drops our `?state` (/auth/desktop-start ignores it and
// /auth/desktop-handoff builds the deep link from tokens alone), so the browser records
// stay presence-gated; the IN-PROCESS password adoption, whose fragment main builds
// itself, now demands an exact nonce match — the state round trip where it is feasible.
//
// Run: `node --test dopl-desktop-app/test/pending-auth.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf, orderOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const AUTH = M("auth.js");
const PASSWORD = M("auth-password.js");
const STATE = M("auth-state.js");
const STORE = M("auth-store.js");

const { livePendingAuth, pickPendingAuth } = new Function(
  `${between(AUTH, "// ─── BEGIN PENDING-AUTH", "// ─── END PENDING-AUTH", "pending-auth block")}
   return { livePendingAuth, pickPendingAuth };`
)();

const TTL = 10 * 60 * 1000;
const NOW = 1_000_000_000;
const rec = (o) => ({ nonce: "n", ts: NOW, ...o });

// ── TTL / shape ─────────────────────────────────────────────────────────────

test("only well-formed records inside the TTL are live", () => {
  const list = [
    rec({ nonce: "fresh" }),
    rec({ nonce: "edge", ts: NOW - TTL }), // exactly at the TTL is still live
    rec({ nonce: "stale", ts: NOW - TTL - 1 }),
    { nonce: "no-ts" },
    { ts: NOW },
    null,
    "not a record",
  ];
  assert.deepEqual(
    livePendingAuth(list, NOW, TTL).map((p) => p.nonce),
    ["fresh", "edge"]
  );
});

test("a per-record ttlMs overrides the default (the password record expires in a minute)", () => {
  const list = [rec({ nonce: "short", ts: NOW - 90_000, ttlMs: 60_000 }), rec({ nonce: "long", ts: NOW - 90_000 })];
  assert.deepEqual(livePendingAuth(list, NOW, TTL).map((p) => p.nonce), ["long"]);
});

test("a legacy single-record value (pre-list) is refused, never coerced", () => {
  // Failing CLOSED is right: the only cost is one refused sign-in across an upgrade.
  assert.deepEqual(livePendingAuth({ nonce: "old", ts: NOW }, NOW, TTL), []);
  assert.deepEqual(livePendingAuth(undefined, NOW, TTL), []);
});

// ── which record a fragment may spend ───────────────────────────────────────

test("an echoed state consumes ONLY the record with that exact nonce", () => {
  const live = [rec({ nonce: "a" }), rec({ nonce: "b", requireState: true })];
  assert.equal(pickPendingAuth(live, "b").nonce, "b");
  assert.equal(pickPendingAuth(live, "a").nonce, "a");
  assert.equal(pickPendingAuth(live, "c"), null, "an unknown nonce matches nothing");
});

test("a fragment with NO state can never spend a requireState record", () => {
  // The in-process password adoption's record. An injected dopl:// link carries no
  // state (the web leg does not echo one), so this is what stops it being spent by
  // anything but the fragment main built itself.
  const live = [rec({ nonce: "password", requireState: true })];
  for (const state of [null, undefined, ""]) {
    assert.equal(pickPendingAuth(live, state), null, `admitted with state=${JSON.stringify(state)}`);
  }
});

test("with no state the NEWEST presence-only record is spent", () => {
  const live = [rec({ nonce: "old" }), rec({ nonce: "strict", requireState: true }), rec({ nonce: "new" })];
  assert.equal(pickPendingAuth(live, null).nonce, "new");
});

test("no live records at all refuses everything", () => {
  assert.equal(pickPendingAuth([], null), null);
  assert.equal(pickPendingAuth([], "whatever"), null);
});

// ── the store operations built on top ───────────────────────────────────────

test("consume is single-use and keeps the OTHER live records", () => {
  // The one-slot store is what made a password sign-in kill an in-flight OAuth
  // handoff and a just-emailed magic link.
  const fn = fnOf(AUTH, "consumePendingAuth");
  assert.match(fn, /pickPendingAuth\(live, state_\)/);
  assert.match(fn, /live\.filter\(\(p\) => p !== hit\)/, "only the consumed record is dropped");
  assert.match(fn, /writePendingAuth\(/);
});

test("arming keeps the existing live records and is bounded", () => {
  const fn = fnOf(AUTH, "beginPendingAuth");
  assert.match(fn, /\[\.\.\.readPendingAuth\(\), rec\]/, "a new attempt must not clobber the others");
  assert.match(fnOf(AUTH, "writePendingAuth"), /slice\(-PENDING_AUTH_MAX\)/);
  assert.match(fnOf(AUTH, "writePendingAuth"), /store\.delete\(PENDING_AUTH_KEY\)/, "an empty set clears the key");
});

// ── the call sites ──────────────────────────────────────────────────────────

test("the magic link arms only AFTER GoTrue accepted the send", () => {
  const fn = fnOf(PASSWORD, "sendMagicLink");
  assert.ok(
    orderOf(fn, "if (!res.ok)", "auth.beginPendingAuth()", "magic-link arming"),
    "arming before the request opens the window for a rejected address / a dead network"
  );
});

test("the in-process password adoption arms a state-bound, short-lived record", () => {
  const fn = fnOf(PASSWORD, "passwordAuth");
  assert.match(fn, /beginPendingAuth\(\{ requireState: true, ttlMs: 60_000 \}\)/);
  assert.match(fn, /captureFromFragment\(sessionFragment\(session, nonce\)\)/, "…and echoes that nonce");
});

test("sign-out disarms the gate", () => {
  const fn = fnOf(STATE, "signOut");
  assert.match(fn, /clearPendingAuth\(\)/, "an armed gate must not outlive the session it belonged to");
  assert.match(AUTH, /clearPendingAuth,/, "…and auth.js must export it");
});

// ── persist reports failure, so a dead-end sign-in says so ──────────────────

test("persist() answers whether the session actually reached disk", () => {
  const fn = fnOf(STORE, "persist");
  assert.match(fn, /return true;/, "the encrypted write path reports success");
  const refusal = fn.slice(fn.indexOf("authFail('safeStorage unavailable"));
  assert.match(refusal, /return false;/, "the safeStorage refusal is a FAILURE, not a silent success");
  assert.match(fn.slice(fn.indexOf("catch")), /return false;/, "and so is a throw");
});

test("captureFromFragment refuses to claim a session it could not store", () => {
  // Otherwise passwordAuth answered {ok:true}, onSignIn() loaded nothing, the machine
  // emitted 'signed-out', and the login form re-rendered with neither error nor
  // progress — an unbreakable retry loop on a machine with no keychain.
  const fn = fnOf(AUTH, "captureFromFragment");
  assert.match(fn, /const stored = persist\(\{/);
  assert.ok(orderOf(fn, "const stored = persist({", "if (!stored)", "persist outcome"));
  assert.match(fn.slice(fn.indexOf("if (!stored)")), /return false;/);
});
