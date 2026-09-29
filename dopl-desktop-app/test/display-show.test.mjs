// `dopl_show` ON THE DESKTOP (docs/specs/unified-display.md §7.1): the gate judges it as the legacy
// call it runs — `dopl_channel` `send` with `kind:"display"` — so with no `channel` it is an
// OWN-CHANNEL post (the server resolves the session channel), a named foreign channel is not, and
// the stream narrates it as the act rather than an empty body.
//
// Run: `node --test dopl-desktop-app/test/display-show.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (...p) => join(HERE, "..", "main", ...p);
const { canonicalDoplCall } = require(M("mcp-tool-names.js"));
const profiles = require(M("session-profiles.js"));
const { postTextOf } = require(M("session-post-surface.js"));

const decide = (input, messageMode) => {
  const call = canonicalDoplCall("mcp__dopl__dopl_show", input);
  return profiles.grantDecision({
    runtime: "claude", profile: "full", toolMode: "default", messageMode,
    channelId: "chan-1", allowForTask: [], toolName: call.name, input: call.input,
  });
};

test("dopl_show runs as dopl_channel send kind=display; the preset wins over a caller's kind", () => {
  assert.deepEqual(canonicalDoplCall("mcp__dopl__dopl_show", { blocks: [{ type: "divider" }], kind: "message" }), {
    name: "mcp__dopl__dopl_channel",
    input: { blocks: [{ type: "divider" }], kind: "display", op: "send" },
  });
});

test("no channel = the session's own channel: auto-outbound allows it, ask gates it; a foreign channel gates", () => {
  const blocks = [{ type: "heading", text: "Ship?" }];
  assert.equal(decide({ blocks }, "auto_outbound"), "allow");
  assert.equal(decide({ blocks, channel: "chan-1" }, "auto_outbound"), "allow");
  assert.equal(decide({ blocks }, "ask"), "gate");
  assert.equal(decide({ blocks, channel: "chan-2" }, "auto_outbound"), "gate");
});

test("a display narrates as the act, a send as its body", () => {
  assert.equal(postTextOf({ op: "send", kind: "display", blocks: [] }), "showed a display");
  assert.equal(postTextOf({ op: "send", body: "hi" }), "hi");
  assert.equal(postTextOf({}), "");
});
