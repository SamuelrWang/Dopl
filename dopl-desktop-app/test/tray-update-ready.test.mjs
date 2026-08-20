// Q10(c) — "Update ready: restart to install", and the version line beside it.
//
// WHAT WAS MISSING. electron-updater is configured `autoDownload` +
// `autoInstallOnAppQuit`: it fetches the new build in the background and applies
// it ON QUIT. A background listener app is quit approximately never, so the
// downloaded update just sits there. On 2026-07-31 a peer Mac ran 1.7.14 for a
// whole evening after 1.7.15 shipped and the released fix read as broken from the
// other side — it was not running. Nothing told anyone a restart was needed.
//
// The staged install therefore has to be VISIBLE, and it must stay the operator's
// call: this app never restarts itself, because a restart mid-turn kills a live
// spawned session. So the affordance is a click, the tooltip carries it without
// the menu being opened, and the current build is printed beside it — the other
// half of every "which version are you on?" conversation.
//
// Source extraction: tray.js requires electron (Tray/Menu/nativeImage), so the
// decisions are fenced as pure functions and sliced out verbatim, the same idiom
// the TRAY-AUTH block uses right above them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, fnOf, orderOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const TRAY = M("tray.js");
const UPDATER = M("updater.js");
const INDEX = M("index.js");

const { updateMenuState, trayTooltip, skewMenuLabel } = new Function(
  `${between(TRAY, "// ─── BEGIN TRAY-UPDATE", "// ─── END TRAY-UPDATE", "tray-update block")}
   return { updateMenuState, trayTooltip, skewMenuLabel };`
)();

// The download / manual-check copy moved OUT of updater.js into a pure module on
// 2026-08-01 (main/update-policy.js), so the strings below are asserted on the
// real functions rather than on the source text that used to hold them.
const POLICY = createRequire(import.meta.url)(join(HERE, "..", "main", "update-policy.js"));

// ── State transitions ───────────────────────────────────────────────────────

test("no staged update → no item at all (the quiet default)", () => {
  for (const nothing of [null, undefined, "", "   ", 0, false]) {
    const s = updateMenuState(nothing);
    assert.equal(s.ready, false, JSON.stringify(nothing));
    assert.equal(s.label, "");
  }
});

test("a staged update → one item that names the version and the action", () => {
  const s = updateMenuState("1.7.16");
  assert.equal(s.ready, true);
  assert.equal(s.version, "1.7.16");
  assert.equal(s.label, "Update ready — restart to install v1.7.16");
  // It must say RESTART: the download already happened, and a restart is the
  // only thing that applies it. "Update available" would be a lie by omission.
  assert.match(s.label, /restart/i);
});

test("a later download replaces the item rather than adding one", () => {
  // setUpdateReady is last-write-wins over a single slot, so two downloads in one
  // (very long) run cannot leave two competing restart items in the menu.
  assert.equal(updateMenuState("1.7.16").version, "1.7.16");
  assert.equal(updateMenuState("1.7.17").version, "1.7.17");
  assert.match(fnOf(TRAY, "setUpdateReady"), /updateReadyVersion = version \|\| null;/);
});

test("the TOOLTIP carries it, so the menu need not be opened to find out", () => {
  const status = "Listener: watching 3 channels";
  assert.equal(trayTooltip(status, null), status, "nothing staged: unchanged");
  const withUpdate = trayTooltip(status, "1.7.16");
  assert.match(withUpdate, /watching 3 channels/, "the status is still first");
  assert.match(withUpdate, /Update ready — restart to install v1\.7\.16/);
  assert.equal(trayTooltip("", "1.7.16").startsWith("Dopl"), true, "never an empty tooltip");
  // …and the tray actually uses it (the old code set the bare status string).
  assert.match(
    TRAY,
    /tray\.setToolTip\(trayTooltip\(currentStatus, updateReadyVersion, updateNote\)\);/
  );
});

test("an IN-FLIGHT download rides the tooltip too, a settled note does not", () => {
  // The download is the state you need to see without clicking: quitting halfway
  // is what discards the staged copy and produces "it took several tries".
  const status = "Listener: watching 3 channels";
  const busy = trayTooltip(status, null, { text: "Downloading update… 43%", busy: true });
  assert.match(busy, /Downloading update… 43%/);
  assert.match(busy, /^Listener: watching 3 channels\n/, "the status stays first");
  // A settled outcome would still be true hours later, so it stays in the menu.
  assert.equal(trayTooltip(status, null, { text: "Up to date (v1.7.18)", busy: false }), status);
  assert.equal(trayTooltip(status, null, null), status);
});

