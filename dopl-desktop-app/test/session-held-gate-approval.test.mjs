// The inline approval surface (Samuel, 2026-09-17). Four modules, one contract:
// `main/session-held-gates.js` (the ledger), the gate bridge's own recording,
// `main/session-summary.js › liveSummary` (the projection), `main/session-answer-permission.js`
// (the answer, exactly once). Tested together because the defect class is the SEAM between them:
// a ledger that records what the projection cannot show, or an answer that resolves what no card
// offered. Every module here is the real one — no stubs.
//
// Run: `node --test dopl-desktop-app/test/session-held-gate-approval.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { load, session } from "./_session-summary-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const held = require(join(MAIN, "session-held-gates.js"));
const axisB = require(join(MAIN, "runtime", "claude", "axis-b.js"));
const answer = require(join(MAIN, "session-answer-permission.js"));

/** A live-session stub with exactly what the gate bridge reads (`session-io-grant.test.mjs`). */
function mkSession(over) {
  return {
    profile: "full",
    channelId: "ch1",
    state: { allowForTask: [], toolMode: "manual", messageMode: "ask", pendingPermissions: [] },
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    ...(over || {}),
  };
}

// ── 1. THE LEDGER ────────────────────────────────────────────────────────────────────

test("LEDGER: an entry carries the four facts that make the question answerable", () => {
  const s = mkSession();
  held.note(s, { requestId: "r1", tool: "dopl_channel", op: "manage.rename", summary: '{"agent":"a1b2c3d4"}', reason: "channel-op-approval-required" });
  assert.deepEqual(s.heldGates.get("r1"), {
    requestId: "r1",
    tool: "dopl_channel",
    op: "manage.rename",
    summary: '{"agent":"a1b2c3d4"}',
    reason: "channel-op-approval-required",
  });
});

test("LEDGER: a hold with NO request id occupies no slot — it could never be answered", () => {
  const s = mkSession();
  held.note(s, { tool: "Bash" });
  held.note(s, { requestId: "", tool: "Bash" });
  assert.equal(s.heldGates === undefined || s.heldGates.size === 0, true);
});

test("LEDGER: every field is ONE LINE and bounded — model input cannot forge a card", () => {
  const s = mkSession();
  held.note(s, {
    requestId: "r2",
    // A tool name carrying newlines would otherwise draw its own rows on the card.
    tool: "Ba\nsh\tX",
    op: "x".repeat(200),
    summary: "y".repeat(500),
    reason: "z".repeat(200),
  });
  const e = s.heldGates.get("r2");
  assert.equal(e.tool, "Ba sh X");
  assert.equal(e.op.length, held.OP_CAP);
  assert.equal(e.summary.length, held.SUMMARY_CAP);
  assert.equal(e.reason.length, held.REASON_CAP);
  assert.equal(/[\r\n\t]/.test(`${e.tool}${e.op}${e.summary}${e.reason}`), false);
});

test("LEDGER: an unnamed tool still reads as something — never a blank card", () => {
  const s = mkSession();
  held.note(s, { requestId: "r3", tool: "" });
  assert.equal(s.heldGates.get("r3").tool, "a tool");
});

test("LEDGER: BOUNDED, oldest first — a per-session map multiplies against the agent cap", () => {
  const s = mkSession();
  for (let i = 0; i < held.MAX_HELD + 10; i += 1) held.note(s, { requestId: `r${i}`, tool: "Bash" });
  assert.equal(s.heldGates.size, held.MAX_HELD);
  assert.equal(s.heldGates.has("r0"), false, "the oldest went");
  assert.equal(s.heldGates.has(`r${held.MAX_HELD + 9}`), true, "the newest stayed");
  // Re-noting a key already held must NOT evict (a reshow of the same request), or the map
  // shrinks by one every time a live card is re-recorded.
  const before = s.heldGates.size;
  held.note(s, { requestId: `r${held.MAX_HELD + 9}`, tool: "Bash" });
  assert.equal(s.heldGates.size, before);
});

// ── 2. THE PROJECTION IS THE REDUCER'S SET, NEVER A SECOND OPINION ───────────────────

