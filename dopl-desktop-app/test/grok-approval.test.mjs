// Grok's gate: the recorded `_x.ai/hooks/run` and `session/request_permission` requests (grok 1.0.52) driven
// through `approval.js › makeApprovalDriver` with a scripted gate. Pins: containment answered in the hook (deny
// fails only that tool), a Dopl call asked of the gate ONCE across both channels, a parked verdict HELD in the hook
// (F-777: an operator Deny fails only that call) and past the hold left to the permission request, once-scoped
// options only, cancel on interrupt, the restricted profiles' allow-list, the S10 mode readback, and the S5b/S11
// recordings (2026-10-14).

import { test } from "node:test";
import assert from "node:assert/strict";
import { g, serverRequests, outbound, inbound, recording } from "./_grok-harness.mjs";

const approval = g("approval.js");
const tools = g("tools.js");
const policy = g("policy.js");
const S2 = "smoke-s2-dopl-config.ndjson";
const HELD = "smoke-s11-held-hook-deny.ndjson";
const CANCELLED = "smoke-s11-permission-cancelled.ndjson";
const REWRITE = "smoke-s11-hook-rewrite.ndjson";
const SLASH = "smoke-s10-slash-toggle.ndjson";
const S5B = "smoke-s5b-builtins.ndjson";
const S5C = "smoke-s5c-client-web-search.ndjson";

const hooks = serverRequests(S2, "_x.ai/hooks/run");
const perm = serverRequests(S2, "session/request_permission")[0];
const hookFor = (re) => hooks.find((h) => re.test(JSON.stringify(h.params)));

