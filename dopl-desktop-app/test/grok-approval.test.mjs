// Grok's gate: the recorded `_x.ai/hooks/run` and `session/request_permission` requests (grok 1.0.52) driven
// through `approval.js › makeApprovalDriver` with a scripted gate. Pins: containment answered in the hook (deny
// fails only that tool), a Dopl call asked of the gate ONCE across both channels, a parked verdict left to the
// permission request, once-scoped options only, cancel on interrupt, and the restricted profiles' allow-list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { g, serverRequests, outbound } from "./_grok-harness.mjs";

const approval = g("approval.js");
const tools = g("tools.js");
const S2 = "smoke-s2-dopl-config.ndjson";

const hooks = serverRequests(S2, "_x.ai/hooks/run");
const perm = serverRequests(S2, "session/request_permission")[0];
const hookFor = (re) => hooks.find((h) => re.test(JSON.stringify(h.params)));

function driver({ profile = "full", verdict = () => ({ behavior: "allow" }) } = {}) {
  const asked = [];
  const d = approval.makeApprovalDriver({
    cfg: tools.buildSessionToolConfig(profile),
    gate: (name, input, meta) => { asked.push({ name, input, meta }); return verdict(name, input); },
    log: () => {},
    onUnknown: (m) => asked.push({ unknown: m }),
  });
  return { d, asked };
}

test("the recorded hook payloads name the RESOLVED tool; Dopl's call reaches the gate with its own arguments", async () => {
  const { d, asked } = driver();
  const post = hookFor(/dopl_session__post_message/);
  assert.deepEqual(await d.onServerRequest(post), { decision: "continue" });
  assert.deepEqual(asked.map((a) => a.name), ["mcp__dopl_session__post_message"]);
  assert.deepEqual(asked[0].input, { text: "smoke2" }, "the use_tool wrapper is unwrapped");
  // A built-in Grok asks about later (or never) is NOT put to the gate in the hook — no orphan card.
  for (const re of [/echo hi/, /note\.txt/, /out\.txt/, /search_tool/]) {
    assert.deepEqual(await d.onServerRequest(hookFor(re)), { decision: "continue" }, String(re));
  }
  assert.equal(asked.length, 1);
});

test("the permission request for that call is answered from the SAME gate verdict — the gate is asked once", async () => {
  const { d, asked } = driver();
  await d.onServerRequest(hookFor(/dopl_session__post_message/));
  const reply = await d.onServerRequest(perm);
  assert.deepEqual(reply, { outcome: { outcome: "selected", optionId: "allow-once" } });
  assert.equal(asked.length, 1, "one ask per call: the gate mints the outbound tag");
  assert.equal(perm.params.toolCall.toolCallId, hookFor(/dopl_session__post_message/).params.toolUseId, "LIVE: the ids join");
});

test("a SETTLED deny is answered in the hook (only that tool fails); a PARKED one waits in the permission request", async () => {
  const denied = driver({ verdict: () => ({ behavior: "deny", message: "Not in this channel." }) });
  assert.deepEqual(await denied.d.onServerRequest(hookFor(/dopl_session__post_message/)), { decision: "deny", systemMessage: "Not in this channel." });

  let release;
  const parked = driver({ verdict: () => new Promise((r) => { release = r; }) });
  assert.deepEqual(await parked.d.onServerRequest(hookFor(/dopl_session__post_message/)), { decision: "continue" }, "the hook never waits on a person (it fails open)");
  const pending = parked.d.onServerRequest(perm);
  release({ behavior: "deny" });
  assert.deepEqual(await pending, { outcome: { outcome: "selected", optionId: "reject-once" } }, "the recorded reply shape");
  assert.equal(parked.asked.length, 1);
  const recorded = outbound(S2).find((m) => m.id === perm.id && m.result && m.result.outcome);
  assert.deepEqual(recorded.result, { outcome: { outcome: "selected", optionId: "reject-once" } });
});

test("a permission request with no hook before it asks the gate itself; a throwing gate is a deny", async () => {
  const { d, asked } = driver();
  assert.equal((await d.onServerRequest(perm)).outcome.optionId, "allow-once");
  assert.equal(asked[0].name, "mcp__dopl_session__post_message");
  const boom = approval.makeApprovalDriver({ cfg: tools.buildSessionToolConfig("full"), gate: () => { throw new Error("x"); } });
  assert.equal((await boom.onServerRequest(perm)).outcome.optionId, "reject-once");
});

