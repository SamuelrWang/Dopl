// SESSION POSTURE IS KEYED BY THE SESSION'S OWN RUNTIME, END TO END (X-01 / P4-02 / P6-06 / P3-04 /
// X-02), the launch start modes read off the LAUNCH runtime's record (C1), and the per-agent pick
// (C2, Samuel's ruling 3: "narrower sticks"). The fan-out half (P3-02) is channel-posture-live's.
//
// Every case drives a REAL entry point: the `startSession` head (sliced from the shipped engine),
// the reducer, `channel-prefs.js` over an in-memory store, `session-private.js`, the button lane.
//
// Run: `node --test dopl-desktop-app/test/posture-runtime-keyed.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startedStateFor } from "./_session-preset-harness.mjs";
import { fakeRegistry } from "./_launch-runtime-stub.mjs";

const require = createRequire(import.meta.url);
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const M = (p) => join(MAIN, p);

// ── an in-memory electron-store, primed before anything requires the real modules ────────────
const DISK = new Map();
class FakeStore {
  get(key) { return DISK.get(key); }
  set(key, value) { DISK.set(key, JSON.parse(JSON.stringify(value))); }
}
const prime = (file, exports) => {
  require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
};
prime(require.resolve("electron-store"), FakeStore);
prime(M("diag.js"), { diag: () => {} });

const prefs = require(M("channel-prefs.js"));
const registry = require(M("runtime/index.js"));
const LD = require(M("runtime/launch-default.js"));
const priv = require(M("session-private.js"));
const { sessionReducer } = require(M("session-reducer.js"));
const summary = require(M("session-summary.js"));

const CH = "7a0c1e55-1111-4222-8333-444455556666";
const CODEX = registry.capability.toolModes(registry.descriptorFor("codex"));

function room(patch) {
  DISK.clear();
  const res = prefs.setLaunchSelection(CH, patch);
  assert.equal(res.ok, true, JSON.stringify(res));
}

// ── 1. CORE STATE CARRIES THE SESSION RUNTIME'S OWN WORD (X-01 / P4-02 / P6-06) ───────────────

test("X-01: a Codex spawn keeps every Codex word; a Claude word on it is Codex's narrowest", () => {
  for (const word of CODEX) {
    const st = startedStateFor({ windowless: true, startModes: { tools: word, messages: "ask" } }, { id: "codex" });
    assert.equal(st.toolMode, word, `${word} survived the spawn`);
    assert.deepEqual(st.toolModes, CODEX);
  }
  const foreign = startedStateFor({ windowless: true, startModes: { tools: "bypass", messages: "ask" } }, { id: "codex" });
  assert.equal(foreign.toolMode, "untrusted", "never a translation, never Claude's `manual`");
  const claude = startedStateFor({ windowless: true, startModes: { tools: "accept_edits", messages: "ask" } }, { id: "claude" });
  assert.equal(claude.toolMode, "accept_edits");
  const bare = startedStateFor({ windowless: true }, { id: "codex" });
  assert.equal(bare.toolMode, "untrusted", "a spawn handed nothing starts at ITS runtime's narrowest");
});

test("P4-02: the reducer coerces a live set against the SESSION's words, not Claude's", () => {
  const st = startedStateFor({ windowless: true }, { id: "codex" });
  assert.equal(sessionReducer(st, { type: "set_tool_mode", mode: "on-request" }).state.toolMode, "on-request");
  assert.equal(sessionReducer(st, { type: "set_tool_mode", mode: "bypass" }).state.toolMode, "untrusted");
  const cl = startedStateFor({ windowless: true }, { id: "claude" });
  assert.equal(sessionReducer(cl, { type: "set_tool_mode", mode: "never" }).state.toolMode, "manual");
});

test("P4-02: the auth hold resets to THIS runtime's narrowest, and a per-agent pick survives it", () => {
  const st = startedStateFor({ windowless: true, startModes: { tools: "never", messages: "auto_both" } }, { id: "codex" });
  const picked = sessionReducer(st, { type: "set_tool_mode", mode: "on-request", pinned: true }).state;
  const r = sessionReducer(picked, { type: "auth_hold" });
  assert.equal(r.state.toolMode, "untrusted");
  assert.equal(r.state.messageMode, "ask");
  assert.deepEqual([r.state.toolModeSet, r.state.toolPick], [true, "on-request"], "the narrower ask still holds after");
  const modes = r.effects.find((e) => e.type === "emit" && e.payload.type === "modes");
  assert.deepEqual(modes.payload, { type: "modes", tool: "untrusted", message: "ask" }, "the echo names a Codex word");
});

test("P4-02: the summary's default is the session runtime's narrowest word, never `manual`", () => {
  summary.bind({ sessions: new Map([["k", {
    key: "k", sessionId: "s", channelId: CH, taskId: "", agentId: "a1b2c3d4", runtimeId: "codex",
    state: { ...startedStateFor({ windowless: true }, { id: "codex" }), toolMode: "" },
  }]]) });
  assert.equal(summary.list()[0].toolMode, "untrusted");
});

// ── 2. THE LIVE READ IS THE SESSION RUNTIME'S RECORD, AND A PICK NARROWS IT (C2) ─────────────

