// AXIS A IS READ LIVE, LIKE AXIS B — the permission-inheritance bug (2026-09-16).
//
// THE DEFECT THIS PINS. Nothing was wrong with the RECORD; the stored pair reached a session ONLY
// as `spec.startModes` at spawn, and the shapes that hand NONE are the common ones — a reopen, a
// recreate, a crash resume, a peer wake, an abandoned shell rebuilt. Those all sat at the reducer's
// `manual`, which allows NO work tool, so every call gated while the Settings tab read Bypass.
// Axis B already answers this on the line below it, with a read at DECISION time
// (`session-private.js › effectiveMessageMode`); Axis A read `st.toolMode` and nothing else.
//
// WHAT IS NOT WIDENED. Hard-deny, the container-only path rules, the profile's own
// `disallowedTools` and the Axis-A/Axis-B split are all checked BEFORE `grantDecision` consults
// this value; `bypass` still reaches only `BYPASS_TOOLS`. This is SUPERVISION read live, which is
// what the 2026-08-31 ruling already granted the operator on the other axis.
//
// THE ONE PLACE IT IS STRICTER THAN AXIS B: an explicit `set_tool_mode` stamps `state.toolModeSet`,
// and a stamped session keeps its own pick — otherwise the channel record would silently undo an
// operator narrowing ONE live agent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const M = (p) => join(MAIN, p);
const read = (p) => readFileSync(M(p), "utf8");

const profiles = require(M("session-profiles.js"));
const io = require(M("session-io.js"));
const posture = require(M("launch-posture.js"));
const { initialSessionState, sessionReducer } = require(M("session-reducer.js"));

const CH = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const THREAD = "11111111-2222-3333-4444-555555555555";

// The state comes from the REAL `initialSessionState`, on the session's runtime's own word list —
// the only shape production builds.
const sess = (state = {}, over = {}) => {
  const runtimeId = over.runtimeId || "claude";
  const { toolMode = "manual", ...rest } = state;
  return {
    key: `${CH}:${THREAD}:a1b2c3d4`,
    agentId: "a1b2c3d4",
    channelId: CH,
    taskId: THREAD,
    profile: "full",
    runtimeId,
    state: {
      ...initialSessionState({ toolModes: profiles.toolModesFor(runtimeId), toolMode, messageMode: "auto_both" }),
      activity: "idle", ...rest,
    },
    ...over,
  };
};

// The pure block with the live read INJECTED — the only way to drive a STORED value in plain node,
// where `channel-prefs.js` cannot load (its electron-store) and `channelToolMode` answers `''`.
// Same source-extraction idiom `session-autosend-live.test.mjs` uses for the other axis.
const SRC = read("session-private.js");
const body = SRC.slice(
  SRC.indexOf("// ─── BEGIN SESSION-PRIVATE-PURE"),
  SRC.indexOf("// ─── END SESSION-PRIVATE-PURE")
);
const slice = (channelToolMode) =>
  new Function(
    "privateTurnMessageMode",
    "floorWindowlessMessage",
    "autoOutboundMode",
    "channelMessageMode",
    "channelToolMode",
    "narrowTo",
    "narrowMessageMode",
    `${body}\nreturn { effectiveToolMode };`
  )(
    profiles.privateTurnMessageMode,
    profiles.floorWindowlessMessage,
    profiles.autoOutboundMode,
    () => "",
    channelToolMode,
    posture.narrowTo,
    posture.narrowMessageMode
  );

/** The real gate, with Axis A re-derived through the sliced live read. */
const decideWith = (stored, s, toolName) =>
  profiles.grantDecision({
    ...io.grantArgs(s, toolName, {}),
    toolMode: slice(() => stored).effectiveToolMode(s),
  });

// ── 1. THE BUG ITSELF ───────────────────────────────────────────────────────────────────────

test("LIVE: a session frozen at `manual` runs Bash when the channel says bypass", () => {
  // THE REPORTED SYMPTOM, EXACTLY. Every startModes-less spawn shape lands here.
  const s = sess({ toolMode: "manual" });
  assert.equal(decideWith("bypass", s, "Bash"), "allow");
});

test("LIVE: it narrows as immediately as it widens — back to `manual` and Bash gates at once", () => {
  // THE OFF DIRECTION IS THE ONE A FROZEN COPY BREAKS SILENTLY. A session launched at `bypass` must
  // stop running shells the moment the operator narrows the channel, with no relaunch.
  const s = sess({ toolMode: "bypass" });
  assert.equal(decideWith("manual", s, "Bash"), "gate");
  assert.equal(decideWith("auto", s, "Bash"), "gate", "Bash is in BYPASS_TOOLS only");
  assert.equal(decideWith("auto", s, "Write"), "allow", "...and edits still run at auto");
});

test("LIVE: the real grantArgs fails CLOSED where the store cannot be read at all", () => {
  // Plain node has no electron-store, so `channelToolMode` answers `''` for every channel — the same
  // answer a hiccuping store gives on the machine. The frozen value must survive, and an unreadable
  // store must never become a grant.
  assert.equal(profiles.grantDecision(io.grantArgs(sess({ toolMode: "manual" }), "Bash", {})), "gate");
  assert.equal(profiles.grantDecision(io.grantArgs(sess({ toolMode: "bypass" }), "Bash", {})), "allow");
});

