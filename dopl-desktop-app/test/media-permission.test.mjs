// THE SESSION PERMISSION FENCE, pinned (2026-09-08 — the composer's dictation glyph).
//
// Electron's default with no `setPermissionRequestHandler` installed is to APPROVE every
// permission a renderer asks for. `main/media-permission.js` replaces that default with an
// allowlist checked against the app's own document, and the properties worth losing sleep over
// are the two ends of it: the microphone works for OUR page, and nothing else works for anyone.
//
// ⚠ THE PREDICATE IS SLICED FROM SOURCE, the same way `test/ui-bridge-guards.test.mjs` drives
// `spa-window.js › isAllowedNavigation` — main cannot be imported without an Electron runtime.
// The "our own document" predicate is INJECTED in the slice, so this file drives the real
// `isAllowedNavigation` through `setOwnDocumentPredicate` rather than a stand-in that could
// disagree with the one production binds.
//
// Run: `node --test dopl-desktop-app/test/media-permission.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

function slice(src, name) {
  const BEGIN = `// ─── BEGIN ${name}`;
  const END = `// ─── END ${name}`;
  const from = src.indexOf(BEGIN);
  const to = src.indexOf(END);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels out of order`);
  return src.slice(from, to);
}

const { isAllowedNavigation } = new Function(
  `${slice(M("spa-window.js"), "SPA-WINDOW-PURE")}; return { isAllowedNavigation };`
)();

const { isAllowedPermission, setOwnDocumentPredicate, ALLOWED_PERMISSIONS } = new Function(
  `${slice(M("media-permission.js"), "MEDIA-PERMISSION-PURE")};` +
    ` return { isAllowedPermission, setOwnDocumentPredicate, ALLOWED_PERMISSIONS };`
)();

setOwnDocumentPredicate(isAllowedNavigation);

const INDEX = pathToFileURL("/app/renderer/app/index.html").href;
const DEV = "http://localhost:5173";

/** The production shape: bundled page, no dev server. */
const ask = (permission, url, mediaTypes, devUrl = "") =>
  isAllowedPermission(permission, url, devUrl, INDEX, mediaTypes);

test("media: the microphone is allowed for OUR document, in both builds", () => {
  assert.equal(ask("media", INDEX, ["audio"]), true);
  // The router's hash is the same document.
  assert.equal(ask("media", `${INDEX}#/ws/channels`, ["audio"]), true);
  // Dev serves the Vite origin instead; the SAME predicate covers it.
  assert.equal(ask("media", `${DEV}/#/ws/channels`, ["audio"], DEV), true);
  // `audioCapture` is the CHECK handler's spelling of the same capability. Allowing one and not
  // the other makes `getUserMedia` succeed while `navigator.permissions.query` reports denied.
  assert.equal(ask("audioCapture", INDEX), true);
});

test("media: AUDIO ONLY — the camera never rides in on the microphone's ticket", () => {
  // ⚠ `{audio:true, video:true}` is ONE ask. A predicate that accepted a list CONTAINING audio
  // would hand over the camera on a request the composer would never make.
  assert.equal(ask("media", INDEX, ["audio", "video"]), false);
  assert.equal(ask("media", INDEX, ["video"]), false);
  assert.equal(ask("videoCapture", INDEX), false);
  assert.equal(ask("display-capture", INDEX), false);
  // ⚠ AND "WE COULD NOT TELL WHAT WAS ASKED FOR" IS A REFUSAL, never a pass. Electron omits
  // `mediaTypes` on some paths, and a missing list must not resolve to yes.
  assert.equal(ask("media", INDEX, undefined), false);
  assert.equal(ask("media", INDEX, []), false);
  assert.equal(ask("media", INDEX, ["unknown"]), false);
});

