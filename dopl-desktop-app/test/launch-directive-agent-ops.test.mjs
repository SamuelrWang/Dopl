// THE AGENT-MANAGEMENT DIRECTIVE KINDS — `end` and `rename` over the launch mailbox
// (2026-09-01, Samuel: "yeah I need you to build out dopl mcp being able to end agents. Dopl MCP
// need to be able to do all that stuff").
//
// ⚠ SPLIT FROM `launch-directives.test.mjs` BY WHAT THE CASES ARE ABOUT, the same rule
// `launch-directive-template.test.mjs` follows and the same shared machinery
// (`_launch-directive-harness.mjs`). That file is about the WATCHER — toggle, owner check, claim,
// containment, goal, model, decision, backstop. This one is about the two new VERBS: which code
// path each routes to, which wire word each failure becomes, and the consent asymmetry.
//
// ⚠ WHAT IS **NOT** WRAPPED: `handle`, `directive-agent-ops.js` and `agent-self-ops.js` are all
// the real ones. Only `session-engine.js` (the live registry) and `agent-names.js` (an
// electron-store) are stubbed, at the seams those modules are stubbed at everywhere else.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HERE, MAIN, boot, decidePosts, claimPosts, row, wire, require_, WS, CH, DID,
} from "./_launch-directive-harness.mjs";

/** A live-registry row, as `session-engine.js › listLiveSessions` projects one. */
const liveRow = (agentId, over = {}) => ({
  sessionId: "s1", key: `${CH}::${agentId}`, channelId: CH, workspaceId: WS,
  taskId: "", agentId, channelName: "General", taskTitle: null, status: "running", hidden: false,
  ...over,
});

/** A pending END directive, as the server would write it. */
const endRow = (over = {}) => row({ kind: "end", task_id: null, goal: null, model: null,
  target_agent_id: "a1b2c3d4", ...over });

/** A pending RENAME directive. ⚠ `target_name: ""` is LEGAL and means CLEAR. */
const renameRow = (name, over = {}) => row({ kind: "rename", task_id: null, goal: null,
  model: null, target_agent_id: "a1b2c3d4", target_name: name, ...over });

const decided = (h) => decidePosts(h).map((p) => p.body);

// ── 1. THE WIRE: THE KINDS AND THE TARGET FIELDS ─────────────────────────────────────────

test("KIND: exactly four, and the launch DEFAULT is the one an unknown collapses to", () => {
  // ⚠ FOUR SINCE 2026-09-01. `set_agent_mode` joined in the agent-efficiency wave and is the ONE
  // non-launch kind that stays behind the consent toggle — a posture GRANTS where an end stops
  // and a rename relabels. `test/directive-set-mode.test.mjs` owns that half.
  assert.deepEqual(wire.KINDS, ["launch", "end", "rename", "set_agent_mode"]);
  assert.equal(wire.KIND_LAUNCH, "launch");
  // ⚠ THE SAFE DIRECTION, AND IT IS NOT AN OVERSIGHT. A fourth kind minted by a newer server
  // reaching this build must not be dispatched by a machine with no branch for it; `launch` is
  // the branch that is FULLY GATED by the operator's toggle, so routing an unknown there is the
  // only reading that is both safe and honest. It must not be dropped either — the row would be
  // claimed and never answered.
  for (const junk of [undefined, null, "", "purge", 7, {}]) {
    assert.equal(wire.directiveFrom(row({ kind: junk }), WS).kind, "launch", String(junk));
  }
  assert.equal(wire.directiveFrom(endRow(), WS).kind, "end");
  assert.equal(wire.directiveFrom(renameRow("Research"), WS).kind, "rename");
});

