// THE FORCED THREAD TAG on a session's own outbound post (main/session-outbound-tag.js).
//
// THE CAPTURE THIS EXISTS FOR (2026-07-31, a FIRST-CLASS thread — not the legacy case).
// A requester created thread 300f2b7e at seq 141. The responder's session window answered
// at seq 143, and that reply carried metadata {runtime, summary, to_user_id} and NO taskId
// at all. On the requester's machine an addressed, agent-authored, thread-less message is
// indistinguishable from a fresh request: it classified `trigger`, created a consent row,
// and popped an "INCOMING REQUEST" window for the answer to its own question.
//
// The prompt had ALREADY been fixed to name the thread (prompt-framing.deliveryCall, plus
// FIX S1 which corrected the argument from the non-existent `task` to the real `thread`).
// The agent simply omitted it. So the tag stops being a request and becomes an invariant
// main enforces: canUseTool may answer {behavior:'allow', updatedInput} (verified present
// in the pinned @anthropic-ai/claude-agent-sdk 0.3.220), and an ALLOW carries the argument.
//
// WHAT MUST NOT MOVE: the permission decision. The injection rides a verdict, it never
// makes one, and it never touches either axis (Tools / Messages).
//
// Run: `node --test dopl-desktop-app/test/session-outbound-tag.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

// The REAL module: it depends only on session-profiles (crypto + tool-profiles), so it
// imports under plain `node --test` and the truth table drives what ships.
const tag = require(join(HERE, "..", "main", "session-outbound-tag.js"));
const { DOPL_CHANNEL_TOOL } = require(join(HERE, "..", "main", "tool-profiles.js"));
const IO = M("session-io.js");
// ⚠ 2026-08-31 (runtime-adapter port, step 3): `makeCanUseTool` SPLIT. The verdict plumbing, the
// TAG MINTING and the card payloads are platform-free and live in `main/session-gate-bridge.js`;
// the held-callback wiring and the platform's reply vocabulary are the adapter's. The tag rules
// themselves never moved — they are `main/session-outbound-tag.js`, core, on every runtime.
const BRIDGE = M("session-gate-bridge.js");
const AXIS_B = M("runtime/claude/axis-b.js");

const CH = "aaaaaaaa-1111-4bbb-8ccc-dddddddddddd";
const UUID = "cccccccc-3333-4ddd-8eee-ffffffffffff";
const LEGACY = `task-${CH}-42`;
const post = (extra) => Object.assign({ op: "post", body: "here is the answer" }, extra || {});

// ── threadTagFor: the decision ───────────────────────────────────────────────────

test("INJECTS the session's thread id when the agent supplied none", () => {
  for (const id of [UUID, LEGACY]) {
    const r = tag.threadTagFor(post(), id);
    assert.equal(r.action, "inject", `${id}: the omission the incident is made of`);
    assert.equal(r.input.thread, id, "the REAL parameter name (1.7.11 cutover), not `task`");
    assert.equal(r.input.body, "here is the answer", "everything else rides along untouched");
  }
});

test("the original input object is never mutated — the SDK and the card still hold it", () => {
  const input = post();
  const r = tag.threadTagFor(input, UUID);
  assert.equal(input.thread, undefined, "a decision must not change under its own callers");
  assert.notEqual(r.input, input, "the tagged value is a copy");
});

test("does NOTHING when the session has no thread id", () => {
  for (const none of [undefined, null, "", "   ", 7, {}]) {
    assert.equal(tag.threadTagFor(post(), none).action, "none", JSON.stringify(none));
  }
});

test("does NOTHING when the agent already tagged it correctly", () => {
  assert.equal(tag.threadTagFor(post({ thread: UUID }), UUID).action, "none");
  assert.equal(tag.threadTagFor(post({ thread: `  ${LEGACY}  ` }), LEGACY).action, "none", "trimmed");
  // metadata.taskId is the OTHER place the op reads a thread id from, so it counts too.
  assert.equal(tag.threadTagFor(post({ metadata: { taskId: UUID } }), UUID).action, "none");
});

