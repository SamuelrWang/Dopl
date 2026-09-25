// main/shell-mode.js — the ONE window factory, and the SPA service wiring.
//
// REWRITTEN FOR STAGE D (2026-08-06), not deleted. This file used to pin a TWO-SHELL world:
// `isSpaMode()` chose between the bundled SPA and the retired remote wrapper, and half the
// assertions here described the remote branch. That shell is gone — the web pages it loaded
// were deleted, so the rollback path led to 404s — and the F-145 rule applies: a file whose
// feature is deleted is rewritten down to the behaviour that SURVIVES, not removed. Every
// surviving property below is still pinned; the remote-branch assertions became assertions
// that the branch is GONE, which is the guard that matters now (a half-reverted Stage D
// reintroduces a factory the min-version gate does not cover).
//
// The 2026-08-03 fleet audit's desktop items that live here or in the index.js wiring:
//   • sign-out → sign-in with the window still open left the sync feed watching NOTHING
//     (stop() clears `watched`; the renderer's registry dedupes on its own module state
//     and never re-issues), so live updates stayed dead for the rest of the session;
//   • a dopl:// deep link arriving with the SPA window CLOSED was parked forever
//     (pendingDeepLink is flushed exactly once, at startup) — routine now that the SPA
//     window is destroyed on close while the app stays in the tray;
//   • the app menu's "Home" was a silent no-op in SPA mode (loadGuard was null there).
//
// Run: `node --test dopl-desktop-app/test/shell-mode.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf, orderOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);

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

// ── THE REMOTE SHELL IS GONE, AND MUST STAY GONE ────────────────────────────