test("KIND: `done` is the non-launch success and `launched` is NOT reused for it", () => {
  assert.equal(wire.STATUS_DONE, "done");
  assert.ok(wire.STATUSES.includes("done"));
  // ⚠ THE REASON THIS IS A TEST AND NOT A PREFERENCE: this row is read back by the orchestrator
  // that filed it and rendered into an agent-facing sentence. "launched" on the record of an
  // agent being STOPPED is the one kind of wrong nothing downstream can detect, so the two words
  // must stay distinct on the wire, in the column CHECK and in the TS union.
  const SCHEMA = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "schema-launch.ts"), "utf8");
  assert.match(SCHEMA, /status: z\.literal\("done"\)/);
  const TYPES = readFileSync(
    join(HERE, "..", "..", "src", "features", "channels", "types-launch.ts"), "utf8");
  assert.match(TYPES, /"launched" \| "done" \| "refused"/);
});

test("TARGET: `target_agent_id` is shape-checked, in BOTH spellings, and never guessed", () => {
  // ⚠ TWO ROADS, TWO NAMES — a REALTIME frame is the raw row, the CLAIM's answer is the server
  // DTO. `templateId`'s lesson one column over: missing the camelCase spelling would make every
  // directive claimed through the CAS act on nothing.
  assert.equal(wire.directiveFrom(endRow(), WS).targetAgentId, "a1b2c3d4");
  assert.equal(wire.directiveFrom(row({ kind: "end", targetAgentId: "b2c3d4e5" }), WS)
    .targetAgentId, "b2c3d4e5");
  // ⚠ '' IS "NO TARGET", NEVER "the oldest agent". There is no oldest-agent fallback on this
  // lane and an end that guessed is unrecoverable — instance ids are not reused.
  for (const junk of ["A1B2C3D4", "a1b2c3d", "1abcdefg", "@agent-a1b2c3d4", "", null, 7]) {
    assert.equal(wire.directiveFrom(row({ kind: "end", target_agent_id: junk }), WS)
      .targetAgentId, "", String(junk));
  }
  // …and it is the SAME anchored shape `agent-id.js` mints against.
  const idSrc = readFileSync(join(MAIN, "agent-id.js"), "utf8");
  assert.ok(idSrc.includes(wire.AGENT_ID_RE.source),
    "the wire's instance-id shape has drifted from agent-id.js's own");
});

test("TARGET: `target_name` keeps '' apart from null — that difference IS the clear gesture", () => {
  // ⚠ EVERY OTHER STRING ON THIS WIRE COLLAPSES EMPTY TO ''. This one must not: '' is the
  // RENAME'S CLEAR (back to `Agent #<id>`) and `null` is "this directive is not a rename".
  // Collapsing them would turn "no rename requested" into "wipe the name" on a kind that never
  // asked for one.
  assert.equal(wire.directiveFrom(renameRow(""), WS).targetName, "");
  assert.equal(wire.directiveFrom(renameRow("Research"), WS).targetName, "Research");
  assert.equal(wire.directiveFrom(endRow(), WS).targetName, null);
  assert.equal(wire.directiveFrom(row(), WS).targetName, null, "a launch carries none");
  assert.equal(wire.directiveFrom(row({ kind: "rename", targetName: "Verifier" }), WS)
    .targetName, "Verifier", "the DTO spelling too");
  // ⚠ BOUNDED BUT NOT TRUNCATED TO THE LIMIT: it keeps one character MORE than `MAX_NAME` so an
  // over-long name reaches `sanitizeName` and is REFUSED as `bad-name`, rather than being stored
  // silently shortened. Truncating here would store something other than what was asked for.
  const long = wire.directiveFrom(renameRow("z".repeat(400)), WS);
  assert.equal(long.targetName.length, wire.TARGET_NAME_MAX + 1);
  assert.equal(wire.TARGET_NAME_MAX, 60, "agent-names.js › MAX_NAME");
  const namesSrc = readFileSync(join(MAIN, "agent-names.js"), "utf8");
  assert.match(namesSrc, /const MAX_NAME = 60;/, "the store's own cap has moved and this has not");
});

// ── 2. END — THE SHARED PATH, NOT A SECOND IMPLEMENTATION ────────────────────────────────

