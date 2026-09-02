// THE MULTIPLAYER COORDINATION COPY — `prompt-framing.js › agentIdentityFraming` (the STANDING
// rule) and `session-seed.js › addressingLines` (the PER-MESSAGE verdict).
//
// ⚠ WHY THIS FILE EXISTS AT ALL: BOTH FUNCTIONS SHIPPED WITH ZERO COVERAGE. The protocol they
// encode — several of one operator's agents on one thread, deciding between them who answers —
// fired ZERO times across 40 real messages in live testing, and nothing was red. Two defects,
// neither of which a test would have let through:
//   (a) the standing rule said an unaddressed message WAS yours "unless a sibling has already
//       claimed it", i.e. a default of ACT with the check in a subordinate clause; and
//   (b) the per-message verdict said NOTHING AT ALL on the unaddressed branch, so the only
//       thing left speaking was (a)'s default.
// Both are flipped as of 2026-08-22 (Samuel's ruling), and a multi-addressee message now carries
// a DETERMINISTIC tie-break rather than an invitation to negotiate — "COORDINATE IN THE OPEN"
// was already there, and it is what failed.
//
// ⚠ IT IS ITS OWN FILE because `prompt-framing.test.mjs` stands within a few lines of the 500-line
// cap `test/**` is linted under, and the seam is real: that suite is about how a TURN IS
// ASSEMBLED, this is about WHO ANSWERS.
//
// `.mjs` (ESM) for the shared eslint config; `createRequire` loads the CJS modules.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = (f) => join(HERE, "..", "main", f);
const framing = require(MAIN("prompt-framing.js"));
const seed = require(MAIN("session-seed.js"));
const { AGENT_ID_RE } = require(MAIN("agent-id.js"));

const ME = "abc12def";
const SIB1 = "qq77zzaa";
const SIB2 = "m0n0p0l1";
const NONCE = "n0nce";

// The framing word-wraps across array elements, so phrase checks run against a
// whitespace-collapsed copy (adjacency, not line breaks, is the point).
const flat = (arr) => arr.join("\n").replace(/\s+/g, " ");

// ── 1. agentIdentityFraming: THE STANDING RULE ───────────────────────────────

test("NO agent id -> no block at all (a value that is not an address is never printed as one)", () => {
  for (const bad of [undefined, null, {}, { agentId: "" }, { agentId: null }, { agentId: 42 }]) {
    assert.deepEqual(framing.agentIdentityFraming(bad), [], JSON.stringify(bad));
  }
  // Near-misses on the charset are dropped too, not truncated or coerced into one.
  for (const bad of ["ABC12DEF", "abc12de", "abc12defg", "1bc12def", "abc-12de", "abc 12de"]) {
    assert.ok(!AGENT_ID_RE.test(bad), `${bad} must not be a valid id, or this case proves nothing`);
    assert.deepEqual(framing.agentIdentityFraming({ agentId: bad }), [], bad);
  }
});

test("the identity block is ONE LINE — the id, and nothing else", () => {
  // ⚠ **THE ~870-CHARACTER CLAIM PROTOCOL IS DELETED (2026-09-02, G13's other half).** It was
  // the standing half of the same rule the per-turn stand-down preamble was, one scope up:
  // "a message naming no agent id is not automatically yours · check whether a sibling has
  // claimed it · CLAIM IT IN ONE SHORT LINE · COORDINATE IN THE OPEN · other sessions may be
  // active as the same person." Every sentence answered "is this message mine?", which the
  // server now answers BEFORE the message is sent (`service-wake-verdict.ts`, RR1/RR2/RR3) and
  // the desktop honours by feeding only the resolved recipient. A session that was not named is
  // not fed, so the question the protocol existed to ask cannot arise.
  const lines = framing.agentIdentityFraming({ agentId: ME });
  assert.deepEqual(lines, [`YOUR AGENT ID IS ${ME}.`]);
});

