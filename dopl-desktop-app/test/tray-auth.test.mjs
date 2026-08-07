// Q4 fix 3 — the tray's signed-out state and the sign-in / sign-out escape hatch.
//
// WHAT WAS MISSING. The tray was the ONLY surface that knew the listener was
// signed out, and all it did was print a dead, disabled "Listener: signed out"
// line. Meanwhile the app window rendered fully signed in on its cookie session,
// so the operator had no reason to suspect anything was wrong and no control to
// fix it either way: there was no sign-in entry point (the web login page's
// window.open was the only one, and a signed-in-looking page never shows it) and
// NO SIGN-OUT CONTROL AT ALL. The actual field recovery was quitting the app and
// deleting its Cookies store by hand.
//
// So the status string now drives an affordance, and this file locks the state
// transitions plus the two things that must NOT regress: the sign-in path still
// arms the M4 login-CSRF nonce, and sign-out clears the cookie jar (not just the
// encrypted blob, which never rendered the UI signed in).
//
// Run: `node --test dopl-desktop-app/test/tray-auth.test.mjs`
//
// Source extraction: tray.js requires electron (Tray/Menu/nativeImage), so the
// decision is fenced as a pure function and sliced out verbatim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const TRAY = M("tray.js");
const INDEX = M("index.js");
const ACTIONS = M("auth-actions.js");
// Stage D moved the sign-out body here (see the sign-out test below).
const SHELL = M("shell-mode.js");
const LISTENER = M("channel-listener.js");

const { authMenuState } = new Function(
  `${between(TRAY, "// ─── BEGIN TRAY-AUTH", "// ─── END TRAY-AUTH", "tray-auth block")}
   return { authMenuState };`
)();

// ── State transitions ───────────────────────────────────────────────────────
// The input is a BOOLEAN now (Q5 review). It used to be the status STRING, matched with
// /signed out/i — the tray re-deriving a fact it does not own from prose written elsewhere,
// so rewording "Listener: signed out" would have deleted the app's only sign-in entry point
// with nothing failing. channel-listener.setStatus passes the fact it already computed.

test("signed out → a clickable sign-in call to action", () => {
  const s = authMenuState(true);
  assert.equal(s.signedOut, true);
  assert.equal(s.action, "signIn");
  assert.equal(s.label, "Listener signed out — Sign in…");
});

test("watching channels → the sign-out escape hatch", () => {
  const s = authMenuState(false);
  assert.equal(s.signedOut, false);
  assert.equal(s.action, "signOut");
  assert.equal(s.label, "Sign out");
});

test("anything that is not the boolean TRUE offers sign-out, never sign-in", () => {
  // Fail closed toward the SAFE affordance: an unknown state must not claim the listener
  // is signed out, and — the old bug's shape — a STATUS STRING passed here by mistake must
  // not be interpreted at all.
  for (const bad of [false, undefined, null, "", 0, 1, "Listener: signed out", {}]) {
    const s = authMenuState(bad);
    assert.equal(s.signedOut, false, `${JSON.stringify(bad)} is not the signed-out fact`);
    assert.equal(s.action, "signOut");
  }
});

test("the two states are mutually exclusive — exactly one affordance at a time", () => {
  const out = authMenuState(true);
  const inn = authMenuState(false);
  assert.notEqual(out.action, inn.action);
  assert.notEqual(out.label, inn.label);
});

