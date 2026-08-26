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
// scoped at all.
// REQUIREMENT CHANGE, M4 (2026-08-05, F-139): `propose_close` and `milestone` LEFT this set.
// They are own-channel CONTENT ops, strictly less powerful than the `post` that `auto_outbound`
// already auto-allows into the same channel — a proposal settled nothing (the operator's confirm
// was the consent point and was untouched) and a milestone carries no deliverable. Gating them
// cost a click per exchange and removed no consent point. The survivor is pinned under the
// OUTBOUND half below.
// ⚠ TWO OPS LEFT THE TOOL'S ENUM ENTIRELY with thread closing (wiring plan Phase 4,
// 2026-08-18): `propose_close` and `close_thread`. `close_thread` was in this ALWAYS_GATED
// list unconditionally and was never conflated with its proposal — the rule that put it there
// still applies to anything that settles SHARED state. Naming ops the tool does not publish
// would make this table read as coverage it does not have, so both are out.
// The six named-agent / breakout ops that were listed here (`join_thread`, `leave_thread`,
// `summon_agent`, `rename_agent`, `set_agent_status`, `disengage_agent`) are gone with the
// tool's own enum (channels rollback §1), and naming ops the tool does not publish would make
// this table read as coverage it does not have.
// ⚠ REQUIREMENT CHANGE, 2026-08-24 (SAMUEL'S RULING): `create_thread` LEFT THIS SET. It is the
// second op to move onto the OUTBOUND half and the first admitted on an argument other than
// "it says less than the post beside it" — it is a post with a TITLE on it, opening the exchange
// the tool's own protocol tells an agent to open FIRST. WHAT IT COST TO LEAVE IT HERE, observed
// live on v1.19.0 in a two-agent test: unclassified, it fell through to the AXIS-A gate, and a
// WINDOWLESS session answers a gate with `deny` — so the op every thread starts with was
// auto-refused with "this session has no surface to show one on", in EVERY posture, with nothing
// the operator could set to change it. The bar it still clears is the one that keeps
// `close_thread` out: a thread OPEN settles no shared state, because a thread has none.
const ALWAYS_GATED = ["open", "invite", "set_thread_mode", "list"];
// M4: the op that moved, kept as its own name so every test below can say which is which.
const MARKERS = ["milestone"];
// 2026-08-24: and the op that moved next, kept separate from MARKERS for the same reason — the
// two are admitted on different arguments and carry different gate-diag ALLOW codes.
const THREAD_OPENS = ["create_thread"];

// ── the read set ──────────────────────────────────────────────────────────────────

test("M3: the read set is exactly the own-channel READ-ONLY ops, and nothing else", () => {
  // `agents` was a seventh read — the channel's named-agent roster — and went with the op.
  // ⚠ `read_sessions` JOINED ON 2026-08-22 (ruling 7, investigation A4): its absence was an
  // OMISSION, not a rule. It is strictly weaker than the `read` already here, because it returns
  // only THIS OPERATOR'S OWN sessions and never a peer's — which is also why it qualifies where
  // `list` does not, even though its `channel` is an optional FILTER rather than required:
  // `list` enumerates OTHER PEOPLE'S channels and DMs, this enumerates only our own runtimes.
  assert.deepEqual(READS,
    ["read", "await", "list_threads", "get_thread", "members", "read_sessions"]);
  for (const op of ALWAYS_GATED.concat(MARKERS, THREAD_OPENS)) {
    assert.ok(!READS.includes(op), `${op} must never be classified as a read`);
  }
  assert.ok(!READS.includes("post"), "a post is the OUTBOUND half's business");
  // M4: and the marker set is disjoint from the read set in the other direction too — a
  // marker WRITES, so it can never be reached by the inbound half of the axis.
  assert.deepEqual(profiles.OWN_CHANNEL_MARKER_OPS, MARKERS);
  // 2026-08-24: the thread-open set is its own list, and the UNION is what the gate asks about.
  // Asserted as three separate constants, because a single merged list is how "a marker earns
  // this lane by saying less" would quietly come to cover an op that says more.
  assert.deepEqual(profiles.OWN_CHANNEL_THREAD_OPS, THREAD_OPENS);
  assert.deepEqual(profiles.OWN_CHANNEL_OUTBOUND_OPS, MARKERS.concat(THREAD_OPENS));
  for (const op of MARKERS.concat(THREAD_OPENS)) {
    assert.ok(!READS.includes(op), `${op} is outbound, not a read`);
  }
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
  // ⚠ M4 named `close_thread` EXPLICITLY here, because the op beside it in the enum
  // auto-allowed: closing settled a SHARED thread for both members, so no posture on this
  // machine could stand in for the operator's act. Both ops left the enum with thread closing
  // (wiring plan Phase 4, 2026-08-18). The rule outlives them and is what this now pins: an
  // op this table does not classify resolves to `gate` in EVERY posture, which is the safe
  // direction and the reason a deleted name never needs an explicit deny.
  for (const op of ["close_thread", "propose_close"]) {
    for (const messageMode of profiles.MESSAGE_MODES) {
      for (const toolMode of profiles.TOOL_MODES) {
        assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op, channel: CH, thread: "T1" }, messageMode, toolMode }),
          "gate", `${op} @ msg=${messageMode} tool=${toolMode}`);
      }
    }
  }
});