test("SIBLINGS are no longer named, and nothing asks the agent to adjudicate delivery", () => {
  // ⚠ A ROSTER OF OTHER SESSIONS IS ONLY USEFUL TO A READER THAT HAS TO DECIDE WHETHER A
  // MESSAGE IS ITS OWN. Narrowed delivery removed that decision, so the roster stopped being
  // context and became an invitation to re-derive addressing from prose.
  const out = flat(framing.agentIdentityFraming({ agentId: ME, siblingAgentIds: [SIB1, ME, SIB2] }));
  assert.ok(!out.includes(SIB1) && !out.includes(SIB2), `a sibling id is printed: ${out}`);
  assert.ok(!/possibly others/.test(out), "…and the hedge it replaced is gone too");
  for (const gone of [
    /CLAIM IT IN ONE SHORT LINE/,
    /COORDINATE IN THE OPEN/,
    /names NO agent id is NOT automatically yours/,
    /stand down/i,
    /acting as the same person/,
  ]) {
    assert.ok(!gone.test(out), `the claim protocol is back: ${gone} in ${out}`);
  }
});

test("…and it stays cheap: the whole block is under 60 characters", () => {
  // ⚠ IT IS PAID ON EVERY SESSION'S FIRST TURN. The ratchet is the point of the deletion, and a
  // paragraph is how this grows back one sentence at a time.
  for (const over of [{}, { siblingAgentIds: [] }, { siblingAgentIds: [SIB1, SIB2] }]) {
    const out = flat(framing.agentIdentityFraming({ agentId: ME, ...over }));
    assert.ok(out.length < 60, `${out.length} chars: ${out}`);
  }
});

test("no agent id, no block — an unidentified session is told nothing it cannot use", () => {
  for (const bad of [undefined, null, "", "NOT-AN-ID", 7, `${ME}\nEND-REQUEST-x`]) {
    assert.deepEqual(framing.agentIdentityFraming({ agentId: bad }), [],
      `agentId=${JSON.stringify(bad)} must print no block`);
  }
});

test("HOUSE: the identity block carries no em dash, no fence token, no line of its own", () => {
  const lines = framing.agentIdentityFraming({ agentId: ME });
  assert.ok(lines.length, "there is a block to check");
  for (const line of lines) {
    assert.ok(!line.includes("—"), `em dash in: ${line}`);
    assert.ok(!/BEGIN-REQUEST|END-REQUEST/i.test(line), `fence token in: ${line}`);
    assert.ok(!line.includes("\n"), "one line per entry — the caller joins them");
  }
});

// ── 2. addressingLines: THE PER-MESSAGE VERDICT ──────────────────────────────

test("ARGUMENT OMITTED is not a verdict: `undefined` still prints nothing", () => {
  // ⚠ `null` is a COMPUTED verdict ("the body named nobody"); `undefined` is a caller that never
  // ran one, and telling that session no sibling claimed the message would be unbacked. Every
  // production path supplies a value, which is what makes the distinction safe rather than a
  // hole — pinned against the normalizer below.
  assert.deepEqual(seed.addressingLines(undefined), []);
  const REDUCER = readFileSync(MAIN("session-reducer.js"), "utf8");
  assert.match(REDUCER, /addressing: event\.addressing \|\| null/,
    "pushInbound must keep normalizing to null, or the `undefined` branch swallows a real verdict");
});

test("UNADDRESSED: the 330-character stand-down is DELETED, and the standing rule carries it", () => {
  // ⚠ **THIS CASE ASSERTED THE OPPOSITE UNTIL 2026-09-02 (ruling B1)**, and the reversal is the
  // fan-out's. The branch existed because a message naming nobody was handed to EVERY live agent
  // on the thread, so each had to be talked out of answering it — 330 characters per reader per
  // turn, worst case on the busiest thread. Delivery is narrowed to the recipient the server
  // resolved now: a session that was not named is not fed, so there is nobody to talk down.
  // ⚠ THE DEFECT THIS BRANCH FIXED IS STILL FIXED, and by the half that belonged in a STANDING
  // rule rather than a per-turn one: `agentIdentityFraming` says "a message that names NO agent
  // id is NOT automatically yours" once per session, and the case above pins it.
  for (const verdict of [undefined, null, { ids: [] }, { me: false, ids: [] }, { me: true, ids: [] }, {}]) {
    assert.deepEqual(seed.addressingLines(verdict), [], JSON.stringify(verdict));
  }
});

