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
  for (const op of ["create_thread", "close_thread", "read", "await", "list"]) {
    assert.equal(tag.isOutboundPost(DOPL_CHANNEL_TOOL, { op, channel: CH }, CH), false, op);
  }
  assert.equal(tag.isOutboundPost("Bash", post(), CH), false, "and never another tool");
});

// ── the wiring in session-io actually does all of the above ──────────────────────

test("makeCanUseTool computes the tag from isOutboundPost + s.taskId, and only reads it on ALLOW", () => {
  const fn = fnOf(IO, "makeCanUseTool");
  assert.match(fn, /const tag = isOutboundPost\(name, input, s\.channelId\) \? outboundTag\.threadTagFor\(input, s\.taskId\) : null;/);
  assert.match(fn, /if \(decision === 'preapproved' \|\| decision === 'allow'\) return Promise\.resolve\(outboundTag\.allowResult\(tag\)\);/,
    "the auto-allowed path");
  assert.match(fn, /s\.pendingPermissions\.set\(requestId, outboundTag\.wrapAllow\(resolve, tag\)\);/,
    "and the gated one");
  // The DENY branch must be byte-identical: the tag may not appear anywhere near it.
  assert.match(fn, /if \(decision === 'deny'\) return Promise\.resolve\(\{ behavior: 'deny', message: 'Blocked for this session' \}\);/);
});

test("the decision is made BEFORE the tag can influence anything", () => {
  const fn = fnOf(IO, "makeCanUseTool");
  // 2026-08-02: the verdict comes back as { decision, reason }; the ORDER pinned here is what
  // matters, and it is unchanged — the decision (and now its explanation) is settled first.
  const decide = fn.indexOf("const verdict = grantDecisionDetail(grantArgs(");
  const tagAt = fn.indexOf("const tag = isOutboundPost");
  assert.ok(decide !== -1 && tagAt > decide, "the decision runs first and never sees the tag");
  assert.ok(!/grantArgs\([^)]*tag/.test(fn), "the tag is not an input to either axis");
});

test("a conflicting thread id is logged, and the log is injected (session-io stays electron-free)", () => {
  const fn = fnOf(IO, "makeCanUseTool");
  assert.match(fn, /function makeCanUseTool\(s, dispatch, log\)/);
  assert.match(fn, /tag\.action === 'conflict' && typeof log === 'function'/, "guarded, never assumed");
  assert.ok(!/require\('\.\/diag'\)/.test(IO), "diag requires electron; this file must not");
  assert.match(M("session-query.js"), /io\.makeCanUseTool\(s, deps\.dispatch, diag\)/, "the option assembly supplies it");
});

test("the SDK really accepts updatedInput on an allow (pinned version, not assumed)", () => {
  const sdk = readFileSync(
    join(HERE, "..", "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.d.ts"), "utf8"
  );
  assert.match(sdk, /behavior: 'allow';\s*updatedInput\?: Record<string, unknown>;/,
    "PermissionResult must carry updatedInput, or this whole approach is a no-op");
});