// ── M4 (F-139): the own-channel MARKERS follow the OUTBOUND half ───────────────────

test("M4: an own-channel milestone is ALLOWED under auto_outbound / auto_both", () => {
  for (const op of MARKERS) {
    for (const channel of [undefined, CH]) { // absent means this session's own channel, as for a post
      const input = { op, channel, thread: "T1", body: "one line" };
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
    const away = { op, channel: "OTHER", thread: "T1", body: "x" };
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

// ── 2026-08-24 (Samuel's ruling): create_thread rides the SAME outbound half ───────
//
// ⚠ THE DEFECT IT CLOSES IS A DENY, NOT A CLICK. `create_thread` was unclassified, so it fell
// through to the AXIS-A gate — and `session-windowless.js › claimGate` answers a
// `permission_request` on a surface-less session with `setImmediate(() => decide(rid, 'deny'))`.
// A live two-agent test on v1.19.0 got the verbatim refusal "This tool needs a permission prompt
// and this session has no surface to show one on, so the call was refused automatically" for the
// one op the tool's own protocol says to start with. No posture on either axis could reach it.

test("THREAD OPEN: an own-channel create_thread is ALLOWED under auto_outbound / auto_both", () => {
  for (const op of THREAD_OPENS) {
    for (const channel of [undefined, CH]) { // absent means this session's own channel, as for a post
      const input = { op, channel, title: "Wire the listener", body: "the request", to: "bob@x.com" };
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: "auto_both" }), "allow", `${op} @ auto_both`);
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: "auto_outbound" }), "allow", `${op} @ auto_outbound`);
      // It puts CONTENT into the channel and ADDRESSES a member, so the INBOUND half does not
      // answer it — "send my replies for me" is the only posture that covers what LEAVES.
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: "auto_inbound" }), "gate", `${op} @ auto_inbound`);
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: "ask" }), "gate", `${op} @ ask`);
    }
  }
});

test("THREAD OPEN: a CROSS-channel or SLUG-addressed create_thread keeps gating, in every posture", () => {
  // ⚠ THE SAFE FAILURE IS UNCHANGED AND IS THE WHOLE CONTAINMENT ARGUMENT: the lane is scoped
  // to THIS session's channel by ID, so opening a thread in another room — the shape that would
  // let a counterparty's text steer an exchange into a channel the operator never bound this
  // session to — still costs a decision. A slug is another channel, exactly as for a post.
  for (const op of THREAD_OPENS) {
    for (const channel of ["OTHER", "my-slug", "other-id"]) {
      const away = { op, channel, title: "T", body: "x", to: "evil@x" };
      for (const messageMode of profiles.MESSAGE_MODES) {
        assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: away, messageMode }), "gate",
          `${op} -> ${channel} @ ${messageMode}`);
      }
    }
    // THE INVARIANT: Axis A never answers a message operation, thread opens included.
    for (const toolMode of profiles.TOOL_MODES) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op, channel: CH, title: "T", body: "x", to: "b@x" }, toolMode }),
        "gate", `toolMode=${toolMode} must not answer ${op}`);
    }
  }
});

