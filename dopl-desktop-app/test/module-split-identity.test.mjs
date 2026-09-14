// THE 2026-09-14 §2 SPLITS — IDENTITY PINS.
//
// WHAT THIS FILE IS FOR. Seven desktop files had crossed the 500-line `max-lines` cap
// (`eslint.config.js`, ZERO exemptions), so `cd dopl-desktop-app && npm run lint` — the CI
// `desktop` job — was red. Five of them were brought back under it by MOVING a cohesive block
// into a sibling module; the moves are meant to be BYTE-IDENTICAL in behaviour, and this file is
// what makes that claim checkable rather than asserted.
//
// ⚠ THE PIN IS OBJECT IDENTITY, NOT A RE-IMPLEMENTATION. Every case below asserts that the name
// the old module still publishes IS the very function object the new module exports (`===`), so a
// future edit that "restores" a helper by copying it back — the second-spelling failure this tree
// spends INVARIANTS §1 warning about — fails here instead of quietly shipping two answers.
//
// ⚠ WHY SOME CASES READ SOURCE INSTEAD OF REQUIRING. `session-engine.js` and `session-ipc-ops.js`
// pull in electron at load, so they cannot be `require`d from a credential-less `npm test`. For
// those two the pin is the require LINE plus the name list, which is the same claim one level out.
//
// Run: `node --test dopl-desktop-app/test/module-split-identity.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require_ = createRequire(import.meta.url);
const read = (f) => readFileSync(join(MAIN, f), "utf8");
const load = (f) => require_(join(MAIN, f));

/** Every name in `names` is the SAME object on both modules. */
const sameNames = (host, moved, names, label) => {
  for (const n of names) {
    assert.ok(n in moved, `${label}: ${n} is not exported by the new module`);
    assert.equal(host[n], moved[n], `${label}: ${n} is a SECOND copy, not the moved one`);
  }
};

// ── 1. session-profiles.js → session-profiles-runtime.js ─────────────────────────────

test("SPLIT: the runtime-resolved Axis-A surface is re-exported, never respelled", () => {
  const profiles = load("session-profiles.js");
  const runtime = load("session-profiles-runtime.js");
  sameNames(profiles, runtime, [
    "buildSessionToolConfig", "toolModeAllows", "normalizeToolMode", "floorWindowlessTool",
    "windowlessFloorRefusal", "axisBOpScopedWarning", "isClassifiedTool",
    "TOOL_MODES", "AUTO_TOOLS", "BYPASS_TOOLS", "BYPASS_READS", "ESCALATION_TOOLS", "EDIT_TOOLS",
  ], "session-profiles-runtime");
  // ⚠ THE ONE REQUIRE IN CORE THAT REACHES THE RUNTIME LAYER MOVED WITH THEM, and core-vocabulary
  // depends on there being exactly one: it must not come back in the file it left.
  assert.equal(/require\('\.\/runtime'\)/.test(read("session-profiles.js")), false,
    "the registry require went with the delegates; a second one is a second answer");
  assert.match(read("session-profiles-runtime.js"), /require\('\.\/runtime'\)/);
});

// ── 2. session-engine.js → session-engine-host.js ────────────────────────────────────

