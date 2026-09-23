// PERMISSION SETTINGS MUST APPLY TO RUNNING SESSIONS (Samuel, 2026-08-25).
//
// THE INCIDENT. A channel had six windowless agents working in it. The operator opened the
// channel's Settings tab and moved the durable launch posture to Tools=Bypass /
// Messages=auto_both. The three agents spawned AFTERWARDS posted freely. The three spawned
// BEFORE went on gating every post against the posture they had launched under — each one
// bridging to a consent row and holding — while the Settings tab displayed the new pair. The
// operator changed a setting and the room ignored it.
//
// Reproduced from that machine's own listener.log, where the two cohorts are one line apart:
//
//   18:35:17  channel-prefs posture 1c44bbdf bypass auto_both          <- the operator's change
//   18:39:12  session gate: dopl_channel op=post gate message-approval-required tool=manual msg=auto_inbound
//   18:43:09  session gate: dopl_channel op=post allow auto-outbound   tool=bypass msg=auto_both
//
// Same channel, same second-scale window, two different postures, because the pair is read at
// SPAWN and never again.
//
// THE FIX IS A FAN-OUT, NOT A NEW MECHANISM, and §1 pins that. main already had a correct
// live-apply op — `session-reopen.js › setModeByTask`, which moves ONE running session's axes
// through the reducer's own `set_tool_mode` / `set_message_mode`, and `session-io.js › grantArgs`
// reads both axes off `s.state` at CALL time. What was missing is that
// `channel-dir-ipc.js › channels:setLaunchPosture` wrote the durable record and stopped.
//
// §2 pins the SECOND half of the same complaint, which is a display truth rule and is filed
// separately below.
//
// Run: `node --test dopl-desktop-app/test/channel-posture-live.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { between, fnOf, orderOf } from "./helpers/source-probe.mjs";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const IPC = M("channel-dir-ipc.js");
const APPLY = fnOf(IPC, "applyPostureToLive");

const CH = "1c44bbdf-1965-4bea-af60-5e9e5aedaf57";
const OTHER = "0b018509-f29d-4e49-b1b5-1e2463db1829";
const require = createRequire(import.meta.url);
const REGISTRY = require(join(HERE, "..", "main", "runtime", "index.js"));
const SELECTION = require(join(HERE, "..", "main", "launch-selection.js"));

// Two stored selections: what the record was, and what the write made it.
const SEL = (over = {}) => ({ v: 2, runtime: "", messages: "ask", byRuntime: {}, ...over });
const BEFORE = SEL();
const WIDE = SEL({ messages: "auto_both", byRuntime: { claude: { tools: "bypass" } } });

// ── the driver ───────────────────────────────────────────────────────────────
// The REAL `applyPostureToLive`, with the engine faked at the `require` seam it uses; the
// registry and the selection shape are the real modules.
function runApply(opts) {
  const calls = [];
  const diags = [];
  const engine = {
    listLiveSessions: opts.listLiveSessions === null ? undefined : (opts.listLiveSessions || (() => opts.rows || [])),
    setModeByTask: opts.setModeByTask === null ? undefined : (opts.setModeByTask || ((a) => {
      calls.push(a);
      return { ok: true };
    })),
  };
  const body = `
    const require = (name) => {
      if (name === './session-engine') { if (THROWS) throw new Error("boom"); return ENGINE; }
      if (name === './runtime') return REGISTRY;
      throw new Error("unexpected require: " + name);
    };
    const diag = (...a) => { DIAGS.push(a.map(String).join(" ")); };
    ${APPLY}
    return applyPostureToLive(CHANNEL, BEFORE_SEL, AFTER_SEL);
  `;
  const applied = new Function("ENGINE", "THROWS", "DIAGS", "CHANNEL", "BEFORE_SEL", "AFTER_SEL", "REGISTRY", "selectionShape", body)(
    engine, opts.throws === true, diags, opts.channelId === undefined ? CH : opts.channelId,
    opts.before === undefined ? BEFORE : opts.before, opts.after === undefined ? WIDE : opts.after,
    REGISTRY, SELECTION
  );
  return { applied, calls, diags };
}

const row = (agentId, channelId = CH, taskId = "", runtimeId = "claude") => ({ channelId, taskId, agentId, runtimeId });

// ── 1. THE FAN-OUT ───────────────────────────────────────────────────────────

test("every live session in the channel takes BOTH axes of the new posture", () => {
  const r = runApply({ rows: [row("nu8ywb1s"), row("qkve5cr8"), row("q8tilt6l")] });
  assert.equal(r.applied, 3, "all three pre-flip agents moved");
  assert.equal(r.calls.length, 6, "two axes each — a tools-only apply is half a fix");
  assert.deepEqual(r.calls.filter((c) => c.axis === "tools").map((c) => c.mode), ["bypass", "bypass", "bypass"]);
  assert.deepEqual(r.calls.filter((c) => c.axis === "messages").map((c) => c.mode), ["auto_both", "auto_both", "auto_both"]);
});

