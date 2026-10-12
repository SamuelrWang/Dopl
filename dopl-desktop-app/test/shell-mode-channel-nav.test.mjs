// main/shell-mode.js › navigateToChannels — WHERE A CLICKED NOTIFICATION LANDS.
//
// ⚠ SPLIT OUT OF `test/shell-mode.test.mjs` ON 2026-10-12, at the §2 500-line cap, when the
// cold-window cases landed. Every case below was there before or is new to that fix; none was
// dropped, and the loader both files use is `helpers/shell-mode-harness.mjs` so the two suites
// cannot disagree about shell-mode's dependency set.
//
// The subject is ONE chain, which is why it is one file: a notification's click →
// `targeting-window.js › openChannelForEntry` → `shell-mode.js › navigateToChannels` →
// `/{segment}/channels/{channelId}?thread=&seq=` → the SPA's `initialThreadId` / `initialSeq`.
//
// Run: `node --test dopl-desktop-app/test/shell-mode-channel-nav.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";
import {
  HERE,
  M,
  SHELL,
  INDEX,
  REAL_SAFE,
  loadDeepLink,
  loadShell,
} from "./helpers/shell-mode-harness.mjs";

const require = createRequire(import.meta.url);

test("the cold-window push really is exported, so shell-mode's lazy require resolves", () => {
  assert.equal(typeof loadDeepLink().pushRoute, "function");
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
  // ⚠ THE "degrade to the page" AND "deep route" PROBES THAT USED TO SIT HERE AND BELOW read
  // `navigateTo(...)` literally, and the cold-window fix moved both onto `pushWhenReady`. They
  // are replaced by the BEHAVIOURAL pair in the next section ("a notification with an unusable
  // channel id…" / "…lands on the channel route"), which asserts the pushed PATH rather than the
  // call's spelling — the invariant the probes were standing in for.
  assert.match(chan, /if \(!isSafeSegment\(channelId\)\) return pushWhenReady\(page\);/);
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
  assert.match(chan, /pushWhenReady\(`\$\{page\}\/\$\{channelId\}\$\{suffix\}`\)/);
  // The page is ONE named string, which is what made the Phase 12 cutover's
  // rename an edit rather than a grep: `channels-v2` → `channels`, 2026-08-18.
  assert.match(SHELL, /const CHANNELS_PAGE = 'channels';/);
  // The retired route may be NAMED as history in a comment; it may not survive
  // as a string this file could navigate to.
  assert.ok(!/'channels-v2'/.test(SHELL), "the retired v2 route must not survive as a value");
});

// ── A CLICKED NOTIFICATION AT A COLD WINDOW (Samuel, 2026-10-12) ───────────
//
// 🔒 *"Clicking a mention notification brings Dopl into focus but leaves it on the OVERVIEW
// page."* Closing the window DESTROYS it while the app stays in the tray, so the common case for
// a background mention is the cold one: `showMainWindow` builds the window, `createSpaWindow`
// starts an ASYNC `loadFile`, and a `webContents.send` into a renderer that has not yet
// subscribed is dropped with no error. The SPA then boots `/` → `BootPage` → `/{segment}` → the
// index redirect to `WORKSPACE_HOME_PATH` (`apps/desktop-ui/src/routes.tsx:74`), which IS the
// overview page. The route was lost, silently, and the window looked merely "wrong".
//
// These are BEHAVIOURAL: they assert the path that actually reaches the bridge.

/**
 * @param {{loading?: boolean, existing?: boolean}} o `loading` models a window whose document has
 *   not finished loading, which is every freshly built one.
 */
