import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, "..", "main", "runtime", "codex");
const requests = require(join(CODEX, "server-requests.js"));
const approval = require(join(CODEX, "approval.js"));
const mcp = require(join(CODEX, "mcp.js"));
const codexTools = require(join(CODEX, "tools.js"));
const profiles = require(join(HERE, "..", "main", "session-profiles.js"));

const ELICITATION = "mcpServer/elicitation/request";

/**
 * One tool-call elicitation as codex-cli 0.155.1 really sends it (the transcript lives in
 * `test/codex-mcp-surface.test.mjs`), with `over` replacing params.
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

// ══ THE MCP ELICITATION — DOPL'S OWN SERVER, AND NOBODY ELSE'S ══════════════════════════════
//
// 🔒 ⚠ **THE RELEASE BLOCKER THESE CASES CLOSE**: `mcpServer/elicitation/request` carries NO tool
// name and no `itemId` to join to the item that has one, so it used to be answered with an
// unconditional `{ action: 'decline' }` and a Dopl-launched Codex agent could not post, read or
// reach its own channel at all. Samuel's ruling (2026-09-22) was to *resolve it by server*: the
// request names the SERVER, Dopl mounts that server itself, and Dopl's own entry puts exactly one
// tool on it in a mode that can ask. Nothing is parsed out of the operator-facing sentence.

test("a Dopl-server tool-call elicitation reaches the REAL gate, under the one tool that server asks for", async () => {
  const gate = recorder("allow");
  const answer = await requests.answer(elicitation(), gate.decide);

  assert.deepEqual(answer, { action: "accept" });
  assert.equal(gate.seen.length, 1, "the gate is consulted exactly once");
  // ⚠ THE NAME IS THE ENTRY'S, NOT A LITERAL: `mcp.js` pins one asking tool and this is it.
  assert.equal(gate.seen[0].name, mcp.soleAskingTool());
  assert.equal(gate.seen[0].name, mcp.CHANNEL_TOOL);
  // …and the call's OWN ARGUMENTS ride along (§5 item C1), so Axis B's op-scoped lanes are
  // reachable rather than being handed an empty input that would classify as malformed.
  assert.deepEqual(gate.seen[0].input, { op: "send", body: "hello" });
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
  // ⚠ INCLUDING NEAR-MISSES. Allowing a third party's tool on the strength of Dopl's posture is
  // not a question this gate was ever asked, so the comparison is exact identity.
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
    { why: "no approval kind", over: { _meta: { tool_params: { op: "send" } } } },
    { why: "a DIFFERENT approval kind", over: { _meta: { codex_approval_kind: "mcp_elicitation" } } },
    { why: "an empty approval kind", over: { _meta: { codex_approval_kind: "" } } },
    // ⚠ A SERVER'S OWN FORM IS NOT A TOOL-CALL APPROVAL and must not borrow one's allow path,
    // even when it really is Dopl's server raising it.
    { why: "Dopl raising its own form", over: { _meta: { codex_approval_kind: "form", tool_params: {} } } },
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

test("a Dopl elicitation with NO arguments still reaches the gate, with an empty input", async () => {
  // ⚠ ABSENT ARGUMENTS ARE NOT A REASON TO SKIP THE GATE — they are a reason for the gate to have
  // nothing to classify, which its own Axis-B branch answers with `gate` (`postFieldsOk` /
  // `channelOpKey`). Deciding that here would be a second gate.
  for (const tool_params of [undefined, null, "op=send", 42, ["op"]]) {
    const gate = recorder("deny");
    const answer = await requests.answer(
      elicitation({ _meta: { codex_approval_kind: "mcp_tool_call", tool_params } }), gate.decide);
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
    // ⚠ `cancel` MEANS "THE ASK WAS ABANDONED", NOT "NO". Dopl's gate always produces a verdict,
    // so Dopl has no state in which it has no answer to give.
    assert.notEqual(answer.action, "cancel", String(verdict));
    assert.equal(answer.action, verdict === "allow" ? "accept" : "decline", String(verdict));
  }
});

test("the prose is never read: the message may name ANOTHER tool and the name does not move", async () => {
  const gate = recorder("allow");
  await requests.answer(elicitation({
    message: 'Allow the dopl MCP server to run tool "dopl_kb"?',
    _meta: { codex_approval_kind: "mcp_tool_call", tool_params: { op: "read" } },
  }), gate.decide);
  assert.equal(gate.seen[0].name, mcp.soleAskingTool(),
    "the name comes from Dopl's own entry, not from the sentence the operator would have read");
});

// ── THE CONSTANT-SHARING PINS ────────────────────────────────────────────────────────────────

test("the server key is ONE constant, and the asking table is read off the ENTRY", () => {
  // ⚠ NO SECOND LITERAL. The comparison that opens the allow path and the key the entry is
  // mounted under are the same value; `test/codex-gate.test.mjs` pins the launch spec's own mount
  // against it, which is the other half of this join.
  const entry = mcp.buildDoplServerEntry(["dopl_channel", "dopl_kb"]);
  assert.deepEqual(mcp.askingToolsIn(entry), [mcp.CHANNEL_TOOL],
    "exactly one tool on Dopl's entry may raise an ask — that singleton IS the name derivation");
  assert.equal(mcp.soleAskingTool(entry), mcp.CHANNEL_TOOL);
  assert.equal(entry.tools[mcp.CHANNEL_TOOL].approval_mode, "prompt");
  assert.equal(entry.default_tools_approval_mode, "approve",
    "a default that can ask puts every tool in the asking set and makes every ask un-nameable");
  assert.equal(approval.doplElicitation(elicitation().params).name, mcp.soleAskingTool());
});

test("a SECOND asking tool degrades to the un-named Dopl surface instead of guessing", () => {
  // ⚠ THE SET, NOT THE FIRST MEMBER. A future entry that lets two tools ask must stop deriving a
  // name, not pick one — so the derivation is pinned on a synthetic entry rather than trusted.
  const two = mcp.buildDoplServerEntry(null);
  two.tools = { dopl_channel: { approval_mode: "prompt" }, dopl_kb: { approval_mode: "prompt" } };
  assert.deepEqual(mcp.askingToolsIn(two), ["dopl_channel", "dopl_kb"]);
  assert.equal(mcp.soleAskingTool(two), null);
  // …and a default that asks means EVERY tool can, which is not a set Dopl enumerated at all.
  for (const mode of mcp.ASKING_MODES) {
    const wide = mcp.buildDoplServerEntry(null);
    wide.default_tools_approval_mode = mode;
    assert.equal(mcp.askingToolsIn(wide), null, mode);
    assert.equal(mcp.soleAskingTool(wide), null, mode);
  }
});

test("the un-named Dopl surface is NOT the channel tool, and is allowed by no mode", async () => {
  const surface = approval.DOPL_TOOL_SURFACE;
  // ⚠ IT MUST NOT INHERIT AXIS B's CHANNEL LANES. A call Dopl cannot name must not be judged by
  // the classifier for the one tool it happens to be unable to name.
  assert.equal(profiles.isChannelTool(surface), false);
  // …and it is in no Axis-A positive allow-list, so `grantDecision` reaches `gate` in every mode,
  // `never` included — an operator is ASKED rather than a name being invented.
  for (const mode of codexTools.TOOL_MODES) {
    assert.equal(codexTools.axisAAllows(mode, surface), false, mode);
  }

  // END TO END through the real wire path, with the derivation forced to fail.
  const real = mcp.soleAskingTool;
  mcp.soleAskingTool = () => null;
  try {
    const gate = recorder("allow");
    const answer = await requests.answer(elicitation(), gate.decide);
    assert.deepEqual(gate.seen, [{ name: surface, input: { op: "send", body: "hello" } }],
      "the gate is still asked — under the surface name, which gates");
    assert.deepEqual(answer, { action: "accept" }, "and the gate's answer is still what is sent");
  } finally {
    mcp.soleAskingTool = real;
  }
});
