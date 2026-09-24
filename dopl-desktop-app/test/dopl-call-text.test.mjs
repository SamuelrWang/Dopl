// EVERY DOPL CALL A DESKTOP PROMPT SPELLS FOLLOWS THE SESSION'S TOOL SET (DMP-013).
//
// `main/dopl-call-text.js` renders a manifest key for `s.doplToolSet`: legacy is byte-for-byte the
// spelling the prompts carried before, granular names the granular tool. The sweep below builds
// every framed turn a session can receive on a granular session and finds no legacy spelling in it.
//
// Run: `node --test dopl-desktop-app/test/dopl-call-text.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (...p) => join(HERE, "..", "main", ...p);

const { doplTool, doplCall, doplArgs, doplOp } = require(M("dopl-call-text.js"));
const { GRANULAR_NAMES } = require(M("dopl-tool-table.js"));
const framing = require(M("prompt-framing.js"));
const seed = require(M("session-seed.js"));

test("legacy renders the spellings the prompts always carried", () => {
  assert.equal(doplTool("legacy", "channel.send"), "mcp__dopl__dopl_channel");
  assert.equal(doplCall(undefined, "channel.rooms.threads", "x"), 'mcp__dopl__dopl_channel op "rooms", action "threads", x');
  assert.equal(doplOp("legacy", "channel.read"), 'op "read"');
  assert.equal(doplArgs("legacy", "channel.send", "this channel"), 'op "send", this channel');
  assert.equal(doplCall("legacy", "channel.status", "", true), 'dopl_channel op "status"');
  assert.equal(doplCall("legacy", "ontology.map", 'ontology "o1"'), 'mcp__dopl__dopl_ontology op "map", ontology "o1"');
});

test("granular names the tool that runs the job, with its selector when it has one", () => {
  assert.equal(doplTool("granular", "channel.send"), "mcp__dopl__dopl_send_message");
  assert.equal(doplCall("granular", "channel.rooms.threads", "x"), 'mcp__dopl__dopl_get_channel action "threads", x');
  assert.equal(doplOp("granular", "channel.read"), "mcp__dopl__dopl_read_channel");
  assert.equal(doplArgs("granular", "channel.send", "this channel"), "this channel");
  assert.equal(doplCall("granular", "channel.status", "", true), 'dopl_get_channel action "status"');
  assert.equal(doplCall("granular", "kb.get_tree"), 'mcp__dopl__dopl_browse_knowledge action "tree"');
  assert.throws(() => doplTool("granular", "channel.nope"), /not a manifest key/);
  assert.throws(() => doplTool("legacy", "channel.nope"), /not a manifest key/, "a typo fails on both sets");
});

const CTX = {
  channelId: "c0ffee00-0000-4000-8000-000000000001",
  workspaceId: "c0ffee00-0000-4000-8000-000000000002",
  taskId: "c0ffee00-0000-4000-8000-000000000003",
  channelName: "ops", authorName: "Ann", agentId: "abcd1234", agentName: "Bug Reviewer",
  roster: { agents: [{ handle: "x", mine: true }], people: [], agentsMore: 2, read: "failed" },
  ontologies: [{ id: "o1", name: "Graph", level: "view" }],
  identity: { name: "Coder", instructions: "Be terse.", knowledge: [
    { scope: "base", baseId: "kb1", baseName: "Notes" },
    { scope: "folder", baseId: "kb1", baseName: "Notes", toolPath: "f" },
    { scope: "entry", baseId: "kb1", baseName: "Notes", toolPath: "a.md" },
  ] },
  mcpDiscovery: { verb: "tool_search", catalog: "ALL_TOOLS" },
  profile: "full",
};

function turns(toolSet) {
  const ctx = { ...CTX, toolSet };
  return [
    framing.buildFencedTurn({ side: "responder", message: "hi", context: ctx, nonce: "n1" }),
    framing.buildFencedTurn({ side: "requester", message: "hi", context: { ...ctx, scope: "channel" }, nonce: "n1" }),
    framing.buildFencedTurn({ side: "responder", message: "hi", context: { ...ctx, channelId: "" }, nonce: "n1" }),
    seed.frameContinuation("n1", "hi", "Ann", null, null, toolSet),
    seed.frameOperatorTurn("n1", "hi", toolSet),
    seed.frameDirectedTurn("n1", "hi", toolSet),
  ];
}

test("a granular session's turns carry no legacy spelling, and every tool they name exists", () => {
  const granular = new Set(GRANULAR_NAMES);
  for (const text of turns("granular")) {
    const legacy = text.match(/\bdopl_(channel|kb|ontology|workspaces|skill|chats|members|map|status|agent)\b|\bop "/g);
    assert.equal(legacy, null, `legacy spelling ${legacy} in:\n${text}`);
    for (const [, name] of text.matchAll(/\b(dopl_[a-z_]+)\b/g)) assert.ok(granular.has(name), `${name} is not a granular tool`);
  }
});

test("the sweep reaches every block that spells a call", () => {
  const all = turns("granular").join("\n");
  for (const name of ["dopl_send_message", "dopl_read_channel", "dopl_get_channel", "dopl_list_channels",
    "dopl_browse_knowledge", "dopl_read_entry", "dopl_browse_ontology"]) {
    assert.ok(all.includes(name), `${name} never rendered: the fixture no longer reaches its block`);
  }
});

test("a legacy session's turns still name the legacy tools (the default is unchanged)", () => {
  const [responder] = turns(undefined);
  assert.equal(responder, turns("legacy")[0]);
  assert.match(responder, /exactly like this: op "send", channel "/);
  assert.ok(!/dopl_send_message|dopl_read_channel/.test(turns("legacy").join("\n")));
});
