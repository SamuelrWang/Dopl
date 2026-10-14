// MSP approvals → Dopl's gate → `approval/decide`, driven with Meta's own approval transcripts.
// The receipt is `{}` and never waits; the decision is ONE command per (approval, stage), naming a ONCE
// choice from the approval's own list; a gate that throws is a deny; an approval Dopl cannot answer
// interrupts the turn rather than parking it forever.

import { test } from "node:test";
import assert from "node:assert/strict";
import { notifications, serverRequests, m, until } from "./_muse-harness.mjs";

const approval = m("approval.js");
const tools = m("tools.js");
const policy = m("policy.js");

const requested = (name) => notifications(name).find((n) => n.method === "approval/requested").params;

function drive(gateAnswer, extra = {}) {
  const decided = [];
  const asked = [];
  let stuck = null;
  const driver = approval.makeApprovalDriver(Object.assign({
    gate: async (name, input) => { asked.push({ name, input }); return typeof gateAnswer === "function" ? gateAnswer(name) : gateAnswer; },
    request: async (method, params) => { decided.push({ method, params }); return { status: "accepted", terminal: true }; },
    sessionId: () => "sess",
    commandId: () => "01a1369a-0000-7000-8000-000000000000",
    onStuck: (why) => { stuck = why; },
  }, extra));
  return { driver, decided, asked, stuck: () => stuck };
}

test("approval-round-trip: the request is answered with the bare receipt, at once, and the decision is a separate command", async () => {
  const req = serverRequests("meta/approval-round-trip.ndjson").find((r) => r.method === "approval/request");
  let release;
  const h = drive(() => new Promise((r) => { release = r; }));
  assert.deepEqual(h.driver.onServerRequest(req), {}, "a receipt never waits on a person");
  await until(() => h.asked.length === 1, "the gate was asked");
  release("allow");
  await until(() => h.decided.length === 1, "no decision sent");
  const d = h.decided[0];
  assert.equal(d.method, "approval/decide");
  assert.equal(d.params.approvalId, req.params.approvalId);
  assert.deepEqual(d.params.requirementId, req.params.currentRequirementId);
  assert.equal(d.params.choiceId, "allow_once", "never the session-scoped grant Meta's fixture picked");
});

test("the notification and the request for ONE approval are decided ONCE", async () => {
  const name = "meta/approval-round-trip.ndjson";
  const h = drive("allow");
  h.driver.onNotification({ method: "approval/requested", params: requested(name) });
  h.driver.onServerRequest(serverRequests(name).find((r) => r.method === "approval/request"));
  await until(() => h.decided.length === 1, "no decision");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.decided.length, 1);
  assert.equal(h.asked.length, 1);
});

test("approval-deny-round-trip: a deny sends the approval's own once-scoped deny choice", async () => {
  const p = requested("meta/approval-deny-round-trip.ndjson");
  const h = drive("deny");
  h.driver.onNotification({ method: "approval/requested", params: p });
  await until(() => h.decided.length === 1, "no decision");
  const chosen = p.availableChoices.find((c) => c.choiceId === h.decided[0].params.choiceId);
  assert.ok(chosen && (chosen.decision === "denied" || chosen.decision === "abort"), JSON.stringify(chosen));
});

test("a gate that THROWS is a deny, not an operator who said yes", async () => {
  const p = requested("meta/approval-round-trip.ndjson");
  const h = drive(() => { throw new Error("boom"); });
  h.driver.onNotification({ method: "approval/requested", params: p });
  await until(() => h.decided.length === 1, "no decision");
  assert.notEqual(h.decided[0].params.choiceId, "allow_once");
});

test("the gate is asked in MSP's words: subject kind, or the MCP tool's own name with its parsed arguments", () => {
  assert.equal(approval.gateName({ subject: { kind: "shell", command: "ls" } }), "shell");
  assert.equal(approval.gateName({ subject: { kind: "fileAccess" } }), "fileAccess");
  const mcpAsk = { subject: { kind: "tool" }, toolName: "mcp__dopl_session__dopl_channel", rawArgs: "{\"op\":\"post\",\"text\":\"hi\"}" };
  assert.equal(approval.gateName(mcpAsk), "mcp__dopl_session__dopl_channel");
  assert.deepEqual(approval.gateInput(mcpAsk), { op: "post", text: "hi" });
  // Unknown kinds are NEVER auto-approved: the shared unrecognised prefix (no grant, denied when restricted).
  assert.equal(approval.gateName({ subject: { kind: "teleport" } }), `${approval.UNKNOWN_PREFIX}teleport`);
  assert.equal(approval.gateName({}), `${approval.UNKNOWN_PREFIX}unknown`);
});

