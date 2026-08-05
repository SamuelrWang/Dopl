// M3 (2026-08-05) — "I SET AUTOMATIC AND IT STILL ASKS ME", the channel half.
//
// THE DEFECT. AXIS B auto-allowed exactly one shape, an own-channel POST, and gated every other
// op on dopl_channel in every posture. So POSTING into the session's own channel ran with no card
// while READING that same channel asked: the more dangerous op was the permitted one. The
// production diag line was
//     session gate: dopl_channel gate channel-op-approval-required tool=bypass msg=auto_both
// with both axes wide open, and it did not even name the op — which is why this took code
// archaeology to find rather than ten seconds of reading the log (the `op=` field is M3's too;
// it is proved in session-gate-reason.test.mjs).
//
// THE RULE. Read-only ops SCOPED TO THE SESSION'S OWN CHANNEL follow the INBOUND half of Axis B.
// A read sends nothing off this machine; what it does is bring the peer's words into this agent's
// context without an operator seeing them first, which is precisely what auto_inbound consents to
// (the inbound gate makes the identical call about a pushed turn). `auto_outbound` alone therefore
// does NOT cover a read: "send my replies for me" is a statement about what LEAVES.
//
// Split out of session-permission-axes.test.mjs (§2 500-line cap) — same source-of-truth idiom:
// the REAL session-profiles module, driven directly, no copy of the table anywhere in here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const profiles = require(M("session-profiles.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

const CH = "ch1";
const decide = (over) => profiles.grantDecision({ profile: "full", channelId: CH, ...over });
const detail = (over) => profiles.grantDecisionDetail({ profile: "full", channelId: CH, ...over });
const READS = profiles.OWN_CHANNEL_READ_OPS;

// WHAT DELIBERATELY STAYS GATED IN EVERY POSTURE. Each one writes, addresses somebody, changes
// who is in the room, or reaches past the session's own channel — the v1.9 FIX H1 exfil surface,
// whose reasoning M3 does not touch. `list` is the interesting one: it is read-only AND it stays,
// because it enumerates every channel and DM this account can reach, so it is not own-channel
// scoped at all. `close_thread` is in the enum only to earn a teaching refusal; it gates too.
// REQUIREMENT CHANGE, M4 (2026-08-05, F-139): `propose_close` and `milestone` LEFT this set.
// They are own-channel CONTENT ops, strictly less powerful than the `post` that `auto_outbound`
// already auto-allows into the same channel — a proposal closes nothing (the operator's confirm
// is the consent point and is untouched) and a milestone carries no deliverable. Gating them
// cost a click per exchange and removed no consent point. They are pinned under the OUTBOUND
// half below; `close_thread` stays here, unconditionally, and is never conflated with its
// proposal. Everything else in this list is unchanged from M3.
// The six named-agent / breakout ops that were listed here (`join_thread`, `leave_thread`,
// `summon_agent`, `rename_agent`, `set_agent_status`, `disengage_agent`) are gone with the
// tool's own enum (channels rollback §1), and naming ops the tool does not publish would make
// this table read as coverage it does not have.
const ALWAYS_GATED = ["open", "invite", "create_thread", "close_thread",
  "set_thread_mode", "list"];
// M4: the two ops that moved, kept as their own name so every test below can say which is which.
const MARKERS = ["propose_close", "milestone"];

// ── the read set ──────────────────────────────────────────────────────────────────

test("M3: the read set is exactly the own-channel READ-ONLY ops, and nothing else", () => {
  // `agents` was a seventh read — the channel's named-agent roster — and went with the op.
  assert.deepEqual(READS, ["read", "await", "list_threads", "get_thread", "members"]);
  for (const op of ALWAYS_GATED.concat(MARKERS)) {
    assert.ok(!READS.includes(op), `${op} must never be classified as a read`);
  }
  assert.ok(!READS.includes("post"), "a post is the OUTBOUND half's business");
  // M4: and the marker set is disjoint from the read set in the other direction too — a
  // marker WRITES, so it can never be reached by the inbound half of the axis.
  assert.deepEqual(profiles.OWN_CHANNEL_MARKER_OPS, MARKERS);
  for (const op of MARKERS) assert.ok(!READS.includes(op), `${op} is outbound, not a read`);
});

