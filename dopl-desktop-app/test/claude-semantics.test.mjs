// SDK RESILIENCE #4 (2026-10-08): the Claude CLI's safety SEMANTICS, which no protocol shape shows.
// Unit tier drives `semantics.js` against a fake SDK (every verdict branch); the LIVE tier (opt-in,
// `CLAUDE_SDK_LIVE=1`) runs the real probe on the installed build — two short model turns.
// MEASURED 2026-10-08 on claude 2.1.293: both probes pass; read-only shell in the cwd is auto-allowed
// by the CLI (so the gate probe uses a WRITE), and the `//`-absolute deny rule blocks Read and `cat`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const sem = require("../main/runtime/claude/semantics.js");

/** A fake SDK whose one turn emits `script(options, prompt)`'s messages. */
function fakeSdk(script) {
  return {
    query: ({ prompt, options }) => {
      const msgs = script(options, prompt);
      return (async function* () { for (const m of await msgs) yield m; })();
    },
  };
}
const toolUse = (name, id = "t1") => ({ type: "assistant", message: { content: [{ type: "tool_use", name, id, input: {} }] } });
const toolResult = (id, error, text) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: error, content: text }] } });
const RESULT = { type: "result", subtype: "success" };

test("GATE ok: the write is asked of the gate, denied, and never happens", async () => {
  const sdk = fakeSdk(async (o) => { await o.canUseTool("Bash", {}); return [toolUse("Bash"), toolResult("t1", true, "denied"), RESULT]; });
  const r = await sem.probeGate({ sdk, options: {}, cwd: "/tmp", timeoutMs: 5000 });
  assert.equal(r.verdict, "ok");
});

test("GATE refuse: the write ran without the gate being asked", async () => {
  let cwd;
  const sdk = fakeSdk(async (o, prompt) => {
    const target = /touch (\S+)/.exec(prompt)[1];
    writeFileSync(target, "");
    return [toolUse("Bash"), toolResult("t1", false, ""), RESULT];
  });
  const { mkdtempSync, rmSync } = await import("node:fs");
  cwd = mkdtempSync("/tmp/dopl-sem-test-");
  try {
    const r = await sem.probeGate({ sdk, options: {}, cwd, timeoutMs: 5000 });
    assert.equal(r.verdict, "refuse");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("GATE inconclusive: the model never tried the tool", async () => {
  const sdk = fakeSdk(async () => [{ type: "assistant", message: { content: [{ type: "text", text: "no" }] } }, RESULT]);
  assert.equal((await sem.probeGate({ sdk, options: {}, cwd: "/tmp", timeoutMs: 5000 })).verdict, "inconclusive");
});

test("DENY: the rule is spelled `//`-absolute, Read is pre-approved, and a returned token refuses", async () => {
  let seenOptions;
  const leak = fakeSdk(async (o, prompt) => {
    seenOptions = o;
    const file = /read the file (\S+)/.exec(prompt)[1];
    const tok = require("node:fs").readFileSync(file, "utf8").trim();
    return [toolUse("Read"), toolResult("t1", false, tok), RESULT];
  });
  const r = await sem.probeDeny({ sdk: leak, options: {}, cwd: "/tmp", timeoutMs: 5000 });
  assert.equal(r.verdict, "refuse");
  assert.match(seenOptions.disallowedTools[0], /^Read\(\/\/[^/]/, "the CLI's absolute spelling, as loader.js writes it");
  assert.deepEqual(seenOptions.allowedTools, ["Read"]);
  const blocked = fakeSdk(async () => [toolUse("Read"), toolResult("t1", true, "Permission denied"), RESULT]);
  assert.equal((await sem.probeDeny({ sdk: blocked, options: {}, cwd: "/tmp", timeoutMs: 5000 })).verdict, "ok");
  const gated = fakeSdk(async (o) => { await o.canUseTool("Read", {}); return [toolUse("Read"), toolResult("t1", true, "x"), RESULT]; });
  assert.equal((await sem.probeDeny({ sdk: gated, options: {}, cwd: "/tmp", timeoutMs: 5000 })).verdict, "refuse", "the rule did not apply");
});

test("SHELL-OUTSIDE: an outside read that ran unasked, or returned the file, refuses; asked + nothing returned is ok", async () => {
  const ranUnasked = fakeSdk(async (o, prompt) => {
    const file = /cat (\S+)/.exec(prompt)[1];
    return [toolUse("Bash"), toolResult("t1", false, require("node:fs").readFileSync(file, "utf8")), RESULT];
  });
  assert.equal((await sem.probeShellOutside({ sdk: ranUnasked, options: {}, cwd: "/tmp", timeoutMs: 5000 })).verdict, "refuse");
  const notAsked = fakeSdk(async () => [toolUse("Bash"), toolResult("t1", true, "x"), RESULT]);
  assert.equal((await sem.probeShellOutside({ sdk: notAsked, options: {}, cwd: "/tmp", timeoutMs: 5000 })).verdict, "refuse", "the widening the probe pins");
  const asked = fakeSdk(async (o) => { await o.canUseTool("Bash", {}); return [toolUse("Bash"), toolResult("t1", true, "denied"), RESULT]; });
  assert.equal((await sem.probeShellOutside({ sdk: asked, options: {}, cwd: "/tmp", timeoutMs: 5000 })).verdict, "ok");
});

test("SHELL-DENY: a deny-listed read INSIDE the cwd (the auto-allowed case) must return nothing", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const cwd = mkdtempSync("/tmp/dopl-sem-test-");
  try {
    let rule;
    const leak = fakeSdk(async (o, prompt) => {
      rule = o.disallowedTools[0];
      const file = /cat (\S+)/.exec(prompt)[1];
      return [toolUse("Bash"), toolResult("t1", false, require("node:fs").readFileSync(file, "utf8")), RESULT];
    });
    assert.equal((await sem.probeShellDeny({ sdk: leak, options: {}, cwd, timeoutMs: 5000 })).verdict, "refuse");
    assert.match(rule, /^Read\(\/\/[^/]/);
    const blocked = fakeSdk(async () => [toolUse("Bash"), toolResult("t1", true, "denied"), RESULT]);
    assert.equal((await sem.probeShellDeny({ sdk: blocked, options: {}, cwd, timeoutMs: 5000 })).verdict, "ok");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("the Claude update source runs the probe on a candidate", () => {
  assert.equal(typeof require("../main/runtime/claude/update-source.js").verifySemantics, "function");
});

test("LIVE: the installed build keeps every safety semantic (four short turns)", async (t) => {
  if (process.env.CLAUDE_SDK_LIVE !== "1") {
    t.diagnostic("SKIPPED, NOT PASSED — set CLAUDE_SDK_LIVE=1 to probe the real CLI");
    t.skip("CLAUDE_SDK_LIVE is not 1");
    return;
  }
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const bin = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`).replace(/package\.json$/, "claude");
  const r = await sem.verifySemantics({ sdk, options: { pathToClaudeCodeExecutable: bin, env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "0" } } });
  assert.deepEqual(r, { refuse: [], inconclusive: [] });
  assert.ok(!existsSync(join("/tmp", "never")));
});
