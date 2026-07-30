// Tests for the per-session auto-approve GRANT path (main/session-io.js makeCanUseTool,
// Track T2, item 10 — the security-critical flip).
//
// session-io.js imports nothing electron-bound, so we require it in plain Node and drive
// the REAL canUseTool bridge against the REAL session-profiles grantDecision (via a
// session with a real tool profile). Under the `full` profile: `Bash` GATES, `Task` is
// hard-denied, `Read` is preapproved — so we exercise every branch that matters.
//
// THE BOUND (§H-2, proven here): auto-approve flips ONLY a live GATE to allow, WITHOUT a
// dispatch. A hard-DENY decision stays deny even with auto ON (the SESSION_HARD_DENY
// belt is immovable); with auto OFF a gate still dispatches a permission_request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const io = require(join(HERE, "..", "main", "session-io.js"));

// A minimal live-session stub — just the fields makeCanUseTool reads. `autoApprove`
// lives on state exactly as the reducer models it.
function mkSession(autoApprove) {
  return {
    profile: "full",
    channelId: "ch1",
    state: { allowForTask: [], autoApprove },
    pendingPermissions: new Map(),
    pendingNames: new Map(),
  };
}

// A recording dispatch so we can assert whether a permission_request was dispatched.
function recorder() {
  const events = [];
  return { events, dispatch: (_s, ev) => events.push(ev) };
}

test("auto OFF: a GATE tool dispatches a permission_request and parks (no resolution yet)", async () => {
  const s = mkSession(false);
  const rec = recorder();
  const canUse = io.makeCanUseTool(s, rec.dispatch);
  const p = canUse("Bash", { command: "ls" }, { requestId: "r1" });
  assert.equal(rec.events.length, 1, "exactly one dispatch");
  assert.equal(rec.events[0].type, "permission_request");
  assert.equal(rec.events[0].name, "Bash");
  assert.equal(s.pendingPermissions.size, 1, "the resolver is parked for the operator button");
  // Resolve it so the promise settles (deny) and nothing dangles.
  s.pendingPermissions.get("r1")({ behavior: "deny" });
  assert.deepEqual(await p, { behavior: "deny" });
});

test("auto ON: a GATE tool resolves {allow} with NO dispatch and NO parked resolver", async () => {
  const s = mkSession(true);
  const rec = recorder();
  const canUse = io.makeCanUseTool(s, rec.dispatch);
  const res = await canUse("Bash", { command: "ls" }, { requestId: "r2" });
  assert.deepEqual(res, { behavior: "allow" });
  assert.equal(rec.events.length, 0, "auto-approve dispatches nothing — the dock is never touched");
  assert.equal(s.pendingPermissions.size, 0, "no resolver parked");
});

test("auto ON: a hard-DENIED tool STILL resolves {deny} (the belt is immovable, §H-2)", async () => {
  const s = mkSession(true);
  const rec = recorder();
  const canUse = io.makeCanUseTool(s, rec.dispatch);
  const res = await canUse("Task", { description: "spawn" }, { requestId: "r3" });
  assert.equal(res.behavior, "deny", "auto-approve NEVER un-denies a hard-denied tool");
  assert.equal(rec.events.length, 0, "a hard-deny is decided before any gate/dispatch");
});

test("auto ON: a preapproved read is allowed exactly as before (auto-approve does not widen it)", async () => {
  const s = mkSession(true);
  const rec = recorder();
  const canUse = io.makeCanUseTool(s, rec.dispatch);
  const res = await canUse("Read", { file_path: "/x" }, { requestId: "r4" });
  assert.deepEqual(res, { behavior: "allow" });
  assert.equal(rec.events.length, 0);
});

// ── v2.5 D2: the OUTBOUND GATE reaches canUseTool ────────────────────────────────
// The reversal that matters: an own-channel op=post used to resolve 'preapproved' inside
// canUseTool and return {allow} with NO dispatch. It must now PARK on the operator's dock
// like any other write, carrying the drafted body so the dock can render it.

const CHANNEL_TOOL = "mcp__dopl__dopl_channel";
const POST = { op: "post", body: "Shipping the invoice import tonight." };

test("D2: an own-channel post DISPATCHES a permission_request (it no longer auto-allows)", async () => {
  const s = mkSession(false);
  const rec = recorder();
  const p = io.makeCanUseTool(s, rec.dispatch)(CHANNEL_TOOL, POST, { requestId: "r10" });
  assert.equal(rec.events.length, 1, "the post reaches the gate");
  assert.equal(rec.events[0].type, "permission_request");
  assert.equal(s.pendingPermissions.size, 1, "the SDK call is parked on an operator button");
  // The payload carries the real tool name + the full input, so the dock can show the body.
  assert.equal(rec.events[0].payload.name, CHANNEL_TOOL);
  assert.deepEqual(rec.events[0].payload.inputFull, POST);
  s.pendingPermissions.get("r10")({ behavior: "deny", message: "Denied by operator" });
  assert.equal((await p).behavior, "deny", "a DENY on a post stops the message leaving the machine");
});

