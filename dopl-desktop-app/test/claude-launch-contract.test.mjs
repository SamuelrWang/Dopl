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

test("H2: a built-in offered outside the bound REFUSES (the gate is no backstop: the CLI auto-allows some calls)", () => {
  // MEASURED 2026-10-08: `full` offered `TaskStop` unclassified; it is now in the shell class, so the
  // measured list is clean under the strict rule, and a future addition refuses.
  const clean = lc.verifyInit({ permissionMode: "default", tools: MEASURED.full }, lc.contractOf(launchOptions("full")));
  assert.deepEqual(clean, { refuse: [] });
  const v = lc.verifyInit({ permissionMode: "default", tools: MEASURED.full.concat(["ShellKill2"]) }, lc.contractOf(launchOptions("full")));
  assert.match(v.refuse.join(" "), /outside this launch's bound \(ShellKill2\)/);
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

test("H2: an unconfigured server's tools REFUSE on a plain launch; the operator's own tools are theirs", () => {
  const offered = MEASURED.read_only.concat(["mcp__claude_ai_Gmail__send_message"]);
  assert.match(lc.verifyInit({ permissionMode: "default", tools: offered }, lc.contractOf(launchOptions("read_only"))).refuse.join(), /servers this launch did not configure \(mcp__claude_ai_Gmail__send_message\)/);
  assert.deepEqual(lc.verifyInit({ permissionMode: "default", tools: offered }, lc.contractOf(launchOptions("read_only"), { operatorTools: true })), { refuse: [] });
});

test("the normalizer: init → launched, then the refusal; a clean init → launch_verified", () => {
  const init = { type: "system", subtype: "init", session_id: "sid", model: "m", mcp_servers: [], permissionMode: "plan", tools: MEASURED.full.concat(["ShellKill2"]) };
  const evs = normalizer.normalize(init, { launchContract: lc.contractOf(launchOptions("full")) });
  assert.equal(evs[0].type, "launched");
  const stop = evs.find((e) => e.type === "safety_mismatch");
  assert.match(stop.detail, /^Dopl ended this session before it could act: the runtime is in permission mode "plan"/);
  assert.ok(!evs.some((e) => e.type === "launch_verified"));
  const ok = normalizer.normalize({ ...init, permissionMode: "default", tools: MEASURED.full }, { launchContract: lc.contractOf(launchOptions("full")) });
  assert.deepEqual(ok.map((e) => e.type), ["launched", "launch_verified"]);
});

test("M3: NO recorded contract REFUSES; only an explicit `launchContract: false` (a harness) skips the check", () => {
  const init = { type: "system", subtype: "init", session_id: "sid", model: "m", mcp_servers: [], permissionMode: "default", tools: ["Read"] };
  for (const ctx of [{}, { launchContract: null }, { launchContract: undefined }]) {
    const evs = normalizer.normalize(init, ctx);
    assert.match(evs.find((e) => e.type === "safety_mismatch").detail, /no record of what it was asked to enforce/, JSON.stringify(ctx));
  }
  assert.deepEqual(normalizer.normalize(init, { launchContract: false }).map((e) => e.type), ["launched"]);
});

test("H1: a turn the runtime emits BEFORE a verified init ends the session, unrendered", () => {
  const contract = lc.contractOf(launchOptions("read_only"));
  const turn = { type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Read", input: {} }] } };
  assert.deepEqual(normalizer.normalize(turn, { launchContract: contract, launchVerified: false }).map((e) => e.type), ["safety_mismatch"]);
  assert.ok(normalizer.normalize(turn, { launchContract: contract, launchVerified: true }).every((e) => e.type !== "safety_mismatch"));
});

test("H1: the gate is CLOSED until the init is verified — a call before it is denied, the real gate never asked", async () => {
  const spec = require("../main/runtime/claude/launch-spec.js");
  let asked = 0;
  const s = { launchVerified: false };
  const gate = spec.untilVerified(s, async () => { asked += 1; return { behavior: "allow" }; });
  assert.equal((await gate("Bash", {})).behavior, "deny");
  assert.equal(asked, 0);
  s.launchVerified = true;
  assert.equal((await gate("Bash", {})).behavior, "allow");
  assert.equal(asked, 1);
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

test("H1: a tool_use BEFORE any init stops the session; the gate is never called", async () => {
  const sq = require("../main/session-query.js");
  const dispatched = [];
  sq.bind({ dispatch: (_s, ev) => dispatched.push(ev.type) });
  let gateCalls = 0;
  let aborted = false;
  async function* stream() { yield { type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] } }; yield { type: "result" }; }
  const q = stream();
  const s = { key: "k", runtimeId: "claude", state: { phase: "launching" }, channelId: "c", taskId: "t", query: q,
    abortController: { abort: () => { aborted = true; } }, pushIterator: { close() {} },
    launchContract: lc.contractOf(launchOptions("full")), launchVerified: false };
  const gate = require("../main/runtime/claude/launch-spec.js").untilVerified(s, async () => { gateCalls += 1; return { behavior: "allow" }; });
  await sq.consume(s, q, { normalize: normalizer.normalize });
  assert.equal(s.endCode, "runtime-unsafe");
  assert.match(s.mcpDiag, /acted before reporting what it enforces/);
  assert.ok(aborted && dispatched.includes("crash"));
  assert.equal((await gate("Bash", {})).behavior, "deny", "still unverified");
  assert.equal(gateCalls, 0, "the real gate was never asked");
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
