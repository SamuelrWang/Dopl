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
// F-054 CLOSED (2026-08-08). The header used to say the web leg dropped our `?state`,
// so the browser records stayed presence-gated. That was false: /auth/desktop-start
// forwards the state into the Supabase redirectTo, /auth/callback threads it to
// /auth/desktop-handoff, and that page puts it in the dopl:// fragment. Only the
// desktop's ENFORCEMENT was missing — the record armed without `requireState`, so a
// fragment carrying no state at all still passed on presence + TTL. The browser record
// now arms with requireState, alongside the in-process password adoption.
//
// F-054 RESIDUAL, same night. The MAGIC LINK was the one presence-only kind left, and
// it is renderer-reachable (ipc `dopl:magic-link`): every accepted address armed a
// ten-minute state-less window — the pre-F-054 attack, on demand. It no longer gets a
// bare `redirect_to`: the nonce rides out as `?state=` on it, the emailed link lands on
// /auth/desktop-handoff?state=<nonce>#access_token=…, and that page's existing
// `window.location.search` read finds it (the tokens are in the FRAGMENT, so the query
// survives). ALL THREE legs are strict now — the state-less branch of pickPendingAuth
// survives only for records a PRIOR build persisted into the store across an upgrade.
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
const ACTIONS = M("auth-actions.js");
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
  // Covers both strict kinds: the in-process password adoption AND (since F-054) the
  // browser OAuth handoff. An injected dopl:// link cannot guess the nonce, so its
  // only move is to omit the state — which is exactly what this refuses.
  const live = [rec({ nonce: "password", requireState: true })];
  for (const state of [null, undefined, ""]) {
    assert.equal(pickPendingAuth(live, state), null, `admitted with state=${JSON.stringify(state)}`);
  }
});

// ── F-054: the browser OAuth record, end to end over the pure decision ──────

test("F-054 matrix: an armed browser record admits ONLY its exact echo", () => {
  // The record auth-actions.maybeBeginAuth now writes. Nothing else is live, so
  // there is no presence-only record to fall back to — which is the point.
  const armed = [rec({ nonce: "oauth-nonce", requireState: true })];

  assert.equal(
    pickPendingAuth(armed, "oauth-nonce").nonce,
    "oauth-nonce",
    "the real handoff, echoing the state the web leg carried, must still be admitted"
  );
  assert.equal(pickPendingAuth(armed, null), null, "a fragment with NO state is refused");
  assert.equal(pickPendingAuth(armed, ""), null, "an empty state is not 'a state'");
  assert.equal(pickPendingAuth(armed, "oauth-nonc"), null, "a near-miss state is refused");
  assert.equal(pickPendingAuth(armed, "attacker"), null, "a wrong state is refused");
});

test("F-054: a WRONG state never degrades into presence+TTL admission", () => {
  // The failure mode worth naming: if a mismatch fell through to the state-less
  // branch, an attacker would just send a junk state and spend whatever laxer
  // record was lying around. A bad echo must match nothing at all.
  //
  // The laxer record here is the only kind that can still exist: one a PRIOR build
  // wrote into electron-store before the magic-link leg went strict. Nothing arms
  // presence-only any more, and an upgrade does not rewrite the store.
  const live = [rec({ nonce: "oauth", requireState: true }), rec({ nonce: "pre-upgrade" })];
  assert.equal(pickPendingAuth(live, "junk"), null, "a mismatch fell back to a laxer record");
  // …while that legacy record's own state-less return is still honoured.
  assert.equal(pickPendingAuth(live, null).nonce, "pre-upgrade");
});

// ── F-054 residual: the MAGIC-LINK record, over the same pure decision ──────

test("F-054 residual: the magic-link record is strict — no state, no admission", () => {
  // Before tonight this record armed bare, so `pickPendingAuth(armed, null)` returned
  // it: a state-less dopl://auth#access_token=… fired by any local process inside the
  // ten-minute TTL was adopted. The renderer could arm it on demand over IPC with
  // nothing but an address GoTrue would accept.
  const armed = [rec({ nonce: "magic-nonce", requireState: true })];

  assert.equal(pickPendingAuth(armed, null), null, "a state-less fragment must no longer be adopted");
  assert.equal(pickPendingAuth(armed, ""), null, "an empty state is not 'a state'");
  assert.equal(pickPendingAuth(armed, "guess"), null, "a wrong state is refused");
  assert.equal(
    pickPendingAuth(armed, "magic-nonce").nonce,
    "magic-nonce",
    "the real return — the nonce we hung on redirect_to, echoed back by the handoff page — is still admitted"
  );
});