const session = (runtimeId, state) => ({ channelId: CH, runtimeId, windowless: true, state });

test("X-01: a Codex session in a CLAUDE-selected room reads the CODEX record, not Claude's", () => {
  room({ runtime: "claude", tools: "bypass", messages: "ask" });
  prefs.setLaunchSelection(CH, { runtime: "codex", tools: "never" });
  prefs.setLaunchSelection(CH, { runtime: "claude" });
  const codex = session("codex", startedStateFor({ windowless: true }, { id: "codex" }));
  assert.equal(priv.effectiveToolMode(codex), "never");
  const claude = session("claude", startedStateFor({ windowless: true }, { id: "claude" }));
  assert.equal(priv.effectiveToolMode(claude), "bypass");
  const legacy = session(null, startedStateFor({ windowless: true }, { id: "claude" }));
  assert.equal(priv.effectiveToolMode(legacy), "bypass", "no stamped runtime = the DEFAULT runtime's record");
});

test("C2: a pinned pick is clamped to the channel for the session's runtime, then held under it", () => {
  room({ runtime: "codex", tools: "on-request", messages: "auto_inbound" });
  const s = session("codex", startedStateFor({ windowless: true }, { id: "codex" }));
  const wide = priv.pickForSession(s, "tools", "never", true);
  assert.deepEqual(wide, { mode: "on-request", clamped: true }, "never wider than the channel");
  const narrow = priv.pickForSession(s, "tools", "granular", true);
  assert.deepEqual(narrow, { mode: "granular", clamped: false });
  const msgs = priv.pickForSession(s, "messages", "auto_both", true);
  assert.deepEqual(msgs, { mode: "auto_inbound", clamped: true }, "capability bits: no out half");
  s.state = sessionReducer(s.state, { type: "set_tool_mode", mode: narrow.mode, pinned: true }).state;
  assert.equal(priv.effectiveToolMode(s), "granular");
  prefs.setLaunchSelection(CH, { tools: "untrusted" });
  assert.equal(priv.effectiveToolMode(s), "untrusted", "the room narrowing below the pick wins at once");
  prefs.setLaunchSelection(CH, { tools: "never" });
  assert.equal(priv.effectiveToolMode(s), "granular", "…and the pick comes back, never past itself");
});

test("C2: an unpinned set (the Settings fan-out) is validated but never clamped or stamped", () => {
  room({ runtime: "codex", tools: "untrusted", messages: "ask" });
  const s = session("codex", startedStateFor({ windowless: true }, { id: "codex" }));
  assert.deepEqual(priv.pickForSession(s, "tools", "never", false), { mode: "never", clamped: false });
  assert.deepEqual(priv.pickForSession(s, "tools", "bypass", false), { mode: "untrusted", clamped: false });
});

test("C2: a pinned START posture is the agent's own pick on both axes", () => {
  const st = startedStateFor({ windowless: true, startModes: { tools: "granular", messages: "auto_inbound", pinned: true } }, { id: "codex" });
  assert.deepEqual([st.toolModeSet, st.toolPick, st.messageModeSet, st.messagePick], [true, "granular", true, "auto_inbound"]);
  const unpinned = startedStateFor({ windowless: true, startModes: { tools: "granular", messages: "auto_inbound" } }, { id: "codex" });
  assert.deepEqual([unpinned.toolModeSet, unpinned.messageModeSet], [false, false], "a start value follows the channel");
  const floored = startedStateFor({ windowless: true, startModes: { tools: "granular", messages: "ask", pinned: true } }, { id: "codex" });
  assert.equal(floored.messagePick, "auto_inbound", "a windowless pick is floored with the axis (F-236)");
});

test("C2: a START posture pinned on ONE axis pins only that axis; the other follows the channel", () => {
  const tools = startedStateFor({ windowless: true, startModes: { tools: "granular", messages: "auto_inbound", pinned: { tools: true, messages: false } } }, { id: "codex" });
  assert.deepEqual([tools.toolModeSet, tools.toolPick, tools.messageModeSet, tools.messagePick], [true, "granular", false, ""]);
  const messages = startedStateFor({ windowless: true, startModes: { tools: "granular", messages: "auto_inbound", pinned: { tools: false, messages: true } } }, { id: "codex" });
  assert.deepEqual([messages.toolModeSet, messages.toolPick, messages.messageModeSet, messages.messagePick], [false, "", true, "auto_inbound"]);
});

// ── 3. THE LAUNCH READS THE LAUNCH RUNTIME'S RECORD (C1 / X-02 / P3-04) ───────────────────────

