// SDK RESILIENCE #1 (2026-10-08): the Claude CLI's own `system/init` report is checked against what the
// launch asked it to enforce, and a mismatch that gets PAST Dopl's gate ends the session (fail closed).
// Fixtures are MEASURED on runtime 0.3.293 / claude 2.1.293 with Dopl's options and scrubbed env.
// Run: node --test test/claude-launch-contract.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lc = require("../main/runtime/claude/launch-contract.js");
const tools = require("../main/runtime/claude/tools.js");
const normalizer = require("../main/runtime/claude/normalize.js");
const io = require("../main/session-io.js");
const copy = require("../main/runtime/runtime-copy.js");

// What `init.tools` reported per profile (MEASURED 2026-10-08), servers `dopl` + `dopl_agents` configured.
const MEASURED = {
  read_only: ["Glob", "Grep", "Read"],
  dopl_only: ["Glob", "Grep", "Read", "WebFetch", "WebSearch"],
  channel_agent: ["Edit", "Glob", "Grep", "NotebookEdit", "Read", "WebFetch", "WebSearch", "Write"],
  full: ["Bash", "Edit", "Glob", "Grep", "NotebookEdit", "Read", "TaskStop", "WebFetch", "WebSearch", "Write"],
};

function launchOptions(profile, extra = {}) {
  const cfg = tools.buildSessionToolConfig(profile);
  const o = { permissionMode: "default", allowedTools: cfg.preApproved, disallowedTools: cfg.disallowedTools.concat(["Read(~/.ssh/**)"]), mcpServers: { dopl: {}, dopl_agents: {} } };
  if (cfg.builtinTools.length) o.tools = cfg.builtinTools;
  return Object.assign(o, extra);
}

test("🔒 every profile's MEASURED init passes: nothing refuses on today's CLI", () => {
  for (const [profile, offered] of Object.entries(MEASURED)) {
    const v = lc.verifyInit({ permissionMode: "default", tools: offered.concat(["mcp__dopl__dopl_send_message", "mcp__dopl_agents__rename_agent"]) }, lc.contractOf(launchOptions(profile)));
    assert.deepEqual(v.refuse, [], profile);
  }
});

test("a built-in offered outside the bound is DRIFT (the gate holds it), never a refusal", () => {
  // MEASURED 2026-10-08: `full` offered `TaskStop` unclassified; it is now in the shell class, so the
  // measured list is clean, and a future rename is the drift this pins.
  const clean = lc.verifyInit({ permissionMode: "default", tools: MEASURED.full }, lc.contractOf(launchOptions("full")));
  assert.deepEqual(clean, { refuse: [], drift: [] });
  const v = lc.verifyInit({ permissionMode: "default", tools: MEASURED.full.concat(["ShellKill2"]) }, lc.contractOf(launchOptions("full")));
  assert.deepEqual(v.refuse, []);
  assert.match(v.drift.join(" "), /ShellKill2/);
});

test("REFUSES: a permission mode that skips Dopl's gate, or none reported", () => {
  const c = lc.contractOf(launchOptions("read_only"));
  for (const mode of ["bypassPermissions", "acceptEdits", "plan", "auto", "dontAsk"]) {
    assert.match(lc.verifyInit({ permissionMode: mode, tools: MEASURED.read_only }, c).refuse.join(), /permission mode/, mode);
  }
  assert.match(lc.verifyInit({ tools: MEASURED.read_only }, c).refuse.join(), /did not report its permission mode/);
});

test("REFUSES: a deny-listed tool offered (the deny list was not applied)", () => {
  const c = lc.contractOf(launchOptions("channel_agent"));
  const v = lc.verifyInit({ permissionMode: "default", tools: MEASURED.channel_agent.concat(["Bash"]) }, c);
  assert.match(v.refuse.join(), /denied \(Bash\)/);
});

test("REFUSES: no tool list reported (nothing could be checked)", () => {
  assert.match(lc.verifyInit({ permissionMode: "default" }, lc.contractOf(launchOptions("full"))).refuse.join(), /did not report the tools/);
});