test("F-054: requireState changes WHICH record is spent, never the TTL", () => {
  // The strict record obeys the same liveness rules as any other: expiry is
  // livePendingAuth's job and this change must not have touched it.
  const strict = { nonce: "oauth", ts: NOW - TTL, requireState: true };
  const dead = { nonce: "stale", ts: NOW - TTL - 1, requireState: true };
  assert.deepEqual(
    livePendingAuth([strict, dead], NOW, TTL).map((p) => p.nonce),
    ["oauth"],
    "a requireState record is neither exempt from the TTL nor held to a shorter one"
  );
  assert.equal(pickPendingAuth(livePendingAuth([dead], NOW, TTL), "stale"), null,
    "an EXPIRED record is unspendable even by a perfectly matching state");
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

// consumePendingAuth run for real against a fake store: the electron-store reads and
// writes are the only things it touches, so injecting them exercises the actual
// branch — including the `: live` arm no assertion reached before.
function consumerOver(records) {
  const box = { list: records };
  const make = new Function(
    "readPendingAuth",
    "writePendingAuth",
    "pickPendingAuth",
    `${fnOf(AUTH, "consumePendingAuth")}
     return consumePendingAuth;`
  );
  const consume = make(
    () => box.list,
    (list) => { box.list = list; },
    pickPendingAuth
  );
  return { box, consume };
}

test("a REJECTED fragment leaves the record armed — the correct state still spends it", () => {
  // The `hit ? … : live` reject arm, pinned. Burning the record on a mismatch reads
  // like tidy hygiene and is a one-packet sign-in DoS: any local process fires a
  // single junk `dopl://auth#…&state=x` and the operator's real handoff — already in
  // flight, already authenticated in the browser — lands on a disarmed gate and dies
  // with nothing to retry. Keeping it costs nothing: guessing a 128-bit nonce is the
  // attack, and unlimited retries against it are worth exactly as much as one.
  const { box, consume } = consumerOver([{ nonce: "real-nonce", ts: Date.now(), requireState: true }]);

  assert.equal(consume("wrong-nonce"), false, "a mismatched fragment is rejected");
  assert.equal(consume(null), false, "…and so is the state-less retry");
  assert.deepEqual(box.list.map((p) => p.nonce), ["real-nonce"], "the record must survive both");

  assert.equal(consume("real-nonce"), true, "the genuine handoff still completes afterwards");
  assert.deepEqual(box.list, [], "…and only then is it spent");
  assert.equal(consume("real-nonce"), false, "single-use: the same state cannot be replayed");
});

test("a rejected fragment does not disturb the OTHER armed records either", () => {
  const now = Date.now();
  const { box, consume } = consumerOver([
    { nonce: "oauth", ts: now, requireState: true },
    { nonce: "magic", ts: now, requireState: true },
  ]);
  assert.equal(consume("junk"), false);
  assert.deepEqual(box.list.map((p) => p.nonce), ["oauth", "magic"], "a bad packet must not clear the set");
  assert.equal(consume("magic"), true);
  assert.deepEqual(box.list.map((p) => p.nonce), ["oauth"], "and the sibling flow survives the spend");
});

test("arming keeps the existing live records and is bounded", () => {
  const fn = fnOf(AUTH, "beginPendingAuth");
  assert.match(fn, /\[\.\.\.readPendingAuth\(\), rec\]/, "a new attempt must not clobber the others");
  assert.match(fnOf(AUTH, "writePendingAuth"), /slice\(-PENDING_AUTH_MAX\)/);
  assert.match(fnOf(AUTH, "writePendingAuth"), /store\.delete\(PENDING_AUTH_KEY\)/, "an empty set clears the key");
});

// ── the call sites ──────────────────────────────────────────────────────────

test("F-054: the BROWSER handoff arms a state-bound record and sends that nonce", () => {
  const fn = fnOf(ACTIONS, "maybeBeginAuth");
  assert.match(fn, /beginPendingAuth\(\{ requireState: true \}\)/,
    "a presence-only browser record lets a state-less dopl:// fragment in");
  // Unconditional: the old `if (!u.searchParams.has('state'))` guard would arm a
  // record whose nonce we never put on the URL — unspendable, so sign-in dies silently.
  assert.match(fn, /u\.searchParams\.set\('state', nonce\);/);
  assert.ok(!/has\('state'\)/.test(fn), "the nonce must be sent, not conditionally skipped");
});

test("F-054: the docblock no longer claims the web leg drops ?state", () => {
  // The sentence this replaces sent two sessions off to rebuild a shipped half.
  assert.ok(
    !/desktop-start\s+drops\s+\?state/.test(AUTH),
    "auth.js still tells readers the web echo is missing; it shipped"
  );
});

test("F-054 residual: the MAGIC LINK arms a state-bound record and sends that nonce", () => {
  const fn = fnOf(PASSWORD, "sendMagicLink");
  assert.match(fn, /beginPendingAuth\(\{ requireState: true \}\)/,
    "a presence-only magic-link record is a renderer-armable state-less window");
  assert.match(fn, /desktop-handoff\?state=\$\{nonce\}/,
    "the nonce must ride out on redirect_to — GoTrue owns that redirect, so there is no other channel");
  assert.ok(
    orderOf(fn, "beginPendingAuth", "gotrue(`/otp", "magic-link arming"),
    "the nonce has to exist before the send that carries it"
  );
  // The audit's old rule — arm only AFTER GoTrue accepts — rested on the record being
  // presence-only, which is what made a stranded one dangerous. It cannot hold here
  // (the nonce IS the arming), and requireState is what replaces it: the nonce leaves
  // the process only inside that request, so a stranded record is unspendable and
  // simply expires. Assert the reasoning is still written down, not just obeyed.
  assert.match(fn, /unspendable/, "the reversed order must keep stating why it is safe");
});

test("no leg arms a presence-only record any more", () => {
  // The state-less branch of pickPendingAuth is now reachable only by a record a PRIOR
  // build left in electron-store. A bare beginPendingAuth() reintroduces the hole.
  for (const [name, src] of [["auth-actions.js", ACTIONS], ["auth-password.js", PASSWORD]]) {
    assert.ok(
      !/beginPendingAuth\(\s*\)/.test(src),
      `${name} arms a pending record with no requireState — a state-less dopl:// fragment can spend it`
    );
  }
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
