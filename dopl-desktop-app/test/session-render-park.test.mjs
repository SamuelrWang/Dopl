// Tests for the v1.7.4 P1/P2 renderer view-model additions (parked pill + inline paused
// note + reopen-shell notice) in renderer/session/session-viewmodel.js. Split out of
// session-render.test.mjs to keep both files under the §2 500-line cap. Same discipline:
// the module is DOM/electron-free and UMD-wrapped, so it loads directly via createRequire.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vm = require(fileURLToPath(new URL("../renderer/session/session-viewmodel.js", import.meta.url)));
const { initialState, reduceEvent, statusText, statusDotKey, nextPermission } = vm;

const last = (s) => s.items[s.items.length - 1];

test("statusText/statusDotKey render a parked session as the calm 'Paused' pill", () => {
  // Parked is not `running`, so the phase label wins regardless of a stale activity.
  assert.equal(statusText("parked", null), "Paused");
  assert.equal(statusText("parked", "working"), "Paused");
  assert.equal(statusDotKey("parked", null), "is-parked");
});

test("a `status: parked` event moves the phase to parked (composer stays enabled — not ended)", () => {
  const s = reduceEvent(initialState(), { type: "status", phase: "parked" });
  assert.equal(s.phase, "parked");
  assert.equal(s.ended, null, "parked NEVER sets the ended state, so the composer stays enabled");
});

test("a `paused` event drops the one-line inline note (info level, no em dash)", () => {
  const s = reduceEvent(initialState(), { type: "paused" });
  assert.equal(last(s).kind, "notice");
  assert.equal(last(s).level, "info");
  assert.match(last(s).text, /^Paused after inactivity\./);
  assert.ok(!last(s).text.includes("—"), "renderer copy has no em dash");
});

test("FIX #6: the park-emitted permission_resolved clears the renderer's permission dock", () => {
  // A pending gate is showing in the dock; park (main) emits permission_resolved{deny} for
  // it, and the renderer drops it so the parked, query-less window shows no live prompt.
  let s = reduceEvent(initialState(), {
    type: "permission_request", requestId: "r1", name: "Bash", inputSummary: "$ ls", inputFull: {},
  });
  assert.ok(nextPermission(s), "the dock shows the pending gate");
  s = reduceEvent(s, { type: "status", phase: "parked" });
  s = reduceEvent(s, { type: "permission_resolved", requestId: "r1", decision: "deny" });
  assert.equal(nextPermission(s), null, "the dock is cleared once park resolves the pending gate");
  assert.equal(s.phase, "parked", "the pill stays Paused — not a lying 'running'");
});

test("a `notice` event appends a caller-supplied calm line (P2 reopen shell)", () => {
  const s = reduceEvent(initialState(), { type: "notice", level: "info", text: "Reopened. The earlier transcript is in the channel thread." });
  assert.equal(last(s).kind, "notice");
  assert.equal(last(s).level, "info");
  assert.equal(last(s).text, "Reopened. The earlier transcript is in the channel thread.");
  // Level defaults to info; text coerces safely.
  const d = reduceEvent(initialState(), { type: "notice", text: null });
  assert.equal(last(d).level, "info");
  assert.equal(last(d).text, "");
});
