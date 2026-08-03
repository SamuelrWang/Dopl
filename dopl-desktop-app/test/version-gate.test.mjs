// The minimum-version gate, driven FOR REAL: the fetch, the verdict, and the two
// window swaps it causes.
//
// WHY THIS SUITE IS SHAPED AROUND FAILURE. min-version.test.mjs already pins the
// decisions; what is left is the part that talks to a network and can therefore
// go wrong in ways a truth table cannot express. Every one of those ways ends
// the same: the app OPENS. So most of what follows is a list of bad answers —
// offline, a timeout, a 502, a captive portal's login page parsed as JSON, an
// object with the wrong keys, a floor withdrawn after it was set — each asserted
// to leave the operator inside their app rather than in front of a screen they
// cannot get past.
//
// The two that DO block are here for the opposite reason: a gate that never
// blocks is not a gate, and Phase 4 depends on this one working.
//
// METHOD: main/version-gate.js runs unmodified against a fake electron and a
// fake updater primed into the require cache (the update-restart-prompt.test.mjs
// idiom), plus a fake global fetch. The wiring statics live in
// update-required-screen.test.mjs.
//
// Run: `node --test dopl-desktop-app/test/version-gate.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = (f) => join(HERE, "..", "main", f);

// Everything that holds state or reads process.env at require time.
const RELOAD = [
  "version-gate.js", "config.js", "diag.js", "app-version.js",
  "update-policy.js", "min-version.js", "updater.js",
];

function prime(id, exports) {
  const filename = require.resolve(id);
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

function reset() {
  for (const f of RELOAD) delete require.cache[require.resolve(MAIN(f))];
}

const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const BASE = { supported: true, checked: false, available: false, ready: false, checking: false, version: null, percent: null };

// `answers` is consumed in order; the last one repeats. A spec is
// { body } | { status } | { throws: true } | { badJson: true }.
function harness(opts = {}) {
  const { version = "1.8.2", mode, updater: state = {}, answers = [{ body: { minSupported: null, latest: null } }] } = opts;
  const seen = { blocks: [], releases: [], warns: [], notifications: [], fetches: [], restarts: 0, manualChecks: 0 };
  const updaterState = { ...BASE, ...state };

  class FakeNotification {
    constructor(o) { this.opts = o; seen.notifications.push(o); }
    static isSupported() { return true; }
    show() {}
  }

  prime("electron", {
    app: {
      getVersion: () => version,
      // diag() writes to userData/listener.log; make that unavailable so the
      // suite never touches the filesystem (diag swallows the throw by design).
      getPath: () => { throw new Error("no userData in tests"); },
    },
    Notification: FakeNotification,
  });
  reset();
  // The updater is the gate's other input. Faked so the anti-brick guard can be
  // driven directly instead of through electron-updater's event machine.
  prime(MAIN("updater.js"), {
    updateState: () => ({ ...updaterState }),
    requestRestart: () => { seen.restarts++; },
    checkNow: () => { seen.manualChecks++; },
  });

  // Installed for the rest of the process and re-installed by the next harness:
  // every later refresh (onWake, a screen click, the armed timer) has to hit the
  // fake too, and this file never wants a real socket.
  const queue = [...answers];
  globalThis.fetch = async (url, init) => {
    seen.fetches.push({ url, init });
    const spec = queue.length > 1 ? queue.shift() : queue[0];
    if (spec.throws) throw new Error("net::ERR_INTERNET_DISCONNECTED");
    const status = spec.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (spec.badJson) throw new SyntaxError("Unexpected token < in JSON");
        return spec.body;
      },
    };
  };

  const prevMode = process.env.DOPL_VERSION_GATE;
  if (mode === undefined) delete process.env.DOPL_VERSION_GATE;
  else process.env.DOPL_VERSION_GATE = mode;

  let gate;
  try {
    gate = require(MAIN("version-gate.js"));
    // `beforeInit` reproduces the real boot ORDER: index.js arms updater.init()
    // first, and that fires a state event before wireVersionGate() ever runs.
    if (opts.beforeInit) opts.beforeInit(gate);
    gate.init({
      onBlock: (v) => seen.blocks.push(v),
      onRelease: (v) => seen.releases.push(v),
      onWarn: (n) => seen.warns.push(n),
    });
  } finally {
    if (prevMode === undefined) delete process.env.DOPL_VERSION_GATE;
    else process.env.DOPL_VERSION_GATE = prevMode;
  }

  return {
    gate,
    seen,
    // Mutate the updater's answer and tell the gate, exactly as updater.js's
    // onState fan-out does in the app.
    setUpdater(next) { Object.assign(updaterState, next); gate.onUpdaterState(); },
    // Change what the server says for every later refresh.
    serve(spec) { queue.length = 0; queue.push(spec); },
  };
}