test("an allow with no once-scoped approve choice is NOT widened to a session grant — it is denied", async () => {
  const p = { approvalId: "a1", currentRequirementId: { approvalId: "a1", sourceIndex: 0 }, subject: { kind: "shell" },
    availableChoices: [{ choiceId: "always", decision: "approvedForSession", scope: "session" }, { choiceId: "no", decision: "denied", scope: "once" }] };
  const h = drive("allow");
  h.driver.onNotification({ method: "approval/requested", params: p });
  await until(() => h.decided.length === 1, "no decision");
  assert.equal(h.decided[0].params.choiceId, "no");
});

test("an approval offering NO usable choice interrupts the turn instead of parking it forever", async () => {
  const p = { approvalId: "a2", currentRequirementId: { approvalId: "a2", sourceIndex: 0 }, subject: { kind: "shell" }, availableChoices: [] };
  const h = drive("deny");
  h.driver.onNotification({ method: "approval/requested", params: p });
  await until(() => h.stuck() !== null, "not interrupted");
  assert.equal(h.decided.length, 0);
});

test("a multi-stage approval is asked again per stage (`approval/updated` moves the requirement)", async () => {
  const base = { approvalId: "a3", subject: { kind: "shell" }, availableChoices: [{ choiceId: "y", decision: "approved", scope: "once" }] };
  const h = drive("allow");
  h.driver.onNotification({ method: "approval/requested", params: { ...base, currentRequirementId: { approvalId: "a3", sourceIndex: 0 } } });
  h.driver.onNotification({ method: "approval/updated", params: { ...base, currentRequirementId: { approvalId: "a3", sourceIndex: 1 } } });
  await until(() => h.decided.length === 2, "second stage not decided");
  assert.deepEqual(h.decided.map((d) => d.params.requirementId.sourceIndex), [0, 1]);
});

test("a server request Dopl does not know is SHOWN and refused -32601 — never a guessed reply", () => {
  let shown = null;
  const h = drive("allow", { onUnknown: (method) => { shown = method; } });
  assert.throws(() => h.driver.onServerRequest({ id: 9, method: "admission/request", params: {} }), (e) => e.rpcCode === -32601);
  assert.equal(shown, "admission/request");
});

test("Axis A in MSP words: promptUnmatched allows only Dopl reads; onRequest adds file access; allowAll adds the shell and Dopl writes", () => {
  assert.equal(tools.axisAAllows("promptUnmatched", "fileAccess"), false);
  assert.equal(tools.axisAAllows("onRequest", "fileAccess"), true);
  assert.equal(tools.axisAAllows("onRequest", "shell"), false);
  assert.equal(tools.axisAAllows("allowAll", "shell"), true);
  assert.equal(tools.axisAAllows("allowAll", "mcp__someone__else"), false, "an unknown tool gates in every mode");
  assert.equal(tools.axisAAllows("bogus", "fileAccess"), false, "an unknown mode is the narrowest");
});

test("the native mode: `allowAll` is SENT as onRequest so Dopl's MCP writes still raise an approval; the judge never decides", () => {
  assert.equal(policy.nativeApprovalMode("allowAll"), "onRequest");
  assert.equal(policy.nativeApprovalMode("promptUnmatched"), "promptUnmatched");
  assert.equal(policy.nativeApprovalMode("nonsense"), "promptUnmatched");
  for (const p of ["read_only", "dopl_only", "channel_agent", "full"]) {
    const prof = tools.buildSessionToolConfig(p).native.permissionProfile;
    assert.ok([":ask-me", ":read-only"].includes(prof), `${p} → ${prof}: only human-reviewed profiles`);
  }
});

test("restricted profiles fence the host: no writes, no shell, no web; channel_agent loses only the shell", () => {
  const flags = (p) => tools.buildSessionToolConfig(p).native.serveFlags;
  for (const p of ["read_only", "dopl_only"]) {
    for (const f of ["--disable-write", "--disable-shell", "tools.web_fetch.enabled=false"]) assert.ok(flags(p).includes(f), `${p} lacks ${f}`);
  }
  assert.ok(flags("channel_agent").includes("--disable-shell"));
  assert.ok(!flags("channel_agent").includes("--disable-write"));
  assert.ok(!flags("full").includes("--disable-shell"));
  for (const p of ["read_only", "dopl_only", "channel_agent", "full"]) assert.ok(flags(p).includes('run.workflow_trigger_mode="off"'));
});