test("THREAD OPEN: the gate diag tells the two outbound allows apart, and shares the gate code", () => {
  // ⚠ ITS OWN ALLOW CODE. The question an audit asks is "what left this machine with no click?",
  // and "the agent opened an exchange with a member" is not the same answer as "the agent logged
  // a step" — merging them would make a thread open unfindable in listener.log.
  const open = { op: "create_thread", channel: CH, title: "T", body: "x", to: "bob@x.com" };
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: open, messageMode: "auto_both" }),
    { decision: "allow", reason: "auto-outbound-thread-open" });
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "milestone", channel: CH, thread: "T1", body: "x" }, messageMode: "auto_both" }),
    { decision: "allow", reason: "auto-outbound-marker" }, "the marker keeps its own");
  // …and the GATE codes ARE shared, deliberately: the fact that stopped it and the operator's
  // fix are identical to a post's, and a code nobody can act on differently should not exist.
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: open, messageMode: "ask" }),
    { decision: "gate", reason: "message-approval-required" });
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { ...open, channel: "my-slug" }, messageMode: "auto_both" }),
    { decision: "gate", reason: "cross-channel-post" }, "a slug says 'address your own channel by id'");
  // ⚠ AND `invite` / `open` DID NOT COME WITH IT — the ops that change who is in the room keep
  // the code that says message approval does not cover them.
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "invite" }, messageMode: "auto_both" }),
    { decision: "gate", reason: "channel-op-approval-required" });
});

test("THREAD OPEN: a create_thread grant stays OP-SCOPED — it authorizes no other op", () => {
  // FIX F2 is untouched by the lane change: the KEY covers the shape the operator saw, so a
  // "Allow for this task" taken on a thread open cannot open a DM or post a body.
  const openKey = profiles.grantKeyFor(DOPL_CHANNEL_TOOL, { op: "create_thread" }, CH);
  const held = { toolName: DOPL_CHANNEL_TOOL, allowForTask: [openKey] };
  assert.equal(decide({ ...held, input: { op: "create_thread" } }), "allow");
  assert.equal(decide({ ...held, input: { op: "post", body: "hi" } }), "gate");
  assert.equal(decide({ ...held, input: { op: "open", direct: true } }), "gate");
  assert.equal(decide({ ...held, input: { op: "invite" } }), "gate");
});

test("M4: isOwnChannelMarker scopes by channel exactly as isOwnChannelPost does", () => {
  assert.equal(profiles.isOwnChannelMarker({ op: "milestone" }, CH), true);
  assert.equal(profiles.isOwnChannelMarker({ op: "milestone", channel: CH }, CH), true);
  assert.equal(profiles.isOwnChannelMarker({ op: "milestone", channel: "OTHER" }, CH), false);
  // ⚠ The two ops thread closing took with it must never re-enter this ALLOW list — an
  // unclassified op resolves to `gate`, which is the safe direction and where they belong.
  assert.equal(profiles.isOwnChannelMarker({ op: "propose_close", channel: CH }, CH), false);
  assert.equal(profiles.isOwnChannelMarker({ op: "close_thread", channel: CH }, CH), false);
  assert.equal(profiles.isOwnChannelMarker({ op: "post", channel: CH }, CH), false, "a post has its own predicate");
  assert.equal(profiles.isOwnChannelMarker({}, CH), false);
  assert.equal(profiles.isOwnChannelMarker(undefined, CH), false);
  assert.equal(profiles.isOwnChannelMarker({ op: 7 }, CH), false, "a non-string op is not an op");
  // 2026-08-24: the marker predicate did NOT widen to take create_thread — the two are
  // separate lists behind one scope rule, and only the UNION answers the gate.
  assert.equal(profiles.isOwnChannelMarker({ op: "create_thread", channel: CH }, CH), false);
});