test("END: dispatches through the SAME controlByTask the in-process verb and the Agents tab use",
  async () => {
    const h = boot({ live: [liveRow("a1b2c3d4")] });
    await h.api.handle(endRow(), WS);
    assert.equal(claimPosts(h).length, 1, "it is claimed like any other directive");
    // ⚠ THE ADDRESS COMES FROM THE RESOLVED REGISTRY ROW, NOT FROM THE WIRE. Re-deriving a
    // session key from directive fields is how the lane and the engine come to disagree about
    // which session a request names.
    assert.deepEqual(h.controls, [{ channelId: CH, taskId: "", agentId: "a1b2c3d4", action: "end" }]);
    assert.deepEqual(decided(h), [{ directiveId: DID, status: "done" }]);
  });

test("END: it is the SAME two calls `axis-b.js`'s in-process end_agent makes, in order", () => {
  // ⚠ SOURCE-LEVEL, ON PURPOSE. The behavioural case above proves the dispatch happens; this one
  // proves it was not REIMPLEMENTED — the whole constraint on `directive-agent-ops.js` is that a
  // second stop path is a second set of teardown bugs.
  const src = readFileSync(join(MAIN, "directive-agent-ops.js"), "utf8");
  assert.match(src, /agentOps\.endVerdict\(/, "the verdict table is agent-self-ops.js's");
  assert.match(src, /controlByTask\(\{/, "…and the dispatch is session-engine.js's");
  assert.ok(!/dispatch\(|settleSession|\{ type: 'end' \}/.test(src),
    "it must never reach past controlByTask into the reducer itself");
  const axisB = readFileSync(join(MAIN, "runtime", "claude", "axis-b.js"), "utf8");
  assert.match(axisB, /agentOps\.endVerdict\(/, "the in-process verb still uses the same table");
});

test("END: no live session answers `no-session` — the ordinary case, and NOT an error", async () => {
  // ⚠ AN AGENT THAT FINISHED IS THE COMMONEST CAUSE, and on an END that is the outcome the
  // requester wanted, reached without them. The word must be `no-session` and never `no-bridge`,
  // which an orchestrator reads as its operator having switched something off.
  const h = boot({ live: [] });
  await h.api.handle(endRow(), WS);
  assert.deepEqual(h.controls, [], "nothing was dispatched");
  assert.deepEqual(decided(h),
    [{ directiveId: DID, status: "refused", refusalReason: "no-session" }]);
});

test("END: a session that settles between the lookup and the dispatch is `no-session` too",
  async () => {
    const h = boot({ live: [liveRow("a1b2c3d4")], control: { ok: false, reason: "no-session" } });
    await h.api.handle(endRow(), WS);
    assert.equal(h.controls.length, 1, "it tried");
    assert.deepEqual(decided(h),
      [{ directiveId: DID, status: "refused", refusalReason: "no-session" }]);
  });

test("END: a directive naming a DIFFERENT agent than the live one is refused, never redirected",
  async () => {
    // ⚠ THE POINT IS THE ABSENCE OF A FALLBACK. `endVerdict` finds the row by EXACT id; with N
    // agents per thread since 2026-08-21, "the oldest one in this channel" is a real and wrong
    // answer, and an end that took it is unrecoverable.
    const h = boot({ live: [liveRow("z9y8x7w6")] });
    await h.api.handle(endRow(), WS);
    assert.deepEqual(h.controls, []);
    assert.equal(decided(h)[0].refusalReason, "no-session");
  });

// ── 3. RENAME — DISPLAY ONLY, AND THE ONE WRITE ──────────────────────────────────────────

test("RENAME: goes through `agent-self-ops.js › applyRenameTo`, the ONE rename write", async () => {
  const h = boot({});
  await h.api.handle(renameRow("Research"), WS);
  assert.deepEqual(h.names, [{ op: "rename", agentId: "a1b2c3d4", name: "Research" }]);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "done" }]);
  // ⚠ THE SHARING IS THE TEST. Three callers now — this lane, `sessions:rename` and the
  // in-process tool — and a third statement of "empty means clear" is how one surface quietly
  // loses the only gesture that undoes a rename.
  for (const [file, label] of [
    [join(MAIN, "directive-agent-ops.js"), "the directive lane"],
    [join(MAIN, "session-ipc-ops.js"), "sessions:rename"],
    [join(MAIN, "runtime", "claude", "axis-b.js"), "the in-process tool"],
  ]) {
    assert.match(readFileSync(file, "utf8"), /applyRenameTo\(/, label);
  }
});

test("RENAME: an EMPTY name CLEARS — it is a legal value, not a missing one", async () => {
  const h = boot({});
  await h.api.handle(renameRow(""), WS);
  assert.deepEqual(h.names, [{ op: "clear", agentId: "a1b2c3d4" }]);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "done" }]);
});