function navCtx({ loading = false, existing = true } = {}) {
  const sent = [];
  /** `did-finish-load` subscribers, so a test can let the document finish. */
  const onceHandlers = [];
  const makeWin = (isLoading) => ({
    on() {},
    once: (evt, cb) => { if (evt === "did-finish-load") onceHandlers.push(cb); },
    show() {},
    isDestroyed: () => false,
    webContents: {
      send: (_c, a) => sent.push(a && a.path),
      isLoading: () => isLoading,
      once: (evt, cb) => { if (evt === "did-finish-load") onceHandlers.push(cb); },
    },
  });
  let mainWindow = existing ? makeWin(loading) : null;
  // ⚠ THE REAL SEGMENT RULE here too, so `null` really is rejected and a route below can never
  // read `?thread=null` as a pass.
  const helpers = loadShell(REAL_SAFE).makeShellHelpers({
    getMainWindow: () => mainWindow,
    setMainWindow: (w) => { mainWindow = w; },
    // The real factory kicks off an async load, so a window it just built IS loading.
    createSpaWindow: () => makeWin(true),
    registerAppWindow: (w) => w,
    versionGate: { isBlocked: () => false },
    showMainWindow: () => { if (!mainWindow) helpers.createShellWindow({ show: true }); },
    appOrigin: "https://www.usedopl.com",
    diag: () => {},
  });
  return { helpers, sent, finishLoad: () => { for (const cb of onceHandlers.splice(0)) cb(); } };
}

const SEG = "acme-7f3a9c2e";
const CHAN = "7f3a9c2e-1b4d-4e8a-9c1f-2d5b6a7c8e90";

test("a mention clicked with NO window open still lands on the message, not on overview", () => {
  // 🔒 THE REPORTED BUG. Before the fix `sent` held the route already, pushed into a renderer
  // that had not subscribed — so this asserted green while the app sat on the overview page.
  // What makes it honest is `finishLoad()`: the route must arrive AFTER the document is up.
  const ctx = navCtx({ existing: false });
  ctx.helpers.navigateToChannels(SEG, CHAN, null, 1759);
  assert.deepEqual(ctx.sent, [], "nothing may be pushed at a renderer that cannot hear it");
  ctx.finishLoad();
  assert.deepEqual(
    ctx.sent,
    [`/${SEG}/channels/${CHAN}?seq=1759`],
    "the channel + seq route is delivered once the document is loaded"
  );
});

test("…and the same holds for a window that exists but is still loading", () => {
  // The other cold shape: the window survived but is mid-reload (the load guard's retry ladder).
  const ctx = navCtx({ loading: true });
  ctx.helpers.navigateToChannels(SEG, CHAN, "thr-9", 42);
  assert.deepEqual(ctx.sent, []);
  ctx.finishLoad();
  assert.deepEqual(ctx.sent, [`/${SEG}/channels/${CHAN}?thread=thr-9&seq=42`]);
});

test("a WARM window is pushed immediately — the fix must not delay the ordinary click", () => {
  const ctx = navCtx({ loading: false });
  ctx.helpers.navigateToChannels(SEG, CHAN, null, null);
  assert.deepEqual(ctx.sent, [`/${SEG}/channels/${CHAN}`], "no wait when there is nothing to wait for");
});

test("an unusable channel id degrades to the page, and it is delivered too", () => {
  // Replaces the `return navigateTo(page)` source probe: the invariant is the PATH, not the call.
  // ⚠ THE REAL SEGMENT RULE, because a rejected id is exactly what this asserts.
  const mod = loadShell(REAL_SAFE);
  let mainWindow;
  const sent = [];
  const onceHandlers = [];
  const helpers = mod.makeShellHelpers({
    getMainWindow: () => mainWindow,
    setMainWindow: (w) => { mainWindow = w; },
    createSpaWindow: () => mainWindow,
    registerAppWindow: (w) => w,
    versionGate: { isBlocked: () => false },
    showMainWindow: () => {},
    diag: () => {},
  });
  mainWindow = {
    on() {}, show() {}, isDestroyed: () => false,
    webContents: {
      send: (_c, a) => sent.push(a && a.path),
      isLoading: () => true,
      once: (evt, cb) => { if (evt === "did-finish-load") onceHandlers.push(cb); },
    },
  };
  helpers.navigateToChannels(SEG, "../etc", null, null);
  assert.deepEqual(sent, [], "held while loading");
  for (const cb of onceHandlers.splice(0)) cb();
  assert.deepEqual(sent, [`/${SEG}/channels`], "the page, never a fabricated channel id");
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
