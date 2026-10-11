// THE DESKTOP DICTATION ENGINE'S RULES, pinned (2026-10-08, `main/dictation.js`).
//
// ⚠ SLICED FROM SOURCE like every main-process suite here: main cannot load without Electron. What
// is pinned is the part that decides what the operator is TOLD — the probe's precedence (the first
// thing that would stop a click is the one named), and the wire's parsing (stray helper output is
// never forwarded) — plus the shipping shape: helper source, build hook, usage strings.
//
// Run: `node --test dopl-desktop-app/test/dictation.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, "..", ...p), "utf8");

function slice(src, name) {
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels out of order`);
  return src.slice(from, to);
}

const { availabilityFromProbe, parseHelperLine, parseProbeOutput, cleanLocale, exitFault } = new Function(
  `${slice(read("main", "dictation.js"), "DICTATION-PURE")};` +
    " return { availabilityFromProbe, parseHelperLine, parseProbeOutput, cleanLocale, exitFault };"
)();

const READY = {
  type: "probe",
  speech: "authorized",
  mic: "authorized",
  hasMic: true,
  recognizer: true,
  available: true,
  onDevice: true,
  locale: "en-US",
};

test("a fully capable Mac is ready, with the locale the helper chose", () => {
  assert.deepEqual(availabilityFromProbe(READY, "darwin"), { state: "ready", locale: "en-US" });
});

test("not-yet-asked is READY — the OS prompt only appears on a start", () => {
  const p = { ...READY, speech: "notDetermined", mic: "notDetermined" };
  assert.equal(availabilityFromProbe(p, "darwin").state, "ready");
});

test("names the FIRST blocker, in the order the operator must fix them", () => {
  const code = (over) => availabilityFromProbe({ ...READY, ...over }, "darwin").code;
  assert.equal(code({ speech: "denied", mic: "denied", onDevice: false }), "speech-denied");
  assert.equal(code({ speech: "restricted" }), "speech-restricted");
  assert.equal(code({ mic: "denied", onDevice: false }), "mic-denied");
  assert.equal(code({ mic: "restricted" }), "mic-restricted");
  assert.equal(code({ hasMic: false, onDevice: false }), "no-mic");
  assert.equal(code({ recognizer: false, onDevice: false }), "locale-unsupported");
  assert.equal(code({ onDevice: false }), "on-device-unavailable");
});

test("🔒 a missing or garbled probe is a failed helper, never ready", () => {
  assert.equal(availabilityFromProbe(null, "darwin").code, "helper-failed");
  assert.equal(availabilityFromProbe({ type: "partial" }, "darwin").code, "helper-failed");
  assert.equal(availabilityFromProbe(parseProbeOutput("garbage\n"), "darwin").code, "helper-failed");
});

test("Windows and Linux answer unsupported-os (the interface is ready, the engine is not)", () => {
  assert.equal(availabilityFromProbe(READY, "win32").code, "unsupported-os");
  assert.equal(availabilityFromProbe(READY, "linux").code, "unsupported-os");
});

test("reads the probe line out of noisy stdout", () => {
  const out = `log line\n${JSON.stringify(READY)}\n`;
  assert.deepEqual(parseProbeOutput(out), READY);
});

test("🔒 forwards only wire events, with capped text", () => {
  assert.deepEqual(parseHelperLine('{"type":"partial","text":"hello"}'), { type: "partial", text: "hello" });
  assert.deepEqual(parseHelperLine('{"type":"error","code":"mic-denied","message":"x"}'), {
    type: "error",
    code: "mic-denied",
  });
  assert.equal(parseHelperLine('{"type":"probe"}'), null);
  assert.equal(parseHelperLine("2026-10-08 dopl-dictation[1] Cannot make recognizer"), null);
  assert.equal(parseHelperLine(""), null);
  assert.equal(parseHelperLine(JSON.stringify({ type: "final", text: "x".repeat(9000) })).text.length, 4000);
});

test("🔒 a locale reaches the helper's argv only in a tag's shape", () => {
  assert.equal(cleanLocale("en-US"), "en-US");
  assert.equal(cleanLocale("zh-Hant-TW"), "zh-Hant-TW");
  assert.equal(cleanLocale("en_US"), "en_US");
  assert.equal(cleanLocale("--help"), "");
  assert.equal(cleanLocale("en-US; rm -rf /"), "");
  assert.equal(cleanLocale(42), "");
});

test("the shipping shape: helper source, build hook, resource path, usage strings", () => {
  const pkg = JSON.parse(read("package.json"));
  const mac = pkg.build.mac;
  assert.match(mac.extendInfo.NSSpeechRecognitionUsageDescription, /\S/, "no speech prompt text ⇒ silent denial");
  assert.match(mac.extendInfo.NSMicrophoneUsageDescription, /\S/);
  assert.equal(pkg.build.beforePack, "./scripts/build-dictation-helper.js");
  const res = (pkg.build.extraResources || []).find((r) => r && r.to === "dictation/dopl-dictation");
  assert.ok(res, "the helper must ship at Resources/dictation/dopl-dictation (main/dictation.js › helperPath)");
  assert.equal(res.from, "native/build/dopl-dictation");
  assert.match(read("entitlements.mac.plist"), /com\.apple\.security\.device\.audio-input/);
  const swift = read("native", "dictation", "main.swift");
  assert.match(swift, /requiresOnDeviceRecognition = true/, "audio must never leave the Mac");
  assert.match(read("main", "dictation.js"), /'dictation', 'dopl-dictation'/);
  // The helper's own embedded plist must say what the app's says (the prompt and the crash check
  // read different ones).
  const plist = read("native", "dictation", "Info.plist");
  assert.ok(plist.includes(mac.extendInfo.NSSpeechRecognitionUsageDescription), "speech usage text drifted");
  assert.ok(plist.includes(mac.extendInfo.NSMicrophoneUsageDescription), "mic usage text drifted");
  assert.match(read("scripts", "build-dictation-helper.js"), /__info_plist/);
});

// ── THE HELPER'S EXIT (2026-10-11, release-readiness) ──────────────────────────────────────────
// "Red and nothing" was the report. A helper killed by a SIGNAL (a macOS privacy kill, a crash)
// has no exit code, and the old close handler read only the code, so the session ended in silence.
const live = (over = {}) => ({ faulted: false, ended: false, stopping: false, ...over });

test("🔒 a helper killed by a signal it was not sent owes the renderer a fault", () => {
  assert.equal(exitFault(null, "SIGKILL", live()), "helper-failed");
  assert.equal(exitFault(null, "SIGABRT", live()), "helper-failed");
});

test("a non-zero exit with no report of its own is a fault; a clean exit is not", () => {
  assert.equal(exitFault(1, null, live()), "helper-failed");
  assert.equal(exitFault(0, null, live()), null);
});

test("our own stop (grace kill, closed window, quit) stays quiet", () => {
  assert.equal(exitFault(null, "SIGKILL", live({ stopping: true })), null);
});

test("never twice: a helper that already reported, or an ended session, owes nothing", () => {
  assert.equal(exitFault(1, null, live({ faulted: true })), null);
  assert.equal(exitFault(null, "SIGKILL", live({ ended: true })), null);
  assert.equal(exitFault(1, null, null), null);
});

test("🔒 the close handler reads the SIGNAL and every one of our own kills marks the session stopping", () => {
  const src = read("main", "dictation.js");
  assert.match(src, /child\.on\('close', \(code, signal\) =>/);
  assert.match(src, /exitFault\(code, signal, session\)/);
  assert.match(src, /function stopSession\(session\) \{\n  if \(!session \|\| session\.ended\) return;\n  session\.stopping = true;/);
  assert.match(src, /current\.stopping = true;[^\n]*\n    kill\(current\);/);
});

test("🔒 the plain build path rebuilds the SPA before packaging (a stale bundle ships the old mic)", () => {
  // `DOPL_NOTARY_PROFILE=dopl-notary npm run build` is a supported release path. renderer/app is
  // gitignored build output; packaging without rebuilding it shipped whatever was last built —
  // on 2026-10-11 an Oct 2 bundle whose mic still used Electron's keyless Web Speech.
  const { scripts } = JSON.parse(read("package.json"));
  for (const name of ["build", "dist"]) {
    assert.match(scripts[name], /^npm --prefix \.\. run build:ui && electron-builder --mac$/, `${name} must build the UI first`);
  }
  assert.match(read("scripts", "release.sh"), /npm run build:ui/, "release.sh builds the UI itself");
});