test("a narrowing rule is not a removal: `Read(~/.ssh/**)` never makes `Read` a denied name", () => {
  assert.ok(!lc.contractOf(launchOptions("read_only")).denied.includes("Read"));
});

test("an unconfigured server's tools are drift on a plain launch, and ignored with the operator's own tools", () => {
  const offered = MEASURED.read_only.concat(["mcp__claude_ai_Gmail__send_message"]);
  assert.match(lc.verifyInit({ permissionMode: "default", tools: offered }, lc.contractOf(launchOptions("read_only"))).drift.join(), /Gmail/);
  assert.deepEqual(lc.verifyInit({ permissionMode: "default", tools: offered }, lc.contractOf(launchOptions("read_only"), { operatorTools: true })).drift, []);
});

test("the normalizer: init → launched, then the refusal (and drift) when a contract is recorded", () => {
  const init = { type: "system", subtype: "init", session_id: "sid", model: "m", mcp_servers: [], permissionMode: "plan", tools: MEASURED.full.concat(["ShellKill2"]) };
  const evs = normalizer.normalize(init, { launchContract: lc.contractOf(launchOptions("full")) });
  assert.equal(evs[0].type, "launched");
  assert.ok(evs.some((e) => e.type === "shape_drift" && /ShellKill2/.test(e.detail)));
  const stop = evs.find((e) => e.type === "safety_mismatch");
  assert.match(stop.detail, /^Dopl ended this session before it could act: the runtime is in permission mode "plan"/);
  // No contract (a harness) → not checked.
  assert.deepEqual(normalizer.normalize(init, {}).map((e) => e.type), ["launched"]);
});

test("core turns the refusal into the stop signal, outranking the init's MCP status", () => {
  const s = { key: "k", runtimeId: "claude", state: { phase: "launching" }, channelId: "c", taskId: "t" };
  const store = { setSdkSessionId() {}, saveRecord() {} };
  const evs = [{ type: "launched", sessionId: "sid", model: "m", mcpServers: [] }, { type: "safety_mismatch", detail: "x" }];
  assert.deepEqual(io.applyCoreEvents(s, evs, () => {}, store), { type: "safety_stop", detail: "x" });
});

test("the end code is in the closed set, with an operator sentence", () => {
  const c = copy.errorCopy({ id: "claude", label: "Claude Code" }, "runtime-unsafe", "detail");
  assert.equal(c.code, "runtime-unsafe");
  assert.match(c.body, /ended the agent before it could act/);
});

test("consume ENDS on the stop: handles torn down, end code stamped, crash dispatched — no further message read", async () => {
  const sq = require("../main/session-query.js");
  const dispatched = [];
  sq.bind({ dispatch: (_s, ev) => dispatched.push(ev.type) });
  let aborted = false;
  let read = 0;
  const init = { type: "system", subtype: "init", session_id: "sid", model: "m", mcp_servers: [], permissionMode: "bypassPermissions", tools: ["Read"] };
  async function* stream() { read += 1; yield init; read += 1; yield { type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] } }; }
  const q = stream();
  const s = { key: "k", runtimeId: "claude", state: { phase: "launching" }, channelId: "c", taskId: "t", query: q,
    abortController: { abort: () => { aborted = true; } }, pushIterator: { close() {} },
    launchContract: lc.contractOf(launchOptions("read_only")) };
  await sq.consume(s, q, { normalize: normalizer.normalize });
  assert.equal(s.endCode, "runtime-unsafe");
  assert.match(s.mcpDiag, /permission mode "bypassPermissions"/);
  assert.ok(aborted, "the child is torn down");
  assert.ok(dispatched.includes("crash"));
  assert.equal(read, 1, "the turn after init is never read");
});

test("the contract is recorded at the ONE hand-off every spawn shape passes, from the FINAL options", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../main/runtime/claude/launch-spec.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("function buildLaunchSpec"), src.indexOf("function start("));
  assert.match(fn, /const options = buildOptions\(s, req\.dispatch\);\s*\n[\s\S]*s\.launchContract = launchContract\.contractOf\(options, \{ operatorTools: !!s\.operatorTools \}\);/);
  assert.match(fn, /return \{ prompt: s\.pushIterator, options, session: s \};/);
});