test("M3: an own-channel read is ALLOWED under auto_inbound / auto_both and GATES under ask", () => {
  for (const op of READS) {
    assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op }, messageMode: "auto_both" }), "allow", op);
    assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op }, messageMode: "auto_inbound" }), "allow", op);
    assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op }, messageMode: "ask" }), "gate", op);
    // The outbound half is about what leaves; it does not answer a read.
    assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op }, messageMode: "auto_outbound" }), "gate", op);
  }
});

test("M3: own-channel means BY ID — absent, empty and the session's own id, exactly like a post", () => {
  for (const op of READS) {
    for (const channel of [undefined, null, "", CH]) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op, channel }, messageMode: "auto_both" }),
        "allow", `${op} @ channel=${String(channel)}`);
    }
    // A SLUG is classified as another channel — the safe failure isOwnChannelPost already takes.
    for (const channel of ["other-id", "my-slug", "OTHER"]) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op, channel }, messageMode: "auto_both" }),
        "gate", `${op} @ channel=${channel}`);
    }
  }
});

test("M3: the classifier itself, so the rule is provable without going through a decision", () => {
  assert.equal(profiles.isOwnChannelRead({ op: "read" }, CH), true);
  assert.equal(profiles.isOwnChannelRead({ op: "read", channel: CH }, CH), true);
  assert.equal(profiles.isOwnChannelRead({ op: "read", channel: "OTHER" }, CH), false);
  assert.equal(profiles.isOwnChannelRead({ op: "post" }, CH), false, "a post is never a read");
  assert.equal(profiles.isOwnChannelRead({ op: "open" }, CH), false);
  assert.equal(profiles.isOwnChannelRead({}, CH), false);
  assert.equal(profiles.isOwnChannelRead(undefined, CH), false);
  assert.equal(profiles.isOwnChannelRead({ op: 7 }, CH), false, "a non-string op is not an op");
});

// ── what did NOT move ─────────────────────────────────────────────────────────────

test("M3: every channel-CHANGING op still gates at auto_both, exactly as before", () => {
  for (const op of ALWAYS_GATED) {
    for (const messageMode of profiles.MESSAGE_MODES) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op, direct: true, member: "evil@x" }, messageMode }),
        "gate", `${op} @ ${messageMode}`);
    }
  }
  // The two shapes the operator complaint is most likely to be confused with.
  assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "post", channel: "other", body: "x" }, messageMode: "auto_both" }),
    "gate", "a cross-channel post is still the exfil surface");
  assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "open", direct: true, member: "evil@x" }, messageMode: "auto_both" }),
    "gate", "'read my own room' is not consent to open a DM with a stranger");
  // M4: close_thread is named EXPLICITLY, because the op beside it in the enum now auto-allows.
  // Closing settles a SHARED thread for both members; it is the operator's act, the server
  // refuses it from an agent token, and no posture on this machine may stand in for that.
  for (const messageMode of profiles.MESSAGE_MODES) {
    for (const toolMode of profiles.TOOL_MODES) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "close_thread", channel: CH, thread: "T1" }, messageMode, toolMode }),
        "gate", `close_thread @ msg=${messageMode} tool=${toolMode}`);
    }
  }
});

// ── M4 (F-139): the own-channel MARKERS follow the OUTBOUND half ───────────────────

test("M4: an own-channel propose_close / milestone is ALLOWED under auto_outbound / auto_both", () => {
  for (const op of MARKERS) {
    for (const channel of [undefined, CH]) { // absent means this session's own channel, as for a post
      const input = { op, channel, thread: "T1", outcome: "completed", body: "one line" };
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: "auto_both" }), "allow", `${op} @ auto_both`);
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: "auto_outbound" }), "allow", `${op} @ auto_outbound`);
      // It puts CONTENT into the channel, so the INBOUND half does not answer it, and `ask` asks.
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: "auto_inbound" }), "gate", `${op} @ auto_inbound`);
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: "ask" }), "gate", `${op} @ ask`);
    }
  }
});

