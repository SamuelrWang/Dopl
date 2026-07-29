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