function driver({ profile = "full", verdict = () => ({ behavior: "allow" }), hookHoldMs = 30 } = {}) {
  const asked = [];
  const unsafe = [];
  const d = approval.makeApprovalDriver({
    cfg: tools.buildSessionToolConfig(profile),
    gate: (name, input, meta) => { asked.push({ name, input, meta }); return verdict(name, input); },
    log: () => {},
    onUnknown: (m) => asked.push({ unknown: m }),
    onUnsafe: (t) => unsafe.push(t),
    hookHoldMs,
  });
  return { d, asked, unsafe };
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

test("a SETTLED deny is answered in the hook (only that tool fails); one still PARKED past the hold waits in the permission request", async () => {
  const denied = driver({ verdict: () => ({ behavior: "deny", message: "Not in this channel." }) });
  assert.deepEqual(await denied.d.onServerRequest(hookFor(/dopl_session__post_message/)), { decision: "deny", systemMessage: "Not in this channel." });

  let release;
  const parked = driver({ verdict: () => new Promise((r) => { release = r; }) });
  assert.deepEqual(await parked.d.onServerRequest(hookFor(/dopl_session__post_message/)), { decision: "continue" }, "past the hold the hook lets go (Grok would fail OPEN at its timeout)");
  const pending = parked.d.onServerRequest(perm);
  release({ behavior: "deny" });
  assert.deepEqual(await pending, { outcome: { outcome: "selected", optionId: "reject-once" } }, "the recorded reply shape");
  assert.equal(parked.asked.length, 1);
  const recorded = outbound(S2).find((m) => m.id === perm.id && m.result && m.result.outcome);
  assert.deepEqual(recorded.result, { outcome: { outcome: "selected", optionId: "reject-once" } });
});

test("F-777: the hook HOLDS a parked verdict, so an operator's Deny fails only that call and the turn goes on", async () => {
  let release;
  const { d, asked } = driver({ verdict: () => new Promise((r) => { release = r; }), hookHoldMs: 10000 });
  const reply = d.onServerRequest(hookFor(/dopl_session__post_message/));
  await new Promise((r) => setTimeout(r, 20));
  release({ behavior: "deny", message: "The operator denied this call." });
  assert.deepEqual(await reply, { decision: "deny", systemMessage: "The operator denied this call." });
  assert.equal(asked.length, 1);
  // An Allow inside the hold → continue; the permission request that follows (ask rule) is answered from the memo.
  let ok;
  const allowed = driver({ verdict: () => new Promise((r) => { ok = r; }), hookHoldMs: 10000 });
  const r2 = allowed.d.onServerRequest(hookFor(/dopl_session__post_message/));
  ok({ behavior: "allow" });
  assert.deepEqual(await r2, { decision: "continue" });
  assert.equal((await allowed.d.onServerRequest(perm)).outcome.optionId, "allow-once");
  assert.equal(allowed.asked.length, 1, "still one ask per call");
  // The hold stays under Grok's group timeout, which fails OPEN.
  assert.ok(policy.HOOK_HOLD_MS < policy.HOOK_TIMEOUT_S * 1000);
  assert.equal(policy.HOOKS_META["x.ai/hooks"].PreToolUse[0].timeout, policy.HOOK_TIMEOUT_S);
});

test("F-777 recorded (S11): a hook reply held 40 s under the 600 s group is honoured — `deny` fails only that call, the turn ends normally", () => {
  const hooksRun = serverRequests(HELD, "_x.ai/hooks/run");
  assert.equal(hooksRun.length, 2);
  const frames = recording(HELD);
  const t = (pred) => frames.find(pred);
  const asked = t((f) => f.dir === "in" && f.msg && f.msg.id === hooksRun[0].id && f.msg.method);
  const answered = t((f) => f.dir === "out" && f.msg && f.msg.id === hooksRun[0].id && f.msg.result);
  assert.deepEqual(answered.msg.result, { decision: "deny", systemMessage: "The operator denied this call." });
  const at = (f) => frames.indexOf(f);
  assert.ok(at(answered) > at(asked));
  const failed = inbound(HELD).filter((m) => m.method === "session/update" && m.params.update.sessionUpdate === "tool_call_update" && m.params.update.status === "failed");
  assert.equal(failed.length, 2, "each denied call failed on its own");
  const done = inbound(HELD).find((m) => m.result && m.result.stopReason);
  assert.equal(done.result.stopReason, "end_turn", "the turn was NOT cancelled (contrast `reject_once` → PermissionRejected)");
  assert.equal(inbound(HELD).filter((m) => m.method === "session/request_permission").length, 0);
  // And a permission answer cannot do this: `cancelled` ends the turn too (S11).
  const cancelled = inbound(CANCELLED).find((m) => m.result && m.result.stopReason);
  assert.deepEqual([cancelled.result.stopReason, cancelled.result._meta.cancellationCategory], ["cancelled", "PermissionCancelled"]);
  assert.deepEqual(serverRequests(CANCELLED, "session/request_permission")[0].params.options.map((o) => o.kind).sort(), ["allow_always", "allow_once", "reject_once"], "no per-call reject option");
});

test("an interrupt releases a held hook as a deny", async () => {
  const { d } = driver({ verdict: () => new Promise(() => {}), hookHoldMs: 10000 });
  const reply = d.onServerRequest(hookFor(/dopl_session__post_message/));
  await new Promise((r) => setTimeout(r, 5));
  d.cancelPending();
  assert.equal((await reply).decision, "deny");
});

test("S10: a hook reporting `bypassPermissions` (what `/always-approve on` switches to) is DENIED and the session stopped once", async () => {
  const bypass = serverRequests(SLASH, "_x.ai/hooks/run")[0];
  assert.equal(bypass.params.permissionMode, "bypassPermissions", "the recorded readback");
  assert.equal(serverRequests(SLASH, "session/request_permission").length, 0, "LIVE: the edit ran with no permission request");
  assert.ok(inbound(SLASH).filter((m) => m.method === "_x.ai/sessions/changed").every((m) => m.params.upserted.every((u) => u.yolo === false)), "LIVE: the yolo readback stayed false");
  const { d, asked, unsafe } = driver();
  const r = await d.onServerRequest(bypass);
  assert.equal(r.decision, "deny");
  assert.match(r.systemMessage, /bypassPermissions/);
  await d.onServerRequest(bypass);
  assert.equal(unsafe.length, 1, "stopped once");
  assert.equal(asked.length, 0);
  for (const mode of ["default", "auto"]) {
    const ok = driver();
    const h = hookFor(/dopl_session__post_message/);
    assert.equal((await ok.d.onServerRequest({ ...h, params: { ...h.params, permissionMode: mode } })).decision, "continue", mode);
    assert.equal(ok.unsafe.length, 0);
  }
});

test("S5b/S5c recorded built-in ids (hook `toolName`) are each classified; web_search reaches the hook only as the client tool", async () => {
  const names = serverRequests(S5B, "_x.ai/hooks/run").map((h) => h.params.toolName);
  assert.deepEqual(names, ["list_dir", "grep", "search_replace", "web_fetch", "spawn_subagent"]);
  assert.ok(tools.READ_TOOLS.includes("list_dir") && tools.READ_TOOLS.includes("grep"));
  assert.ok(tools.EDIT_TOOLS.includes("search_replace"));
  assert.ok(tools.NETWORK_TOOLS.includes("web_fetch") && tools.NETWORK_TOOLS.includes("web_search"));
  assert.ok(tools.DELEGATION_TOOLS.includes("spawn_subagent"));
  const backend = inbound(S5B).find((m) => m.method === "session/update" && m.params.update.sessionUpdate === "tool_call" && m.params.update.rawInput && m.params.update.rawInput.backend === true);
  assert.equal(backend.params.update.rawInput.variant, "WebSearch", "backend search: a tool_call with NO hook before it");
  const client = serverRequests(S5C, "_x.ai/hooks/run")[0];
  assert.deepEqual([client.params.toolName, client.params.toolInput], ["web_search", { query: "x.ai grok build cli" }]);
  for (const profile of ["read_only", "dopl_only"]) {
    const { d } = driver({ profile });
    for (const h of serverRequests(S5B, "_x.ai/hooks/run").concat([client])) {
      const want = ["list_dir", "grep"].includes(h.params.toolName) ? "continue" : "deny";
      assert.equal((await d.onServerRequest(h)).decision, want, `${profile} ${h.params.toolName}`);
    }
  }
});

test("S11 recorded: a hook reply's `updatedInput` is IGNORED by Grok — Dopl never rewrites (`inputRewrite: null`)", () => {
  const rewrite = outbound(REWRITE).find((m) => m.result && m.result.updatedInput);
  assert.equal(rewrite.result.updatedInput.command, "echo s11b-REWRITTEN");
  const done = inbound(REWRITE).filter((m) => m.method === "session/update" && m.params.update.sessionUpdate === "tool_call_update" && m.params.update.status === "completed").pop();
  assert.match(JSON.stringify(done.params.update), /s11b-original/);
  assert.doesNotMatch(JSON.stringify(done.params.update), /REWRITTEN/);
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