test("LIVE: an unreadable store falls back to the FROZEN value, never to a grant", () => {
  // `''` is "could not read"; `channel-prefs.getLaunchPosture` never answers null, so a channel
  // nobody configured is a real `manual` and is NOT this case.
  const s = sess({ toolMode: "bypass" });
  assert.equal(slice(() => "").effectiveToolMode(s), "bypass");
  assert.equal(slice(() => "").effectiveToolMode(sess({ toolMode: undefined })), "manual");
  assert.equal(slice(() => "").effectiveToolMode(null), "", "no session: no mode, which allows nothing");
  assert.equal(profiles.toolModeAllows("", "Bash"), false);
});

// ── 2. THE PER-SESSION PICK STILL WINS ──────────────────────────────────────────────────────

const pinTo = (s, mode) => ({ ...s, state: sessionReducer(s.state, { type: "set_tool_mode", mode, pinned: true }).state });

test("SET: a per-agent pick keeps its value against a wider channel record", () => {
  const s = pinTo(sess({ toolMode: "manual" }), "manual");
  assert.equal(slice(() => "bypass").effectiveToolMode(s), "manual");
  assert.equal(decideWith("bypass", s, "Bash"), "gate", "the operator narrowed THIS agent");
});

test("C2: a pick is NEVER wider than the channel — it narrows with it and comes back with it", () => {
  const s = pinTo(sess({ toolMode: "manual" }), "auto");
  assert.equal(slice(() => "bypass").effectiveToolMode(s), "auto", "the pick holds under a wider channel");
  assert.equal(slice(() => "manual").effectiveToolMode(s), "manual", "the channel narrowing wins at once");
  assert.equal(slice(() => "bypass").effectiveToolMode(s), "auto", "…and the pick is still the agent's");
});

test("C2 (Codex): a pick is ordered by CODEX's own ladder, not Claude's", () => {
  const s = sess({ toolMode: "never" }, { runtimeId: "codex" });
  const picked = { ...s, state: sessionReducer(s.state, { type: "set_tool_mode", mode: "granular", pinned: true }).state };
  assert.equal(picked.state.toolMode, "granular", "a Codex word survives the reducer on a Codex session");
  assert.equal(slice(() => "never").effectiveToolMode(picked), "granular");
  assert.equal(slice(() => "untrusted").effectiveToolMode(picked), "untrusted");
});

test("SET: only a PINNED set stamps the flag; the channel fan-out never does", () => {
  const s = sess({ toolMode: "manual" });
  const fanned = sessionReducer(s.state, { type: "set_tool_mode", mode: "bypass" }).state;
  assert.equal(fanned.toolModeSet, false, "a channel write is not an agent's pick (P3-02)");
  assert.equal(fanned.toolMode, "bypass");
  assert.equal(initialSessionState({}).toolModeSet, false, "an unpinned start posture is a default, not a pick");
  const picked = sessionReducer(s.state, { type: "set_tool_mode", mode: "auto", pinned: true }).state;
  assert.equal(picked.toolModeSet, true);
  const narrowed = sessionReducer(picked, { type: "set_tool_mode", mode: "manual" }).state;
  assert.deepEqual([narrowed.toolMode, narrowed.toolPick], ["manual", "auto"], "a fan-out narrows the stamp, keeps the pick");
  const widened = sessionReducer(narrowed, { type: "set_tool_mode", mode: "bypass" }).state;
  assert.equal(widened.toolMode, "auto", "and a wider channel never lifts it past the pick");
});

// ── 3. THE WIRING, IN THE SHIPPED SOURCE ────────────────────────────────────────────────────

test("WIRING: grantArgs reads Axis A through effectiveToolMode and nothing else", () => {
  const src = read("session-io.js");
  assert.match(src, /sessionPrivate\.effectiveToolMode\(s\)/);
  assert.doesNotMatch(src, /toolMode: s && s\.windowless === true \? floorWindowlessTool\(st\.toolMode/,
    "the frozen read is gone");
});

test("WIRING: the windowless floor is still applied AFTER the read, and only there", () => {
  // The Axis-A floor is the RUNTIME's and has ONE application site; a second spelling inside
  // `effectiveToolMode` is what `session-mode-floor.test.mjs` exists to prevent.
  assert.match(read("session-io.js"), /floorWindowlessTool\(sessionPrivate\.effectiveToolMode\(s\), s\.runtimeId\)/);
  assert.doesNotMatch(SRC, /floorWindowlessTool\(/, "session-private.js CALLS no Axis-A floor");
  const s = sess({ toolMode: "manual" }, { windowless: true });
  assert.equal(io.grantArgs(s, "Read", {}).toolMode, "auto", "manual floors to auto with no surface");
});

test("WIRING: the live half checks PRESENCE first, exactly like its Axis-B twin", () => {
  // `getLaunchPosture` answers the restrictive DEFAULT for an unconfigured channel, so reading it
  // without `hasLaunchPosture` would make the default win over every session's launch posture.
  const block = SRC.slice(SRC.indexOf("function channelToolMode"));
  assert.match(block, /hasLaunchPosture\(channelId\)/);
  assert.ok(block.indexOf("hasLaunchPosture(channelId)") < block.indexOf("launchPostureFor(channelId, sessionRuntimeId(runtimeId))"),
    "presence first, then the SESSION runtime's record (never the selected runtime's)");
});