const floorAt = (v) => [{ body: { minSupported: v, latest: null } }];

// ── The ordinary answer ──────────────────────────────────────────────────────

test("no floor configured: the app opens and nothing is surfaced", async () => {
  const h = harness();
  await flush();
  assert.equal(h.gate.isBlocked(), false);
  assert.deepEqual(h.seen.blocks, []);
  assert.deepEqual(h.seen.notifications, []);
  assert.equal(h.seen.fetches.length, 1, "it did ask");
});

test("the ask is an unauthenticated GET of /api/version, uncached", async () => {
  const h = harness();
  await flush();
  const { url, init } = h.seen.fetches[0];
  assert.match(url, /\/api\/version$/);
  assert.equal(init.method, undefined, "a plain GET");
  assert.equal(init.headers["Cache-Control"], "no-store");
  assert.ok(!init.headers.Cookie, "no cookie: the check must work signed out");
  assert.ok(!init.headers.Authorization, "and it is not an authorization question");
  // The app-version header rides along as the diagnostic it has always been.
  assert.equal(init.headers["X-Dopl-App-Version"], "1.8.2");
});

test("a build at or above the floor opens", async () => {
  const h = harness({ version: "1.9.0", answers: floorAt("1.9.0") });
  await flush();
  assert.equal(h.gate.isBlocked(), false);
  assert.deepEqual(h.seen.blocks, []);
});

// ── The block ────────────────────────────────────────────────────────────────

test("a build below the floor is BLOCKED, and the swap is asked for once", async () => {
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  assert.equal(h.gate.isBlocked(), true);
  assert.equal(h.seen.blocks.length, 1);
  assert.equal(h.seen.blocks[0].floor, "1.9.0");
  assert.equal(h.seen.blocks[0].current, "1.8.2");
  assert.deepEqual(h.seen.releases, []);
});

test("a repeated identical answer does not re-swap the window", async () => {
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  h.gate.onWake();
  await flush();
  h.gate.onWake();
  await flush();
  assert.ok(h.seen.fetches.length >= 3, "it kept asking");
  assert.equal(h.seen.blocks.length, 1, "…and kept the same window");
});

// ── Fail open, every way ─────────────────────────────────────────────────────

test("OFFLINE never blocks: a throwing fetch leaves the app open", async () => {
  const h = harness({ version: "1.0.0", answers: [{ throws: true }] });
  await flush();
  assert.equal(h.gate.isBlocked(), false);
  assert.deepEqual(h.seen.blocks, []);
});

test("a 5xx, a 404 and a 500 all read as 'no answer'", async () => {
  for (const status of [500, 502, 404, 403]) {
    const h = harness({ version: "1.0.0", answers: [{ status, body: { minSupported: "9.9.9" } }] });
    await flush();
    assert.equal(h.gate.isBlocked(), false, `status ${status}`);
  }
});

test("a captive portal's HTML never blocks (the body does not even parse)", async () => {
  const h = harness({ version: "1.0.0", answers: [{ badJson: true }] });
  await flush();
  assert.equal(h.gate.isBlocked(), false);
});

test("a well-formed 200 with a malformed floor never blocks", async () => {
  for (const minSupported of ["v9.9.9", "9.9", "latest", "", null, 999, { v: 1 }]) {
    const h = harness({ version: "1.0.0", answers: [{ body: { minSupported } }] });
    await flush();
    assert.equal(h.gate.isBlocked(), false, `floor ${JSON.stringify(minSupported)}`);
  }
});

test("a version electron will not report falls back to package.json, not to 'unknown'", async () => {
  // app-version.js's second source. It matters here because "unknown build"
  // never blocks (min-version.test.mjs pins that), so a silent regression in the
  // fallback would quietly disable the gate for everyone rather than fail loudly.
  const below = harness({ version: "not-a-version", answers: floorAt("9.9.9") });
  await flush();
  assert.equal(below.gate.isBlocked(), true, "it still knows what build it is");
  const above = harness({ version: "not-a-version", answers: floorAt("1.0.0") });
  await flush();
  assert.equal(above.gate.isBlocked(), false);
});

// ── The anti-brick guard, end to end ─────────────────────────────────────────