test("NEVER OVERWRITES a different thread the agent deliberately chose", () => {
  const other = "dddddddd-4444-4eee-8fff-000000000000";
  const r = tag.threadTagFor(post({ thread: other }), UUID);
  assert.equal(r.action, "conflict", "main must not silently rewrite what the operator approves");
  assert.equal(r.supplied, other);
  assert.equal(r.wanted, UUID);
  assert.equal(r.input, undefined, "and it produces no replacement input at all");
  // Same via the metadata spelling.
  assert.equal(tag.threadTagFor(post({ metadata: { taskId: other } }), UUID).action, "conflict");
  // An explicit `thread` wins over a metadata copy, exactly as the MCP op resolves it.
  assert.equal(tag.suppliedThreadId(post({ thread: UUID, metadata: { taskId: other } })), UUID);
});

test("a non-object input is left alone (nothing to copy, nothing to claim)", () => {
  for (const bad of [null, undefined, "post", 7]) {
    assert.equal(tag.threadTagFor(bad, UUID).action, "none", JSON.stringify(bad));
  }
});

// ── the two verdict shapes ───────────────────────────────────────────────────────

test("allowResult: an injection rides the allow; anything else is the old object", () => {
  const inject = tag.threadTagFor(post(), UUID);
  assert.deepEqual(tag.allowResult(inject), { behavior: "allow", updatedInput: inject.input });
  for (const noop of [null, { action: "none" }, { action: "conflict", supplied: "x" }]) {
    assert.deepEqual(tag.allowResult(noop), { behavior: "allow" }, "byte-identical to before");
  }
});

test("wrapAllow: the OPERATOR's allow gains the argument, a deny gains nothing", () => {
  const inject = tag.threadTagFor(post(), LEGACY);
  const seen = [];
  const wrapped = tag.wrapAllow((r) => seen.push(r), inject);
  wrapped({ behavior: "allow" });
  assert.deepEqual(seen[0], { behavior: "allow", updatedInput: inject.input });
  wrapped({ behavior: "deny", message: "Denied by operator" });
  assert.deepEqual(seen[1], { behavior: "deny", message: "Denied by operator" }, "a deny is untouched");
});

test("wrapAllow NEVER manufactures an allow — every non-allow shape passes through", () => {
  const inject = tag.threadTagFor(post(), UUID);
  const seen = [];
  const wrapped = tag.wrapAllow((r) => seen.push(r), inject);
  for (const shape of [undefined, null, {}, { behavior: "ask" }, { behavior: "DENY" }]) wrapped(shape);
  for (const r of seen) assert.notEqual(r && r.behavior, "allow", JSON.stringify(r));
  for (const r of seen) assert.ok(!(r && r.updatedInput), "and none carries an injection");
});

test("with nothing to inject, wrapAllow returns the ORIGINAL resolver (zero overhead)", () => {
  const resolve = () => {};
  assert.equal(tag.wrapAllow(resolve, null), resolve);
  assert.equal(tag.wrapAllow(resolve, { action: "none" }), resolve);
  assert.equal(tag.wrapAllow(resolve, { action: "conflict" }), resolve, "a conflict changes nothing");
});

// ── scope: only OUR post, and only on this session's channel ─────────────────────

test("isOutboundPost is the gate: a cross-channel post or a non-post op is never tagged", () => {
  assert.equal(tag.isOutboundPost(DOPL_CHANNEL_TOOL, post(), CH), true);
  assert.equal(tag.isOutboundPost(DOPL_CHANNEL_TOOL, post({ channel: "other" }), CH), false,
    "a cross-channel post is the exfiltration shape, not ours to rewrite");
  // `close_thread` was in this list until it left the tool's enum with thread
  // closing (wiring plan Phase 4, 2026-08-18).
  for (const op of ["create_thread", "set_thread_mode", "read", "await", "list"]) {
    assert.equal(tag.isOutboundPost(DOPL_CHANNEL_TOOL, { op, channel: CH }, CH), false, op);
  }
  assert.equal(tag.isOutboundPost("Bash", post(), CH), false, "and never another tool");
});

// ── the wiring in session-io actually does all of the above ──────────────────────