test("THREAD OPEN: isOwnChannelThreadOpen scopes by channel exactly as isOwnChannelMarker does", () => {
  assert.equal(profiles.isOwnChannelThreadOpen({ op: "create_thread" }, CH), true);
  assert.equal(profiles.isOwnChannelThreadOpen({ op: "create_thread", channel: CH }, CH), true);
  assert.equal(profiles.isOwnChannelThreadOpen({ op: "create_thread", channel: "" }, CH), true);
  assert.equal(profiles.isOwnChannelThreadOpen({ op: "create_thread", channel: "OTHER" }, CH), false);
  assert.equal(profiles.isOwnChannelThreadOpen({ op: "milestone", channel: CH }, CH), false, "the marker has its own");
  assert.equal(profiles.isOwnChannelThreadOpen({ op: "post", channel: CH }, CH), false);
  // ⚠ The ops that settle or reshape shared state never joined, and must not be talked in by
  // "create_thread got in": `open` mints a ROOM, `invite` changes who is in one.
  for (const op of ["open", "invite", "set_thread_mode", "close_thread", "propose_close"]) {
    assert.equal(profiles.isOwnChannelOutbound({ op, channel: CH }, CH), false, op);
  }
  assert.equal(profiles.isOwnChannelThreadOpen({}, CH), false);
  assert.equal(profiles.isOwnChannelThreadOpen(undefined, CH), false);
  assert.equal(profiles.isOwnChannelThreadOpen({ op: 7 }, CH), false, "a non-string op is not an op");
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
  // F-177 (2026-08-08): the built-ins that used to head this list — Task, Agent, Skill,
  // ToolSearch, SendMessage, CronCreate — are no longer hard-denied under `full`; they GATE
  // (asserted just below). What is immovable is the UNIVERSAL FLOOR, so that is what this
  // drives. `bypass` + `auto_both` is still the point: the widest posture on both axes.
  for (const tool of ["mcp__dopl__dopl_kb_admin", "mcp__dopl__dopl_skill_admin",
    "mcp__dopl__dopl_ontology_admin", "mcp__dopl__dopl_chats_admin",
    "mcp__dopl__dopl_cluster_admin", "mcp__dopl__dopl_workflow", "mcp__dopl__dopl_cluster"]) {
    assert.deepEqual(detail({ toolName: tool, input: { op: "read" }, toolMode: "bypass", messageMode: "auto_both" }),
      { decision: "deny", reason: "hard-denied" }, tool);
  }
});