test("permissions: FOREIGN documents get nothing, microphone included", () => {
  // The navigation fence already means these cannot be loaded — this is the second gate.
  assert.equal(ask("media", "https://evil.example/x", ["audio"]), false);
  assert.equal(ask("media", "file:///etc/passwd", ["audio"]), false);
  // A foreign `file:` AUTHORITY on the same path — the hole `isAllowedNavigation` closed in
  // August, inherited here rather than re-derived.
  assert.equal(ask("media", "file://evil.example/app/renderer/app/index.html", ["audio"]), false);
  // A dev-origin ask in a PRODUCTION build (no devUrl) is nobody we know.
  assert.equal(ask("media", `${DEV}/#/x`, ["audio"]), false);
  assert.equal(ask("audioCapture", "https://www.usedopl.com/canvas"), false);
  assert.equal(ask("media", "not a url", ["audio"]), false);
  assert.equal(ask("media", "", ["audio"]), false);
});

test("permissions: everything the app has no feature for is DENIED, even from our own page", () => {
  // ⚠ THE MUTATION THIS CATCHES is somebody widening the allowlist "while they are in there".
  // A permission is added WITH the feature that needs it.
  for (const permission of [
    "geolocation",
    "notifications",
    "midi",
    "midiSysex",
    "hid",
    "serial",
    "usb",
    "window-management",
    "clipboard-read",
    "openExternal",
    "fullscreen",
    "pointerLock",
    "unknown",
    "",
  ]) {
    assert.equal(ask(permission, INDEX), false, `${permission || "(empty)"} must be refused`);
  }
});

test("permissions: clipboard WRITE stays allowed — every Copy button in the app runs on it", () => {
  // ⚠ NOT A COURTESY. `src/shared/hooks/use-copy-to-clipboard.ts` calls
  // `navigator.clipboard.writeText`, which Electron routes through these same handlers, so a
  // media-only allowlist silently breaks every Copy→Check affordance in the product. Its
  // presence here is load-bearing and its absence would pass every other case in this file.
  assert.equal(ask("clipboard-sanitized-write", INDEX), true);
  assert.equal(ask("clipboard-sanitized-write", "https://evil.example/x"), false);
});

test("the allowlist is exactly three names", () => {
  assert.deepEqual(
    [...ALLOWED_PERMISSIONS].sort(),
    ["audioCapture", "clipboard-sanitized-write", "media"]
  );
});

test("both handlers are installed, and the fence is armed before any window exists", () => {
  // ⚠ ONE HANDLER IS NOT A FENCE: the REQUEST handler answers `getUserMedia`, the CHECK handler
  // answers `navigator.permissions.query`, and Electron's allow-everything default stands on
  // whichever one is missing.
  const src = M("media-permission.js");
  assert.match(src, /setPermissionRequestHandler\(/);
  assert.match(src, /setPermissionCheckHandler\(/);
  // ⚠ AND IT IS THE FIRST THING IN `whenReady`. A window created ahead of the install carries
  // the default for the life of its first page.
  const index = M("index.js");
  const ready = index.indexOf("app.whenReady().then(");
  const install = index.indexOf("mediaPermission.installPermissionFence(");
  const firstWindow = index.indexOf("createSpaWindow", ready);
  assert.ok(install > ready, "the fence is installed inside whenReady");
  assert.ok(
    firstWindow === -1 || install < firstWindow,
    "the fence is installed before the first window is created"
  );
});

test("macOS capture is possible at all: the usage string AND the entitlement", () => {
  // ⚠ BOTH, OR THE PACKAGED APP IS DENIED WITHOUT A PROMPT. `hardenedRuntime` is on, so macOS
  // refuses audio input to a process with no audio-input entitlement and shows the operator
  // nothing; `NSMicrophoneUsageDescription` is what makes the prompt possible in the first place.
  // Neither is exercised by any runtime test — this pin is the only thing standing between a
  // tidy-up and a silent, unreportable microphone.
  const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  assert.equal(pkg.build.mac.hardenedRuntime, true);
  assert.ok(
    typeof pkg.build.mac.extendInfo.NSMicrophoneUsageDescription === "string" &&
      pkg.build.mac.extendInfo.NSMicrophoneUsageDescription.length > 0,
    "NSMicrophoneUsageDescription must be in build.mac.extendInfo"
  );
  const ents = readFileSync(join(HERE, "..", pkg.build.mac.entitlements), "utf8");
  assert.match(ents, /com\.apple\.security\.device\.audio-input/);
});
