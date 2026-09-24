import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, "..", "main", "runtime", "codex");
const requests = require(join(CODEX, "server-requests.js"));
const mcp = require(join(CODEX, "mcp.js"));
const profiles = require(join(HERE, "..", "main", "session-profiles.js"));

const ELICITATION = "mcpServer/elicitation/request";

/**
 * One tool-call elicitation as codex-cli 0.155.1 really sends it for a TITLED tool (the transcript
 * lives in `test/codex-mcp-surface.test.mjs`), with `over` replacing params.
 *
 * ⚠ THE `message` DELIBERATELY NAMES A TOOL. Nothing in the adapter may read it, and the case
 * `the prose is never read` below proves it by naming the WRONG tool there.
 */
const elicitation = (over) => ({
  method: ELICITATION,
  params: Object.assign({
    threadId: "01a0ca52-8185-72d2-a2d8-814a510a8179",
    turnId: "01a0ca52-823c-75c0-b229-0502a2e558f5",
    serverName: mcp.SERVER_KEY,
    mode: "form",
    message: 'Allow the dopl MCP server to run tool "dopl_channel"?',
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      tool_title: "dopl_channel",
      tool_description: "Read or post in a Dopl channel.",
      tool_params: { op: "send", body: "hello" },
      tool_params_display: [{ name: "op", value: "send", display_name: "op" }],
    },
    requestedSchema: { type: "object", properties: {} },
  }, over || {}),
});

/** A gate that records what it was asked and answers `verdict`. */
function recorder(verdict) {
  const seen = [];
  return {
    seen,
    decide: async (name, input) => { seen.push({ name, input }); return verdict; },
  };
}

test("command and file requests show their measured inputs and return one-shot decisions", async () => {
  const seen = [];
  const decide = async (name, input) => {
    seen.push({ name, input });
    return name === "commandExecution" ? "allow" : "deny";
  };
  const command = await requests.answer({
    id: 1,
    method: "item/commandExecution/requestApproval",
    params: { itemId: "i1", command: "npm test", cwd: "/repo", reason: "verify" },
  }, decide);
  const file = await requests.answer({
    id: 2,
    method: "item/fileChange/requestApproval",
    params: { itemId: "i2", grantRoot: "/repo/src", reason: "edit source" },
  }, decide);

  assert.deepEqual(command, { decision: "accept" });
  assert.deepEqual(file, { decision: "decline" });
  assert.deepEqual(seen, [
    { name: "commandExecution", input: { command: "npm test", cwd: "/repo", reason: "verify" } },
    { name: "fileChange", input: { grantRoot: "/repo/src", reason: "edit source" } },
  ]);
});

test("permission grants are turn-scoped and denials grant an empty profile", async () => {
  const asked = { network: { enabled: true }, fileSystem: null };
  const allowed = await requests.answer({
    id: 3, method: "item/permissions/requestApproval",
    params: { itemId: "i3", permissions: asked, reason: "download dependency" },
  }, async () => "allow");
  const denied = await requests.answer({
    id: 4, method: "item/permissions/requestApproval",
    params: { itemId: "i4", permissions: asked },
  }, async () => "deny");

  assert.deepEqual(allowed, { permissions: asked, scope: "turn" });
  assert.deepEqual(denied, { permissions: { fileSystem: null, network: { enabled: false } }, scope: "turn" });
});

test("unsupported interactive requests fail closed with method-valid responses", async () => {
  // ⚠ AN ELICITATION WITH EMPTY PARAMS NAMES NO SERVER, SO IT IS NOT DOPL'S AND STILL DECLINES.
  // The ALLOW path below is reached only by a request that proves which server raised it.
  assert.deepEqual(
    await requests.answer({ method: ELICITATION, params: {} }, async () => "allow"),
    { action: "decline" },
  );
  assert.deepEqual(
    await requests.answer({ method: "item/tool/requestUserInput", params: {} }, async () => "allow"),
    { answers: {} },
  );
  await assert.rejects(
    requests.answer({ method: "future/request", params: {} }, async () => "allow"),
    (error) => error && error.rpcCode === -32601,
  );
});

test("a failed Dopl gate denies with the request method's valid shape", async () => {
  const boom = async () => { throw new Error("gate failed"); };
  assert.deepEqual(
    await requests.answer({ method: "item/commandExecution/requestApproval", params: {} }, boom),
    { decision: "decline" },
  );
  assert.deepEqual(
    await requests.answer({ method: "item/permissions/requestApproval", params: { permissions: {} } }, boom),
    { permissions: { fileSystem: null, network: { enabled: false } }, scope: "turn" },
  );
});

