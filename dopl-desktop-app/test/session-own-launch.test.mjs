// THE OWN-MACHINE LAUNCH LANE (Samuel's ruling, 2026-08-25) — F-320's fix, driven end to end.
//
// THE DEFECT, as the orchestrator that filed it received it. A windowless desktop-run session
// called `dopl_channel(op="launch_agent")` to put its workers in visible windows and was told:
// "This tool needs a permission prompt and this session has no surface to show one on, so the
// call was refused automatically." The op was on NO lane, so it fell through to the Axis-A gate,
// and a windowless session answers a gate with `deny` — in EVERY posture, with nothing an
// operator could set. The remedy the refusal named (widen the tool posture) could not work.
//
// THE RULE. An own-channel `launch_agent` is admitted under BOTH axes together — tools `bypass`
// AND messages auto-outbound — and it carries a RECURSION BOUND: a session may ask only while it
// is under `MAX_LAUNCH_DEPTH`, which only the operator's own New Agent button sets to 0.
// The whole argument (and why this is not the outbound lane) is `main/session-own-launch.js`.
//
// SOURCE-OF-TRUTH IDIOM, like session-channel-read.test.mjs: the REAL modules, driven directly.
// No copy of the table, no fixture standing in for a rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const read = (p) => readFileSync(M(p), "utf8");