test("C1: launchStartModes reads byRuntime[launch runtime], in that runtime's words, with its native bag", () => {
  room({ runtime: "codex", tools: "never", native: { sandbox_mode: "read-only" }, messages: "auto_outbound" });
  prefs.setLaunchSelection(CH, { runtime: "claude", tools: "bypass" });
  assert.deepEqual(prefs.launchStartModes(CH, "codex"),
    { tools: "never", messages: "auto_both", native: { sandbox_mode: "read-only" } });
  assert.deepEqual(prefs.launchStartModes(CH, "claude"), { tools: "bypass", messages: "auto_both", native: {} });
  assert.deepEqual(prefs.launchStartModes(CH, ""), prefs.launchStartModes(CH, "claude"), "'' = the SELECTED runtime");
  assert.deepEqual(prefs.launchStartModes(CH, "borg"), prefs.launchStartModes(CH, "claude"), "unregistered = selected");
  assert.deepEqual(prefs.launchStartModes(CH, "cursor").tools, registry.capability.narrowestToolMode(registry.descriptorFor("cursor")),
    "a runtime with no record starts at ITS narrowest");
  assert.deepEqual(prefs.launchPostureFor(CH, "codex"), { tools: "never", messages: "auto_outbound" }, "the ceiling is unfloored");
});

test("X-02: the button lane starts a dialog-picked Codex agent on the CODEX record in a Claude room", async () => {
  room({ runtime: "codex", tools: "never", native: { sandbox_mode: "read-only" }, messages: "ask" });
  prefs.setLaunchSelection(CH, { runtime: "claude", tools: "bypass" });
  const launches = [];
  const stub = (id) => {
    if (id === "./channel-prefs") return prefs;
    if (id === "./session-engine") return { launchRequesterSession: async (spec) => { launches.push(spec); return { agentId: "ag", sessionId: "s" }; } };
    if (id === "./channel-listener") return { watchedChannel: () => ({ channel: { myAgentToolProfile: "full" } }) };
    if (id === "./targeting") return { resolveLaunchToolProfile: () => "full" };
    if (id === "./runtime/launch-default") {
      return { ...LD, resolveLaunchRuntime: (a) => LD.resolveLaunchRuntime(a, { registry: fakeRegistry(), channelRuntime: require(M("channel-runtime.js")) }) };
    }
    return require(join(MAIN, id));
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", require("node:fs").readFileSync(M("session-launch-op.js"), "utf8"))(stub, mod, mod.exports);
  const res = await mod.exports.launchFromButton({ channelId: CH, taskId: "", runtime: "codex" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(launches[0].runtime, "codex");
  assert.deepEqual(launches[0].startModes, { tools: "never", messages: "auto_inbound", native: { sandbox_mode: "read-only" } });
  await mod.exports.launchFromButton({ channelId: CH, taskId: "" });
  assert.equal(launches[1].runtime, "claude", "no pick: the channel's runtime");
  assert.equal(launches[1].startModes.tools, "bypass");
  const refused = await mod.exports.launchFromButton({ channelId: CH, taskId: "", runtime: "borg" });
  assert.deepEqual(refused, { ok: false, reason: "no-sdk" }, "an explicit pick this build cannot run is refused, never swapped");
  assert.equal(launches.length, 2);
});

// ── 4. THE AGENT WINDOW'S SELECT IS A PER-AGENT PICK (C2) ─────────────────────────────────────

test("C2: sessions:setMode hands the RAW word to the session (validated there) as a pinned pick", () => {
  const handlers = {};
  const sent = [];
  const stub = (id) => {
    if (id === "electron") return { ipcMain: { handle: (n, fn) => { handlers[n] = fn; } } };
    if (id === "./ipc-guards") return { isAppWindowSender: () => true, isUuid: require(M("ipc-guards.js")).isUuid };
    if (id === "./session-engine") return { setModeByTask: (a) => { sent.push(a); return { ok: true }; } };
    if (id === "./diag") return { diag: () => {} };
    return require(join(MAIN, id));
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", require("node:fs").readFileSync(M("session-ipc-ops.js"), "utf8"))(stub, mod, mod.exports);
  mod.exports.register({ getSenderIds: () => new Set([1]) });
  handlers["sessions:setMode"]({}, { channelId: CH, taskId: "", agentId: "a1b2c3d4", axis: "tools", mode: "never" });
  assert.equal(sent[0].mode, "never", "not pre-coerced against the default runtime's words at the boundary");
  assert.equal(sent[0].pinned, true);
  handlers["sessions:setMode"]({}, { channelId: CH, axis: "tools", mode: { toString: () => "bypass" } });
  assert.equal(sent[1].mode, "", "a non-string is no word at all (the session fail-closes it)");
});

// ── 5. THE DELIBERATE CODEX POLICY REACHES THE APP-SERVER (X-01) ─────────────────────────────

test("X-01: `never` reaches the app-server as the deliberate granular policy, through the real spawn", () => {
  // "`never` is sent as `granular`" (`runtime/codex/policy.js`) was dead in production: the core
  // state coerced `never` to Claude's `manual`, so every Codex session launched `untrusted`.
  const launchSpec = require(M("runtime/codex/launch-spec.js"));
  const st = startedStateFor({ windowless: true, startModes: { tools: "never", messages: "ask" } }, { id: "codex" });
  const pair = launchSpec.nativePair({ state: st }, registry.runtimeFor("codex").toolConfigFor("full"));
  assert.deepEqual(pair.approval_policy, launchSpec.approvalPolicy("never"));
  assert.equal(typeof pair.approval_policy, "object", "the granular OBJECT, not the `untrusted` string");
});