test("RENAME: a sanitizer refusal is `bad-name`, and the agent is otherwise untouched", async () => {
  // ⚠ REFUSED, NOT STRIPPED. `sanitizeName` rejects control, zero-width and bidi characters
  // instead of removing them, because storing a silently altered name is worse than not storing
  // it — and `bad-name` exists so that refusal does not arrive as `no-bridge`, which reads to an
  // orchestrator as the operator having turned the lane off.
  const h = boot({ renameAnswer: null });
  await h.api.handle(renameRow("Resea‮rch"), WS);
  assert.deepEqual(decided(h),
    [{ directiveId: DID, status: "refused", refusalReason: "bad-name" }]);
  assert.deepEqual(h.controls, [], "a refused rename stops nothing");
});

test("RENAME: it consults NO registry — a name outlives the session object, deliberately",
  async () => {
    // `agent-names.js` is keyed by the INSTANCE ADDRESS and survives an idle park, a lazy resume
    // and a crash resume; `sessions:rename` consults no registry either. Requiring a live session
    // would make a name un-settable at exactly the moments a session is being rebuilt.
    const h = boot({ live: [] });
    await h.api.handle(renameRow("Verifier"), WS);
    assert.equal(h.names.length, 1);
    assert.deepEqual(decided(h), [{ directiveId: DID, status: "done" }]);
  });

// ── 4. THE CONSENT ASYMMETRY — SAMUEL'S RULING, AND THE ASSUMPTION TO OVERRULE ───────────

test("CONSENT: end and rename are answered with the LAUNCH TOGGLE OFF", async () => {
  // ⚠ **THIS IS THE RULING, AS A TEST.** A STOP verb and a DISPLAY verb widen nothing — neither
  // can start a query, wake a shell, grant a tool or post — and the toggle exists to gate LOCAL
  // COMPUTE BEING SPENT, which neither spends. `agent-self-ops.js` already carries the same
  // argument for the in-process twins of these two verbs, which is why they ride pre-approved
  // past the Axis-A gate inside every spawned session.
  // ⚠ IF SAMUEL OVERRULES IT, this is the case that changes, and the change is one `if` in
  // `launch-directives.js › handle`.
  const h = boot({ enabled: false, live: [liveRow("a1b2c3d4")] });
  await h.api.handle(endRow(), WS);
  assert.deepEqual(decided(h), [{ directiveId: DID, status: "done" }]);
  const h2 = boot({ enabled: false });
  await h2.api.handle(renameRow("Research"), WS);
  assert.deepEqual(decided(h2), [{ directiveId: DID, status: "done" }]);
});

test("CONSENT: …and a LAUNCH with the toggle off is still refused in silence", async () => {
  // ⚠ THE OTHER HALF, IN THE SAME FILE ON PURPOSE. The asymmetry is only defensible if the §6
  // gate is untouched, so the two live beside each other: one row, one toggle, opposite answers.
  const h = boot({ enabled: false, live: [liveRow("a1b2c3d4")] });
  await h.api.handle(row(), WS);
  assert.deepEqual(h.posts, [], "no claim, no decision, nothing said about itself");
  assert.equal(h.cfg.lastSpec, undefined, "and nothing spawned");
});

// ── 5. THE DISPATCH ITSELF ───────────────────────────────────────────────────────────────