// ══ THE MCP ELICITATION — NAMED BY `_meta.tool_title`, DOPL'S OWN SERVER ONLY ═══════════════
//
// 🔒 The request carries no tool-name field and no `itemId`. The one per-tool identity in it is
// `_meta.tool_title`, which Codex copies from the called tool's `title` (and Dopl's server titles
// every tool with its own name). An ask with no title, or a title that is not a Dopl tool, is
// declined WITHOUT asking — never guessed, never read out of the operator-facing sentence.

/** `_meta` for a tool-call approval of `tool_title` with `tool_params`. */
const meta = (tool_title, tool_params) => ({ codex_approval_kind: "mcp_tool_call", tool_title, tool_params });

test("a titled Dopl elicitation reaches the REAL gate under ITS OWN tool's name, with its arguments", async () => {
  for (const [title, args] of [["dopl_channel", { op: "send", body: "hello" }], ["dopl_kb", { op: "write", base: "b" }]]) {
    const gate = recorder("allow");
    const answer = await requests.answer(elicitation({ _meta: meta(title, args) }), gate.decide);
    assert.deepEqual(answer, { action: "accept" }, title);
    assert.deepEqual(gate.seen, [{ name: title, input: args }], "consulted once, with the call's own op");
  }
});

test("the gate's DENY is a decline, and a gate that THROWS is a decline too", async () => {
  assert.deepEqual(await requests.answer(elicitation(), async () => "deny"), { action: "decline" });
  assert.deepEqual(
    await requests.answer(elicitation(), async () => { throw new Error("gate failed"); }),
    { action: "decline" },
    "a gate that throws is not an operator who said yes",
  );
});

test("an elicitation from ANY OTHER server declines and never reaches the gate", async () => {
  // ⚠ INCLUDING NEAR-MISSES, and even when it carries a Dopl tool's title: the comparison is exact.
  const foreign = ["evil", "Dopl", "DOPL", "dopl ", " dopl", "dopl2", "xdopl", "", null, undefined, 7, {}, ["dopl"]];
  for (const serverName of foreign) {
    const gate = recorder("allow");
    const answer = await requests.answer(elicitation({ serverName }), gate.decide);
    assert.deepEqual(answer, { action: "decline" }, JSON.stringify(serverName));
    assert.deepEqual(gate.seen, [], `the gate must not be asked about ${JSON.stringify(serverName)}`);
  }
});

test("every malformed or unknown elicitation shape declines WITHOUT asking anyone", async () => {
  const bad = [
    { why: "no _meta at all", over: { _meta: undefined } },
    { why: "_meta is null", over: { _meta: null } },
    { why: "_meta is a string", over: { _meta: "mcp_tool_call" } },
    { why: "_meta is an array", over: { _meta: ["mcp_tool_call"] } },
    { why: "no approval kind", over: { _meta: { tool_title: "dopl_channel", tool_params: { op: "send" } } } },
    { why: "a DIFFERENT approval kind", over: { _meta: { codex_approval_kind: "mcp_elicitation", tool_title: "dopl_channel" } } },
    { why: "an empty approval kind", over: { _meta: { codex_approval_kind: "", tool_title: "dopl_channel" } } },
    // ⚠ A SERVER'S OWN FORM IS NOT A TOOL-CALL APPROVAL and must not borrow one's allow path,
    // even when it really is Dopl's server raising it.
    { why: "Dopl raising its own form", over: { _meta: { codex_approval_kind: "form", tool_title: "dopl_channel" } } },
  ];
  for (const { why, over } of bad) {
    const gate = recorder("allow");
    assert.deepEqual(await requests.answer(elicitation(over), gate.decide), { action: "decline" }, why);
    assert.deepEqual(gate.seen, [], why);
  }
  // And the whole params object missing, which is the shape a truncated frame produces.
  const gate = recorder("allow");
  assert.deepEqual(await requests.answer({ method: ELICITATION }, gate.decide), { action: "decline" });
  assert.deepEqual(gate.seen, []);
});

test("an UNNAMED Dopl ask (an older server publishes no titles) declines unasked, and says why", async () => {
  for (const tool_title of [undefined, null, "", 7, ["dopl_channel"], { name: "dopl_channel" }]) {
    const gate = recorder("allow");
    const logged = [];
    const answer = await requests.answer(
      elicitation({ _meta: meta(tool_title, { op: "read" }) }), gate.decide, (line) => logged.push(line));
    assert.deepEqual(answer, { action: "decline" }, JSON.stringify(tool_title));
    assert.deepEqual(gate.seen, [], "never guessed: not the channel, not a surface name");
    assert.equal(logged.length, 1);
    assert.match(logged[0], /_meta\.tool_title/, "the reason names the missing field");
  }
});

