// main/shell-mode.js — WHICH shell the main window is, and the SPA service wiring.
//
// The 2026-08-03 fleet audit's desktop items that live here or in the index.js wiring
// this file owns:
//   • sign-out → sign-in with the window still open left the sync feed watching NOTHING
//     (stop() clears `watched`; the renderer's registry dedupes on its own module state
//     and never re-issues), so live updates stayed dead for the rest of the session;
//   • a dopl:// deep link arriving with the SPA window CLOSED was parked forever
//     (pendingDeepLink is flushed exactly once, at startup) — routine now that the SPA
//     window is destroyed on close while the app stays in the tray;
//   • the app menu's "Home" was a silent no-op in SPA mode (loadGuard is null there);
//   • DOPL_UI=remote ran main's proactive refresher ALONGSIDE the remote page's own
//     supabase-js, against ONE rotating refresh-token family — reuse detection then
//     revoked it, signing the rollback shell out roughly hourly.
//
// Run: `node --test dopl-desktop-app/test/shell-mode.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf, orderOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SHELL = M("shell-mode.js");
const INDEX = M("index.js");
// The deep-link half moved out of index.js when the `dopl://open` verb joined
// the auth handoff and the file hit the 500-line cap. The properties pinned
// below are unchanged; only the file holding them is.
const DEEP_LINK = M("deep-link.js");

const { resumeWatchTarget } = new Function(
  `${between(SHELL, "// ─── BEGIN SHELL-MODE-PURE", "// ─── END SHELL-MODE-PURE", "shell-mode pure block")}
   return { resumeWatchTarget };`
)();

const WS = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

// ── the watch replay is IDENTITY-SCOPED ─────────────────────────────────────

test("the same operator signing back in gets the feed put back", () => {
  assert.equal(resumeWatchTarget({ workspaceId: WS, userId: USER_A }, USER_A), WS);
});

test("a DIFFERENT operator gets nothing — that is why stop() cleared it", () => {
  assert.equal(resumeWatchTarget({ workspaceId: WS, userId: USER_A }, USER_B), null);
});

test("an unknown identity on either side refuses the replay", () => {
  for (const stash of [null, undefined, {}, { workspaceId: WS }, { userId: USER_A }]) {
    assert.equal(resumeWatchTarget(stash, USER_A), null, `replayed from ${JSON.stringify(stash)}`);
  }
  for (const uid of [null, undefined, ""]) {
    assert.equal(resumeWatchTarget({ workspaceId: WS, userId: USER_A }, uid), null);
  }
});

test("the auth fan-out stashes before stopping and replays only after restarting", () => {
  const fn = fnOf(SHELL, "wireSpaServices");
  assert.ok(
    orderOf(fn, "deps.uiSync.watchedWorkspace()", "deps.uiSync.stop()", "signed-out"),
    "stop() clears `watched`, so it must be read first or there is nothing to replay"
  );
  assert.match(fn, /stash = watching \? \{ workspaceId: watching, userId: lastUserId \} : null/);
  assert.ok(orderOf(fn, "startUiSync();", "resumeWatchTarget(stash", "signed-in"));
  assert.match(fn, /stash = null;/, "the stash is single-use — a later sign-in must not reuse it");
  assert.match(fn, /if \(state && state\.userId\) lastUserId = state\.userId/,
    "'signed-out' carries no userId, so the operator must be remembered from the last push");
});

// ── tray sign-out pushes the transition (audit item, fixed in 7824d93) ──────