test("makeCanUseTool computes the tag from isOutboundPost + s.taskId, and only reads it on ALLOW", () => {
  const fn = fnOf(BRIDGE, "gateCall");
  // ⚠ A THIRD ARGUMENT JOINED THE TAG ON 2026-08-21: the PER-INSTANCE post stamp
  // (`agent-<agentId>-<n>`), which is what lets `session-dispatch.js`'s fan-out recognise a
  // session's own words coming back off the wire. It rides the SAME seam as the thread tag, for
  // the same reason — a prompt is a request, an injected argument is an invariant — and under
  // the SAME rules: own-channel posts only, never an overwrite, never on a deny.
  assert.match(fn, /const outbound = isOutboundPost\(name, input, s\.channelId\);/);
  assert.match(fn, /const tag = outbound \? outboundTag\.threadTagFor\(input, s\.taskId, outboundTag\.nextOwnPostId\(s\)\) : null;/);
  // ⚠ THE STAMP IS MINTED ONLY FOR A REAL OWN-CHANNEL POST. Minting on every tool call would
  // spend ids the session never posts under and blunt the bounded lookback.
  assert.ok(!/nextOwnPostId\(s\)[^)]*\n[\s\S]*nextOwnPostId/.test(fn), "exactly one mint site");
  // ⚠ THE ANSWER SHAPE MOVED, THE RULE DID NOT (2026-08-31). The bridge hands the verdict and
  // the tag back; the adapter writes them in the platform's own reply vocabulary
  // (`runtime/claude/approval.js › answerApproval` -> `outboundTag.allowResult(tag)`), which is
  // the half that is not portable. Both ends are pinned.
  assert.match(fn, /if \(decision === 'preapproved' \|\| decision === 'allow'\) return \{ settled: true, verdict: 'allow', tag \};/,
    "the auto-allowed path");
  assert.match(fnOf(M("runtime/claude/approval.js"), "answerApproval"),
    /if \(verdict === 'allow'\) return outboundTag\(\)\.allowResult\(req\.tag \|\| null\);/,
    "…and the tag is what an allow carries");
  assert.match(fn, /s\.pendingPermissions\.set\(requestId, outboundTag\.wrapAllow\(resolve, tag\)\);/,
    "and the gated one");
  // THE DENY BRANCH CARRIES NO TAG — that is what this pin is for, and it still holds.
  // ⚠ THE MESSAGE MOVED ON 2026-08-25 (F-320) and this line was the literal `'Blocked for this
  // session'` until then. A `deny` verdict has TWO causes now — the profile's hard-deny, and the
  // LAUNCH-DEPTH BOUND — so the sentence is chosen by `session-permissions.js › denyMessageFor`
  // from the gate REASON. The tag is still absent from the branch, which is the invariant here.
  assert.match(fn, /if \(decision === 'deny'\) return \{ settled: true, verdict: 'deny', tag: null, message: denyMessageFor\(verdict\.reason\) \};/);
  // ⚠ STATED AS `tag: null` SINCE 2026-08-31 RATHER THAN AS AN ABSENCE. The bridge now returns a
  // shape rather than a promise, so "the branch mentions no tag" would be satisfied by a shape
  // that simply forgot the field — and a forgotten field is exactly what a later refactor drops.
  // Asserting the explicit null is the stronger pin: a refused call carries a tag of NOTHING.
  assert.ok(!/decision === 'deny'[^\n]*tag(?!: null)/.test(fn), "no tag rides a refused call");
});

// ── THE COUNTER SURVIVES A CRASH RESUME (2026-08-22) ─────────────────────────────
//
// ⚠ THE STAMP IS ONLY IDEMPOTENCY-SAFE IF IT IS UNIQUE, AND FOR ONE WAVE IT WAS NOT. The id is
// `agent-<agentId>-<n>`. The AGENT ID is persisted on the durable record and deliberately re-used
// by `session-park.js › startResume` ("a resumed session keeps its AGENT INSTANCE ID, else it
// comes back as a stranger") while `n` came from `s.ownPostSeq`, which `startSession` initialised
// to 0 on EVERY session object. So a crash+resume re-minted `agent-<id>-1, 2, 3…` — client_msg_ids
// the server already had rows for — and the server's idempotency short-circuit answered the OLD
// row and wrote nothing. The resumed agent's replies were silently discarded, with no error on
// either side. This is the fix's pin: the counter is persisted (`session-io.js › baseRecord`,
// `session-store.js › durableSessionRecord`) and rehydrated WITH SLACK, because the record always
// lags the posts a crash hid.

const store = require(join(HERE, "..", "main", "session-store.js"));

// The REAL rehydrate line out of the shipping `startSession`, so this cannot pass against a
// number the test made up.
const REHYDRATE = (M("session-engine.js").match(/ownPostSeq: store\.resumedPostSeq\(spec\.ownPostSeq\),/) || [])[0];

