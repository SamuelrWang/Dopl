// Tests for the Realtime credential chooser in auth.js — the 1.7.6 root cause.
//
// THE BUG THIS LOCKS OUT: getAccessToken() used to be "stored blob first, cookie
// only if the blob is missing". The stored deep-link blob is rewritten ONLY by
// captureFromFragment() or refresh(), and refresh() is reachable only from
// getAuthCookie()'s repair branch, which never runs while the renderer keeps the
// cookie jar fresh. So ~1h after sign-in the blob's JWT was expired forever while
// the cookie stayed fresh — and Realtime, which is the one consumer that needs a
// raw JWT, was handed the dead one on every single rejoin. Result in the field:
// zero SUBSCRIBED, CHANNEL_ERROR forever, push dead, every channel loop silently
// falling back to the 45s poll backstop.
//
// The other direction is worse: hand Realtime NO token and realtime-js joins with
// the URL apikey, i.e. as `anon`. An anon postgres_changes subscriber cannot
// evaluate the published tables' RLS (42501, `permission denied for function
// is_current_workspace_member`), which crashes the project's whole CDC pipeline
// and kills push for EVERY client, web included. So the chooser must always report
// whether it actually found a live credential, never silently return nothing.
//
// Run: `node --test dopl-desktop-app/test/realtime-credential.test.mjs`
//
// WHY SOURCE EXTRACTION: auth.js is CommonJS and requires electron (app,
// safeStorage, session) + electron-store, so it cannot be imported under
// `node --test`. chooseAccessToken is fenced by BEGIN/END sentinels as a PURE
// function (candidates + injected `nowSec` in, decision out), so this test slices
// the fenced block and evaluates it verbatim — the test stays honest to what ships.
//
// `.mjs` (ESM) to stay clean under the repo's shared eslint config.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "auth.js"), "utf8");

function slice(beginTag, endTag) {
  const from = SRC.indexOf(beginTag);
  const to = SRC.indexOf(endTag);
  assert.notEqual(from, -1, `${beginTag} sentinel missing`);
  assert.notEqual(to, -1, `${endTag} sentinel missing`);
  assert.ok(to > from, `${beginTag} sentinels out of order`);
  return SRC.slice(from, to);
}

const { chooseAccessToken } = new Function(
  `${slice("// ─── BEGIN TOKEN-CHOICE", "// ─── END TOKEN-CHOICE")}\n return { chooseAccessToken };`
)();

const NOW = 1_800_000_000; // fixed clock; all exps are relative to this
const SKEW = 60;

// Candidate shorthand: minutes of life left (negative = already expired).
function cand(kind, minutes, token = `${kind}-token`) {
  return { kind, token, exp: NOW + minutes * 60 };
}
const pick = (candidates) => chooseAccessToken(candidates, NOW, SKEW);

// ── The regression itself ─────────────────────────────────────────────────────

test("THE 1.7.6 BUG: an expired stored blob must NOT beat a fresh cookie", () => {
  // Exactly the live state: blob captured at sign-in and never refreshed, cookie
  // kept fresh by the renderer. The old rule returned the blob and push died.
  const got = pick([cand("stored", -300), cand("cookie", 55)]);
  assert.equal(got.kind, "cookie");
  assert.equal(got.token, "cookie-token");
  assert.equal(got.fresh, true);
  assert.equal(got.reason, "fresh");
});

test("the freshest source wins even when BOTH are still valid", () => {
  assert.equal(pick([cand("stored", 5), cand("cookie", 55)]).kind, "cookie");
  // ...and it is genuinely furthest-exp, not a hardcoded preference for cookie.
  assert.equal(pick([cand("stored", 55), cand("cookie", 5)]).kind, "stored");
});

test("a fresh stored blob is still used when there is no cookie yet", () => {
  const got = pick([cand("stored", 50), { kind: "cookie", token: null, exp: null }]);
  assert.equal(got.kind, "stored");
  assert.equal(got.fresh, true);
});

// ── Skew: never hand over a token that dies mid-join ──────────────────────────