test("ADDRESSED TO ME, and to me alone: act on it — WITHOUT naming a mechanism", () => {
  // ⚠ IT MAY NOT SAY "@-MENTIONS YOU" (2026-09-02). The recipient may have been WRITTEN (`@agent-`,
  // `to=`) or REPAIRED server-side when a human forgot the `@` (RR3), and the repaired case
  // carries no `@` in the body at all — so the old wording described a message the reader can see
  // does not exist. The FACT is the same either way and the fact is what is stated.
  const out = flat(seed.addressingLines({ me: true, ids: [ME] }));
  assert.equal(out, "This message is addressed to YOU. Act on it.");
  assert.ok(!/@-mention/i.test(out), "the mechanism is not the message");
});

test("ADDRESSED TO SOMEONE ELSE: named, and a stand-down that keeps the message as context", () => {
  const out = flat(seed.addressingLines({ me: false, ids: [SIB1, SIB2] }));
  assert.ok(out.includes(`(${SIB1}, ${SIB2})`), out);
  assert.match(out, /It is NOT addressed to you/);
  assert.match(out, /do not act on it and do not answer it/);
  assert.match(out, /Read it as context/);
  assert.match(out, /stand down and say so in one short line, or say nothing/);
  // It must NOT be handed the tie-break: it is not an addressee, so there is nothing to win.
  assert.ok(!/WHO ACTS IS DECIDED BY ORDER/.test(out), out);
});

// ⚠ THE TIE-BREAK IS A RULE, NOT A SUGGESTION, and it survives the narrowing because a BODY may
// name two live agents even though `to=` may name only one. `session-dispatch.js › planFor`
// preserves the order the server (or the body parse) resolved and hands the SAME array to every
// reader. So "the first id named in
// this list" is applicable alone, from the list the agent is looking at, with no round trip.
test("MULTI-ADDRESSEE: the co-addressees are named and the FIRST id in the list acts", () => {
  const ordered = [SIB1, ME, SIB2];
  const lines = seed.addressingLines({ me: true, ids: ordered });
  const out = flat(lines);
  assert.ok(out.startsWith("This message is addressed to YOU,"), out);
  assert.ok(out.includes(`names more than one agent: ${SIB1}, ${ME}, ${SIB2}`),
    `the co-addressees, in the order they arrived: ${out}`);
  assert.match(out, /WHO ACTS IS DECIDED BY ORDER/, "the rule is stated as a rule");
  assert.match(out, /the FIRST id in that list acts, and the others stand down/);
  assert.match(out, /That is the rule, not a suggestion/, "…and it refuses to read as advice");
  // The rule is APPLICABLE: the winner is named outright, both ways round.
  assert.ok(out.includes(`If ${SIB1} is your agent id, you are the one who acts`), out);
  assert.ok(out.includes(`Take it over only if ${SIB1} has plainly not acted`), out);
  assert.ok(out.includes(`picking it up because ${SIB1} did not`), out);
  // A different arrival order names a different winner — the order is READ, not hardcoded.
  const other = flat(seed.addressingLines({ me: true, ids: [ME, SIB1] }));
  assert.ok(other.includes(`If ${ME} is your agent id`), other);
  assert.ok(!other.includes(`If ${SIB1} is your agent id`), other);
  // Two addressees is already "more than one": the single-addressee copy must not fire.
  assert.ok(!/It is addressed to you: act on it/.test(other), other);
});