test("tray sign-out drops the credential, pushes signed-out and loads no remote page", () => {
  // The tray path used to skip authTokens.onSignOut() entirely, so the SPA kept
  // rendering the signed-in workspace on a dead session until some later request 401'd.
  const fn = fnOf(SHELL, "spaSignOut");
  assert.ok(orderOf(fn, "deps.auth.signOut()", "deps.authTokens.onSignOut()", "spaSignOut"));
  assert.match(fn, /deps\.listener\.restart\(\)/, "…and the listener stops polling on it");
  assert.ok(!/HOME_URL|loadGuard|load\(/.test(fn), "no remote page may be loaded into the SPA window");
  assert.match(INDEX, /if \(isSpaMode\(\)\) \{\s*void spaSignOut\(/, "the tray must take this path in SPA mode");
});

// ── main → renderer navigation ──────────────────────────────────────────────

test("SPA navigation goes over the bridge; remote mode keeps the loadGuard URL", () => {
  const nav = fnOf(SHELL, "navigateTo");
  assert.match(nav, /webContents\.send\('dopl:navigate', \{ path \}\)/);
  assert.match(nav, /if \(!path \|\| !win \|\| win\.isDestroyed\(\)\) return false;/, "fails closed");
  const chan = fnOf(SHELL, "navigateToChannels");
  assert.match(chan, /if \(isSpaMode\(\)\) \{ navigateTo\(`\/\$\{segment\}\/channels`\); return; \}/);
  assert.match(chan, /guard\.load\(`\$\{deps\.appOrigin\}\/\$\{segment\}\/channels`\)/);
});

test("the menu's Home routes the SPA to boot instead of no-oping on a null loadGuard", () => {
  const fn = fnOf(INDEX, "loadApp");
  assert.match(fn, /if \(isSpaMode\(\)\) \{ shellHelpers\.navigateTo\('\/'\); return; \}/);
  assert.match(fn, /if \(loadGuard\) loadGuard\.load\(HOME_URL\)/, "remote mode is unchanged");
  assert.match(INDEX, /appMenu\.build\(\{ onHome: loadApp/, "…and the menu item still points at it");
});

// ── deep links no longer depend on a window existing ────────────────────────

test("a deep link is parked only before app-ready, never on a missing window", () => {
  const fn = fnOf(DEEP_LINK, "handle");
  assert.match(fn, /if \(!app\.isReady\(\)\)/, "the store/safeStorage are the real precondition");
  assert.ok(
    !/MainWindow|mainWindow/.test(fn),
    "the window guard is what parked an OAuth return / magic link forever once the SPA window could be closed"
  );
  assert.match(fn, /openDeepLink\(url, deps\)/);
  // The capture happens first and unconditionally; the window is then surfaced (and
  // recreated when it was closed) rather than being a precondition for adopting.
  const open = fnOf(DEEP_LINK, "adoptSession");
  assert.ok(
    orderOf(open, "deps.auth.captureFromFragment(fragment)", "deps.showMainWindow()"),
    "the capture must precede the window"
  );
  // …and index.js still arms it, flushes the park at startup, and forwards the
  // Windows/Linux launch-arg delivery.
  assert.match(INDEX, /deepLinkModule\.arm\(\{/);
  assert.match(INDEX, /deepLink\.flushPending\(\)/);
  assert.match(INDEX, /if \(link\) deepLink\.handle\(link\)/);
});

test("the open verb never navigates a signed-out app, and never in remote mode", () => {
  // A workspace route pushed at a signed-out SPA replaces the sign-in screen
  // with a page waiting on a session; the rollback shell has no bridge routing
  // at all. Both fall back to "the window is up", which is the verb's floor.
  const fn = fnOf(DEEP_LINK, "openApp");
  assert.ok(orderOf(fn, "deps.showMainWindow()", "webPathToRoute"), "the window comes first");
  assert.match(fn, /if \(!deps\.isSpaMode\(\)\) return;/);
  assert.match(fn, /if \(!signedIn\)/);
  assert.ok(
    orderOf(fn, "if (!deps.isSpaMode()) return;", "signedIn", "pushRoute"),
    "every refusal must sit above the one push"
  );
});

// ── one refresher per rotating refresh-token family ─────────────────────────

test("the proactive token timer starts in SPA mode ONLY", () => {
  // In remote mode the page's supabase-js still refreshes the jar; two refreshers on one
  // family means the loser presents a stale refresh token and reuse detection revokes
  // the family — an hourly forced sign-out of the rollback shell.
  const at = INDEX.indexOf("if (isSpaMode()) {", INDEX.indexOf("wireSpaServices"));
  const start = INDEX.indexOf("authTokens.start()");
  assert.notEqual(at, -1, "the SPA-mode wiring branch is gone");
  assert.notEqual(start, -1, "the token authority must still start somewhere");
  assert.ok(start > at, "authTokens.start() must sit INSIDE the SPA branch, not above it");
  const branch = INDEX.slice(at, INDEX.indexOf("createMainWindow();", at));
  assert.match(branch, /try \{ authTokens\.start\(\);/, "…and only inside that branch");
  assert.match(branch, /wireSpaServices\(\{/, "…alongside the bridge + sync wiring");
});
