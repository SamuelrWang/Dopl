// AXIS B's OUTBOUND HALF on `dopl_channel` — the marker, the thread open and the decision card.
// (Sibling of `session-channel-read.test.mjs`, which owns the INBOUND half; see the split note
// below the fixtures. The header that follows is that file's and is duplicated on purpose.)
//
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
// ⚠ `await` IS STILL A CLASSIFIED READ AND IS NO LONGER AN ALLOWABLE ONE (2026-09-01, T85).
// `grantDecision` denies it inside the channel branch, ahead of every grant and both axes, so it
// can never reach the inbound allow the rest of this set takes. The two facts are separated here
// rather than merged because BOTH are pinned: the membership case below still walks `READS` (the
// classifier is what makes a cross-channel await say "another channel" instead of "unknown op"),
// while every DECISION case walks this list. Collapsing them would delete the only evidence that
// the deny is a policy on top of the classification rather than a hole in it.
// ⚠ `await` IS NOT A KEY ANY MORE — a hold is `read` carrying `wait_ms` (F-578), so every KEY is
// allowable and the deny is a SHAPE, owned by `session-await-refusal.test.mjs`.
const READ_ALLOWS = READS;
/** `"rooms.threads"` → `{ op: "rooms", action: "threads" }`. The dotted key, as a call. */
const inputFor = (key) => {
  const [op, action] = String(key).split(".");
  return action ? { op, action } : { op };
};

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
// ⚠ **SHAPES, NOT OP NAMES, SINCE THE FIVE-OP COLLAPSE (2026-09-02, F-578).** `open`, `invite`,
// `set_thread_mode` and `list` are `rooms` ACTIONS, and the three outbound ops below are all
// `send` told apart by `kind` / `thread`. Each table is a partial INPUT, spread into the call.
const ALWAYS_GATED = ["open", "invite", "thread_mode", "list", "update"]
  .map((action) => ({ op: "rooms", action }));
// M4: the shape that moved, kept as its own name so every test below can say which is which.
const MARKERS = [{ op: "send", kind: "milestone" }];
// 2026-08-24: and the op that moved next, kept separate from MARKERS for the same reason — the
// two are admitted on different arguments and carry different gate-diag ALLOW codes.
const THREAD_OPENS = [{ op: "send", thread: "new" }];
// ⚠ REQUIREMENT CHANGE, 2026-08-31 (SAMUEL'S RULING): `escalate` is the THIRD op on the OUTBOUND
// half, kept as its own name for the same reason the two above are — a different argument, a
// different gate-diag ALLOW code (`auto-outbound-escalate`).
//
// It is admitted on `create_thread`'s argument, not on `milestone`'s: a milestone earned the lane
// by SAYING LESS than the post beside it, and an escalation says MORE — it is a post with a
// question and a set of answers on it. What admits it is outbound CONTENT into this session's own
// channel, addressed to a member of that same channel. The bar that keeps `close_thread` out is
// cleared the way a thread open clears it: an escalation settles no shared state, it ASKS.
//
// WHAT LEAVING IT GATED WOULD HAVE COST is F-320's defect class, restated: the agent that most
// needs to escalate is a BLOCKED one, which is almost always a windowless session on the
// operator's own machine — and a windowless session answers a gate with `deny`, so the op the
// tool's protocol tells a stuck agent to reach for would be auto-refused in EVERY posture.
const ESCALATES = [{ op: "send", kind: "decision" }];

// ── THIS FILE IS THE OUTBOUND HALF ────────────────────────────────────────────────
//
// §2 SPLIT out of `session-channel-read.test.mjs` on 2026-09-02, when the five-op collapse
// (F-578) turned every op STRING in both halves into an input SHAPE and took that file to 511
// of the 500-line cap. The seam is the axis: this file owns AXIS B's OUTBOUND half — the
// marker, the thread open and the scope rule they share — and the other owns the INBOUND half
// plus the invariants that hold between them. The header above is duplicated deliberately: a
// test file that imported its fixtures from another would make a failure in one read as a
// failure in the other.

// ── M4 (F-139): the own-channel MARKERS follow the OUTBOUND half ───────────────────

