// THE OWN-MACHINE MANAGE LANE — `manage.rename` / `manage.end` / `manage.posture` (2026-09-17).
//
// THE DEFECT, as Samuel measured it in the field. A channel at tools=`bypass` /
// messages=`auto_both` — the posture the own-machine LAUNCH lane is written for — admitted an
// orchestrator's `manage(action="launch")` and then GATED the `manage(action="rename")` it issued
// against the agent it had just launched:
//
//   session gate: dopl_channel op=manage.rename gate channel-op-approval-required tool=bypass msg=auto_both
//
// **AND THERE IS NO SURFACE ON WHICH A HELD CHANNEL-OP GATE CAN BE ANSWERED**, so the
// orchestrator waits forever — F-320's defect class one op later, and not rare: the shipped Coder
// template has every coder rename itself on start.
//
// THE RULE. The three housekeeping actions take the LAUNCH LANE'S CONJUNCTION — tools `bypass`
// AND messages auto-outbound, own channel BY ID — and carry NO depth bound, because they create
// no agent and every session that renames itself is AT the cap by construction. The whole
// argument is `main/session-own-manage.js`.
//
// SOURCE-OF-TRUTH IDIOM, like session-own-launch/-direct: the REAL modules, driven directly.

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

const lane = require(M("session-own-manage.js"));
const launchLane = require(M("session-own-launch.js"));
const directLane = require(M("session-own-direct.js"));
const profiles = require(M("session-profiles.js"));
// ⚠ 2026-08-31 (runtime-adapter port, step 3): the HELD-CALLBACK WIRING and the platform's own
// reply vocabulary are the adapter's, so the end-to-end cases below drive the shipped callback
// from there, exactly as the two neighbouring lane suites do.
const axisB = require(M("runtime/claude/axis-b.js"));
const { GATE_REASONS } = require(M("session-gate-reason.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

const CH = "ch1";
// The three calls in the shape the MCP tool actually publishes: `channel` and `to` are REQUIRED
// on all three server-side (`channel-dispatch-agents.ts`), so a real one always names its room.
const RENAME = { op: "manage", action: "rename", channel: CH, to: "@agent-k3wpf7c5", name: "coder" };
const END = { op: "manage", action: "end", channel: CH, to: "@agent-k3wpf7c5" };
const POSTURE = { op: "manage", action: "posture", channel: CH, to: "@agent-k3wpf7c5",
  posture: { tools: "auto" } };
const CALLS = [["rename", RENAME], ["end", END], ["posture", POSTURE]];

const decide = (over) => profiles.grantDecision({ profile: "full", channelId: CH, ...over });
const detail = (over) => profiles.grantDecisionDetail({ profile: "full", channelId: CH, ...over });
const args = (input, over) => ({ toolName: DOPL_CHANNEL_TOOL, input, ...over });

const TOOL_MODES = profiles.TOOL_MODES;
const MESSAGE_MODES = profiles.MESSAGE_MODES;
const AUTO_OUT = ["auto_outbound", "auto_both"];
const NOT_AUTO_OUT = MESSAGE_MODES.filter((m) => !AUTO_OUT.includes(m));

// ── A. THE LANE MODULE ITSELF (pure) ──────────────────────────────────────────────

test("the keys are EXACTLY the three housekeeping actions, and it is an ALLOW list", () => {
  assert.deepEqual(lane.OWN_MACHINE_MANAGE_OPS, ["manage.rename", "manage.end", "manage.posture"]);
  // ⚠ NAMED, NEVER INFERRED: a call in no list gates in every posture, which is the safe
  // direction, so this must never grow by pattern-match or by prefix.
  for (const op of ["rename", "end", "posture", "rename_agent", "end_agent", "send", "manage", ""]) {
    assert.equal(lane.isOwnMachineManage({ op }, CH), false, `${op} must not reach the lane`);
  }
  // ⚠ AND THE BARE OP IS NOT ENOUGH: `manage` also dispatches `launch` (which carries the depth
  // bound) and `direct` (which buys a TURN), and admitting the dispatcher would open both
  // through a door written for neither.
  for (const action of ["launch", "direct", "open", ""]) {
    assert.equal(lane.isOwnMachineManage({ op: "manage", action }, CH), false,
      `manage.${action} must not reach the MANAGE lane`);
  }
});

test("it is DISJOINT from BOTH neighbouring lanes and from both halves of Axis B", () => {
  // ⚠ SAMENESS OF CONJUNCTION IS NOT A REASON TO MERGE — `session-own-direct.js`'s own argument,
  // applied a second time. Folding these into `OWN_MACHINE_LAUNCH_OPS` would make relabelling an
  // agent depend on the channel's agent-chaining setting and on a depth bound that has nothing to
  // say about labels; folding `launch` in HERE would hand a capped session the one op the bound
  // exists to refuse.
  for (const key of lane.OWN_MACHINE_MANAGE_OPS) {
    assert.ok(!launchLane.OWN_MACHINE_LAUNCH_OPS.includes(key), `${key} carries no depth bound`);
    assert.ok(!directLane.OWN_MACHINE_DIRECT_OPS.includes(key), `${key} is not a direction`);
    assert.ok(!profiles.OWN_CHANNEL_OUTBOUND_OPS.includes(key), `${key} is not outbound content`);
    assert.ok(!profiles.OWN_CHANNEL_READ_OPS.includes(key), `${key} is not a read`);
  }
  assert.ok(!lane.OWN_MACHINE_MANAGE_OPS.includes("manage.launch"));
  assert.ok(!lane.OWN_MACHINE_MANAGE_OPS.includes("manage.direct"));
});

test("the scope is the CHANNEL, BY ID — a slug is another room, exactly like a post", () => {
  for (const [name, call] of CALLS) {
    const bare = { op: call.op, action: call.action };
    assert.equal(lane.isOwnMachineManage(bare, CH), true, `${name}: unset -> own channel`);
    assert.equal(lane.isOwnMachineManage({ ...bare, channel: "" }, CH), true, name);
    assert.equal(lane.isOwnMachineManage({ ...bare, channel: CH }, CH), true, name);
    assert.equal(lane.isOwnMachineManage({ ...bare, channel: "my-slug" }, CH), false, name);
    assert.equal(lane.isOwnMachineManage({ ...bare, channel: "ch2" }, CH), false, name);
  }
});

test("the verdict asks NO depth question, and that absence is the FIX rather than an omission", () => {
  // ⚠ THE SESSIONS THIS LANE EXISTS FOR ARE ALL AT THE CAP. A launched agent carries no depth
  // stamp, and `normalizeLaunchDepth` reads absent AS the cap — so a depth question here would
  // DENY every self-rename the Coder template performs, re-filing the reported defect under a
  // code no posture can open. These three create no agent, so there is no generation to count.
  for (const launchDepth of [0, 1, 2, undefined, null, -1]) {
    assert.equal(lane.manageLaneVerdict({ toolMode: "bypass", launchDepth }, true), "allow",
      `depth=${String(launchDepth)} must not move a rename`);
  }
  // ...and nothing on this lane can answer `deny`: the not-admitted case is a POSTURE the
  // operator can widen, so it must stay the refusable verdict.
  for (const toolMode of TOOL_MODES) {
    for (const autoOutbound of [true, false]) {
      assert.notEqual(lane.manageLaneVerdict({ toolMode }, autoOutbound), "deny");
    }
  }
});

// ── B. THE ADMISSION, THROUGH THE REAL `grantDecision` ────────────────────────────

test("ADMITTED: tools `bypass` + messages auto-outbound — the 2026-09-17 field case", () => {
  for (const [name, input] of CALLS) {
    for (const messageMode of AUTO_OUT) {
      assert.equal(decide(args(input, { toolMode: "bypass", messageMode })), "allow",
        `${name} bypass/${messageMode}: an agent may keep house on its own machine`);
    }
  }
});

test("...AT THE LAUNCH CAP TOO, which is the shape the defect was reported on", () => {
  // The orchestrator's own workers are launched sessions (no depth stamp => the cap), and the
  // Coder template tells each of them to rename itself the moment it starts.
  for (const [name, input] of CALLS) {
    assert.equal(decide(args(input, { toolMode: "bypass", messageMode: "auto_both" })), "allow", name);
    assert.equal(decide(args(input, { toolMode: "bypass", messageMode: "auto_both", launchDepth: 1 })),
      "allow", `${name}: a capped session may still rename, end and re-posture`);
  }
  // ...while the LAUNCH beside it is still denied at the cap. The bound did not move.
  assert.equal(decide(args({ op: "manage", action: "launch", channel: CH, name: "w" },
    { toolMode: "bypass", messageMode: "auto_both", launchDepth: 1 })), "deny");
});

test("NEITHER AXIS ALONE ADMITS ONE — the conjunction is the narrowness", () => {
  for (const [name, input] of CALLS) {
    // Axis A alone: every tool posture, message axis short of auto-outbound.
    for (const toolMode of TOOL_MODES) {
      for (const messageMode of NOT_AUTO_OUT) {
        assert.equal(decide(args(input, { toolMode, messageMode })), "gate",
          `${name} ${toolMode}/${messageMode}: the ask LEAVES this machine as a directive row`);
      }
    }
    // Axis B alone: outbound wide open, tool posture short of `bypass`.
    for (const toolMode of TOOL_MODES.filter((m) => m !== "bypass")) {
      for (const messageMode of AUTO_OUT) {
        assert.equal(decide(args(input, { toolMode, messageMode })), "gate",
          `${name} ${toolMode}/${messageMode}: no MESSAGE posture may reach a local session`);
      }
    }
  }
});

test("CROSS-CHANNEL is UNCHANGED — it gates in every posture, id or slug", () => {
  for (const [name, input] of CALLS) {
    for (const channel of ["ch2", "my-slug"]) {
      for (const toolMode of TOOL_MODES) {
        for (const messageMode of MESSAGE_MODES) {
          assert.equal(decide(args({ ...input, channel }, { toolMode, messageMode })), "gate",
            `${name} -> ${channel} ${toolMode}/${messageMode}: another room is another room`);
        }
      }
    }
  }
});

test("THE NEIGHBOURING LANES DID NOT MOVE — launch and direct decide exactly as before", () => {
  const LAUNCH = { op: "manage", action: "launch", channel: CH, name: "worker" };
  const DIRECT = { op: "manage", action: "direct", channel: CH, to: "@agent-k3wpf7c5", body: "go" };
  for (const toolMode of TOOL_MODES) {
    for (const messageMode of MESSAGE_MODES) {
      const wantLaunch = toolMode === "bypass" && AUTO_OUT.includes(messageMode) ? "allow" : "gate";
      assert.equal(decide(args(LAUNCH, { toolMode, messageMode, launchDepth: 0 })), wantLaunch,
        `launch ${toolMode}/${messageMode}`);
      assert.equal(decide(args(LAUNCH, { toolMode, messageMode })), "deny",
        `launch ${toolMode}/${messageMode}: the depth bound still denies, in every posture`);
      const wantDirect = toolMode === "bypass" && AUTO_OUT.includes(messageMode) ? "allow" : "gate";
      assert.equal(decide(args(DIRECT, { toolMode, messageMode })), wantDirect,
        `direct ${toolMode}/${messageMode}`);
    }
  }
});

// ── C. THE VERDICTS ARE AUDITABLE, AND THE GATE IS HONEST ─────────────────────────

test("each admitted action carries its OWN diag code — it is not narrated as a message", () => {
  const want = { rename: "auto-rename-own-machine", end: "auto-end-own-machine",
    posture: "auto-posture-own-machine" };
  for (const [name, input] of CALLS) {
    const v = detail(args(input, { toolMode: "bypass", messageMode: "auto_both" }));
    assert.equal(v.decision, "allow");
    assert.equal(v.reason, want[name]);
    assert.ok(GATE_REASONS.includes(v.reason), "the code is in the closed set");
    // ⚠ THREE CODES AND NOT ONE, because the delivery end already separates these verbs: the
    // posture one sits behind the operator's launch toggle and the other two do not.
    assert.equal(lane.MANAGE_ALLOW_REASONS[`manage.${name}`], want[name]);
    // Nothing left this machine as CONTENT, so none of them may borrow an outbound code — the
    // same rule `auto-launch-own-machine` is held to.
    for (const outbound of ["auto-outbound", "auto-outbound-marker", "auto-outbound-thread-open",
      "auto-outbound-escalate", "auto-outbound-artifact", "auto-launch-own-machine"]) {
      assert.notEqual(v.reason, outbound);
    }
  }
  // ...and the three codes are distinct, so an audit can tell a STOP from a RELABEL.
  assert.equal(new Set(Object.values(want)).size, 3);
});

test("THE DISHONEST GATE IS GONE: `manage-posture-required`, not `channel-op-approval-required`", () => {
  // ⚠ THE REPORTED LINE, REPRODUCED. The old code's sentence — "message approval covers this
  // channel's messages, not this operation" — was false twice over: the fix is TWO postures, and
  // the approval it names has no surface to be given on.
  for (const [name, input] of CALLS) {
    for (const over of [{ toolMode: "bypass", messageMode: "ask" },
      { toolMode: "auto", messageMode: "auto_both" },
      { toolMode: "manual", messageMode: "auto_outbound" }]) {
      const v = detail(args(input, over));
      assert.equal(v.decision, "gate", name);
      assert.equal(v.reason, "manage-posture-required",
        `${name} ${over.toolMode}/${over.messageMode}: the operator's fix is TWO settings`);
      assert.ok(GATE_REASONS.includes(v.reason));
    }
  }
});

test("...and a CROSS-CHANNEL manage still says `channel-op-approval-required`, honestly", () => {
  // It named another room, so no posture of THIS session's is the fix — the same fall-through a
  // cross-channel launch takes.
  for (const [name, input] of CALLS) {
    const v = detail(args({ ...input, channel: "ch2" },
      { toolMode: "bypass", messageMode: "auto_both" }));
    assert.equal(v.decision, "gate", name);
    assert.equal(v.reason, "channel-op-approval-required", name);
  }
});

test("the LAUNCH lane's own codes are untouched on both sides", () => {
  const LAUNCH = { op: "manage", action: "launch", channel: CH, name: "worker" };
  assert.equal(detail(args(LAUNCH, { toolMode: "bypass", messageMode: "auto_both", launchDepth: 0 })).reason,
    "auto-launch-own-machine");
  assert.equal(detail(args(LAUNCH, { toolMode: "bypass", messageMode: "ask", launchDepth: 0 })).reason,
    "launch-posture-required");
  assert.equal(detail(args(LAUNCH, { toolMode: "bypass", messageMode: "auto_both" })).reason,
    "launch-depth-capped");
});

// ── D. THE WIRING: the auto-deny path is unreachable for the admitted case ─────────
//
// ⚠ WHY THIS IS THE TEST THAT MATTERS. The refusal Samuel measured is not a card nobody clicked;
// it is `session-windowless.js › claimGate` auto-denying a dispatched `permission_request`. An
// ADMITTED call resolves inside `makeCanUseTool` and dispatches NOTHING, so there is no payload
// to claim and no resolver to deny.

function mkSession(over) {
  const o = over || {};
  return {
    profile: "full",
    channelId: CH,
    windowless: true, // the shape the defect was measured on: no surface, so a gate IS a deny
    launchDepth: o.launchDepth,
    state: { allowForTask: [], toolMode: o.toolMode || "manual", messageMode: o.messageMode || "ask" },
    pendingPermissions: new Map(),
    pendingNames: new Map(),
  };
}

test("ADMITTED: {allow}, NO dispatch, NO parked resolver — even at the launch cap", async () => {
  for (const [name, input] of CALLS) {
    const s = mkSession({ toolMode: "bypass", messageMode: "auto_both" }); // no depth => the cap
    const events = [];
    const res = await axisB.makeCanUseTool(s, (_s, ev) => events.push(ev))(
      DOPL_CHANNEL_TOOL, input, { requestId: `M-${name}` });
    assert.deepEqual(res, { behavior: "allow" }, name);
    assert.equal(events.length, 0, `${name}: nothing dispatched, so nothing can be auto-denied`);
    assert.equal(s.pendingPermissions.size, 0, `${name}: no resolver parked for claimGate`);
  }
});

test("NOT ADMITTED: ONE permission_request carrying the HONEST reason — refusable, not silent", async () => {
  const s = mkSession({ toolMode: "auto", messageMode: "auto_both" });
  const events = [];
  const pending = axisB.makeCanUseTool(s, (_s, ev) => events.push(ev))(
    DOPL_CHANNEL_TOOL, RENAME, { requestId: "M9" });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "permission_request");
  assert.equal(events[0].payload.gateReason, "manage-posture-required",
    "the card and the notice say which postures are missing");
  s.pendingPermissions.get("M9")({ behavior: "deny", message: "x" });
  assert.equal((await pending).behavior, "deny");
});

// ── E. THE DISCIPLINE PINS ────────────────────────────────────────────────────────

test("the lane holds no identity concept — whose machine is reached is not its question", () => {
  // It classifies an ASK. It has no operator id, no credential and no registry, so there is no
  // shape of this module that could widen WHOSE machine may be addressed: a directive is stamped
  // with the caller's own `operator_user_id` server-side and only their machines claim it.
  const src = read("session-own-manage.js");
  const executable = src.split("const { channelOpKey } = require")[1] || "";
  assert.ok(!/operatorUserId|getUserId|credential|token/i.test(executable),
    "the executable half must not have grown an identity concept");
});

test("the gate's ORDER is mirrored by the explainer, which is what keeps it true", () => {
  const gate = read("session-profiles.js");
  const launchAt = gate.indexOf("isOwnMachineLaunch(a.input, a.channelId)) return launchLaneVerdict");
  const directAt = gate.indexOf("isOwnMachineDirect(a.input, a.channelId)) return directLaneVerdict");
  const manageAt = gate.indexOf("isOwnMachineManage(a.input, a.channelId)) return manageLaneVerdict");
  assert.ok(launchAt !== -1 && directAt > launchAt && manageAt > directAt,
    "launch, then direct, then manage");
  const why = read("session-gate-reason.js");
  const gLaunch = why.indexOf("return 'launch-posture-required'");
  const gManage = why.indexOf("return 'manage-posture-required'");
  const gCross = why.indexOf("return 'channel-op-approval-required'");
  assert.ok(gLaunch !== -1 && gManage > gLaunch && gCross > gManage,
    "the explainer asks them in the gate's order, and the cross-channel fall-through is LAST");
});

test("🔒 THE DELIVERY END'S PER-KIND CONSENT IS UNTOUCHED — widening a gate moved no consent", () => {
  // ⚠ ADMITTING THE ASK IS NOT ADMITTING THE ACT. `manage.posture` rides the mailbox as
  // `set_agent_mode`, which is behind the operator's machine-local launch toggle; `end` and
  // `rename` are outside it because a STOP verb and a DISPLAY verb spend no compute. On a machine
  // with that toggle off an ADMITTED posture ask still changes nothing and the row expires.
  const wire = read("launch-directive-wire.js");
  assert.match(wire, /KINDS_NEEDING_LAUNCH_CONSENT/);
  const directives = read("launch-directives.js");
  assert.match(directives,
    /if \(wire\.KINDS_NEEDING_LAUNCH_CONSENT\.indexOf\(d\.kind\) !== -1 && !launchEnabled\(\)\) return;/);
  // ...and this lane's CODE says nothing about any of it. ⚠ COMMENTS STRIPPED FIRST, on
  // `session-own-launch.test.mjs`'s 2026-09-05 correction: the header NAMES that consent split in
  // order to explain why admitting the ask is not admitting the act, and a raw regex over the file
  // text would redden the very invariant the prose documents.
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const executableSrc = stripComments(read("session-own-manage.js"));
  assert.ok(executableSrc.length > 0);
  assert.ok(!/launchEnabled|getOrchestratorLaunch|KINDS_NEEDING/.test(executableSrc),
    "the classifier must not grow an opinion about the delivery end's consent");
});
