// The minimum-version GATE, as a truth table.
//
// WHAT THIS FEATURE RISKS. Every other policy in this app fails by being
// annoying. This one fails by taking the product away from everyone at once: a
// floor above the newest published build, or a fail-open path that does not,
// and the entire fleet sits on a screen it cannot get past with no update to
// install. So the tests below are weighted accordingly. Most of them are not
// "does it block correctly" but "does every way this can go wrong end with the
// app OPENING":
//
//   • an unreachable server, a timeout, a 5xx, HTML from a captive portal, a
//     JSON object with the wrong shape → no floor → open
//   • a floor this build cannot parse, a build that cannot name itself → open
//   • a floor above the newest build that exists → the updater says so and the
//     hard block degrades to a warning (GUARD 2, the fleet-outage guard)
//   • no updater at all (dev, unpackaged, a failed module load) → warning, never
//     a block, because no button on that screen could ever end it (GUARD 1)
//
// main/min-version.js is pure (no electron, no timers, no I/O) precisely so all
// of that is a table here instead of a click test. The wiring that consumes it
// is pinned in version-gate.test.mjs.
//
// Run: `node --test dopl-desktop-app/test/min-version.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const minVersion = require(join(HERE, "..", "main", "min-version.js"));

const {
  FLOOR_FETCH_TIMEOUT_MS,
  FLOOR_RETRY_MS,
  parseVersion,
  compareVersions,
  readFloorResponse,
  resolveGateMode,
  forcedFloor,
  gateVerdict,
  gateScreen,
  floorNotice,
} = minVersion;

// The updater states the verdict is a function of. `live` is the ordinary case:
// packaged, has looked, found something, downloading it.
const UPDATER = {
  booting: { supported: true, checked: false, available: false, ready: false },
  live: { supported: true, checked: true, available: true, ready: false },
  ready: { supported: true, checked: true, available: false, ready: true, version: "1.9.0" },
  nothing: { supported: true, checked: true, available: false, ready: false },
  absent: { supported: false, checked: false, available: false, ready: false },
};

const at = (current, floor, updater = UPDATER.booting, mode = "auto") =>
  gateVerdict({ current, floor, updater, mode });

// ── Parsing and ordering ─────────────────────────────────────────────────────

test("parseVersion takes a release triple and ignores a pre-release tag", () => {
  assert.deepEqual(parseVersion("1.8.2"), [1, 8, 2]);
  // A 1.9.0-rc.1 tester must not be told to upgrade to the build they are on.
  assert.deepEqual(parseVersion("1.9.0-beta.2"), [1, 9, 0]);
  for (const bad of ["", "v1.8.2", "1.8", "1.8.2.1", "latest", " 1.8.2", null, undefined, {}, 1.8]) {
    assert.equal(parseVersion(bad), null, `parsed ${JSON.stringify(bad)}`);
  }
});

test("compareVersions orders numerically, and answers null for the unknown", () => {
  assert.equal(compareVersions("1.8.1", "1.8.2"), -1);
  assert.equal(compareVersions("1.8.2", "1.8.2"), 0);
  assert.equal(compareVersions("1.8.3", "1.8.2"), 1);
  assert.equal(compareVersions("1.8.9", "1.8.10"), -1, "numeric, not lexical");
  assert.equal(compareVersions("1.9.0", "1.8.99"), 1, "minor beats patch");
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1, "major beats minor");
  assert.equal(compareVersions("1.9.0-rc.1", "1.9.0"), 0, "the tag is not ordered on");
  assert.equal(compareVersions("nope", "1.8.2"), null);
  assert.equal(compareVersions("1.8.2", ""), null);
});

test("this file and version-skew.js order versions IDENTICALLY (the drift alarm)", () => {
  // The two implementations are deliberately separate: version-skew.js's block
  // is require-free so its own truth table can slice it into a bare scope. They
  // describe the same vocabulary today, and a change to one that is not a
  // decision about both fails here.
  const SKEW = M("version-skew.js");
  const a = SKEW.indexOf("// ─── BEGIN VERSION-SKEW-PURE");
  const b = SKEW.indexOf("// ─── END VERSION-SKEW-PURE");
  assert.ok(b > a, "the version-skew pure sentinels moved");
  const skew = new Function(
    `${SKEW.slice(a, b)}\nreturn { parseVersion, compareVersions };`
  )();
  const table = ["1.8.2", "1.8.10", "1.9.0", "1.9.0-rc.1", "2.0.0", "0.0.0", "v1", "", "1.8"];
  for (const x of table) {
    assert.deepEqual(parseVersion(x), skew.parseVersion(x), `parse ${x}`);
    for (const y of table) {
      assert.equal(compareVersions(x, y), skew.compareVersions(x, y), `compare ${x} vs ${y}`);
    }
  }
});