test("M4: an own-channel milestone is ALLOWED under auto_outbound / auto_both", () => {
  for (const shape of MARKERS) {
    for (const channel of [undefined, CH]) { // absent means this session's own channel, as for a post
      const input = { ...shape, channel, thread: "T1", body: "one line" };
      const at = (m) => decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: m });
      assert.equal(at("auto_both"), "allow", "marker @ auto_both");
      assert.equal(at("auto_outbound"), "allow", "marker @ auto_outbound");
      // It puts CONTENT into the channel, so the INBOUND half does not answer it, and `ask` asks.
      assert.equal(at("auto_inbound"), "gate", "marker @ auto_inbound");
      assert.equal(at("ask"), "gate", "marker @ ask");
    }
  }
});

test("M4: a CROSS-channel marker keeps gating, and no TOOL posture can ever answer one", () => {
  for (const shape of MARKERS) {
    const away = { ...shape, channel: "OTHER", thread: "T1", body: "x" };
    for (const messageMode of profiles.MESSAGE_MODES) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: away, messageMode }), "gate", `marker -> other channel @ ${messageMode}`);
    }
    // THE INVARIANT: Axis A never answers a message operation, marker shapes included.
    for (const toolMode of profiles.TOOL_MODES) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { ...shape, channel: CH, thread: "T1" }, toolMode }),
        "gate", `toolMode=${toolMode} must not answer a marker`);
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
  for (const shape of THREAD_OPENS) {
    for (const channel of [undefined, CH]) { // absent means this session's own channel, as for a post
      const input = { ...shape, channel, summary: "Wire the listener", body: "the request", to: "bob@x.com" };
      const at = (m) => decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: m });
      assert.equal(at("auto_both"), "allow", "thread open @ auto_both");
      assert.equal(at("auto_outbound"), "allow", "thread open @ auto_outbound");
      // It puts CONTENT into the channel and ADDRESSES a member, so the INBOUND half does not
      // answer it — "send my replies for me" is the only posture that covers what LEAVES.
      assert.equal(at("auto_inbound"), "gate", "thread open @ auto_inbound");
      assert.equal(at("ask"), "gate", "thread open @ ask");
    }
  }
});

test("THREAD OPEN: a CROSS-channel or SLUG-addressed create_thread keeps gating, in every posture", () => {
  // ⚠ THE SAFE FAILURE IS UNCHANGED AND IS THE WHOLE CONTAINMENT ARGUMENT: the lane is scoped
  // to THIS session's channel by ID, so opening a thread in another room — the shape that would
  // let a counterparty's text steer an exchange into a channel the operator never bound this
  // session to — still costs a decision. A slug is another channel, exactly as for a post.
  for (const shape of THREAD_OPENS) {
    for (const channel of ["OTHER", "my-slug", "other-id"]) {
      const away = { ...shape, channel, summary: "T", body: "x", to: "evil@x" };
      for (const messageMode of profiles.MESSAGE_MODES) {
        assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: away, messageMode }), "gate",
          `thread open -> ${channel} @ ${messageMode}`);
      }
    }
    // THE INVARIANT: Axis A never answers a message operation, thread opens included.
    for (const toolMode of profiles.TOOL_MODES) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { ...shape, channel: CH, summary: "T", body: "x", to: "b@x" }, toolMode }),
        "gate", `toolMode=${toolMode} must not answer a thread open`);
    }
  }
});

test("THREAD OPEN: the gate diag tells the two outbound allows apart, and shares the gate code", () => {
  // ⚠ ITS OWN ALLOW CODE. The question an audit asks is "what left this machine with no click?",
  // and "the agent opened an exchange with a member" is not the same answer as "the agent logged
  // a step" — merging them would make a thread open unfindable in listener.log.
  const open = { op: "send", thread: "new", channel: CH, summary: "T", body: "x", to: "bob@x.com" };
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: open, messageMode: "auto_both" }),
    { decision: "allow", reason: "auto-outbound-thread-open" });
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "send", kind: "milestone", channel: CH, thread: "T1", body: "x" }, messageMode: "auto_both" }),
    { decision: "allow", reason: "auto-outbound-marker" }, "the marker keeps its own");
  // …and the GATE codes ARE shared, deliberately: the fact that stopped it and the operator's
  // fix are identical to a post's, and a code nobody can act on differently should not exist.
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: open, messageMode: "ask" }),
    { decision: "gate", reason: "message-approval-required" });
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { ...open, channel: "my-slug" }, messageMode: "auto_both" }),
    { decision: "gate", reason: "cross-channel-post" }, "a slug says 'address your own channel by id'");
  // ⚠ AND `invite` / `open` DID NOT COME WITH IT — the ops that change who is in the room keep
  // the code that says message approval does not cover them.
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "rooms", action: "invite" }, messageMode: "auto_both" }),
    { decision: "gate", reason: "channel-op-approval-required" });
});