test("THE FLEET-OUTAGE GUARD: a completed check with nothing newer RELEASES the block", async () => {
  // The floor was set above the newest build that exists. Every client blocks
  // with nothing to install, which is an outage caused by this feature. The
  // updater looking and finding nothing is the evidence that ends it.
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  assert.equal(h.gate.isBlocked(), true, "it blocks while it does not know");

  h.setUpdater({ checked: true, available: false, ready: false });
  assert.equal(h.gate.isBlocked(), false);
  assert.equal(h.seen.releases.length, 1, "the app window comes back");
  // …and the operator is told, once, quietly.
  assert.equal(h.seen.notifications.length, 1);
  assert.equal(h.seen.notifications[0].silent, true);
  assert.match(h.seen.notifications[0].body, /no newer build is published/i);
  assert.match(h.seen.warns.filter(Boolean).pop().tray, /1\.9\.0/);
});

test("no updater at all means a warning, never a block, and ONE banner per floor", async () => {
  // Dev, an unpackaged run, or a build whose electron-updater failed to load.
  // Blocking there is a dead end: no button on that screen could ever end it.
  const h = harness({ version: "1.8.2", updater: { supported: false }, answers: floorAt("1.9.0") });
  await flush();
  assert.equal(h.gate.isBlocked(), false);
  assert.match(h.seen.warns.filter(Boolean).pop().body, /cannot update itself/i);
  for (let i = 0; i < 10; i++) h.gate.onUpdaterState();
  assert.equal(h.seen.notifications.length, 1, "stated once, not on every re-decide");
});

test("a FAILED check does not release a block: it is not evidence of anything", async () => {
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  // updater.js leaves `checked` false on an errored check; the gate must hold.
  h.setUpdater({ checking: false, checked: false });
  assert.equal(h.gate.isBlocked(), true);
  assert.deepEqual(h.seen.releases, []);
});

test("a staged-but-uninstalled update keeps the block: downloaded is not running", async () => {
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  h.setUpdater({ checked: true, available: false, ready: true, version: "1.9.0" });
  assert.equal(h.gate.isBlocked(), true);
});

// ── Unblocking ───────────────────────────────────────────────────────────────

test("WITHDRAWING the floor unblocks without a relaunch", async () => {
  // A mistaken floor has to be correctable from the server side alone, or the
  // mistake outlives its fix.
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  assert.equal(h.gate.isBlocked(), true);

  h.serve({ body: { minSupported: null } });
  h.gate.onWake();
  await flush();
  assert.equal(h.gate.isBlocked(), false);
  assert.equal(h.seen.releases.length, 1);
});

test("a LOWERED floor unblocks too", async () => {
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  h.serve({ body: { minSupported: "1.8.0" } });
  h.gate.onWake();
  await flush();
  assert.equal(h.gate.isBlocked(), false);
});

test("a server that goes UNREACHABLE does not clear a floor it already gave", async () => {
  // "No answer" is not "no floor". Otherwise pulling the network would be a
  // one-step bypass of every forced upgrade.
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  h.serve({ throws: true });
  h.gate.onWake();
  await flush();
  assert.equal(h.gate.isBlocked(), true);
  assert.deepEqual(h.seen.releases, []);
});

// ── The dev knob ─────────────────────────────────────────────────────────────

test("DOPL_VERSION_GATE=off asks nothing and blocks nothing", async () => {
  const h = harness({ mode: "off", version: "1.0.0", answers: floorAt("9.9.9") });
  await flush();
  assert.deepEqual(h.seen.fetches, [], "not even a request");
  assert.equal(h.gate.isBlocked(), false);
  h.gate.onWake();
  h.gate.onUpdaterState();
  await flush();
  assert.deepEqual(h.seen.fetches, []);
});

test("DOPL_VERSION_GATE=force blocks immediately, before any answer arrives", async () => {
  const h = harness({ mode: "force", version: "1.8.2", updater: { supported: false } });
  assert.equal(h.gate.isBlocked(), true, "synchronously, inside init()");
  assert.equal(h.seen.blocks[0].floor, "1.9.0", "a synthetic floor one minor up");
  await flush();
  assert.equal(h.gate.isBlocked(), true, "and the real 'no floor' answer does not lift it");
});

test("…and DOGFOODS THE REAL SCREEN, not the dead end a dev updater would draw", async () => {
  // `force` blocks through the real branch (the whole point), so the screen has
  // to be rewritten with the SAME synthetic updater the verdict used. Before the
  // fix the verdict saw a live updater and the screen saw the unpackaged one, so
  // the developer checking the gate was shown "this build cannot update itself"
  // with no button at all — a screen a real blocked user never gets.
  const h = harness({ mode: "force", version: "1.8.2", updater: { supported: false } });
  await flush();
  const s = h.gate.screen();
  assert.match(s.status, /Looking for an update/);
  assert.equal(s.action.id, "check", "the button a real blocked user has");
  assert.ok(!/cannot update itself/.test(s.status));
});