// ── Reading the server's answer ──────────────────────────────────────────────

test("a well-formed body yields the floor", () => {
  assert.deepEqual(readFloorResponse({ minSupported: "1.9.0", latest: "1.9.2" }),
    { floor: "1.9.0", latest: "1.9.2" });
  assert.deepEqual(readFloorResponse({ minSupported: "1.9.0" }),
    { floor: "1.9.0", latest: null });
});

test("EVERY malformed answer reads as 'no floor' and never throws", () => {
  // The realistic ones, in order of how often they actually happen: a captive
  // portal's HTML parsed into nothing, a proxy's error envelope, a server that
  // answered with the key nulled, and a future field we do not understand.
  const nothing = { floor: null, latest: null };
  for (const body of [
    null, undefined, "", "<!doctype html>", 42, [], [{ minSupported: "1.9.0" }],
    {}, { error: "bad gateway" }, { minSupported: null }, { minSupported: "" },
    { minSupported: "v1.9.0" }, { minSupported: "1.9" }, { minSupported: "latest" },
    { minSupported: 190 }, { minSupported: { v: "1.9.0" } },
  ]) {
    assert.deepEqual(readFloorResponse(body), nothing, `body ${JSON.stringify(body)}`);
  }
});

test("an unreadable `latest` does not take a readable floor down with it", () => {
  assert.deepEqual(readFloorResponse({ minSupported: "1.9.0", latest: "newest" }),
    { floor: "1.9.0", latest: null });
});

// ── Fail open ────────────────────────────────────────────────────────────────

test("NO FLOOR IS THE DEFAULT: nothing to compare, nothing blocked", () => {
  for (const floor of ["", null, undefined, "v1.9.0", "1.9", "latest", "1.9.0.1"]) {
    const v = at("1.8.2", floor);
    assert.equal(v.state, "allow", `floor ${JSON.stringify(floor)}`);
    assert.equal(v.reason, "no-floor");
  }
});

test("a build that cannot name itself is never blocked", () => {
  // app-version.js resolves to '' outside Electron. Comparing a floor against
  // nothing is not an ordering, and guessing would be guessing about a block.
  for (const current of ["", null, undefined, "unknown"]) {
    assert.equal(at(current, "1.9.0").state, "allow");
    assert.equal(at(current, "1.9.0").reason, "unknown-build");
  }
});

test("at or above the floor is the ordinary answer", () => {
  assert.equal(at("1.9.0", "1.9.0").reason, "at-or-above-floor");
  assert.equal(at("1.9.1", "1.9.0").reason, "at-or-above-floor");
  assert.equal(at("2.0.0", "1.9.0").reason, "at-or-above-floor");
  // A pre-release of the floor build IS the floor build.
  assert.equal(at("1.9.0-rc.1", "1.9.0").reason, "at-or-above-floor");
});

// ── The block ────────────────────────────────────────────────────────────────

test("below a real floor, with a real update behind it, blocks", () => {
  const v = at("1.8.2", "1.9.0", UPDATER.live);
  assert.equal(v.state, "block");
  assert.equal(v.reason, "below-floor");
  assert.equal(v.current, "1.8.2");
  assert.equal(v.floor, "1.9.0");
});

test("the seconds before the first check has finished still block", () => {
  // The common case is a real floor with a real build behind it, so the boot
  // window is not a hole. GUARD 2 releases it within seconds when it is wrong.
  assert.equal(at("1.8.2", "1.9.0", UPDATER.booting).state, "block");
});

test("a staged update keeps the block: downloaded is not installed", () => {
  // This is the Q10 failure in miniature. The bits are on disk and the app is
  // still running the old build, so the screen stays up until the restart.
  const v = at("1.8.2", "1.9.0", UPDATER.ready);
  assert.equal(v.state, "block");
});