test("PROJECTION: the REDUCER's array is the set; the ledger only supplies the detail", () => {
  const s = mkSession();
  held.note(s, { requestId: "r1", tool: "Bash", summary: "ls" });
  held.note(s, { requestId: "r2", tool: "Read", summary: "/tmp/x" });
  // `r1` was answered, timed out or fail-closed by a park. The ledger still HAS it, and it
  // must not be rendered.
  s.state.pendingPermissions = ["r2"];
  assert.deepEqual(held.heldGatesFor(s).map((e) => e.requestId), ["r2"]);
  // …and the ORDER is the reducer's, not the ledger's insertion order.
  s.state.pendingPermissions = ["r2", "r1"];
  assert.deepEqual(held.heldGatesFor(s).map((e) => e.requestId), ["r2", "r1"]);
});

test("PROJECTION: an id with no entry is DROPPED, never rendered as a blank card", () => {
  const s = mkSession();
  s.state.pendingPermissions = ["ghost"];
  assert.deepEqual(held.heldGatesFor(s), []);
});

test("PROJECTION: nothing held, and a session that has never held anything, both answer []", () => {
  assert.deepEqual(held.heldGatesFor(mkSession()), []);
  assert.deepEqual(held.heldGatesFor(null), []);
  assert.deepEqual(held.heldGatesFor({}), []);
});

// ── 3. THE GATE BRIDGE RECORDS THE DOCK SHAPE, WITH ITS OWN SPELLINGS ────────────────

test("BRIDGE: a gated work tool is recorded when its resolver is parked", async () => {
  const s = mkSession();
  const events = [];
  const p = axisB.makeCanUseTool(s, (_s, ev) => events.push(ev))("Bash", { command: "ls" }, { requestId: "r1" });
  assert.equal(events[0].type, "permission_request", "precondition: it really gated");
  const entry = s.heldGates.get("r1");
  assert.equal(entry.tool, "Bash");
  assert.equal(entry.op, "", "a work tool has no channel op key");
  assert.match(entry.summary, /ls/, "the input's one-line restatement");
  // The reason is the gate's own CODE (`session-gate-reason.js`), never words: the renderer owns
  // the copy and an unknown code must render no line rather than a guess.
  assert.equal(entry.reason, "awaiting-approval");
  s.pendingPermissions.get("r1")({ behavior: "deny" });
  await p;
});

test("BRIDGE: a `dopl_channel` hold carries the OP KEY the classifiers match on (F-578)", async () => {
  const s = mkSession();
  const events = [];
  const canUse = axisB.makeCanUseTool(s, (_s, ev) => events.push(ev));
  const p = canUse("mcp__dopl__dopl_channel", { op: "rooms", action: "invite", channel: "ch1" }, { requestId: "r5" });
  assert.equal(events[0].type, "permission_request", "precondition: it really gated");
  const entry = s.heldGates.get("r5");
  // The SHORT label, past the `mcp__<server>__` prefix.
  assert.equal(entry.tool, "dopl_channel");
  // `rooms` alone would read identically for a roster read and an invite, which is why the op
  // key is a field of its own.
  assert.equal(entry.op, "rooms.invite");
  s.pendingPermissions.get("r5")({ behavior: "deny" });
  await p;
});

test("BRIDGE: an OWN-CHANNEL POST is NOT recorded — it already has a surface", async () => {
  // An own-channel post gates onto a CONSENT ROW with its own Post button in the send box. A
  // second set of buttons would be two answers to one question, and a local resolve would race
  // the row the server CAS's.
  const s = mkSession();
  const events = [];
  const canUse = axisB.makeCanUseTool(s, (_s, ev) => events.push(ev));
  const p = canUse("mcp__dopl__dopl_channel", { op: "send", channel: "ch1", body: "hi" }, { requestId: "r6" });
  assert.equal(events[0].payload.type, "outbound_gate", "precondition: this is the post shape");
  assert.equal(s.pendingPermissions.has("r6"), true, "it IS held");
  assert.equal(s.heldGates === undefined || s.heldGates.has("r6") === false, true, "…and offered no card");
  s.pendingPermissions.get("r6")({ behavior: "deny" });
  await p;
});

// ── 4. THE SUMMARY CARRIES IT, AND THE SERVER DOES NOT ──────────────────────────────