test("a token inside the expiry SKEW counts as not fresh", () => {
  // 30s of life left, skew is 60s: treat as dead so we rotate instead of joining
  // with a token that expires during the handshake.
  const got = pick([{ kind: "stored", token: "t", exp: NOW + 30 }]);
  assert.equal(got.fresh, false);
  assert.equal(got.reason, "all-expired");
  assert.equal(got.token, "t", "still returned, so the caller can log WHY it failed");
});

test("a token just beyond the skew counts as fresh", () => {
  assert.equal(pick([{ kind: "stored", token: "t", exp: NOW + SKEW + 1 }]).fresh, true);
});

// ── No credential at all: must be loud, never silently "fine" ─────────────────

test("no candidates → kind 'none' with a null token and a named reason", () => {
  const got = pick([]);
  assert.equal(got.kind, "none");
  assert.equal(got.token, null);
  assert.equal(got.fresh, false);
  assert.equal(got.reason, "no-credential");
});

test("candidates that exist but carry no token are ignored entirely", () => {
  const got = pick([
    { kind: "stored", token: null, exp: null },
    { kind: "cookie", token: undefined, exp: null },
  ]);
  assert.equal(got.kind, "none", "an empty source must never look like a credential");
  assert.equal(got.token, null);
});

test("a missing / null candidate list does not throw", () => {
  assert.equal(chooseAccessToken(undefined, NOW, SKEW).kind, "none");
  assert.equal(chooseAccessToken(null, NOW, SKEW).kind, "none");
  assert.equal(chooseAccessToken([null, undefined], NOW, SKEW).kind, "none");
});

// ── All sources stale: report it so the caller rotates ────────────────────────

test("all sources expired → fresh:false and reason 'all-expired'", () => {
  const got = pick([cand("stored", -300), cand("cookie", -10)]);
  assert.equal(got.fresh, false);
  assert.equal(got.reason, "all-expired");
  // Still the least-dead one, so a rotation starts from the best available state.
  assert.equal(got.kind, "cookie");
});

test("a rotated token joins the pool and wins once it is the freshest", () => {
  // What getAccessTokenInfo() does after refresh(): re-pick with the new blob.
  const got = pick([cand("stored", -300), cand("cookie", -10), cand("refreshed", 60)]);
  assert.equal(got.kind, "refreshed");
  assert.equal(got.fresh, true);
});

// ── Non-JWT credentials (the `dopl_at_` device-token trap) ────────────────────

test("a token with an unreadable exp sorts LAST behind any real JWT", () => {
  // A Dopl `dopl_at_` device token is not a JWT: Realtime would reject it, so it
  // must never be preferred over a decodable Supabase JWT.
  const got = pick([
    { kind: "stored", token: "dopl_at_deadbeef", exp: null },
    cand("cookie", 30),
  ]);
  assert.equal(got.kind, "cookie");
});

test("an unreadable exp is the LAST resort, and is reported as such", () => {
  const got = pick([{ kind: "stored", token: "dopl_at_deadbeef", exp: null }]);
  assert.equal(got.kind, "stored");
  assert.equal(got.fresh, false, "we cannot claim freshness we cannot verify");
  assert.equal(got.reason, "exp-unreadable");
  assert.equal(got.secondsLeft, null);
});

test("an unreadable exp loses to an EXPIRED JWT too (both stale, JWT is knowable)", () => {
  const got = pick([{ kind: "stored", token: "dopl_at_x", exp: null }, cand("cookie", -10)]);
  assert.equal(got.kind, "cookie");
});

// ── The metadata the log depends on ───────────────────────────────────────────

test("secondsLeft is reported so the log can print expires_in without the token", () => {
  const got = pick([cand("cookie", 10)]);
  assert.equal(got.secondsLeft, 600);
  assert.equal(got.exp, NOW + 600);
});

test("secondsLeft goes negative for an expired token (how stale, not just stale)", () => {
  assert.equal(pick([cand("cookie", -5)]).secondsLeft, -300);
});

test("the result NEVER contains a field other than `token` holding the secret", () => {
  const got = pick([cand("cookie", 10, "super-secret-jwt")]);
  const leaked = Object.entries(got)
    .filter(([k, v]) => k !== "token" && String(v).includes("super-secret-jwt"))
    .map(([k]) => k);
  assert.deepEqual(leaked, [], "only .token may carry the credential");
});