test("DISPATCH: an end/rename NEVER reaches the spawn funnel", async () => {
  const h = boot({ live: [liveRow("a1b2c3d4")] });
  await h.api.handle(endRow(), WS);
  await h.api.handle(renameRow("Research", { id: DID.replace(/6/g, "8") }), WS);
  assert.equal(h.cfg.lastSpec, undefined,
    "no session was launched, and no containment input was ever assembled");
  assert.deepEqual(h.resolves, [], "and no template was resolved");
});

test("DISPATCH: the CLAIMED row's kind decides, not the frame's", async () => {
  // ⚠ THE CAS'S ANSWER IS THE AUTHENTICATED ONE. `claim` re-narrows from what the server GRANTED,
  // and if the realtime frame disagrees the granted row wins — the same rule the goal, the model
  // and the template already follow. A frame claiming `kind: "end"` that is granted as a LAUNCH
  // must launch, not end.
  const h = boot({
    live: [liveRow("a1b2c3d4")],
    claimed: { ...row(), status: "claimed" },
  });
  await h.api.handle(endRow(), WS);
  assert.deepEqual(h.controls, [], "the granted row was a launch, so nothing was ended");
  assert.ok(h.cfg.lastSpec, "it spawned instead");
});

test("DISPATCH: every claimed directive is DECIDED — none is left to expire silently", async () => {
  // ⚠ A CLAIMED DIRECTIVE NOBODY DECIDES IS THE ONE OUTCOME THE ORCHESTRATOR CANNOT ACT ON. The
  // fallthrough in `apply` exists for exactly this, and this case drives the shape that would
  // reach it if `directiveFrom`'s collapse ever stopped working.
  const ops = require_(join(MAIN, "directive-agent-ops.js"));
  const out = ops.apply({ kind: "purge", targetAgentId: "a1b2c3d4" });
  assert.deepEqual(out, { refused: "no-bridge" });
  assert.ok(!("done" in out), "an unknown kind must never report success");
});

// ── 6. THE MIGRATION — THE COLUMN CAN STORE WHAT THIS MACHINE PRODUCES ───────────────────

test("MIGRATION: the CHECK admits the two words this lane produces, and still bans the one it must",
  () => {
    // ⚠ THE 2026-08-22 LESSON, APPLIED. That wave put a seventh word in four TypeScript files
    // while the column CHECK stayed at six: a `decide` carrying it passed zod, passed the route
    // and was refused AT REST — a 500 on the one write whose whole job is to report honestly.
    // This wave lands the CHECK WITH the producer, and this case is what proves it.
    const sql = readFileSync(join(HERE, "..", "..", "supabase", "migrations",
      "20260907120000_channel_launch_directives_kind.sql"), "utf8");
    for (const word of ["no-session", "bad-name", "no-template", "no-bridge"]) {
      assert.ok(sql.includes(`'${word}'`), `the refusal CHECK must admit ${word}`);
    }
    // ⚠ THE NEGATIVE PIN, CARRIED FORWARD. `template-approval` is the desktop's word to its OWN
    // renderer for a first-use click; this lane has no human at the keyboard, so a column that
    // could store it would tell a future reader the lane has an approval gate it does not have.
    assert.ok(!wire.REFUSAL_REASONS.includes("template-approval"));
    assert.match(sql, /ABORT: template-approval reached the DIRECTIVE refusal vocabulary/);
    // The kind, its DEFAULT, and the two target columns staying OPTIONAL (a LAUNCH names none).
    assert.match(sql, /kind TEXT NOT NULL DEFAULT 'launch'/);
    assert.match(sql, /CHECK \(kind IN \('launch', 'end', 'rename'\)\)/);
    assert.match(sql, /ABORT: a target column carries a DEFAULT or NOT NULL/);
    // ⚠ AND IT NEVER TOUCHES THE REPLICA IDENTITY — losing that makes every claim and every
    // decide stop reaching this machine. The migration asserts it survived rather than assuming.
    assert.ok(!/REPLICA IDENTITY\s+USING INDEX/.test(sql.replace(/^--.*$/gm, "")),
      "this file must not redefine the replica identity");
    assert.match(sql, /ABORT: channel_launch_directives has no replica-identity index/);
  });