const lane = require(M("session-own-launch.js"));
const profiles = require(M("session-profiles.js"));
const perms = require(M("session-permissions.js"));
const io = require(M("session-io.js"));
const { GATE_REASONS } = require(M("session-gate-reason.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

const CH = "ch1";
const LAUNCH = { op: "launch_agent", goal: "staff this channel" };
const decide = (over) => profiles.grantDecision({ profile: "full", channelId: CH, ...over });
const detail = (over) => profiles.grantDecisionDetail({ profile: "full", channelId: CH, ...over });
const launchArgs = (over) => ({ toolName: DOPL_CHANNEL_TOOL, input: LAUNCH, launchDepth: 0, ...over });

const TOOL_MODES = profiles.TOOL_MODES;
const MESSAGE_MODES = profiles.MESSAGE_MODES;
const AUTO_OUT = ["auto_outbound", "auto_both"];
const NOT_AUTO_OUT = MESSAGE_MODES.filter((m) => !AUTO_OUT.includes(m));

// ── A. THE LANE MODULE ITSELF (pure) ──────────────────────────────────────────────

test("the op list is EXACTLY `launch_agent`, and it is an ALLOW list of one", () => {
  assert.deepEqual(lane.OWN_MACHINE_LAUNCH_OPS, ["launch_agent"]);
  // ⚠ THE ADMISSION IS NAMED, NEVER INFERRED: an op in no list gates in every posture, which is
  // the safe direction, so this must never grow by pattern-match or by prefix.
  for (const op of ["launch", "launch_agents", "spawn_agent", "post", "open", "invite", ""]) {
    assert.equal(lane.isOwnMachineLaunch({ op }, CH), false, `${op} must not reach the lane`);
  }
});

test("the lane is DISJOINT from the outbound and the read halves of Axis B", () => {
  // F-320's own argument: a launch is not outbound CONTENT and is not a read. Three lanes.
  for (const op of lane.OWN_MACHINE_LAUNCH_OPS) {
    assert.ok(!profiles.OWN_CHANNEL_OUTBOUND_OPS.includes(op), `${op} is not outbound content`);
    assert.ok(!profiles.OWN_CHANNEL_READ_OPS.includes(op), `${op} is not a read`);
  }
});

test("the scope is the CHANNEL, BY ID — a slug is another channel, exactly like a post", () => {
  assert.equal(lane.isOwnMachineLaunch({ op: "launch_agent" }, CH), true, "unset -> own channel");
  assert.equal(lane.isOwnMachineLaunch({ op: "launch_agent", channel: "" }, CH), true);
  assert.equal(lane.isOwnMachineLaunch({ op: "launch_agent", channel: CH }, CH), true);
  assert.equal(lane.isOwnMachineLaunch({ op: "launch_agent", channel: "my-slug" }, CH), false);
  assert.equal(lane.isOwnMachineLaunch({ op: "launch_agent", channel: "ch2" }, CH), false);
  // An agent must not be able to staff a room it is not in — and that includes gating in EVERY
  // posture, not merely classifying differently.
  for (const toolMode of TOOL_MODES) {
    for (const messageMode of MESSAGE_MODES) {
      assert.equal(decide(launchArgs({ input: { op: "launch_agent", channel: "ch2" }, toolMode, messageMode })),
        "gate", `${toolMode}/${messageMode}: a cross-channel launch always gates`);
    }
  }
});

test("normalizeLaunchDepth FAILS CLOSED — absent, junk and negatives all read as the cap", () => {
  assert.equal(lane.MAX_LAUNCH_DEPTH, 1, "one generation (see the module header for why not 2)");
  assert.equal(lane.normalizeLaunchDepth(0), 0, "the one value that means a human started it");
  assert.equal(lane.normalizeLaunchDepth(1), 1);
  for (const junk of [undefined, null, NaN, Infinity, -1, -0.5, "0", "", {}, [], true, false]) {
    assert.equal(lane.normalizeLaunchDepth(junk), lane.MAX_LAUNCH_DEPTH,
      `${JSON.stringify(String(junk))} must read as the cap, never as zero`);
  }
  assert.equal(lane.normalizeLaunchDepth(99), lane.MAX_LAUNCH_DEPTH, "clamped, never carried");
  assert.equal(lane.launchDepthExhausted(0), false);
  assert.equal(lane.launchDepthExhausted(undefined), true, "ABSENT IS THE CAP — the whole bound");
});

// ── B. THE ADMISSION, THROUGH THE REAL `grantDecision` ────────────────────────────

test("ADMITTED: tools `bypass` + messages auto-outbound, at depth 0 — the F-320 case", () => {
  for (const messageMode of AUTO_OUT) {
    assert.equal(decide(launchArgs({ toolMode: "bypass", messageMode })), "allow",
      `bypass/${messageMode}: an agent session may ask its own machine for an agent`);
  }
});

test("NEITHER AXIS ALONE ADMITS IT — the conjunction is the narrowness", () => {
  // Axis A alone: every tool posture, message axis short of auto-outbound.
  for (const toolMode of TOOL_MODES) {
    for (const messageMode of NOT_AUTO_OUT) {
      assert.equal(decide(launchArgs({ toolMode, messageMode })), "gate",
        `${toolMode}/${messageMode}: no TOOL posture may buy a launch on its own`);
    }
  }
  // Axis B alone: outbound wide open, tool posture short of `bypass`.
  for (const toolMode of TOOL_MODES.filter((m) => m !== "bypass")) {
    for (const messageMode of AUTO_OUT) {
      assert.equal(decide(launchArgs({ toolMode, messageMode })), "gate",
        `${toolMode}/${messageMode}: no MESSAGE posture may start a process on its own`);
    }
  }
});

test("HONEST GATE UNDER ASK: it stops on a decision, and it is not a DENY", () => {
  // ⚠ THE DISTINCTION F-320 IS ABOUT. `gate` means "a human is asked"; `deny` means "no answer
  // exists". Under ask-posture the operator has simply not widened anything, so the verdict must
  // be the refusable one — and the remedy the refusal names now actually works, because a
  // posture that admits this op exists at all.
  const v = detail(launchArgs({ toolMode: "bypass", messageMode: "ask" }));
  assert.equal(v.decision, "gate");
  assert.equal(v.reason, "launch-posture-required");
  assert.ok(GATE_REASONS.includes(v.reason), "the code is in the closed set");
});

// ── C. THE RECURSION BOUND ────────────────────────────────────────────────────────

test("THE BOUND DENIES, IN EVERY POSTURE, AND NO POSTURE OPENS IT", () => {
  for (const launchDepth of [1, 2, undefined, null, "0", -1]) {
    for (const toolMode of TOOL_MODES) {
      for (const messageMode of MESSAGE_MODES) {
        assert.equal(decide(launchArgs({ launchDepth, toolMode, messageMode })), "deny",
          `depth=${String(launchDepth)} ${toolMode}/${messageMode}: the bound is not posture-openable`);
      }
    }
  }
});

test("...and it says WHY: `launch-depth-capped`, never `hard-denied`", () => {
  // Reporting the bound as a profile deny would send an operator to a deny list that does not
  // contain `dopl_channel` — it is hard-denied on no profile at all.
  const v = detail(launchArgs({ launchDepth: 1, toolMode: "bypass", messageMode: "auto_both" }));
  assert.equal(v.decision, "deny");
  assert.equal(v.reason, "launch-depth-capped");
  assert.ok(GATE_REASONS.includes(v.reason));
  // A REAL hard-deny still reports as one.
  const hard = profiles.grantDecisionDetail({ profile: "full", channelId: CH, launchDepth: 0,
    toolName: "mcp__dopl__dopl_kb_admin", input: { op: "delete_base" }, toolMode: "bypass" });
  assert.equal(hard.decision, "deny");
  assert.equal(hard.reason, "hard-denied", "the profile's deny keeps its own code");
});

test("THE DEPTH TOUCHES THE LAUNCH LANE AND NOTHING ELSE", () => {
  // Every other channel op decides identically at depth 0 and at the cap: the bound is about how
  // many agents come into existence, not about what an agent may say or read.
  const others = [{ op: "post", body: "hi" }, { op: "read" }, { op: "milestone", body: "step" },
    { op: "create_thread", title: "t", body: "b" }, { op: "open" }, { op: "invite" }];
  for (const input of others) {
    for (const toolMode of TOOL_MODES) {
      for (const messageMode of MESSAGE_MODES) {
        const at0 = decide({ toolName: DOPL_CHANNEL_TOOL, input, toolMode, messageMode, launchDepth: 0 });
        const atCap = decide({ toolName: DOPL_CHANNEL_TOOL, input, toolMode, messageMode });
        assert.equal(at0, atCap, `${input.op} ${toolMode}/${messageMode} must not move with the depth`);
      }
    }
  }
  // ...and no WORK tool moves with it either.
  for (const tool of ["Bash", "Read", "Write", "WebFetch", "mcp__dopl__dopl_kb"]) {
    const input = tool === "Bash" ? { command: "ls" } : { file_path: "/x" };
    assert.equal(decide({ toolName: tool, input, toolMode: "bypass", launchDepth: 0 }),
      decide({ toolName: tool, input, toolMode: "bypass" }), `${tool} must not move with the depth`);
  }
});

// ── D. THE ALLOW IS AUDITABLE ─────────────────────────────────────────────────────

test("an admitted launch carries its OWN diag code — it is not narrated as a message", () => {
  const v = detail(launchArgs({ toolMode: "bypass", messageMode: "auto_both" }));
  assert.equal(v.decision, "allow");
  assert.equal(v.reason, "auto-launch-own-machine");
  assert.ok(GATE_REASONS.includes(v.reason));
  // The question an audit asks is "what left this machine with no click?" — and a launch is not
  // an answer to "what did my agent SAY", so it may not borrow an outbound code.
  for (const outboundCode of ["auto-outbound", "auto-outbound-marker", "auto-outbound-thread-open"]) {
    assert.notEqual(v.reason, outboundCode);
  }
});

// ── E. THE WIRING: the F-320 refusal path is unreachable for the admitted case ─────
//
// ⚠ WHY THIS IS THE TEST THAT MATTERS. The auto-deny lives in `session-windowless.js › claimGate`
// and it can only fire on a dispatched `permission_request`. An ADMITTED call resolves inside
// `makeCanUseTool` and dispatches NOTHING, so there is no payload for `claimGate` to claim and no
// resolver for it to deny. That is what "the refusal path is unreachable" means, mechanically.

function mkSession(over) {
  const o = over || {};
  return {
    profile: "full",
    channelId: CH,
    windowless: true, // the shape F-320 was measured on: no surface, so a gate IS a deny
    launchDepth: o.launchDepth,
    state: { allowForTask: [], toolMode: o.toolMode || "manual", messageMode: o.messageMode || "ask" },
    pendingPermissions: new Map(),
    pendingNames: new Map(),
  };
}
function recorder() {
  const events = [];
  return { events, dispatch: (_s, ev) => events.push(ev) };
}

test("ADMITTED: {allow}, NO dispatch, NO parked resolver — claimGate is never reached", async () => {
  const s = mkSession({ toolMode: "bypass", messageMode: "auto_both", launchDepth: 0 });
  const rec = recorder();
  const res = await io.makeCanUseTool(s, rec.dispatch)(DOPL_CHANNEL_TOOL, LAUNCH, { requestId: "L1" });
  assert.deepEqual(res, { behavior: "allow" });
  assert.equal(rec.events.length, 0, "nothing was dispatched, so nothing can be auto-denied");
  assert.equal(s.pendingPermissions.size, 0, "no resolver parked for claimGate to deny");
});

test("ASK: ONE permission_request, carrying the reason — refusable, not silent", async () => {
  const s = mkSession({ toolMode: "bypass", messageMode: "ask", launchDepth: 0 });
  const rec = recorder();
  const pending = io.makeCanUseTool(s, rec.dispatch)(DOPL_CHANNEL_TOOL, LAUNCH, { requestId: "L2" });
  assert.equal(rec.events.length, 1);
  assert.equal(rec.events[0].type, "permission_request");
  assert.equal(rec.events[0].payload.gateReason, "launch-posture-required",
    "the card and the notice say which posture is missing");
  // It is a real decision point: whoever answers it decides, and a deny is the operator's.
  s.pendingPermissions.get("L2")({ behavior: "deny", message: "x" });
  assert.equal((await pending).behavior, "deny");
});

test("CAPPED: an immediate deny carrying the BOUND's own sentence, not 'Blocked for this session'", async () => {
  const s = mkSession({ toolMode: "bypass", messageMode: "auto_both" }); // no depth => the cap
  const rec = recorder();
  const res = await io.makeCanUseTool(s, rec.dispatch)(DOPL_CHANNEL_TOOL, LAUNCH, { requestId: "L3" });
  assert.equal(res.behavior, "deny");
  assert.equal(res.message, perms.LAUNCH_DEPTH_DENY_MESSAGE);
  assert.equal(rec.events.length, 0, "nothing to ask — the bound is not a question");
  // The sentence has to stop the retry loop, so it must say all three things.
  assert.match(perms.LAUNCH_DEPTH_DENY_MESSAGE, /NOBODY WAS ASKED/);
  assert.match(perms.LAUNCH_DEPTH_DENY_MESSAGE, /re-issuing cannot succeed/);
  // ⚠ IT SAID `no setting will widen this` UNTIL 2026-08-31, AND SAMUEL'S AGENT-CHAINING RULING
  // FALSIFIED THAT CLAUSE. There is now exactly one setting that widens it — the channel's
  // chaining toggle — and a refusal that denies its own remedy is the defect class this whole
  // sentence exists to remove: the agent stops (correctly) and the operator never learns there
  // was a switch. ⚠ AND IT STILL MUST NOT INVITE A RETRY: the flag is a SPAWN-TIME stamp, so
  // flipping it cannot unblock THIS session, which is why "cannot succeed" is asserted above and
  // the remedy is addressed to a HUMAN rather than to the next tool call.
  assert.ok(!/no setting will widen this/.test(perms.LAUNCH_DEPTH_DENY_MESSAGE),
    "the falsified clause is gone, not softened");
  assert.match(perms.LAUNCH_DEPTH_DENY_MESSAGE, /your operator/);
  assert.match(perms.LAUNCH_DEPTH_DENY_MESSAGE, /agent-chaining setting/,
    "it NAMES the switch — a bound with an unnamed remedy is the same dead end");
  // ...and a hard-denied tool keeps the generic wording.
  const hard = await io.makeCanUseTool(mkSession({ toolMode: "bypass" }), recorder().dispatch)(
    "mcp__dopl__dopl_kb_admin", { op: "delete_base" }, { requestId: "L4" });
  assert.deepEqual(hard, { behavior: "deny", message: perms.BLOCKED_MESSAGE });
});

test("the AUTO-DENY remedy names BOTH axes — the old sentence was half an answer (F-320)", () => {
  // An agent whose operator widens only the tool axis retries and is refused by the other one.
  assert.match(perms.AUTO_DENY_MESSAGE, /TOOLS/);
  assert.match(perms.AUTO_DENY_MESSAGE, /MESSAGES/);
  assert.ok(!/session's tool posture/.test(perms.AUTO_DENY_MESSAGE), "the one-axis remedy is gone");
});

// ── F. WHERE DEPTH 0 COMES FROM, PINNED AT SOURCE ─────────────────────────────────
//
// ⚠ THE BOUND IS ONLY AS GOOD AS THE NUMBER OF LANES THAT MAY CLAIM ZERO, and that number is
// ONE. These pins are the enforcement: the funnel forwards without defaulting, the button says
// zero, and the two agent-driven spawn lanes say nothing at all (which reads as the cap).

test("exactly ONE lane in main/ claims depth 0, and it is the New Agent button", () => {
  const opSrc = read("session-launch-op.js");
  assert.match(opSrc, /launchDepth: 0,/, "the button lane says a human started this");
  const claimants = ["session-launch-op.js", "session-launch.js", "session-engine.js", "session-io.js",
    "launch-directives.js", "trigger.js", "session-park.js", "session-reopen.js", "session-ipc-ops.js"]
    .filter((f) => /launchDepth:\s*0\b/.test(read(f)));
  assert.deepEqual(claimants, ["session-launch-op.js"], "only the button may mint a depth-0 session");
});

test("the AGENT-DRIVEN spawn lanes pass NO depth, so their sessions are at the cap", () => {
  // ⚠ THE SILENCE IS LOAD-BEARING, which is why it is pinned. `launch-directives.js › spawn` is
  // the lane an orchestrator's own `launch_agent` comes back through; if it ever claimed a depth,
  // an agent could staff an agent that staffs an agent, forever.
  for (const f of ["launch-directives.js", "trigger.js"]) {
    assert.ok(!/launchDepth/.test(read(f)), `${f} must not set a launch depth`);
  }
  // The funnel FORWARDS and never defaults — a `|| 0` here would invert the bound in one word.
  const funnel = read("session-launch.js");
  assert.match(funnel, /launchDepth: a\.launchDepth,/);
  assert.ok(!/launchDepth: a\.launchDepth \|\|/.test(funnel), "no default, ever");
  // The engine stamps it on the session, and the gate reads it off there.
  assert.match(read("session-engine.js"), /launchDepth: spec\.launchDepth,/);
  assert.match(read("session-io.js"), /launchDepth: s\.launchDepth,/);
});

test("a RECREATE lands at the cap; an ordinary park+resume keeps the stamp", () => {
  // ⚠ TWO RESUME SHAPES, AND ONLY ONE OF THEM REBUILDS ANYTHING. `resumeParked` restarts the
  // query on the SAME session object, so the stamp is still there and an operator's orchestrator
  // survives going idle. `startResume` rebuilds the spec from the DURABLE RECORD — which does not
  // carry this field — so a crash recreate comes back at the cap, exactly as it comes back with a
  // fail-restrictive profile. Neither needs a rule; this pins that neither grew one.
  const park = read("session-park.js");
  assert.ok(!/launchDepth/.test(park), "the recreate must not resurrect a depth it cannot verify");
  assert.match(park, /function resumeParked\(s\)/, "the in-place resume still exists");
  const io = read("session-io.js");
  const record = io.slice(io.indexOf("function baseRecord(s) {"), io.indexOf("// The canUseTool bridge"));
  assert.ok(record.length > 0 && !/launchDepth/.test(record),
    "the durable projection carries no launch depth — that is WHY a recreate is capped");
});