test("SUMMARY: `heldGates` rides the live row and moves the push digest", () => {
  const m = load();
  const s = session();
  held.note(s, { requestId: "r1", tool: "Bash", summary: "ls", reason: "awaiting-approval" });
  s.state = { ...s.state, pendingPermissions: ["r1"] };
  const row = m.liveSummary(s, "a1b2c3d4");
  assert.deepEqual(row.heldGates, [
    { requestId: "r1", tool: "Bash", op: "", summary: "ls", reason: "awaiting-approval" },
  ]);
  // The summaries push is digest-gated, so a held call outside the digest would leave the panel
  // showing a card over an already-answered call until some unrelated field moved.
  const answered = { ...s, state: { ...s.state, pendingPermissions: [] } };
  assert.notEqual(
    m.summariesDigest([row]),
    m.summariesDigest([m.liveSummary(answered, "a1b2c3d4")]),
    "answering it changes the digest"
  );
});

test("SUMMARY: an ENDED row has no held calls — a control over a finished run controls nothing", () => {
  const m = load();
  assert.equal("heldGates" in m.endedSummary({ agentId: "a1b2c3d4" }, "a1b2c3d4"), false);
});

test("BRIDGE: the op is declared in ALL THREE places the preload's surface has to reach", () => {
  // A gap here does not fail, it deletes a feature silently. The preload is ground truth;
  // `src/shared/lib/spa-bridge-sessions.ts` is the shared declaration the channels components
  // compile against, and `apps/desktop-ui/src/lib/dopl-bridge.ts` is the SPA's own mirror.
  const root = join(HERE, "..", "..");
  const read = (...p) => readFileSync(join(root, ...p), "utf8");
  assert.match(read("src", "shared", "lib", "spa-bridge-sessions.ts"), /answerPermission\?\(/,
    "the shared declaration has the op");
  assert.match(read("apps", "desktop-ui", "src", "lib", "dopl-bridge.ts"), /answerPermission\?\(/,
    "…and so does the mirror");
  assert.match(readFileSync(join(HERE, "..", "renderer", "app-preload.js"), "utf8"),
    /answerPermission: \(channelId, taskId, requestId, allow, agentId\) =>/,
    "…and the preload is the ground truth all three follow");
});

// ── 5. THE ANSWER ────────────────────────────────────────────────────────────────────

/** A bound copy of the answer op over ONE fake session. `dispatched` records what reached the
 *  reducer funnel; the dispatch models `resolvePerm`'s delete-as-it-answers. */
function mkAnswerer(over) {
  const s = mkSession(over);
  s.pendingPermissions.set("r1", () => {});
  s.pendingNames.set("r1", "Bash#ls#deadbeef");
  s.state.pendingPermissions = ["r1"];
  const dispatched = [];
  answer.bind({
    resolveSession: (a, channelId) => (channelId === CH && (!a.agentId || a.agentId === "a1b2c3d4") ? s : null),
    dispatch: (sess, ev) => {
      dispatched.push(ev);
      // The engine's FIX-F1 contract: TRUE only when a live resolver really took the answer.
      if (!sess.pendingPermissions.has(ev.requestId)) return false;
      sess.pendingPermissions.delete(ev.requestId);
      sess.pendingNames.delete(ev.requestId);
      return true;
    },
  });
  return { s, dispatched };
}

const CH = "11111111-2222-4333-8444-555555555555";

test("ANSWER: an allow dispatches `permission_decision` as ALLOW-ONCE and reports the resolve", () => {
  const { dispatched } = mkAnswerer();
  assert.deepEqual(
    answer.answerPermission({ channelId: CH, taskId: "t1", agentId: "a1b2c3d4", requestId: "r1", allow: true }),
    { ok: true, decision: "allow-once" }
  );
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, "permission_decision");
  // ALLOW-ONCE, never allow-task: a standing grant keyed on the scoped name is too much to hand
  // over from a compact inline card.
  assert.equal(dispatched[0].decision, "allow-once");
  // The grant name is the SESSION's own recorded key, never a caller's string.
  assert.equal(dispatched[0].name, "Bash#ls#deadbeef");
});

test("ANSWER: a deny is the same lane with the other word", () => {
  const { dispatched } = mkAnswerer();
  assert.deepEqual(
    answer.answerPermission({ channelId: CH, taskId: "t1", requestId: "r1", allow: false }),
    { ok: true, decision: "deny" }
  );
  assert.equal(dispatched[0].decision, "deny");
});

test("ANSWER: `allow` FAILS CLOSED — anything but a literal `true` denies", () => {
  for (const allow of [undefined, null, 0, "", "true", 1, {}, []]) {
    const { dispatched } = mkAnswerer();
    answer.answerPermission({ channelId: CH, taskId: "t1", requestId: "r1", allow });
    assert.equal(dispatched[0].decision, "deny", `allow=${JSON.stringify(allow)} must deny`);
  }
});

test("ANSWER: EXACTLY ONCE — the second click answers {ok:false}, never a blanket success", () => {
  const { dispatched } = mkAnswerer();
  const p = { channelId: CH, taskId: "t1", requestId: "r1", allow: true };
  assert.deepEqual(answer.answerPermission(p), { ok: true, decision: "allow-once" });
  // The second call must not reach the reducer at all: the resolver map no longer holds it.
  assert.deepEqual(answer.answerPermission(p), { ok: false, reason: "unknown-request" });
  assert.equal(dispatched.length, 1, "one dispatch, not two");
});

test("ANSWER: an UNKNOWN request id is refused and dispatches nothing", () => {
  const { dispatched } = mkAnswerer();
  assert.deepEqual(
    answer.answerPermission({ channelId: CH, taskId: "t1", requestId: "nope", allow: true }),
    { ok: false, reason: "unknown-request" }
  );
  assert.equal(dispatched.length, 0);
});

test("ANSWER: a request the reducer still lists but no resolver holds is `already-decided`", () => {
  // The race this closes: a park's `denyPendingPermissions` fail-closed the resolver between the
  // state push the card was drawn from and the click. FIX F1: the honest answer is a refusal with
  // a reason, never a blanket `{ok:true}`.
  const { s } = mkAnswerer();
  let resolvedLive = true;
  answer.bind({ resolveSession: () => s, dispatch: () => { resolvedLive = false; return false; } });
  assert.deepEqual(
    answer.answerPermission({ channelId: CH, taskId: "t1", requestId: "r1", allow: true }),
    { ok: false, reason: "already-decided" }
  );
  assert.equal(resolvedLive, false);
});

test("ANSWER: an address that names nothing live here answers `no-session`", () => {
  mkAnswerer();
  assert.deepEqual(
    answer.answerPermission({ channelId: CH, taskId: "t1", agentId: "zzzzzzzz", requestId: "r1", allow: true }),
    { ok: false, reason: "no-session" }
  );
});

test("ANSWER: a settled session answers `no-session` — an ended agent has nothing to allow", () => {
  const { s } = mkAnswerer();
  s.settled = true;
  assert.deepEqual(
    answer.answerPermission({ channelId: CH, taskId: "t1", requestId: "r1", allow: true }),
    { ok: false, reason: "no-session" }
  );
});

test("ANSWER: the BOUNDARY gates — a non-UUID channel is the plain refusal, indistinguishable", () => {
  const { dispatched } = mkAnswerer();
  // The SAME `{ok:false}` a sender-binding refusal returns, deliberately: a hostile page must not
  // learn which window it is running in from the difference.
  assert.deepEqual(answer.answerPermission({ channelId: "not-a-uuid", requestId: "r1", allow: true }), { ok: false });
  assert.deepEqual(answer.answerPermission({}), { ok: false });
  assert.deepEqual(answer.answerPermission(null), { ok: false });
  assert.equal(dispatched.length, 0);
});

test("ANSWER: an out-of-charset agent id degrades to the thread answer, it does not throw", () => {
  const { dispatched } = mkAnswerer();
  assert.deepEqual(
    answer.answerPermission({ channelId: CH, taskId: "t1", agentId: "NOT VALID", requestId: "r1", allow: true }),
    { ok: true, decision: "allow-once" }
  );
  assert.equal(dispatched.length, 1);
});

test("ANSWER: the request id is BOUNDED at the boundary", () => {
  const { s, dispatched } = mkAnswerer();
  const long = "r".repeat(500);
  s.pendingPermissions.set(long.slice(0, answer.REQUEST_ID_CAP), () => {});
  assert.deepEqual(
    answer.answerPermission({ channelId: CH, taskId: "t1", requestId: long, allow: false }),
    { ok: true, decision: "deny" }
  );
  assert.equal(dispatched[0].requestId.length, answer.REQUEST_ID_CAP);
});

test("ANSWER: UNBOUND FAILS CLOSED — an unbound privileged verb is not a usable one", () => {
  answer.bind(null);
  assert.deepEqual(answer.answerPermission({ channelId: CH, taskId: "t1", requestId: "r1", allow: true }), { ok: false });
});