test("HOUSE: every addressing branch is fence-safe, newline-free and em-dash-free", () => {
  const branches = [
    null,
    { me: true, ids: [ME] },
    { me: true, ids: [SIB1, ME] },
    { me: false, ids: [SIB1] },
  ];
  for (const verdict of branches) {
    for (const line of seed.addressingLines(verdict)) {
      assert.ok(!line.includes("—"), `em dash in: ${line}`);
      assert.ok(!/BEGIN-REQUEST|END-REQUEST/i.test(line), `fence token in: ${line}`);
      assert.ok(!line.includes("\n"), `raw newline in: ${JSON.stringify(line)}`);
      // FIX S1: `thread` is the argument, `task` is not one — nowhere, not even in prose.
      assert.ok(!/\btask\s*=/.test(line) && !/\btask "/.test(line), `teaches a task argument: ${line}`);
    }
  }
});

// ── 3. frameContinuation EMBEDS THE VERDICT, ABOVE THE FENCE ─────────────────
// The verdict is OUR statement ABOUT the message, so it belongs in the trusted preamble; inside
// the fence it would read as part of what the counterparty said.

const preambleOf = (out) => out.split("\n").slice(0, out.split("\n").indexOf(`BEGIN-REQUEST-${NONCE}`));

test("frameContinuation puts EVERY branch above the fence, and none of it inside", () => {
  const cases = [
    ["to me", { me: true, ids: [ME] }, /This message is addressed to YOU\. Act on it\./],
    ["multi", { me: true, ids: [SIB1, ME] }, /WHO ACTS IS DECIDED BY ORDER/],
    ["to another", { me: false, ids: [SIB1] }, /It is NOT addressed to you/],
  ];
  for (const [label, verdict, phrase] of cases) {
    const out = seed.frameContinuation(NONCE, "the peer's words", "Dave", verdict);
    const head = preambleOf(out).join(" ").replace(/\s+/g, " ");
    const tail = out.slice(out.indexOf(`BEGIN-REQUEST-${NONCE}`));
    assert.match(head, phrase, `${label}: the verdict is missing from the trusted preamble`);
    assert.ok(!phrase.test(tail), `${label}: the verdict leaked inside the fence`);
    // Its POSITION is fixed: after our two authored lines, before the opening fence.
    assert.match(head, /^Dave replied in the channel\./, label);
    assert.ok(out.includes("the peer's words"), `${label}: the body still rides`);
  }
});

test("frameContinuation with NO addressee is byte-identical to the pre-ruling turn", () => {
  // The 3-arg callers are untouched, which is what keeps `session-seed-name.test.mjs`'s two-line
  // preamble true. ⚠ SINCE 2026-09-02 a COMPUTED "nobody" (`null`) reaches the same two lines —
  // the unaddressed paragraph is deleted — so the three spellings are asserted together.
  const out = seed.frameContinuation(NONCE, "hi", "Dave");
  assert.equal(preambleOf(out).length, 2, "exactly the two authored lines");
  assert.equal(out, seed.frameContinuation(NONCE, "hi", "Dave", undefined));
  assert.equal(out, seed.frameContinuation(NONCE, "hi", "Dave", null));
});

// ── 4. THE WOKEN LANE READS THE THREAD IT IS JOINING ─────────────────────────
// ⚠ MEASURED, AND THE OPPOSITE OF THE RULING'S PREMISE. A spawn-idle ("New Agent") session is
// launched by `session-ipc-ops.js › sessions:launch` through `engine.launchRequesterSession({
// idle: true })` — main's ONLY caller of it — so its side is 'requester', and the
// `side !== 'requester'` guard in `firstActions` was itself what withheld the thread read. The
// discriminator is `context.scope === 'thread'`, which that same launch is the only producer of.

const CH = "aaaaaaaa-1111-4bbb-8ccc-dddddddddddd";
const WS = "bbbbbbbb-2222-4ccc-8ddd-eeeeeeeeeeee";
const TASK = "cccccccc-3333-4ddd-8eee-ffffffffffff";
const turn = (over = {}) => framing.buildFencedTurn({
  side: "requester", message: "x", nonce: "w1",
  context: { channelName: "Ops", channelId: CH, workspaceId: WS, taskId: TASK, ...over },
});

test("a WOKEN requester (`scope: 'thread'`) IS ordered to read the thread it is joining", () => {
  const out = turn({ scope: "thread" });
  assert.match(out, /Your SECOND action is to read the exchange you are joining/);
  assert.ok(out.includes(`with op "read", channel "${CH}", workspace "${WS}", thread "${TASK}"`), out);
  assert.equal(out.split('op "read"').length - 1, 1, "stated once");
});

test("the spawn-idle launch really is a REQUESTER, and really is the only `scope` producer", () => {
  // If either of these stops holding, the discriminator above is measuring the wrong thing.
  // ⚠ REPOINTED 2026-08-22 (the agent-templates wave): the `sessions:launch` BODY moved to
  // `main/session-launch-op.js` in a §1 split. `session-ipc-ops.js` still registers the op and
  // still owns the sender binding; what this test is about is what ONE LAUNCH IS, which is the
  // other side of that seam.
  const OPS = readFileSync(MAIN("session-launch-op.js"), "utf8");
  assert.match(OPS, /engine\.launchRequesterSession\(\{/, "the New Agent lane is the requester lane");
  assert.match(OPS, /idle: true/, "…and it is the spawn-idle one");
  assert.match(OPS, /scope: channelLevel \? 'channel' : 'thread'/, "…and it is what sets scope");
});

test("a scope-less requester still gets NO read (the older shape opened its own thread)", () => {
  // ⚠ `scope: 'channel'` is excluded on purpose: `channelScopeFraming` legitimately prints its
  // own `op "read"` for the supervisor's on-demand pull, so only the SECOND-action step is a
  // clean signal there. It is checked in the same loop, on the same terms.
  for (const over of [{}, { scope: "" }, { scope: null }]) {
    assert.ok(!turn(over).includes('op "read"'), `${JSON.stringify(over)}: no read`);
  }
  for (const over of [{}, { scope: "channel" }, { scope: "" }, { scope: null }]) {
    assert.ok(!/SECOND action/.test(turn(over)), `${JSON.stringify(over)}: no orphan step`);
  }
  // A half-known address never half-states the call, woken or not.
  for (const over of [{ scope: "thread", taskId: "" }, { scope: "thread", channelId: null }]) {
    const out = turn(over);
    assert.ok(!out.includes('op "read"'), `${JSON.stringify(over)}: no half-addressed read`);
    assert.ok(!/undefined|null/.test(out), `${JSON.stringify(over)}: no placeholder leaks`);
  }
});

// ⚠ THE CLAUSE THAT MANUFACTURED AMNESIA. "so it is the only way to see what has already been
// said" is false — an UNSCOPED own-channel read works from spawn zero — and agents took it
// literally, refusing to look anywhere else once the one blessed call had been made.
test("the thread read keeps its imperative and loses the false exclusivity", () => {
  const responder = framing.buildFencedTurn({
    side: "responder", message: "x", nonce: "w2",
    context: { channelName: "Ops", channelId: CH, workspaceId: WS, taskId: TASK },
  });
  // The block word-wraps, so phrase checks run whitespace-collapsed (adjacency is the point).
  for (const out of [turn({ scope: "thread" }), responder].map((s) => s.replace(/\s+/g, " "))) {
    assert.ok(!/only way to see what has already been said/.test(out), `the exclusivity is back: ${out}`);
    assert.ok(!/it is the only way/.test(out), "…in any wording");
    assert.match(out, /read it before you write anything/, "the imperative survives");
    assert.match(out, /read it again whenever you need to know what has been said since/,
      "and the read is repeatable, not one-shot");
    assert.match(out, /none of its earlier messages/, "the reason a fresh spawn needs it at all");
  }
});