test("D2: the allow-for-task grant recorded for a post is the SCOPED post key", async () => {
  const s = mkSession(false);
  const rec = recorder();
  io.makeCanUseTool(s, rec.dispatch)(CHANNEL_TOOL, POST, { requestId: "r11" });
  const grantName = rec.events[0].name; // what the reducer puts in allowForTask
  assert.equal(grantName, CHANNEL_TOOL + "#post", "not the bare tool name");
  assert.equal(s.pendingNames.get("r11"), grantName, "session-ipc reads the same key back");
  // With that grant in hand, a later post allows with no button — but op=open still gates.
  s.state.allowForTask = [grantName];
  const rec2 = recorder();
  const canUse2 = io.makeCanUseTool(s, rec2.dispatch);
  assert.deepEqual(await canUse2(CHANNEL_TOOL, POST, { requestId: "r12" }), { behavior: "allow" });
  assert.equal(rec2.events.length, 0, "no second prompt for the granted shape");
  canUse2(CHANNEL_TOOL, { op: "open", direct: true, member: "evil@x" }, { requestId: "r13" });
  assert.equal(rec2.events.length, 1, "a DM open still needs its own decision");
  s.pendingPermissions.get("r13")({ behavior: "deny" });
});

// FIX F2: the bare tool name is NEVER recorded any more. A non-post op used to hand the
// reducer `dopl_channel` itself, and grantDecision honored that for every op — so one
// click on a read/list/create_task prompt silently authorized op=post AND op=open for the
// rest of the task. Each op now earns its own key.
test("FIX F2: a NON-post dopl_channel op records an OP-SCOPED grant, never the bare tool", () => {
  const s = mkSession(false);
  const rec = recorder();
  io.makeCanUseTool(s, rec.dispatch)(CHANNEL_TOOL, { op: "create_task" }, { requestId: "r14" });
  assert.equal(rec.events[0].name, CHANNEL_TOOL + "#op:create_task");
  assert.notEqual(rec.events[0].name, CHANNEL_TOOL, "a bare-tool grant would cover every op");
  assert.equal(rec.events[0].payload.name, CHANNEL_TOOL, "the dock still shows the real tool name");
  s.pendingPermissions.get("r14")({ behavior: "deny" });
});

test("FIX F2: a grant taken on op=read does NOT let a later post or DM open through", async () => {
  const s = mkSession(false);
  const rec = recorder();
  const canUse = io.makeCanUseTool(s, rec.dispatch);
  canUse(CHANNEL_TOOL, { op: "read" }, { requestId: "r20" });
  const readGrant = rec.events[0].name;
  assert.equal(readGrant, CHANNEL_TOOL + "#op:read");
  s.pendingPermissions.get("r20")({ behavior: "allow" });
  // The operator picked "Allow for this task" on that READ — the reducer stores this key.
  s.state.allowForTask = [readGrant];
  const rec2 = recorder();
  const canUse2 = io.makeCanUseTool(s, rec2.dispatch);
  canUse2(CHANNEL_TOOL, POST, { requestId: "r21" });
  canUse2(CHANNEL_TOOL, { op: "open", direct: true, member: "evil@x" }, { requestId: "r22" });
  assert.equal(rec2.events.length, 2, "the post AND the DM open each still need their own decision");
  assert.deepEqual(rec2.events.map((e) => e.name), [CHANNEL_TOOL + "#post", CHANNEL_TOOL + "#op:open"]);
  // A second op=read rides the grant it was actually given.
  assert.deepEqual(await canUse2(CHANNEL_TOOL, { op: "read" }, { requestId: "r23" }), { behavior: "allow" });
  assert.equal(rec2.events.length, 2, "no new prompt for the granted op");
  for (const id of ["r21", "r22"]) s.pendingPermissions.get(id)({ behavior: "deny" });
});

test("D2: auto-approve covers a post too (one switch, gated tools AND outbound)", async () => {
  const s = mkSession(true);
  const rec = recorder();
  const res = await io.makeCanUseTool(s, rec.dispatch)(CHANNEL_TOOL, POST, { requestId: "r15" });
  assert.deepEqual(res, { behavior: "allow" });
  assert.equal(rec.events.length, 0, "the operator opted out of being asked");
});

test("the flip reads s.state.autoApprove LIVE — the same session gates then auto-allows", async () => {
  const s = mkSession(false);
  const rec = recorder();
  const canUse = io.makeCanUseTool(s, rec.dispatch);
  // OFF first: gate dispatches.
  const p1 = canUse("Write", { file_path: "/x", content: "y" }, { requestId: "r5" });
  assert.equal(rec.events.length, 1);
  s.pendingPermissions.get("r5")({ behavior: "deny" });
  await p1;
  // Operator flips auto ON (the reducer would set this) — now the SAME session auto-allows.
  s.state.autoApprove = true;
  const res = await canUse("Write", { file_path: "/x", content: "y" }, { requestId: "r6" });
  assert.deepEqual(res, { behavior: "allow" });
  assert.equal(rec.events.length, 1, "no new dispatch after the flip");
});