test("the peer-skew line states a fact and offers no action", () => {
  assert.equal(skewMenuLabel(null), "");
  assert.equal(skewMenuLabel({}), "");
  assert.equal(
    skewMenuLabel({ peer: "1.7.14", mine: "1.7.15", who: "Sam" }),
    "Sam is on v1.7.14, you are on v1.7.15"
  );
  assert.match(skewMenuLabel({ peer: "1.7.14", mine: "1.7.15" }), /^A peer /, "no name, still a line");
  assert.match(skewMenuLabel({ peer: "1.7.14" }), /you are on v\?/, "unknown own build degrades");
});

// ── Where the items land ────────────────────────────────────────────────────

test("the restart item is a CALL TO ACTION at the top, not buried under the submenus", () => {
  // The submenu anchor was 'Sessions' until the window-mode retirement removed it
  // (2026-08-20, settings.js header); 'Channel folders' is the surviving submenu.
  const menu = fnOf(TRAY, "buildMenu");
  assert.ok(
    orderOf(menu, "updateItem.ready", "label: 'Channel folders'", "update before the submenus"),
    "the update item used to sit below Channel folders, where nobody found it"
  );
  assert.match(menu, /click: \(\) => handlers\.onUpdate && handlers\.onUpdate\(\)/);
});

test("the current build is printed too — the other half of a skew conversation", () => {
  const menu = fnOf(TRAY, "buildMenu");
  assert.match(menu, /label: `Dopl v\$\{appVersion\.appVersion\(\) \|\| '\?'\}`, enabled: false/);
  // Disabled: it is information, not a control.
  assert.match(menu, /const skewLabel = skewMenuLabel\(peerSkew\);/);
  assert.match(menu, /template\.push\(\{ label: skewLabel, enabled: false \}\)/);
});

test("setPeerSkew keeps ONE line and only redraws on a real change", () => {
  const fn = fnOf(TRAY, "setPeerSkew");
  assert.match(fn, /if \(same\) return;/, "a repeated observation must not rebuild the menu");
  assert.match(fn, /peerSkew = next;/, "latest wins — a list would be the nag this avoids");
});

// ── The updater side ────────────────────────────────────────────────────────

test("the download event is what drives the affordance, and it is wired", () => {
  assert.match(UPDATER, /autoUpdater\.on\('update-downloaded', \(info\) => \{/);
  assert.match(UPDATER, /if \(onReadyCb\) \{/);
  assert.match(INDEX, /onReady: \(version\) => tray\.setUpdateReady\(version\)/);
  assert.match(INDEX, /onUpdate: \(\) => updater\.requestRestart\(\)/);
});

test("NEVER auto-restarts: the operator decides when a live session may die", () => {
  // autoInstallOnAppQuit stays on (a normal quit still applies it). The install
  // itself is reachable from exactly two places, and both of them are downstream
  // of a click: the restart dialog's explicit button, and the tray item.
  assert.match(UPDATER, /autoUpdater\.autoInstallOnAppQuit = true;/);
  assert.match(fnOf(UPDATER, "quitAndInstall"), /if \(!autoUpdater \|\| !readyVersion\) return;/);
  const callers = ["promptRestart", "requestRestart"];
  for (const name of callers) {
    assert.match(fnOf(UPDATER, name), /quitAndInstall\(\)/, `${name} is one of the two paths`);
  }
  // Everything else in the module — including the event handlers and the
  // interval — must be unable to reach it.
  const bodies = ["init", "check", "showDownloadedNotification", "checkNow"];
  for (const name of bodies) {
    assert.equal(
      /quitAndInstall\(\)/.test(fnOf(UPDATER, name)),
      false,
      `${name} must not be able to restart the app on its own`
    );
  }
  // And the dialog result is the gate on the prompt's path.
  assert.match(fnOf(UPDATER, "promptRestart"), /if \(!policy\.isRestartChoice\(response\)\)/);
  // No timer, no listener, no message path reaches it either.
  for (const f of ["channel-listener.js", "listener-messages.js", "version-skew.js", "trigger.js"]) {
    assert.equal(/quitAndInstall/.test(M(f)), false, `${f} can restart the app`);
  }
});

test("the notification says what the operator has to DO about it", () => {
  const { title, body } = POLICY.downloadedNotification({ version: "1.7.19" });
  assert.equal(title, "Dopl update ready");
  assert.match(body, /^Version 1\.7\.19 is downloaded\./);
  assert.match(body, /restart Dopl/i);
  assert.match(body, /keeps running the old build/, "names the consequence of doing nothing");
  assert.match(UPDATER, /silent: true/, "quiet: news, not a decision prompt");
  assert.match(UPDATER, /if \(!notified\) \{/, "one banner per run, never a nag");
});