// ── The two anti-brick guards ────────────────────────────────────────────────

test("GUARD 2: a floor above the newest published build DEGRADES to a warning", () => {
  // The fleet outage this whole feature could cause. The updater has genuinely
  // looked at the release feed and found nothing, so no user can satisfy the
  // floor. Blocking would be a config mistake holding the product hostage.
  const v = at("1.8.2", "1.9.0", UPDATER.nothing);
  assert.equal(v.state, "warn");
  assert.equal(v.reason, "no-update-published");
  assert.equal(v.floor, "1.9.0", "the warning still names the floor");
});

test("GUARD 2 needs a COMPLETED check, not merely the absence of an update", () => {
  // `checked` is the whole guard. An app that has not looked yet knows nothing,
  // and "I have not looked" must not read as "there is nothing there".
  assert.equal(at("1.8.2", "1.9.0", { supported: true, checked: false, available: false, ready: false }).state,
    "block");
  assert.equal(at("1.8.2", "1.9.0", { supported: true, checked: true, available: false, ready: false }).state,
    "warn");
});

test("GUARD 1: no updater means a warning, because no button could end the block", () => {
  const v = at("1.8.2", "1.9.0", UPDATER.absent);
  assert.equal(v.state, "warn");
  assert.equal(v.reason, "no-updater");
});

test("the guards only ever RELAX: at or above the floor is still allow", () => {
  for (const u of Object.values(UPDATER)) {
    assert.equal(at("1.9.0", "1.9.0", u).state, "allow", "a current build is never warned at");
    assert.equal(at("1.8.2", "", u).state, "allow", "and no floor is no verdict");
  }
});

// ── The dev knob ─────────────────────────────────────────────────────────────

test("DOPL_VERSION_GATE=off is the escape hatch; a typo is NOT", () => {
  assert.equal(resolveGateMode("off"), "off");
  assert.equal(resolveGateMode("OFF"), "off");
  assert.equal(resolveGateMode(" off "), "off");
  assert.equal(resolveGateMode("0"), "off");
  // Anything unrecognized falls back to the shipping behavior on purpose: a
  // misspelled opt-out that silently disabled the gate would be undetectable.
  for (const raw of [undefined, null, "", "1", "on", "yes", "true", "offf", "auto"]) {
    assert.equal(resolveGateMode(raw), "auto", `mode for ${JSON.stringify(raw)}`);
  }
  assert.equal(resolveGateMode("force"), "force");
});

test("`off` allows even a build far below a real floor", () => {
  const v = at("1.0.0", "9.9.9", UPDATER.live, "off");
  assert.equal(v.state, "allow");
  assert.equal(v.reason, "gate-off");
});

test("`force` blocks through the REAL branch, so dogfooding sees the real screen", () => {
  const v = at("1.8.2", "", UPDATER.absent, "force");
  assert.equal(v.state, "block");
  assert.equal(v.reason, "below-floor", "not a special-cased state");
  assert.equal(v.floor, "1.9.0", "a synthetic floor one minor up");
  // It suppresses GUARD 2 as well, or dev (which has no updater at all) could
  // never see the screen.
  assert.equal(at("1.8.2", "", UPDATER.nothing, "force").state, "block");
});

test("`force` keeps a REAL floor when one is already above this build", () => {
  assert.equal(at("1.8.2", "2.0.0", UPDATER.absent, "force").floor, "2.0.0");
  // …and synthesizes one when the real floor is below (nothing to show).
  assert.equal(at("1.8.2", "1.0.0", UPDATER.absent, "force").floor, "1.9.0");
});

test("forcedFloor is always strictly above, including for an unnameable build", () => {
  assert.equal(forcedFloor("1.8.2"), "1.9.0");
  assert.equal(forcedFloor("2.0.0"), "2.1.0");
  assert.equal(forcedFloor(""), "9999.0.0");
  assert.equal(compareVersions("1.8.2", forcedFloor("1.8.2")), -1);
});

// ── Copy ─────────────────────────────────────────────────────────────────────