// ── Boot order ───────────────────────────────────────────────────────────────

test("a verdict reached BEFORE init cannot eat the block the handlers exist for", async () => {
  // index.js arms updater.init() first, and that fires a state event
  // synchronously ('checking' packaged, 'unsupported' in dev) — which reaches
  // onUpdaterState and decides a verdict while `handlers` is still empty. Left
  // alone, that pre-wiring verdict marked the gate blocked, so the FIRST real
  // decision looked like "no change" and onBlock never fired: the app would show
  // its normal window while isBlocked() said otherwise.
  const h = harness({
    mode: "force",
    version: "1.8.2",
    updater: { supported: false },
    beforeInit: (gate) => gate.onUpdaterState(),
  });
  assert.equal(h.gate.isBlocked(), true);
  assert.equal(h.seen.blocks.length, 1, "the swap was actually asked for");
  await flush();
  assert.equal(h.seen.blocks.length, 1, "and only once");
});

// ── The screen's surface ─────────────────────────────────────────────────────

test("the screen narrates the updater, and every state change is pushed", async () => {
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  const pushes = [];
  const off = h.gate.subscribe((s) => pushes.push(s));

  assert.match(h.gate.screen().message, /1\.9\.0/);
  h.setUpdater({ available: true, checked: true, percent: 42 });
  assert.match(h.gate.screen().status, /42%/);
  assert.ok(pushes.length >= 1);
  assert.match(pushes[pushes.length - 1].status, /42%/);

  h.setUpdater({ available: false, ready: true, version: "1.9.0" });
  assert.equal(h.gate.screen().action.id, "restart");

  off();
  const before = pushes.length;
  h.gate.onUpdaterState();
  assert.equal(pushes.length, before, "unsubscribing stops the pushes");
});

test("the screen's buttons are the updater's, not a second implementation", async () => {
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  assert.equal(h.gate.act("restart"), true);
  assert.equal(h.seen.restarts, 1);

  h.serve({ body: { minSupported: "1.9.0" } });
  const fetchesBefore = h.seen.fetches.length;
  assert.equal(h.gate.act("check"), true);
  await flush();
  assert.equal(h.seen.manualChecks, 1, "the operator's click is a MANUAL check, so failures surface");
  assert.ok(h.seen.fetches.length > fetchesBefore, "…and it re-asks for the floor in the same click");

  assert.equal(h.gate.act("nonsense"), false);
});

test("a listener that throws cannot break the gate", async () => {
  const h = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  await flush();
  h.gate.subscribe(() => { throw new Error("window is gone"); });
  assert.doesNotThrow(() => h.gate.onUpdaterState());
  // …and neither can a handler that throws.
  const g = harness({ version: "1.8.2", answers: floorAt("1.9.0") });
  g.gate.init({ onBlock: () => { throw new Error("no window"); } });
  await assert.doesNotReject(async () => { g.gate.onWake(); await flush(); });
});

// ── Shape ────────────────────────────────────────────────────────────────────

test("the floor is NEVER written to disk", () => {
  // A cached floor would let a machine boot straight into a block with no
  // network to re-check against, which is the one way offline use could brick.
  const SRC = require("node:fs").readFileSync(MAIN("version-gate.js"), "utf8");
  assert.ok(!/electron-store|require\('fs'\)|writeFile|store\.set/.test(SRC));
});

test("the fetch does NOT go through api.js (no cookies, no 401 repair)", () => {
  const SRC = require("node:fs").readFileSync(MAIN("version-gate.js"), "utf8");
  assert.ok(!/require\('\.\/api'\)/.test(SRC), "a 401 repair here could emit a sign-out");
  assert.match(SRC, /await fetch\(/);
});

test("an answer keeps the 4h cadence; NO answer retries in minutes", () => {
  const SRC = require("node:fs").readFileSync(MAIN("version-gate.js"), "utf8");
  assert.match(SRC, /arm\(gotAnswer \? VERSION_GATE\.CHECK_INTERVAL_MS : VERSION_GATE\.RETRY_MS\)/);
  reset();
  const { VERSION_GATE, UPDATER } = require(MAIN("config.js"));
  assert.equal(VERSION_GATE.CHECK_INTERVAL_MS, UPDATER.CHECK_INTERVAL_MS, "one interval, not two");
  assert.ok(VERSION_GATE.RETRY_MS < VERSION_GATE.CHECK_INTERVAL_MS);
  assert.equal(VERSION_GATE.PATH, "/api/version");
});