test("Stage D: no mode switch, no second factory, no load guard", () => {
  // A half-reverted Stage D is the failure this catches: a resurrected
  // `createMainWindow` is a window the MIN-VERSION GATE does not cover, because the gate's
  // entire enforcement point is `createShellWindow` being the only factory.
  for (const [src, name] of [[SHELL, "shell-mode.js"], [INDEX, "index.js"]]) {
    assert.ok(!/function isSpaMode|isSpaMode\(\)/.test(src), `${name} still branches on isSpaMode`);
    assert.ok(!/createLoadGuard|loadGuard\./.test(src), `${name} still reaches for the load guard`);
  }
  assert.ok(!/createMainWindow\(/.test(INDEX), "index.js still calls the retired remote factory");
  assert.ok(
    !existsSync(join(HERE, "..", "main", "load-guard.js")),
    "main/load-guard.js is back — it exists only to manage a REMOTE page load"
  );
  // `DOPL_UI_DEV_URL` is a different variable (spa-window's dev server) and must survive.
  assert.ok(!/DOPL_UI\b(?!_DEV_URL)/.test(SHELL), "the DOPL_UI switch is back in shell-mode");
});

test("createShellWindow is the ONE factory, and the gate is its only branch", () => {
  const fn = fnOf(SHELL, "createShellWindow");
  assert.match(fn, /deps\.versionGate\.isBlocked\(\)/, "the min-version gate rides this factory");
  assert.match(fn, /createUpdateRequiredWindow\(\)/, "…and resolves to the update screen when blocked");
  // `opts` is threaded through (2026-08-07) so a hidden login launch can stay in the tray:
  // the factory's own ready-to-show consults it. Before that, `show:false` was inert.
  assert.match(fn, /deps\.createSpaWindow\(opts\)/, "…otherwise the bundled SPA, unconditionally");
  assert.ok(!/deps\.createMainWindow/.test(fn), "the remote factory must not be reachable");
});

// ── THE SHELL IS BOUND AS AN APP WINDOW (wiring plan Phase 10, 2026-08-18) ──

/** The real module, evaluated with a stub `require` — it has no module-scope dependencies. */
function loadShell() {
  const stub = (id) => {
    if (id === "./update-required-window") {
      return {
        createUpdateRequiredWindow: () => ({ id: "update-screen", on() {}, show() {} }),
        closeUpdateRequiredWindow: () => {},
      };
    }
    if (id === "./deep-link-target") return { isSafeSegment: () => true };
    throw new Error("unexpected require: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SHELL)(stub, mod, mod.exports);
  return mod.exports;
}

function shellHelpers({ blocked = false } = {}) {
  const registered = [];
  const made = [];
  let mainWindow = null;
  const helpers = loadShell().makeShellHelpers({
    getMainWindow: () => mainWindow,
    setMainWindow: (w) => { mainWindow = w; },
    createSpaWindow: (opts) => {
      const w = { opts, on() {}, show() {}, isDestroyed: () => false };
      made.push(w);
      return w;
    },
    registerAppWindow: (w) => { registered.push(w); return w; },
    versionGate: { isBlocked: () => blocked },
    showMainWindow: () => {},
    appOrigin: "https://www.usedopl.com",
    diag: () => {},
  });
  return { helpers, registered, made, current: () => mainWindow };
}

test("createShellWindow BINDS the shell in the app-window registry", () => {
  // ⚠ THE SINGLE MOST LOAD-BEARING LINE OF PHASE 10. Since the sender binding's subject is
  // the registry rather than the main-window slot, a shell that is never registered has its
  // ENTIRE privileged IPC surface refused — every `apiRequest`, silently, with no error
  // shape anywhere. Nothing else in the suite would notice.
  const ctx = shellHelpers();
  const win = ctx.helpers.createShellWindow({ show: false });
  assert.equal(ctx.made.length, 1);
  assert.deepEqual(ctx.registered, [win], "the window main just built is bound at creation");
  assert.equal(ctx.current(), win, "…and it is still the main-window slot");
});

test("the UPDATE-REQUIRED screen is deliberately NOT bound", () => {
  // It takes its own preload and reaches no `dopl:*` handler. A blocking screen holding the
  // app's privileged surface would be the min-version block leaking a door.
  const ctx = shellHelpers({ blocked: true });
  ctx.helpers.createShellWindow({ show: false });
  assert.equal(ctx.made.length, 0, "the SPA factory is not reached while blocked");
  assert.deepEqual(ctx.registered, [], "the update screen is not an app window");
});

test("registration is optional at the WIRING level and fatal at neither end", () => {
  // A mid-wave caller / a harness with no registry must still get a window — the guards
  // fail closed on their own, which is the correct place for that decision.
  const mod = loadShell();
  let mainWindow = null;
  const helpers = mod.makeShellHelpers({
    getMainWindow: () => mainWindow,
    setMainWindow: (w) => { mainWindow = w; },
    createSpaWindow: () => ({ on() {}, show() {}, isDestroyed: () => false }),
    versionGate: { isBlocked: () => false },
    showMainWindow: () => {},
    diag: () => {},
  }); // no registerAppWindow
  assert.doesNotThrow(() => helpers.createShellWindow({ show: false }));
});

// ── AN EXPLICIT OPEN LANDS ON THE LAUNCH DECISION (2026-09-09) ─────────────
//
// Samuel: *"every time i go to the desktop app/open it, it auto has it on my
// original workspace. The user should be auto at the Home space. (This is for
// new opens)."* A COLD launch already did: the SPA loads its index with no hash,
// the hash router resolves `/` to the boot page, and boot navigates to `/home`
// for a `kind='home'` boot answer (`c37e4942`). What did not was every OTHER
// "open": Dopl lives in the tray, so the dock icon, "Open Dopl" and a second
// launch all revealed the SAME window, still on the workspace route it was left
// on. `openMainWindow` is that gap, and nothing else.

function openCtx({ existing = true } = {}) {
  const sent = [];
  let mainWindow = existing
    ? { on() {}, show() {}, isDestroyed: () => false, webContents: { send: (_c, a) => sent.push(a) } }
    : null;
  let shown = 0;
  const helpers = loadShell().makeShellHelpers({
    getMainWindow: () => mainWindow,
    setMainWindow: (w) => { mainWindow = w; },
    createSpaWindow: () => ({ on() {}, show() {}, isDestroyed: () => false, webContents: { send: (_c, a) => sent.push(a) } }),
    registerAppWindow: (w) => w,
    versionGate: { isBlocked: () => false },
    // The real one CREATES the window when there is none — modelled, because
    // the whole decision below turns on whether there already WAS one.
    showMainWindow: () => {
      shown += 1;
      if (!mainWindow) helpers.createShellWindow({ show: true });
    },
    appOrigin: "https://www.usedopl.com",
    diag: () => {},
  });
  return { helpers, sent, shownCount: () => shown };
}

test("an explicit open puts a LIVE window back on the launch route", () => {
  // 🔒 THE WHOLE FIX. Without the push the operator sees the route the window
  // was left on, which is a workspace page — the report.
  const ctx = openCtx({ existing: true });
  assert.equal(ctx.helpers.openMainWindow(), true, "it saw a live window");
  assert.equal(ctx.shownCount(), 1, "the window is still revealed");
  assert.deepEqual(ctx.sent, [{ path: "/" }], "…and landed on boot");
});

test("…and pushes NOTHING when it had to build the window", () => {
  // A window main just created is already loading the index at `/`, and a send
  // to a renderer that has not subscribed yet is dropped on the floor with no
  // error (deep-link.js carries that trap in full). Pushing here would be a
  // no-op that reads like a mechanism.
  const ctx = openCtx({ existing: false });
  assert.equal(ctx.helpers.openMainWindow(), false, "there was nothing to reset");
  assert.deepEqual(ctx.sent, [], "no route was pushed at a cold window");
});

test("the three OPEN doors go through it, and the DESTINATION doors do not", () => {
  // 🔒 THE SCOPE IS THE POINT. A deep link and a clicked channel notification
  // reveal the window too and both NAME a destination — routing them to `/`
  // first is a race their own push would have to win. They call
  // `showMainWindow` / `navigateToChannels` directly, so this asserts the
  // wiring in index.js rather than a property of this module.
  const doors = INDEX.match(/openMainWindow\(\)/g) || [];
  assert.equal(doors.length, 3, "second-instance, the tray's Open, and activate");
  assert.match(INDEX, /onOpen: \(\) => openMainWindow\(\)/, "the tray's Open Dopl");
  assert.match(
    INDEX,
    /if \(link\) \{ deepLink\.handle\(link\); return; \}\n\s*openMainWindow\(\);/,
    "a second launch carrying a deep link must not be reset to /"
  );
  // `navigateToChannels` is the notification's path and still reveals directly.
  assert.match(SHELL, /function navigateToChannels[\s\S]*?deps\.showMainWindow\(\);/);
});

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
  // Stage D: the tray takes this path UNCONDITIONALLY — there is no other one left.
  assert.match(INDEX, /onSignOut: \(\) => \{ void spaSignOut\(/, "the tray must take this path");
  assert.ok(!/authActions\s*\n?\s*\.signOut\(/.test(INDEX), "the remote sign-out path is back");
});

// ── main → renderer navigation ──────────────────────────────────────────────

test("navigation goes over the bridge, and nothing else", () => {
  const nav = fnOf(SHELL, "navigateTo");
  assert.match(nav, /webContents\.send\('dopl:navigate', \{ path \}\)/);
  assert.match(nav, /if \(!path \|\| !win \|\| win\.isDestroyed\(\)\) return false;/, "fails closed");
  const chan = fnOf(SHELL, "navigateToChannels");
  assert.match(chan, /const page = `\/\$\{segment\}\/\$\{CHANNELS_PAGE\}`;/);
  assert.ok(!/guard\.load|appOrigin/.test(chan), "the remote URL load must be gone");
});

// ── PHASE 9: the notification lands ON the channel ──────────────────────────

test("a clicked notification navigates to the CHANNEL, not just the page", () => {
  // The "windowing inverts" ruling's focus-the-app half. The mechanism (show
  // the window, push a route) already existed — what was missing was the
  // channel, which every caller's `entry` had carried the whole time.
  const chan = fnOf(SHELL, "navigateToChannels");
  assert.match(chan, /function navigateToChannels\(segment, channelId, threadId, seq\)/);
  assert.match(chan, /deps\.showMainWindow\(\)/, "the window comes up either way");
  // A usable channel id deepens the route; anything else degrades to the page —
  // and a usable THREAD id (2026-08-20) deepens it once more, as the `?thread=`
  // SELECTION the channels page already reads. Same one segment rule for all three.
  assert.match(chan, /if \(!isSafeSegment\(channelId\)\) return navigateTo\(page\);/);
  // ⚠ **TWO SELECTIONS NOW, BUILT AS A LIST** (2026-09-20): `?thread=` and
  // `?seq=`, the second so a clicked MENTION banner scrolls to the message it was
  // about. The thread still goes through `isSafeSegment`; the seq is DIGITS,
  // checked numerically rather than as a segment, because it is a bigint on the
  // wire and `isSafeSegment` would be the wrong question about it.
  assert.match(chan, /if \(isSafeSegment\(threadId\)\) params\.push\(`thread=\$\{threadId\}`\);/);
  assert.match(
    chan,
    /if \(Number\.isSafeInteger\(Number\(seq\)\) && Number\(seq\) > 0\) params\.push\(`seq=\$\{Number\(seq\)\}`\);/,
    "a seq reaching a URL must be a validated number, never caller text"
  );
  assert.match(chan, /const suffix = params\.length \? `\?\$\{params\.join\('&'\)\}` : '';/);
  assert.match(chan, /navigateTo\(`\$\{page\}\/\$\{channelId\}\$\{suffix\}`\)/);
  // The page is ONE named string, which is what made the Phase 12 cutover's
  // rename an edit rather than a grep: `channels-v2` → `channels`, 2026-08-18.
  assert.match(SHELL, /const CHANNELS_PAGE = 'channels';/);
  // The retired route may be NAMED as history in a comment; it may not survive
  // as a string this file could navigate to.
  assert.ok(!/'channels-v2'/.test(SHELL), "the retired v2 route must not survive as a value");
});

test("both interpolated values pass the ONE segment rule, and it is not a local copy", () => {
  // A channel id arrives on a server DTO and ends up inside a router path.
  // INVARIANTS §11's rule is `deep-link-target.js`'s, and a second regex in
  // this file would be a second answer to it — the drift the export exists to
  // prevent. So: no character class here, and the check is required lazily so
  // shell-mode keeps its module-scope dependency freedom.
  const chan = fnOf(SHELL, "navigateToChannels");
  assert.match(chan, /const \{ isSafeSegment \} = require\('\.\/deep-link-target'\);/);
  assert.match(chan, /if \(!isSafeSegment\(segment\)\) return;/, "the segment is checked too");
  assert.ok(
    !/\[A-Za-z0-9\]|SLUG_RE|test\(channelId\)/.test(SHELL),
    "shell-mode must not carry its own segment regex"
  );
  // …and the rule really is exported, so the require above resolves.
  const target = require(join(HERE, "..", "main", "deep-link-target.js"));
  assert.equal(typeof target.isSafeSegment, "function");
  assert.equal(target.isSafeSegment("7f3a9c2e-1b4d-4e8a-9c1f-2d5b6a7c8e90"), true);
  assert.equal(target.isSafeSegment("../etc"), false);
  assert.equal(target.isSafeSegment(null), false);
});

test("the notification seam hands the channel over, and never invents one", () => {
  // `targeting-window.js › openChannelForEntry` is the ONE seam all three
  // notification producers reach (the inbound request, the silent FYI, the
  // passive task-reply notice), which is why the destination is one channel
  // route rather than a per-kind fork.
  const TW = M("targeting-window.js");
  const fn = fnOf(TW, "openChannelForEntry");
  // ⚠ FOUR ARGUMENTS SINCE 2026-09-20 — the SEQ joined the thread so a clicked
  // mention banner lands ON the message, not merely in the room. Both optionals
  // are still the CALLER's claim or nothing: `|| null`, never a fabricated value.
  assert.match(
    fn,
    /handlers\.openChannel\(\s*entry\.workspaceSegment,\s*\(entry\.channel && entry\.channel\.id\) \|\| null,\s*\(opts && opts\.threadId\) \|\| null,\s*\(opts && opts\.seq\) \|\| null\s*\)/,
    "an entry with no channel must degrade to the page, never to a fabricated id — and the thread and seq are the CALLER's claim or nothing"
  );
  assert.match(fn, /if \(!handlers\.openChannel \|\| !entry \|\| !entry\.workspaceSegment\) return;/);
  // index.js still wires this seam to the shell helper that grew the parameter.
  assert.match(INDEX, /openChannel: navigateToChannels/);
});

test("the menu's Home routes the SPA to boot", () => {
  const fn = fnOf(INDEX, "loadApp");
  assert.match(fn, /shellHelpers\.navigateTo\('\/'\)/);
  assert.ok(!/loadGuard|HOME_URL/.test(fn), "the remote home load must be gone");
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
  // ⚠ AND IT RETURNS (2026-09-09). A second launch carrying a link is not a
  // plain "open the app": `openMainWindow` would push `/` on top of the link's
  // own route. `deepLink.handle` reveals the window itself, so the early return
  // loses nothing.
  assert.match(INDEX, /if \(link\) \{ deepLink\.handle\(link\); return; \}/);
});

test("the open verb never navigates a signed-out app", () => {
  // A workspace route pushed at a signed-out SPA replaces the sign-in screen with a page
  // waiting on a session, so it falls back to "the window is up" — the verb's floor. The
  // remote-mode refusal that used to sit beside this one went with the shell.
  const fn = fnOf(DEEP_LINK, "openApp");
  assert.ok(orderOf(fn, "deps.showMainWindow()", "webPathToRoute"), "the window comes first");
  assert.match(fn, /if \(!signedIn\)/);
  assert.ok(orderOf(fn, "signedIn", "pushRoute"), "the refusal must sit above the one push");
});

test("the auth verb adopts the session without loading a completion page", () => {
  // The retired shell navigated to `/auth/desktop-complete#<fragment>` so that page could
  // plant the cookie jar. In the SPA the captured tokens ARE the session, and loading it
  // stranded the window on "Signing you in…". The page is deleted; this pins that nothing
  // reaches for it.
  const fn = fnOf(DEEP_LINK, "adoptSession");
  assert.ok(!/desktop-complete/.test(fn), "the completion-page load is back");
  assert.ok(!/getLoadGuard|loadURL/.test(fn), "the remote loader is back");
  assert.match(fn, /deps\.authTokens\.onSignIn\(\)/, "the token authority is still re-armed");
  assert.match(fn, /deps\.listener\.restart\(\)/, "…and the listener still restarts on the fresh session");
});

// ── one refresher per rotating refresh-token family ─────────────────────────

test("the proactive token timer starts, and is the only refresher left", () => {
  // It used to be gated on SPA mode: the remote page ran its own supabase-js against the
  // SAME rotating family, so two refreshers meant the loser presented a stale refresh token
  // and reuse detection revoked the family — an hourly forced sign-out of the rollback
  // shell. With that page deleted there is no second refresher and the gate is unnecessary.
  assert.match(INDEX, /try \{ authTokens\.start\(\);/, "the token authority must still start");
  assert.match(INDEX, /wireSpaServices\(\{/, "…alongside the bridge + sync wiring");
  assert.ok(
    orderOf(INDEX, "authTokens.start()", "wireSpaServices({", "startup wiring"),
    "the authority starts before the services that read from it"
  );
});

// ── THE BOOT RECONCILE RUNS AFTER THE ENGINE RELOADS ITS RECORDS (2026-09-14) ────────────────
//
// The writer fires on a STATE CHANGE and on the sign-in transition, so a boot that is ALREADY
// signed in makes neither and the PREVIOUS run's rows stand — which is why a kick exists at all
// (2026-09-13). But it shipped INSIDE `wireSpaServices`, which `index.js` wires BEFORE
// `sessionEngine.init()` reloads the durable records: the run's first push therefore reported an
// EMPTY registry, the server deleted every row for the workspace, and `session-boot.js ›
// reparkDormant`'s `touch()` posted the re-parked ones straight back. Two writes and a visible
// flap on every surface that reads `channel_sessions`, to say what ONE write after `init()` says
// correctly the first time.
//
// ⚠ PINNED AS THE PAIR — the return AND the ordered call — because either half alone restores it:
// a `kick()` left in `wireSpaServices` is the flap, and a `bootReconcile` nobody calls is the
// 2026-09-13 bug (stale Idle pills for the whole run).

test("wireSpaServices RETURNS the boot reconcile instead of kicking it", () => {
  const fn = fnOf(SHELL, "wireSpaServices");
  assert.match(fn, /return \{ bootReconcile \};/, "the reconcile is handed to the caller");
  const armOnly = between(fn, "const startSessionStatePush", "const bootReconcile");
  assert.equal(/sessionStatePush\.kick\(\)/.test(armOnly), false,
    "arming the writer must not also kick it — that kick sees an empty registry");
  assert.match(fn, /const bootReconcile = \(\) => \{[\s\S]*?sessionStatePush\.kick\(\)/,
    "the reconcile IS the kick, just not here");
});

test("index.js calls the boot reconcile AFTER sessionEngine.init()", () => {
  // ⚠ THE MARKERS ARE CODE, NEVER PROSE. `sessionEngine.init()` also appears in index.js's own
  // comment ABOVE the wiring, and matching that read the order backwards — which is how an
  // ordering pin passes while pinning nothing.
  assert.match(INDEX, /spaServices = wireSpaServices\(\{/, "the handle is kept");
  // ⚠ THE WHOLE STATEMENT, NOT THE CALL TEXT. `session-auth-recovery.test.mjs`'s rule: a looser
  // regex matches a call that is never reached, and `if (false) spaServices.bootReconcile();`
  // passes any scan for the name — which is the 2026-09-13 bug (stale Idle pills for the run)
  // restored under a green test.
  assert.match(INDEX, /try \{ if \(spaServices\) spaServices\.bootReconcile\(\); \}/,
    "…and the reconcile is actually called, guarded only on the handle existing");
  assert.ok(
    orderOf(INDEX, "try { sessionEngine.init();", "spaServices.bootReconcile()", "boot reconcile"),
    "the first push must report the re-parked set, not the empty one that precedes init()"
  );
  assert.ok(
    orderOf(INDEX, "spaServices = wireSpaServices({", "try { sessionEngine.init();", "boot reconcile"),
    "…and the writer is still ARMED before init(), or the reconcile would be a no-op"
  );
});