test("⚠ agents are addressed BY AGENT ID, never by (channel, thread)", () => {
  // `resolveSession` takes the OLDEST live agent on a thread when no agentId is given, so a
  // thread-addressed fan-out would move ONE agent and silently skip its siblings — which in the
  // incident above is most of the room. Multiplayer is the normal case here, not the edge one.
  const r = runApply({ rows: [row("aaa", CH, "t1"), row("bbb", CH, "t1"), row("ccc", CH, "t1")] });
  assert.deepEqual([...new Set(r.calls.map((c) => c.agentId))].sort(), ["aaa", "bbb", "ccc"]);
  assert.equal(r.applied, 3, "three agents on ONE thread are three targets");
});

test("sessions in OTHER channels are untouched — the record is per channel", () => {
  const r = runApply({ rows: [row("mine"), row("theirs", OTHER), row("also", OTHER)] });
  assert.equal(r.applied, 1);
  assert.deepEqual([...new Set(r.calls.map((c) => c.channelId))], [CH]);
});

test("a session that settled between the listing and the dispatch is not counted", () => {
  // `setModeByTask` answers {ok:false, reason:'no-session'} for a settled session. Best-effort:
  // it is skipped, and the sessions that DID move are still reported.
  const r = runApply({
    rows: [row("live"), row("gone")],
    setModeByTask: (a) => (a.agentId === "gone" ? { ok: false, reason: "no-session" } : { ok: true }),
  });
  assert.equal(r.applied, 1);
});

test("no live sessions is a clean zero, not a failure", () => {
  assert.equal(runApply({ rows: [] }).applied, 0);
});

// ── 1b. ONLY WHAT CHANGED, ONLY WHERE IT APPLIES (P3-02) ─────────────────────

test("P3-02: Axis A reaches only sessions whose OWN runtime's record moved — Axis B reaches all", () => {
  // The Claude record moved to bypass. A Codex agent in the same room must not be handed a Claude
  // word (it used to be, coerced to `untrusted` and pinned there); it takes the messaging change.
  const r = runApply({ rows: [row("claude1"), row("codex1", CH, "", "codex")] });
  assert.deepEqual(r.calls.filter((c) => c.axis === "tools").map((c) => [c.agentId, c.mode]), [["claude1", "bypass"]]);
  assert.deepEqual(r.calls.filter((c) => c.axis === "messages").map((c) => c.agentId), ["claude1", "codex1"]);
});

test("P3-02: a Codex record write reaches Codex sessions in CODEX words", () => {
  const after = SEL({ runtime: "codex", byRuntime: { codex: { tools: "never" } } });
  const r = runApply({ rows: [row("claude1"), row("codex1", CH, "", "codex")], after });
  assert.deepEqual(r.calls.map((c) => [c.agentId, c.axis, c.mode]), [["codex1", "tools", "never"]]);
});

test("P3-02: a runtime SWITCH moves no running session at all", () => {
  // Claude -> Codex with neither record touched: no session's own-runtime record moved, and the
  // messaging axis did not either. It used to stamp every Claude agent `manual` + pinned.
  const before = SEL({ byRuntime: { claude: { tools: "bypass" } } });
  const after = SEL({ runtime: "codex", byRuntime: { claude: { tools: "bypass" } } });
  const r = runApply({ rows: [row("claude1"), row("codex1", CH, "", "codex")], before, after });
  assert.equal(r.calls.length, 0);
  assert.equal(r.applied, 0);
});

test("P3-02: a session with no stamped runtime reads the DEFAULT runtime's record", () => {
  const r = runApply({ rows: [row("old", CH, "", null)] });
  assert.deepEqual(r.calls.filter((c) => c.axis === "tools").map((c) => c.mode), ["bypass"]);
});

test("C2: the fan-out never stamps a per-agent pick", () => {
  const r = runApply({ rows: [row("a"), row("b", CH, "", "codex")] });
  assert.ok(r.calls.length > 0);
  assert.ok(r.calls.every((c) => c.pinned !== true), "a channel write is the channel's value, not an agent's pick");
});

// ── 2. THE DURABLE WRITE MUST NEVER BE TAKEN DOWN BY THE FAN-OUT ─────────────

test("a throwing engine returns what landed and does NOT propagate", () => {
  // The setting has ALREADY been persisted by the time this runs. A mid-wave build or a harness
  // with no engine bound must not turn a successful settings write into a failed one.
  const r = runApply({ rows: [row("a")], throws: true });
  assert.equal(r.applied, 0);
  assert.ok(r.diags.some((d) => /fan-out failed/.test(d)), "and it is diagnosed, not swallowed");
});

test("an engine without the two ops is a no-op, not a crash", () => {
  assert.equal(runApply({ rows: [row("a")], listLiveSessions: null }).applied, 0);
  assert.equal(runApply({ rows: [row("a")], setModeByTask: null }).applied, 0);
});

