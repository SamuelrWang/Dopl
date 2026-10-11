// Q4 fix 1, PART TWO — THE ORIGIN LOCKS THAT MAKE THE COOKIE-SESSION FIX SAFE.
//
// ⚠ WHY THIS IS ITS OWN FILE (2026-10-11). `auth-signed-in.test.mjs` crossed the hard 500-line
// §2 cap that `test/**/*.mjs` is linted under (`eslint.config.js`, ZERO exemptions), so
// `cd dopl-desktop-app && npm run lint` was red and neither of its subjects could gain a case.
// Split on the seam that file's OWN header already named — it locks "that truth table, the
// blob-rebuild rule, and — critically — that the deep-link CSRF gate was NOT weakened on the way
// through" — rather than at the line the lint happened to fail on (the F-226 / `_ipc-harness.mjs`
// precedent: one file per reason to change). The THIRD of those three groups is here, in whole.
//
// It is the separable one because it is the only group that reads a different set of modules, and
// none of the signed-in fixtures: `auth.js` (the deep-link path), `auth-cookies.js` (the jar),
// `auth-actions.js` + `spa-window.js` (the navigation lock). `signedInFrom`, the fixed clock/TTL
// and `loadRebuild` are NOT needed here and do not travel — the truth table and the blob-rebuild
// rule stay in `auth-signed-in.test.mjs`, which remains the entry point for the whole story.
//
// THE CLAIM THESE CASES PIN. The rebuild adopts a session WITHOUT a pending-auth nonce, which is
// only safe because the jar is writable solely by our own origin. That must not bleed into the
// deep-link path, where the fragment IS attacker-suppliable.
//
// Run: `node --test dopl-desktop-app/test/auth-signed-in-origin-lock.test.mjs`
//
// WHY SOURCE EXTRACTION: auth-state.js / auth.js / auth-cookies.js are CommonJS and require
// electron (safeStorage, session) + electron-store, so they cannot be imported under
// `node --test`. The functions are brace-matched out and read as text — the test stays honest to
// what ships. `codeOf` is used wherever a COMMENT must not be able to satisfy the assertion.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { codeOf, fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const STATE = M("auth-state.js");
const AUTH = M("auth.js");
const COOKIES = M("auth-cookies.js");
const ACTIONS = M("auth-actions.js");
const INDEX = M("index.js");

// ── THE CSRF GATE IS NOT WEAKENED ───────────────────────────────────────────

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
  assert.ok(!/c\.name === COOKIE_BASE \|\| c\.name\.startsWith/.test(codeOf(read)), "the name-only filter is gone");
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
  // THE WILL-NAVIGATE LOCK MOVED (2026-08-07). It lived in index.js's `wireNavigation`,
  // which existed only for the deleted remote wrapper. The SPA window polices navigation
  // itself and STRICTER: `isAllowedNavigation` locks to the bundled index file rather than
  // to the app origin, and it covers will-redirect and will-frame-navigate too, which the
  // old branch did not. `isAppOrigin` survives as the nonce gate's own predicate.
  // ⚠ …AND IT IS SHARED NOW (2026-08-18, wiring plan Phase 10). `policeNavigation(win)` is
  // the exported policy the POP-OUT thread window takes verbatim, so the two windows cannot
  // drift; the per-event handler inside it is `police`.
  const SPA = readFileSync(join(HERE, "..", "main", "spa-window.js"), "utf8");
  assert.match(SPA, /on\('will-navigate', police\)/, "the live lock is the SPA window's");
  assert.match(SPA, /on\('will-redirect', police\)/, "…and it covers redirects too");
  assert.match(SPA, /function policeNavigation\(win\)/, "one policy, applied to every app window");
  // ⚠ `police` GREW AN ELSE-BRANCH (#3031, 2026-10-10) and this used to pin its one-liner
  // verbatim. The PREDICATE and the refusal are unchanged — what is new is that a refused URL
  // is handed to the real browser instead of silently dropped, which is what made every link
  // in the app dead. Pinned as two facts rather than one line so the hand-off cannot be
  // deleted and cannot be mistaken for a loosening of the gate.
  assert.match(SPA, /if \(isAllowedNavigation\(url, devUrl\(\), indexHref\)\) return;/);
  // ⚠ THE ORDER, NOT THE TWO LINES BEING ADJACENT. This pinned
  // `event.preventDefault();\s*\n\s*handOffExternal(url, 'navigation');` — literally the two
  // statements touching, with that exact argument list — and it went red when the gesture gate
  // gave `handOffExternal` a third argument (the webContents it must check activation on) and
  // put a comment between them. Neither change loosened anything: the refusal still happens
  // first and the hand-off still happens second, which is the whole claim. A probe that fails
  // when a comment is added is measuring layout, not behaviour.
  const police = codeOf(fnOf(SPA, "policeNavigation"));
  const refuse = police.indexOf("event.preventDefault();");
  const handOff = police.indexOf("handOffExternal(url, 'navigation'");
  assert.ok(refuse > 0, "the navigation refusal is gone from policeNavigation");
  assert.ok(handOff > 0, "the refused URL is no longer handed to the browser — every link dies again");
  assert.ok(refuse < handOff, "the URL must be refused in-window BEFORE it is handed off");
});
