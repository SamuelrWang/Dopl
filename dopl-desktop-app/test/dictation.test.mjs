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

const { availabilityFromProbe, parseHelperLine, parseProbeOutput, cleanLocale } = new Function(
  `${slice(read("main", "dictation.js"), "DICTATION-PURE")};` +
    " return { availabilityFromProbe, parseHelperLine, parseProbeOutput, cleanLocale };"
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