test("a missing record on either side applies NOTHING", () => {
  for (const [before, after] of [[null, WIDE], [BEFORE, null], [undefined, undefined]]) {
    const r = runApply({ before: before === undefined ? null : before, after: after === undefined ? null : after });
    assert.equal(r.applied, 0);
    assert.equal(r.calls.length, 0);
  }
});

// ── 3. THE WIRING, AS SOURCE ─────────────────────────────────────────────────

test("the fan-out runs only AFTER the durable write succeeded, and never replaces it", () => {
  const body = between(IPC, "'channels:setLaunchPosture'", "'channels:getAgentChain'");
  // ⚠ THE ONE VALIDATING WRITER IS `setLaunchSelection` SINCE 2026-09-21 (U5) — the runtime pick
  // is a FIELD of the same versioned record now rather than a second store write issued after the
  // pair, so a rejected write cannot half-apply a runtime. The property this case is about is
  // unchanged: the durable record is written first and the fan-out is guarded by its answer.
  assert.match(body, /channelPrefs\.setLaunchSelection/, "the record is still written first");
  assert.match(body, /res\.ok !== true/, "a rejected write applies nothing to anything");
  assert.ok(orderOf(body, "res.ok !== true", "applyPostureToLive"),
    "the ok-check must GUARD the fan-out, not follow it");
  assert.match(body, /applied:/, "and the count comes back so a caller can say what moved");
});

test("⚠ the fan-out reuses setModeByTask rather than writing the axes itself", () => {
  // That op is where the windowless message FLOOR (F-236) and the reducer's fail-closed coercion
  // live. A second writer to the same two fields is how two readers come to disagree about one
  // posture — and it would re-open the exact hole F-236 closed.
  assert.match(APPLY, /setModeByTask/);
  assert.ok(!/set_tool_mode|set_message_mode/.test(APPLY), "no direct reducer dispatch here");
  assert.ok(!/floorWindowless/.test(APPLY), "and no second copy of the floor");
});

// ── 4. THE DISPLAY HALF: A HELD GATE OUTRANKS "WORKING" ──────────────────────
//
// The other half of the same complaint — "stuck working · thinking, burning tokens, nothing
// lands". A windowless post that gates holds on a consent row for as long as the operator takes,
// and the reducer parks the session at `awaiting_permission`, which renders as "Waiting on you".
// But the `outbound_post` branch wrote `activity: 'working'` UNCONDITIONALLY, so the agent's NEXT
// post — a fresh turn fed by the channel fan-out while the FIRST was still undecided — flipped
// the card back to "Sending a message" with the row still pending. An agent that looks busy and
// is in fact stopped, waiting on the operator, with nothing saying so.

const { sessionReducer, initialSessionState, gateActivity } = loadReducer();

const POST = (id) => ({ type: "outbound_post", payload: { type: "outbound_post", toolUseId: id } });

function held(base) {
  // Drive the REAL gate event, so the held state is the one the engine really produces.
  return sessionReducer(base, {
    type: "permission_request",
    requestId: "req-1",
    name: "mcp__dopl__dopl_channel",
    payload: { type: "outbound_gate", requestId: "req-1", text: "hi" },
  }).state;
}

test("a post while a gate is HELD keeps the session at awaiting_permission", () => {
  const gated = held(initialSessionState({}));
  assert.equal(gated.activity, "awaiting_permission", "precondition: the gate parked it");
  const after = sessionReducer(gated, POST("tu-2")).state;
  assert.equal(after.activity, "awaiting_permission",
    "the second post must NOT claim the session is working");
  assert.equal(after.postedThisTurn, true, "and the post itself is still recorded");
  assert.ok(after.postedToolUseIds.includes("tu-2"), "F3's un-count ledger is unaffected");
});

test("with NOTHING pending a post still goes to working — the rule widens in one direction only", () => {
  const idle = initialSessionState({});
  const after = sessionReducer(idle, POST("tu-1")).state;
  assert.equal(after.activity, "working");
});

test("gateActivity holds awaiting_permission and never invents it", () => {
  assert.equal(gateActivity({ pendingPermissions: ["r"] }, "working"), "awaiting_permission");
  assert.equal(gateActivity({ pendingPermissions: [] }, "working"), "working");
  assert.equal(gateActivity({ pendingPermissions: [] }, "idle"), "idle", "it decides nothing else");
  for (const junk of [null, undefined, {}, { pendingPermissions: null }]) {
    assert.equal(gateActivity(junk, "working"), "working", "a malformed state is not a gate");
  }
});

test("once the gate is DECIDED the session goes back to working on the next post", () => {
  let s = held(initialSessionState({}));
  s = sessionReducer(s, { type: "permission_decision", requestId: "req-1", decision: "allow-once" }).state;
  assert.deepEqual(s.pendingPermissions, [], "precondition: nothing held");
  assert.equal(sessionReducer(s, POST("tu-3")).state.activity, "working");
});