test("only ONCE-scoped options are ever sent: an allow with only `allow_always` is a deny; none at all → cancelled", async () => {
  const { d } = driver();
  const always = { ...perm, params: { ...perm.params, options: [{ optionId: "always-allow", kind: "allow_always" }, { optionId: "reject-once", kind: "reject_once" }] } };
  assert.equal((await d.onServerRequest(always)).outcome.optionId, "reject-once");
  const bare = { ...perm, params: { ...perm.params, options: [{ optionId: "always-allow", kind: "allow_always" }] } };
  assert.deepEqual(await d.onServerRequest(bare), { outcome: { outcome: "cancelled" } });
});

test("an interrupt answers every permission still waiting `cancelled` (ACP's cancel contract)", async () => {
  const { d } = driver({ verdict: () => new Promise(() => {}) });
  const pending = d.onServerRequest(perm);
  d.cancelPending();
  assert.deepEqual(await pending, { outcome: { outcome: "cancelled" } });
});

test("containment in the HOOK: the deny list (every tool, even ones Grok never asks about) and hard-deny", async () => {
  const { d, asked } = driver({ profile: "channel_agent" });
  const shell = await d.onServerRequest(hookFor(/echo hi/));
  assert.equal(shell.decision, "deny");
  assert.match(shell.systemMessage, /run_terminal_command/);
  const admin = { method: "_x.ai/hooks/run", id: 9, params: { toolName: "dopl_session__dopl_kb_admin", toolUseId: "c1", toolInput: { tool_name: "dopl_session__dopl_kb_admin", tool_input: {} } } };
  assert.equal((await d.onServerRequest(admin)).decision, "deny", "hard-deny, under any server segment");
  assert.equal(asked.length, 0, "a contained call never reaches the gate");
  const full = driver({ profile: "full" });
  const spawn = { method: "_x.ai/hooks/run", id: 10, params: { toolName: "spawn_subagent", toolUseId: "c2", toolInput: {} } };
  assert.equal((await full.d.onServerRequest(spawn)).decision, "deny", "no sub-agents on any profile");
});

test("restricted profiles: a built-in Dopl has not classified is DENIED, never run; reads stay open", async () => {
  for (const profile of ["read_only", "dopl_only"]) {
    const { d } = driver({ profile });
    assert.equal((await d.onServerRequest(hookFor(/note\.txt/))).decision, "continue", `${profile} read_file`);
    assert.equal((await d.onServerRequest(hookFor(/out\.txt/))).decision, "deny", `${profile} write`);
    const novel = { method: "_x.ai/hooks/run", id: 11, params: { toolName: "brand_new_tool", toolUseId: "c3", toolInput: {} } };
    assert.equal((await d.onServerRequest(novel)).decision, "deny", `${profile} unknown built-in`);
    const web = { method: "_x.ai/hooks/run", id: 12, params: { toolName: "web_search", toolUseId: "c4", toolInput: {} } };
    assert.equal((await d.onServerRequest(web)).decision, "deny", `${profile} web_search (never prompted, so only the hook can stop it)`);
  }
});

test("a truncated hook input is never judged; the permission request carries it whole", async () => {
  const { d, asked } = driver();
  const h = hookFor(/dopl_session__post_message/);
  const cut = { ...h, params: { ...h.params, toolInputTruncated: true } };
  assert.deepEqual(await d.onServerRequest(cut), { decision: "continue" });
  assert.equal(asked.length, 0);
});

test("a server request Dopl does not know is shown and refused (-32601), never answered in a guessed shape", async () => {
  const { d, asked } = driver();
  assert.throws(() => d.onServerRequest({ method: "fs/write_text_file", id: 3, params: {} }), (e) => e.rpcCode === -32601);
  assert.deepEqual(asked, [{ unknown: "fs/write_text_file" }]);
});

test("Axis A in Grok's ids: positive lists, unknown gates everywhere, Dopl writes only on approve-all", () => {
  assert.equal(tools.axisAAllows("default", "read_file"), true);
  assert.equal(tools.axisAAllows("default", "write"), false);
  assert.equal(tools.axisAAllows("autoMode", "write"), true);
  assert.equal(tools.axisAAllows("autoMode", "run_terminal_command"), false);
  assert.equal(tools.axisAAllows("approve-all", "run_terminal_command"), true);
  assert.equal(tools.axisAAllows("approve-all", "brand_new_tool"), false);
  assert.equal(tools.axisAAllows("approve-all", "spawn_subagent"), false);
  assert.equal(tools.normalizeToolMode("yolo"), "default", "fail closed");
});