test("F-177: the released built-ins GATE with both axes wide open — they never auto-allow", () => {
  // The replacement bound. A posture cannot run them: neither AUTO_TOOLS nor BYPASS_TOOLS
  // carries them, and both are positive allow-lists, so the verdict is `gate` at `bypass` +
  // `auto_both` exactly as at `manual` + `ask`.
  for (const tool of ["Task", "Agent", "Skill", "ToolSearch", "SendMessage", "CronCreate"]) {
    assert.equal(decide({ toolName: tool, input: { op: "read" }, toolMode: "bypass", messageMode: "auto_both" }),
      "gate", tool);
    assert.equal(decide({ toolName: tool, input: { op: "read" } }), "gate", `${tool} @ the strictest posture`);
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

// ── THE CHANNEL-LEVEL AGENT'S PULL LANE (2026-08-22, Samuel's refinement) ─────────
//
// A CHANNEL-LEVEL agent (`taskId: null`, key `<channelId>::<agentId>`) is FED only untagged
// main-room posts — thread traffic is never pushed to it, not even when a thread message
// @-mentions its id. The supervisor use case ("monitor the threads and the agents working in
// them") is therefore answered by READING ON DEMAND, and that only works if a THREAD-SCOPED
// read of its own channel auto-allows: a windowless session's message axis is floored at
// `auto_inbound` and there is no surface to answer a gate on, so a gated read is a DENIED read.
//
// ⚠ WHAT MAKES IT WORK IS AN ABSENCE, WHICH IS WHY IT IS PINNED HERE. `isOwnChannelRead` scopes
// by CHANNEL ONLY — it never looks at `thread` — so `get_thread` / `read` with a thread argument
// are the same own-channel read as the bare op. Nothing was added for the channel agent; the
// risk is that somebody later "tightens" the read half by scoping the thread, which would break
// the supervisor lane and look like a permission bug rather than a rule change.
const THREAD = "0f5d1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

test("CHANNEL AGENT: a THREAD-scoped read of its own channel auto-allows under the floor", () => {
  // The windowless floor is `auto_inbound`; the durable auto-send posture may raise it to
  // `auto_both`. Both must let the pull lane through.
  for (const messageMode of ["auto_inbound", "auto_both"]) {
    for (const op of ["get_thread", "read"]) {
      assert.deepEqual(
        detail({ toolName: DOPL_CHANNEL_TOOL, input: { op, channel: CH, thread: THREAD }, messageMode }),
        { decision: "allow", reason: "auto-inbound-read" },
        `${op} @ ${messageMode}`
      );
    }
    // …and the two unthreaded reads a supervisor opens with.
    for (const op of ["list_threads", "members"]) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op, channel: CH }, messageMode }), "allow", op);
    }
  }
});

test("CHANNEL AGENT: the thread argument changes NOTHING — the scope is the channel", () => {
  // ⚠ The pin against a future "tighten the read to the session's own thread". A channel-level
  // session HAS no thread (`taskId` is ''), so a thread-scoped read rule would deny every one of
  // these and the supervisor lane would silently stop working.
  for (const thread of [THREAD, "", null, undefined, "task-legacy-7"]) {
    assert.equal(
      decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "read", channel: CH, thread }, messageMode: "auto_inbound" }),
      "allow",
      `thread ${JSON.stringify(thread)}`
    );
  }
});

test("CHANNEL AGENT: a SLUG-addressed thread read still gates — the safe failure is unchanged", () => {
  // This is why `prompt-framing.js › channelScopeFraming` interpolates the channel UUID into
  // every read call it teaches: `isOwnChannelRead` compares against the ID, so a slug is ANOTHER
  // channel, and in a windowless session a gate is a deny.
  assert.deepEqual(
    detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "get_thread", channel: "my-slug", thread: THREAD }, messageMode: "auto_both" }),
    { decision: "gate", reason: "cross-channel-read" }
  );
});

test("CHANNEL AGENT: pull access does NOT widen the write half", () => {
  // Reading every thread in the channel is the whole grant. A thread-scoped POST is still an
  // outbound op and still answers to the OUTBOUND half alone.
  assert.equal(
    decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "post", body: "x", channel: CH, thread: THREAD }, messageMode: "auto_inbound" }),
    "gate",
    "auto_inbound is the READ half and never sends"
  );
  // ⚠ 2026-08-24: `create_thread` LEFT `ALWAYS_GATED` and did NOT join the pull lane — it is an
  // OUTBOUND op, so the windowless floor (`auto_inbound`) does not reach it and a supervisor
  // reading threads still cannot open one without the operator's outbound posture.
  for (const op of THREAD_OPENS) {
    assert.equal(
      decide({ toolName: DOPL_CHANNEL_TOOL, input: { op, channel: CH, thread: THREAD, title: "T", body: "x", to: "b@x" }, messageMode: "auto_inbound" }),
      "gate",
      `${op} answers to the OUTBOUND half alone`
    );
  }
  for (const op of ALWAYS_GATED) {
    assert.equal(
      decide({ toolName: DOPL_CHANNEL_TOOL, input: { op, channel: CH, thread: THREAD }, messageMode: "auto_both" }),
      "gate",
      `${op} stays gated with a thread argument too`
    );
  }
});