test("M4: a CROSS-channel marker keeps gating, and no TOOL posture can ever answer one", () => {
  for (const op of MARKERS) {
    const away = { op, channel: "OTHER", thread: "T1", outcome: "completed", body: "x" };
    for (const messageMode of profiles.MESSAGE_MODES) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: away, messageMode }), "gate", `${op} -> other channel @ ${messageMode}`);
    }
    // THE INVARIANT: Axis A never answers a message operation, marker ops included.
    for (const toolMode of profiles.TOOL_MODES) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op, channel: CH, thread: "T1" }, toolMode }),
        "gate", `toolMode=${toolMode} must not answer ${op}`);
    }
  }
});

test("M4: isOwnChannelMarker scopes by channel exactly as isOwnChannelPost does", () => {
  assert.equal(profiles.isOwnChannelMarker({ op: "propose_close" }, CH), true);
  assert.equal(profiles.isOwnChannelMarker({ op: "propose_close", channel: CH }, CH), true);
  assert.equal(profiles.isOwnChannelMarker({ op: "propose_close", channel: "OTHER" }, CH), false);
  assert.equal(profiles.isOwnChannelMarker({ op: "milestone", channel: CH }, CH), true);
  assert.equal(profiles.isOwnChannelMarker({ op: "close_thread", channel: CH }, CH), false, "the close is not the proposal");
  assert.equal(profiles.isOwnChannelMarker({ op: "post", channel: CH }, CH), false, "a post has its own predicate");
  assert.equal(profiles.isOwnChannelMarker({}, CH), false);
  assert.equal(profiles.isOwnChannelMarker(undefined, CH), false);
  assert.equal(profiles.isOwnChannelMarker({ op: 7 }, CH), false, "a non-string op is not an op");
});

test("M3: THE INVARIANT holds in both directions — no tool posture reads, no read runs a tool", () => {
  for (const toolMode of profiles.TOOL_MODES) {
    for (const op of READS) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op }, toolMode }), "gate",
        `toolMode=${toolMode} must not answer ${op}`);
    }
  }
  // ...and the read allow is not a second way for Axis B to reach a work tool.
  for (const messageMode of profiles.MESSAGE_MODES) {
    for (const tool of ["Bash", "Write", "WebFetch", "mcp__dopl__dopl_kb"]) {
      assert.equal(decide({ toolName: tool, input: { command: "ls" }, messageMode }), "gate",
        `messageMode=${messageMode} must not run ${tool}`);
    }
  }
});

test("M3: the HARD-DENY set is immovable, with both axes wide open", () => {
  for (const tool of ["Task", "Agent", "Skill", "ToolSearch", "SendMessage", "CronCreate",
    "mcp__dopl__dopl_kb_admin", "mcp__dopl__dopl_cluster_admin"]) {
    assert.deepEqual(detail({ toolName: tool, input: { op: "read" }, toolMode: "bypass", messageMode: "auto_both" }),
      { decision: "deny", reason: "hard-denied" }, tool);
  }
});

// ── the reason codes the read half needs ──────────────────────────────────────────

test("M3: a read's gate says WHICH fact stopped it, and an allow says which rule let it through", () => {
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "read" }, messageMode: "ask" }),
    { decision: "gate", reason: "read-approval-required" });
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "list_threads", channel: "my-slug" }, messageMode: "auto_both" }),
    { decision: "gate", reason: "cross-channel-read" });
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "read" }, messageMode: "auto_both" }),
    { decision: "allow", reason: "auto-inbound-read" });
  // ...and a non-read channel op keeps the code it always had, so nothing else was reworded.
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "invite" }, messageMode: "auto_both" }),
    { decision: "gate", reason: "channel-op-approval-required" });
});

test("M3: a read grant is still OP-SCOPED — one read approved does not approve the others", () => {
  // FIX F2's rule is untouched by the posture change: the KEY covers the shape the operator saw.
  const readKey = profiles.grantKeyFor(DOPL_CHANNEL_TOOL, { op: "read" }, CH);
  const held = { toolName: DOPL_CHANNEL_TOOL, allowForTask: [readKey] };
  assert.equal(decide({ ...held, input: { op: "read" } }), "allow");
  assert.equal(decide({ ...held, input: { op: "get_thread" } }), "gate", "each op earns its own key");
  assert.equal(decide({ ...held, input: { op: "post", body: "hi" } }), "gate");
  assert.equal(decide({ ...held, input: { op: "open", direct: true } }), "gate");
});