test("the listener SENDS the fact, and the tray stores it without parsing the string", () => {
  const set = fnOf(LISTENER, "setStatus");
  assert.match(set, /onStatus\(status\(\), \{ signedOut: running && !auth\.isSignedIn\(\) \}\)/,
    "the boolean comes from the same gate status() consults");
  const update = fnOf(TRAY, "update");
  assert.match(update, /typeof meta\.signedOut === 'boolean'/, "and only a real boolean moves it");
  assert.match(fnOf(TRAY, "authMenuState"), /signedOut === true/, "an explicit boolean, nothing looser");
  assert.ok(!/\.test\(/.test(fnOf(TRAY, "authMenuState")), "no string matching may return to the tray");
  assert.match(INDEX, /listener\.start\(\(status, meta\) => tray\.update\(status, meta\)/, "index wires it through");
});

// ── The menu is actually wired to those actions ─────────────────────────────

test("buildMenu renders the signed-out item first and the sign-out item last", () => {
  const fn = fnOf(TRAY, "buildMenu");
  assert.match(fn, /const authItem = authMenuState\(signedOutNow\)/);
  assert.match(fn, /if \(authItem\.signedOut\)[\s\S]*handlers\.onSignIn/);
  assert.match(fn, /if \(!authItem\.signedOut\)[\s\S]*handlers\.onSignOut/);
  const signIn = fn.indexOf("handlers.onSignIn");
  const status = fn.indexOf("label: currentStatus");
  const quit = fn.indexOf("handlers.onQuit");
  assert.ok(signIn < status, "the call to action belongs above the dead status line");
  assert.ok(fn.indexOf("handlers.onSignOut") < quit, "sign out sits just above Quit");
});

test("the tray rebuilds on every status change, so the affordance tracks the state", () => {
  assert.match(fnOf(TRAY, "update"), /if \(status\) currentStatus = status;[\s\S]*buildMenu\(\)/);
});

test("index.js supplies both handlers", () => {
  assert.match(INDEX, /onSignIn: \(\) => authActions\.beginSignIn/);
  // STAGE D (2026-08-06): the sign-out handler is `shell-mode.spaSignOut`. It used to be
  // `authActions.signOut`, whose whole shape was the retired remote shell's — it reloaded
  // HOME_URL so the WEB app would resolve server-side to /login. There is no page to reload.
  assert.match(INDEX, /onSignOut: \(\) => \{ void spaSignOut\(/);
  assert.ok(!/authActions\s*\n?\s*\.signOut\(/.test(INDEX), "the remote sign-out path is back");
});

// ── What must NOT regress ───────────────────────────────────────────────────

test("the tray sign-in still arms the M4 login-CSRF nonce", () => {
  const fn = fnOf(ACTIONS, "beginSignIn");
  // The URL is now provider-parameterized, but it is still DERIVED from
  // SIGN_IN_URL (exact app origin, /auth path) and still passes through the
  // gate — which is the invariant this test protects.
  assert.match(fn, /const target = p === 'google' \? SIGN_IN_URL : `\$\{SIGN_IN_URL\}\?provider=\$\{p\}`;/,
    "the sign-in URL must be derived from SIGN_IN_URL");
  assert.match(fn, /maybeBeginAuth\(target\)/, "the tray entry point must not bypass the gate");
  const gate = fnOf(ACTIONS, "maybeBeginAuth");
  assert.match(gate, /auth\.beginPendingAuth\(\)/);
  assert.match(gate, /searchParams\.set\('state', nonce\)/);
  // FIX S3: the gate is EXACT-ORIGIN now. It used to arm for any *.usedopl.com /auth/ URL,
  // which handed our login-CSRF nonce (as ?state=) to a host we do not control.
  assert.match(gate, /if \(!isAppOrigin\(urlStr\) \|\| !\/\\\/auth\\\/\/i\.test\(u\.pathname\)\) return urlStr;/,
    "still only arms for app-origin /auth/ URLs, and now ONLY the exact origin");
});

test("sign-in runs in the SYSTEM browser, not in-window (Supabase PKCE)", () => {
  assert.match(fnOf(ACTIONS, "beginSignIn"), /shell\.openExternal\(url\)/);
});

test("there is exactly one place that arms the nonce, shared by both entry points", () => {
  assert.ok(!/beginPendingAuth/.test(INDEX), "index.js must go through auth-actions, not re-implement it");
  // The destructure went with `wireNavigation` (2026-08-07): index.js opens nothing
  // externally any more, so the nonce is armed in exactly ONE place rather than shared
  // between two call sites — which is what this test is really about.
  // MATCHED AGAINST CODE, NOT PROSE. The comment recording the deletion names the function,
  // so a bare /maybeBeginAuth\(/ over the raw source matches its own explanation.
  const code = INDEX.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.ok(!/maybeBeginAuth\(/.test(code), "index.js must not arm the nonce itself");
  // PINS THE LIVE PATH, NOT A DEAD ONE (2026-08-07). This used to assert
  // `shell.openExternal(maybeBeginAuth(url))` in index.js — a line inside `wireNavigation`,
  // whose only caller was the deleted `createMainWindow`. It passed on code that could
  // never run, which is the source-slicing trap inverted: green about a dead path. The
  // arming now lives in exactly one place, and the SPA window denies window.open outright.
  assert.match(ACTIONS, /shell\.openExternal\(url\)/, "auth-actions owns the external open");
  assert.match(ACTIONS, /function maybeBeginAuth/, "…and the nonce gate lives beside it");
  // Matches the DECLARATION, not the word: the comment recording the deletion names it.
  assert.ok(!/function wireNavigation\(/.test(INDEX), "the dead remote-shell navigation wiring is back");
});

test("sign-out clears the cookie jar and shows the sign-in screen", () => {
  // REWRITTEN FOR STAGE D (2026-08-06). The behaviour this pinned is intact — drop the
  // credential, surface the app, nudge the listener instead of waiting out its 5-min timer —
  // but it now lives in `shell-mode.spaSignOut`, because the step it CANNOT do any more is
  // `load(HOME_URL)`: that reloaded the retired web app so the SERVER could resolve /login.
  // The SPA swaps to the sign-in screen off the pushed auth state instead.
  const fn = fnOf(SHELL, "spaSignOut");
  assert.match(fn, /deps\.auth\.signOut\(\)/, "clears the blob AND the jar (auth-state.signOut)");
  assert.match(fn, /deps\.authTokens\.onSignOut\(\)/, "…and pushes signed-out so the renderer swaps");
  assert.match(fn, /deps\.listener\.restart\(\)/, "…and nudges the listener");
  assert.match(fn, /deps\.showMainWindow\(\)/, "…and surfaces the app");
  assert.ok(!/HOME_URL|load\(/.test(fn), "no remote page may be reloaded on sign-out");
  assert.ok(
    !/function signOut\(/.test(ACTIONS),
    "auth-actions.signOut is back — it existed only to reload the retired web app"
  );
});