test("a title that is not a Dopl tool declines unasked — no near-miss, no prefixed form", async () => {
  for (const tool_title of ["evil_tool", "Dopl_KB", "dopl_kb ", "mcp__dopl__dopl_kb", "dopl_kb_v2"]) {
    const gate = recorder("allow");
    const logged = [];
    const answer = await requests.answer(
      elicitation({ _meta: meta(tool_title, { op: "list" }) }), gate.decide, (line) => logged.push(line));
    assert.deepEqual(answer, { action: "decline" }, tool_title);
    assert.deepEqual(gate.seen, [], tool_title);
    assert.match(logged[0], /is not a Dopl tool/, tool_title);
  }
  // No logger is optional, not a crash.
  assert.deepEqual(await requests.answer(elicitation({ _meta: meta("evil_tool", {}) }), recorder("allow").decide),
    { action: "decline" });
});

test("a RETIRED Dopl name is named, and the real gate hard-denies it", async () => {
  const decide = async (name, input) => profiles.grantDecision({
    runtime: "codex", profile: "full", toolMode: "never", toolName: name, input,
  }) === "allow" ? "allow" : "deny";
  const answer = await requests.answer(elicitation({ _meta: meta("dopl_kb_admin", { op: "delete" }) }), decide);
  assert.deepEqual(answer, { action: "decline" });
});

test("a Dopl elicitation with NO arguments still reaches the gate, with an empty input", async () => {
  // ⚠ ABSENT ARGUMENTS ARE NOT A REASON TO SKIP THE GATE — they are a reason for the gate to have
  // nothing to classify, which its own branches answer with `gate`. Deciding that here would be a
  // second gate.
  for (const tool_params of [undefined, null, "op=send", 42, ["op"]]) {
    const gate = recorder("deny");
    const answer = await requests.answer(elicitation({ _meta: meta("dopl_channel", tool_params) }), gate.decide);
    assert.deepEqual(answer, { action: "decline" }, String(tool_params));
    assert.equal(gate.seen.length, 1, "the gate is still the one that decides");
    assert.deepEqual(gate.seen[0].input, {}, "a non-object argument bag reaches the gate as EMPTY");
  }
});

test("the reply vocabulary is `{action}` — never `{decision}`, and never `cancel`", async () => {
  // ⚠ THE TWO SHAPES ARE NOT INTERCHANGEABLE. `item/*/requestApproval` takes `{ decision }`;
  // this method takes `{ action }`. Answering either with the other's key leaves the turn waiting
  // forever, which is the defect this module exists to prevent.
  for (const verdict of ["allow", "deny", "gate", "accept", "allow-once", undefined, null, ""]) {
    const answer = await requests.answer(elicitation(), async () => verdict);
    assert.deepEqual(Object.keys(answer), ["action"], String(verdict));
    assert.equal(answer.decision, undefined, String(verdict));
    // ⚠ `cancel` MEANS "THE ASK WAS ABANDONED", NOT "NO". Dopl's gate always produces a verdict.
    assert.notEqual(answer.action, "cancel", String(verdict));
    assert.equal(answer.action, verdict === "allow" ? "accept" : "decline", String(verdict));
  }
});

test("the prose is never read: the message may name ANOTHER tool and the name does not move", async () => {
  const gate = recorder("allow");
  await requests.answer(elicitation({
    message: 'Allow the dopl MCP server to run tool "dopl_kb"?',
    _meta: meta("dopl_channel", { op: "read" }),
  }), gate.decide);
  assert.equal(gate.seen[0].name, "dopl_channel", "named by the title, not by the sentence");
  // …and a sentence naming a tool does not rescue an ask with no title.
  const unnamed = recorder("allow");
  const answer = await requests.answer(elicitation({
    message: 'Allow the dopl MCP server to run tool "dopl_kb"?',
    _meta: meta(undefined, { op: "list" }),
  }), unnamed.decide);
  assert.deepEqual(answer, { action: "decline" });
  assert.deepEqual(unnamed.seen, []);
});

test("the server key is ONE constant: the entry's mount and the comparison agree", () => {
  // `test/codex-gate.test.mjs` pins the launch spec's own mount against it, the other half of this join.
  assert.equal(requests.doplElicitation(elicitation().params).name, "dopl_channel");
  assert.ok(requests.doplElicitation(elicitation({ serverName: mcp.SERVER_KEY + "x" }).params).refused);
});
