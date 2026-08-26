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
import { fnOf } from "./helpers/source-probe.mjs";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const IPC = M("channel-dir-ipc.js");
const APPLY = fnOf(IPC, "applyPostureToLive");

const CH = "1c44bbdf-1965-4bea-af60-5e9e5aedaf57";
const OTHER = "0b018509-f29d-4e49-b1b5-1e2463db1829";
const WIDE = { tools: "bypass", messages: "auto_both" };

// ── the driver ───────────────────────────────────────────────────────────────
// The REAL `applyPostureToLive`, with the engine faked at the `require` seam it uses.
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
      throw new Error("unexpected require: " + name);
    };
    const diag = (...a) => { DIAGS.push(a.map(String).join(" ")); };
    ${APPLY}
    return applyPostureToLive(CHANNEL, PRESET);
  `;
  const applied = new Function("ENGINE", "THROWS", "DIAGS", "CHANNEL", "PRESET", body)(
    engine, opts.throws === true, diags, opts.channelId === undefined ? CH : opts.channelId,
    opts.preset === undefined ? WIDE : opts.preset
  );
  return { applied, calls, diags };
}

const row = (agentId, channelId = CH, taskId = "") => ({ channelId, taskId, agentId });

// ── 1. THE FAN-OUT ───────────────────────────────────────────────────────────

test("every live session in the channel takes BOTH axes of the new posture", () => {
  const r = runApply({ rows: [row("nu8ywb1s"), row("qkve5cr8"), row("q8tilt6l")] });
  assert.equal(r.applied, 3, "all three pre-flip agents moved");
  assert.equal(r.calls.length, 6, "two axes each — a tools-only apply is half a fix");
  for (const axis of ["tools", "messages"]) {
    const sent = r.calls.filter((c) => c.axis === axis);
    assert.equal(sent.length, 3);
    assert.deepEqual(sent.map((c) => c.mode), [WIDE[axis], WIDE[axis], WIDE[axis]]);
  }
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

test("a half-formed preset applies NOTHING — never one axis of a rejected pair", () => {
  for (const bad of [null, undefined, {}, { tools: "bypass" }, { messages: "auto_both" }]) {
    const r = runApply({ preset: bad });
    assert.equal(r.applied, 0);
    assert.equal(r.calls.length, 0);
  }
});

// ── 3. THE WIRING, AS SOURCE ─────────────────────────────────────────────────

test("the fan-out runs only AFTER the durable write succeeded, and never replaces it", () => {
  const handler = IPC.slice(IPC.indexOf("'channels:setLaunchPosture'"));
  const body = handler.slice(0, handler.indexOf("ipcMain.handle", 10));
  assert.match(body, /channelPrefs\.setLaunchPosture/, "the record is still written first");
  assert.match(body, /res\.ok !== true/, "a rejected write applies nothing to anything");
  assert.ok(body.indexOf("res.ok !== true") < body.indexOf("applyPostureToLive"),
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

test("no status emit falsely announces 'working' while a gate is held", () => {
  const gated = held(initialSessionState({}));
  const { effects } = sessionReducer(gated, POST("tu-2"));
  const statuses = effects.filter((e) => e.type === "emit" && e.payload && e.payload.type === "status");
  assert.deepEqual(statuses.map((e) => e.payload.activity).filter((a) => a === "working"), [],
    "a 'working' status emit here is the lie the operator read off the card");
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