test("resumedPostSeq jumps the crash window, and a fresh spawn still starts at zero", () => {
  assert.ok(REHYDRATE, "startSession no longer rehydrates ownPostSeq — the collision is back");
  const slack = store.RESUME_POST_SEQ_SLACK;
  assert.ok(Number.isInteger(slack) && slack > 0, "the slack is a real, stated number");
  assert.equal(store.resumedPostSeq(7), 7 + slack, "clear of the posts the record could not see");
  // A fresh spawn passes nothing; slack over nothing would only make the first stamp odd.
  for (const nothing of [undefined, null, 0, "", NaN, -3, Infinity, {}]) {
    assert.equal(store.resumedPostSeq(nothing), 0, JSON.stringify(String(nothing)));
  }
});

test("a RESUMED session never re-mints a client_msg_id the crashed one already used", () => {
  // Before the crash: the agent posts three times, and the record is persisted after the FIRST
  // (the lag that makes the slack necessary).
  const before = { agentId: "a1b2c3d4", ownPostSeq: 0, ownPostIds: new Set() };
  const used = new Set();
  used.add(tag.nextOwnPostId(before));
  const persisted = store.durableSessionRecord({ key: "k", ownPostSeq: before.ownPostSeq }).ownPostSeq;
  used.add(tag.nextOwnPostId(before));
  used.add(tag.nextOwnPostId(before));
  assert.deepEqual([...used], ["agent-a1b2c3d4-1", "agent-a1b2c3d4-2", "agent-a1b2c3d4-3"]);
  assert.equal(persisted, 1, "the record saw only the first — this is the gap");

  // …the machine dies, and the resume re-uses the SAME agent id.
  const after = { agentId: "a1b2c3d4", ownPostSeq: store.resumedPostSeq(persisted), ownPostIds: new Set() };
  for (let i = 0; i < 20; i += 1) {
    const id = tag.nextOwnPostId(after);
    assert.ok(!used.has(id), `${id} collides with a pre-crash post the server already stored`);
  }
});

test("…and a session with NO id still mints nothing, resume or not", () => {
  // Unchanged: the stamp names an instance, so a session without one has nothing to stamp with.
  assert.equal(tag.nextOwnPostId({ ownPostSeq: store.resumedPostSeq(9) }), "");
  assert.equal(tag.nextOwnPostId(null), "");
});

test("the decision is made BEFORE the tag can influence anything", () => {
  const fn = fnOf(BRIDGE, "gateCall");
  // 2026-08-02: the verdict comes back as { decision, reason }; the ORDER pinned here is what
  // matters, and it is unchanged — the decision (and now its explanation) is settled first.
  const decide = fn.indexOf("const verdict = grantDecisionDetail(io().grantArgs(");
  const tagAt = fn.indexOf("const outbound = isOutboundPost");
  assert.ok(decide !== -1 && tagAt > decide, "the decision runs first and never sees the tag");
  assert.ok(!/grantArgs\([^)]*tag/.test(fn), "the tag is not an input to either axis");
});

test("a conflicting thread id is logged, and the log is injected (session-io stays electron-free)", () => {
  const fn = fnOf(BRIDGE, "gateCall");
  assert.match(fnOf(AXIS_B, "makeCanUseTool"), /function makeCanUseTool\(s, dispatch, log\)/);
  assert.match(fn, /tag\.action === 'conflict' && typeof log === 'function'/, "guarded, never assumed");
  assert.ok(!/require\('\.\/diag'\)/.test(IO), "diag requires electron; this file must not");
  assert.ok(!/require\('\.\/diag'\)/.test(BRIDGE),
    "…and neither must the bridge, for the same reason");
  assert.match(M("runtime/claude/launch-spec.js"), /axisB\.makeCanUseTool\(s, dispatch, diag\)/, "the option assembly supplies it");
});

test("the SDK really accepts updatedInput on an allow (pinned version, not assumed)", () => {
  const sdk = readFileSync(
    join(HERE, "..", "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.d.ts"), "utf8"
  );
  assert.match(sdk, /behavior: 'allow';\s*updatedInput\?: Record<string, unknown>;/,
    "PermissionResult must carry updatedInput, or this whole approach is a no-op");
});