test("SPLIT: the engine's host seams are one module, and the engine imports all four back", () => {
  const host = load("session-engine-host.js");
  for (const n of ["readCaps", "refreshTray", "runLifecycle", "setLifecycleHandlers"]) {
    assert.equal(typeof host[n], "function", `${n} is not exported`);
  }
  const engine = read("session-engine.js");
  assert.match(engine,
    /const \{ readCaps, refreshTray, runLifecycle, setLifecycleHandlers \} = require\('\.\/session-engine-host'\);/,
    "the engine takes the moved names back under their own names");
  // ⚠ THE STATE WENT WITH THE FUNCTIONS. A `lifecycle` handler pair left behind in the engine
  // would be a second registry that `setLifecycleHandlers` no longer writes to.
  assert.equal(/let lifecycle = \{/.test(engine), false, "the handler pair lives in ONE module");
  assert.match(read("session-engine-host.js"), /let lifecycle = \{ onLaunched: null, onEnded: null \};/);
});

// ── 3. session-ipc-ops.js → session-ipc-window-op.js ─────────────────────────────────

test("SPLIT: the agent-window op keeps its IPC surface here and its body there", () => {
  const ops = read("session-ipc-ops.js");
  const op = load("session-ipc-window-op.js");
  assert.equal(typeof op.openAgentWindow, "function");
  // The SURFACE is what must not move: the op name, the literal `appWindowOnly` wrap (the shape
  // `channel-ipc-sender.test.mjs`'s structural belt reads) and the `channelId` UUID gate.
  assert.match(ops,
    /ipcMain\.handle\('sessions:openAgentWindow', appWindowOnly\('sessions:openAgentWindow', \{ ok: false \}/);
  assert.match(ops, /require\('\.\/session-ipc-window-op'\)\.openAgentWindow\(p\)/);
  const handler = ops.slice(ops.indexOf("ipcMain.handle('sessions:openAgentWindow'"),
    ops.indexOf("require('./session-ipc-window-op')"));
  assert.match(handler, /if \(!isUuid\(p\.channelId\)\) return \{ ok: false \};/,
    "the UUID gate stays AHEAD of the delegate — a bad payload must never reach it");
  // ⚠ `asAgentId` IS READ BACK FROM THE REGISTRAR, never re-spelled: it is the third coordinate
  // of every agent op and two copies is how the two come to disagree.
  assert.match(read("session-ipc-window-op.js"), /require\('\.\/session-ipc-ops'\)\.asAgentId/);
  assert.equal(/function asAgentId\(/.test(read("session-ipc-window-op.js")), false);
});

// ── 4. session-narration.js → narration-ring.js ──────────────────────────────────────

test("SPLIT: the ring's two bounds and its append are re-exported, never respelled", () => {
  const narration = load("session-narration.js");
  const ring = load("narration-ring.js");
  sameNames(narration, ring,
    ["NARRATION_MAX", "RING_CHAR_BUDGET", "ENTRY_OVERHEAD_CHARS", "push"], "narration-ring");
  // The arithmetic the 17 GB incident bought is unchanged, and it is derived rather than restated.
  assert.equal(ring.RING_CHAR_BUDGET, ring.NARRATION_MAX * narration.TEXT_CAP);
  assert.equal(ring.ENTRY_OVERHEAD_CHARS, 64);
  // ⚠ AND THE REQUIRE SITS ABOVE THE SENTINEL, like every other one in that file: a require inside
  // SESSION-NARRATION-PURE breaks the extraction idiom the marker promises.
  const src = read("session-narration.js");
  assert.ok(src.indexOf("require('./narration-ring')") < src.indexOf("// ─── BEGIN SESSION-NARRATION-PURE"));
});

// ── 5. session-dispatch.js → agent-handles-escalation.js ─────────────────────────────

test("SPLIT: the escalation-answer door is ONE function, reached through agent-handles", () => {
  const handles = load("agent-handles.js");
  const door = load("agent-handles-escalation.js");
  sameNames(handles, door, ["escalationAnswerAgentIds"], "agent-handles-escalation");
  // ⚠ THE DISPATCH BLOCK BINDS IT OFF `agentHandles` ON PURPOSE. `agent-handles.js` is the one
  // module every SESSION-DISPATCH-PURE harness already injects REAL, so the door needed no new
  // free var in any of them — and a FAKE door is a fake wake.
  const dispatch = read("session-dispatch.js");
  assert.match(dispatch, /const escalationAnswerAgentIds = agentHandles\.escalationAnswerAgentIds;/);
  assert.equal(/function escalationAnswerAgentIds\(/.test(dispatch), false,
    "the body lives in one file; a copy here is a second door");
  // Behaviour, driven through the seam the routing table actually uses.
  const answer = (id) => ({ metadata: { escalationAnswer: { agentId: id } } });
  assert.deepEqual(handles.escalationAnswerAgentIds(answer("a1b2c3d4"), ["a1b2c3d4", "z9y8x7w6"]), ["a1b2c3d4"]);
  assert.deepEqual(handles.escalationAnswerAgentIds(answer("zzzzzzzz"), ["a1b2c3d4"]), []);
  assert.deepEqual(handles.escalationAnswerAgentIds(answer("a1b2c3d4"), []), []);
});

// ── 6. THE CAP ITSELF ────────────────────────────────────────────────────────────────

test("every file the splits touched is back under the 500-line cap, with headroom", () => {
  // ⚠ MEASURED, NOT REMEMBERED (§1's own rule about numbers in prose). The cap is `error` with
  // ZERO exemptions in the desktop config, so a file back over it is a red CI job, not a nit.
  for (const f of [
    "session-dispatch.js", "session-engine.js", "session-ipc-ops.js", "session-narration.js",
    "session-profiles.js", "session-reopen.js", "session-summary.js",
    "session-profiles-runtime.js", "session-engine-host.js", "session-ipc-window-op.js",
    "narration-ring.js", "agent-handles.js", "agent-handles-escalation.js",
  ]) {
    const lines = read(f).split("\n").length;
    assert.ok(lines <= 500, `main/${f} is ${lines} lines — over the §2 cap again`);
  }
  const preload = readFileSync(join(HERE, "..", "renderer", "app-preload.js"), "utf8").split("\n").length;
  assert.ok(preload <= 500, `renderer/app-preload.js is ${preload} lines — over the §2 cap again`);
});

// ── 7. THE WORKSPACE ID ON A SUMMARY ─────────────────────────────────────────────────

test("SUMMARY: both projections carry `workspaceId`, `null` when the shape carried none, and it RIDES the wire", async () => {
  // 2026-09-14 ruling (Desktop Agent, for the tabbed pop-out's rail): `session-summary.js ›
  // wireSummary` no longer strips `workspaceId`, so `DesktopSessionSummary.workspaceId` is a
  // wire fact and `pages/agent-window/index.tsx › segmentFor` routes a cross-workspace row by
  // it. `session-summary-report.test.mjs` pins the same contract from the report side.
  const { load: loadSummary, session, endedRecord } = await import("./_session-summary-harness.mjs");
  const m = loadSummary();
  assert.equal(m.liveSummary(session(), "a1b2c3d4").workspaceId, "ws-1");
  assert.equal(m.liveSummary(session({ workspaceId: null }), "a1b2c3d4").workspaceId, null,
    "absent is null — never '' and never a guess");
  assert.equal(m.endedSummary(endedRecord(), "a1b2c3d4").workspaceId, "ws-1");
  assert.equal(m.endedSummary(endedRecord({ workspaceId: "" }), "a1b2c3d4").workspaceId, null);
  m.bind({ sessions: new Map([["chan-1:task-1", session()]]) });
  assert.equal(m.list()[0].workspaceId, "ws-1", "on the wire, not stripped");
});