test("the screen names both builds and the ONE action that ends it", () => {
  const s = gateScreen({ current: "1.8.2", floor: "1.9.0", updater: UPDATER.ready });
  assert.match(s.message, /1\.9\.0/);
  assert.match(s.message, /1\.8\.2/);
  assert.equal(s.action.id, "restart");
  assert.match(s.status, /1\.9\.0/);
  assert.equal(s.busy, false);
});

test("a download in flight narrates itself and offers no button", () => {
  // The reason update-policy.js exists: an invisible 200MB download is what
  // makes someone force-quit and throw the partial copy away.
  const s = gateScreen({ current: "1.8.2", floor: "1.9.0", updater: { ...UPDATER.live, percent: 43 } });
  assert.match(s.status, /43%/);
  assert.equal(s.busy, true);
  assert.equal(s.action, null);
  // An unknown amount degrades to "downloading", never to a fake 0% that never moves.
  assert.match(gateScreen({ updater: { ...UPDATER.live, percent: null } }).status, /Downloading/);
  assert.ok(!/0%/.test(gateScreen({ updater: { ...UPDATER.live, percent: null } }).status));
});

test("before an answer the screen offers the manual check, and says it is looking", () => {
  const booting = gateScreen({ current: "1.8.2", floor: "1.9.0", updater: UPDATER.booting });
  assert.equal(booting.action.id, "check");
  assert.match(booting.status, /Looking/);
  const checking = gateScreen({ updater: { ...UPDATER.booting, checking: true } });
  assert.equal(checking.busy, true, "a check in flight disables the button");
  const nothing = gateScreen({ updater: UPDATER.nothing });
  assert.match(nothing.status, /No newer build/);
});

test("no user-facing string in this module uses an em dash (repo copy rule)", () => {
  const strings = [
    gateScreen({ current: "1.8.2", floor: "1.9.0", updater: UPDATER.ready }),
    gateScreen({ current: "1.8.2", floor: "1.9.0", updater: UPDATER.live }),
    gateScreen({ current: "1.8.2", floor: "1.9.0", updater: UPDATER.absent }),
    gateScreen({ current: "1.8.2", floor: "1.9.0", updater: UPDATER.nothing }),
    floorNotice({ current: "1.8.2", floor: "1.9.0", reason: "no-update-published" }),
    floorNotice({ current: "1.8.2", floor: "1.9.0", reason: "no-updater" }),
  ].flatMap((o) => Object.values(o).filter((v) => typeof v === "string"));
  assert.ok(strings.length > 10);
  for (const s of strings) assert.ok(!s.includes("—"), `em dash in: ${s}`);
});

test("the warning explains the situation instead of demanding an impossible action", () => {
  const nothingYet = floorNotice({ current: "1.8.2", floor: "1.9.0", reason: "no-update-published" });
  assert.match(nothingYet.body, /no newer build is published/i);
  assert.match(nothingYet.body, /Keep working/i);
  assert.match(nothingYet.tray, /1\.9\.0/);
  assert.match(nothingYet.tray, /1\.8\.2/);
  // The no-updater case is the one where the operator DOES have something to
  // do, so that one names it.
  assert.match(floorNotice({ floor: "1.9.0", reason: "no-updater" }).body, /Download the latest/i);
});

// ── Shape ────────────────────────────────────────────────────────────────────

test("the module is PURE: no electron, no timers, no network", () => {
  const SRC = M("min-version.js");
  assert.ok(!/require\('electron'\)/.test(SRC), "no electron");
  assert.ok(!/setTimeout|setInterval|fetch\(/.test(SRC), "no timers, no I/O");
  // update-policy.js is the one require, and it is pure for the same reason.
  const requires = [...SRC.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, ["./update-policy"]);
});

test("the cadence composes with the updater instead of inventing a second one", () => {
  const SRC = M("min-version.js");
  assert.ok(!/CHECK_INTERVAL\w*\s*=/.test(SRC), "the steady-state interval belongs to update-policy.js");
  assert.equal(FLOOR_FETCH_TIMEOUT_MS, 8000);
  // The retry is the one added timing: an app that booted offline must not wait
  // four hours to learn there is a floor.
  assert.equal(FLOOR_RETRY_MS, 10 * 60 * 1000);
  assert.ok(FLOOR_RETRY_MS < 4 * 60 * 60 * 1000);
});