test("THREAD OPEN: a create_thread grant stays OP-SCOPED — it authorizes no other op", () => {
  // FIX F2 is untouched by the lane change: the KEY covers the shape the operator saw, so a
  // "Allow for this task" taken on a thread open cannot open a DM or post a body.
  const openKey = profiles.grantKeyFor(DOPL_CHANNEL_TOOL, { op: "send", thread: "new" }, CH);
  const held = { toolName: DOPL_CHANNEL_TOOL, allowForTask: [openKey] };
  assert.equal(decide({ ...held, input: { op: "send", thread: "new" } }), "allow");
  assert.equal(decide({ ...held, input: { op: "send", body: "hi" } }), "gate");
  assert.equal(decide({ ...held, input: { op: "rooms", action: "open", direct: true } }), "gate");
  assert.equal(decide({ ...held, input: { op: "rooms", action: "invite" } }), "gate");
});

test("M4: isOwnChannelMarker scopes by channel exactly as isOwnChannelPost does", () => {
  const M = { op: "send", kind: "milestone" };
  assert.equal(profiles.isOwnChannelMarker(M, CH), true);
  assert.equal(profiles.isOwnChannelMarker({ ...M, channel: CH }, CH), true);
  assert.equal(profiles.isOwnChannelMarker({ ...M, channel: "OTHER" }, CH), false);
  // ⚠ THE KIND IS HALF THE PREDICATE NOW (F-578). An unmatched kind is an ordinary post,
  // answered by the post branch — the safe direction an unclassified op used to take.
  for (const kind of [undefined, "message", "decision", "task_progress", 7]) {
    assert.equal(profiles.isOwnChannelMarker({ op: "send", kind, channel: CH }, CH), false,
      `kind=${String(kind)} is not a marker`);
  }
  assert.equal(profiles.isOwnChannelMarker({ op: "rooms", action: "open", kind: "milestone" }, CH),
    false, "the kind alone is not the lane — the op is still `send`");
  assert.equal(profiles.isOwnChannelMarker({}, CH), false);
  assert.equal(profiles.isOwnChannelMarker(undefined, CH), false);
  assert.equal(profiles.isOwnChannelMarker({ op: 7 }, CH), false, "a non-string op is not an op");
  // The marker predicate did NOT widen to take a thread open — only the UNION answers the gate.
  assert.equal(profiles.isOwnChannelMarker({ op: "send", thread: "new", channel: CH }, CH), false);
});

test("THREAD OPEN: isOwnChannelThreadOpen scopes by channel exactly as isOwnChannelMarker does", () => {
  const T = { op: "send", thread: "new" };
  assert.equal(profiles.isOwnChannelThreadOpen(T, CH), true);
  assert.equal(profiles.isOwnChannelThreadOpen({ ...T, channel: CH }, CH), true);
  assert.equal(profiles.isOwnChannelThreadOpen({ ...T, channel: "" }, CH), true);
  assert.equal(profiles.isOwnChannelThreadOpen({ ...T, channel: "OTHER" }, CH), false);
  assert.equal(profiles.isOwnChannelThreadOpen({ op: "send", kind: "milestone", channel: CH }, CH), false, "the marker has its own");
  // ⚠ **A REPLY INTO AN EXISTING THREAD IS NOT AN OPEN** — `"new"` is the schema's literal for
  // "open one and return its id"; a thread id is an ordinary post.
  assert.equal(profiles.isOwnChannelThreadOpen({ op: "send", thread: "T1", channel: CH }, CH), false);
  assert.equal(profiles.isOwnChannelThreadOpen({ op: "send", channel: CH }, CH), false);
  // ⚠ The actions that reshape shared state never joined, and must not be talked in by "a thread
  // open got in": `rooms.open` mints a ROOM, `rooms.invite` changes who is in one.
  for (const action of ["open", "invite", "thread_mode", "update"]) {
    assert.equal(profiles.isOwnChannelOutbound({ op: "rooms", action, channel: CH }, CH), false, action);
  }
  assert.equal(profiles.isOwnChannelThreadOpen({}, CH), false);
  assert.equal(profiles.isOwnChannelThreadOpen(undefined, CH), false);
  assert.equal(profiles.isOwnChannelThreadOpen({ op: 7 }, CH), false, "a non-string op is not an op");
});
