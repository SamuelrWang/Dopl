// P4-05 — DOES THE BUNDLED CLAUDE CLI FOLD A MID-TURN PUSH INTO THE RUNNING TURN?
//
// `session-directed.js › armAndOpen` covers a direction pushed while a turn is in flight with a
// depth of 2, which is right only if that push becomes its OWN later turn. The CLI's command queue
// can instead absorb a `priority: 'next'` message after the running turn's next tool batch, so one
// `result` answers both. This measures which one happens, on the production push shape
// (`session-io.js › makePushIterator` / `userMessage`), and what the stream says when it does.
//
// Opt-in: one short turn on the cheapest model. `CLAUDE_LIVE_TURN=1 node --test test/claude-mid-turn-fold-live.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const io = require("../main/session-io.js");

const ARMED = process.env.CLAUDE_LIVE_TURN === "1";
const MODEL = "haiku";
const BUDGET_MS = 120000;
const QUIET_AFTER_RESULT_MS = 20000;

function bundledBinary() {
  try {
    const pkg = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    const bin = join(dirname(pkg), "claude");
    return existsSync(bin) ? bin : null;
  } catch (_) {
    return null;
  }
}

// The child gets the app's environment, not the host's: a parent Claude Code session's own
// CLAUDE_*/ANTHROPIC_* wiring (proxy URL, host auth refresh) is dropped; credentials pass.
const PASS_THROUGH = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]);
function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC)/.test(k) && !PASS_THROUGH.has(k)) continue;
    env[k] = v;
  }
  return env;
}

/** One line per stream message: enough to read the order back, never the prompt text. */
function summarize(m) {
  if (!m || typeof m !== "object") return String(m);
  if (m.type === "assistant") {
    const kinds = ((m.message && m.message.content) || []).map((b) => (b.type === "text" ? `text:${String(b.text).slice(0, 40)}` : b.type));
    return `assistant[${kinds.join(",")}]`;
  }
  if (m.type === "user") return `user${m.isReplay ? "(replay)" : ""}${m.uuid ? `#${String(m.uuid).slice(0, 8)}` : ""}`;
  if (m.type === "result") return `result(${m.subtype})`;
  if (m.type === "command_lifecycle") return `command_lifecycle(${m.state}#${String(m.command_uuid || m.uuid || "").slice(0, 8)})`;
  return `${m.type}${m.subtype ? `/${m.subtype}` : ""}`;
}

test("LIVE: a push made while a tool call runs — folded into that turn, or its own turn?", { timeout: BUDGET_MS + 30000 }, async (t) => {
  if (!ARMED) {
    t.diagnostic("SKIPPED, NOT PASSED — CLAUDE_LIVE_TURN is not 1 (this spends one short Claude turn)");
    t.skip("CLAUDE_LIVE_TURN is not 1");
    return;
  }
  const bin = bundledBinary();
  assert.ok(bin, "the bundled Claude binary must resolve for this platform");
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const cwd = mkdtempSync(join(tmpdir(), "dopl-claude-fold-"));
  const first = randomUUID();
  const second = randomUUID();
  const prompts = io.makePushIterator();
  const q = sdk.query({
    prompt: prompts,
    options: {
      model: MODEL,
      pathToClaudeCodeExecutable: bin,
      cwd,
      settingSources: [],
      permissionMode: "default",
      tools: ["Bash"],
      allowedTools: ["Bash"],
      maxTurns: 8,
      persistSession: false,
      includePartialMessages: false,
      env: childEnv(),
    },
  });
  const seen = [];
  const lifecycle = [];
  const results = [];
  let pushedAt = -1;
  let quiet = null;
  const stop = () => { try { prompts.close(); } catch (_) { /* best effort */ } };
  const budget = setTimeout(() => { seen.push("BUDGET EXPIRED"); stop(); try { q.close(); } catch (_) { /* best effort */ } }, BUDGET_MS);
  prompts.push({ ...io.userMessage("Use the Bash tool exactly once to run: sleep 6 && echo tick. When it finishes, reply with the single word FIRST."), uuid: first });
  try {
    for await (const m of q) {
      if (quiet) { clearTimeout(quiet); quiet = null; }
      seen.push(summarize(m));
      if (m.type === "command_lifecycle") lifecycle.push({ uuid: m.command_uuid || m.uuid, state: m.state, at: seen.length - 1, resultsBefore: results.length });
      const toolCall = m.type === "assistant" && ((m.message && m.message.content) || []).some((b) => b.type === "tool_use");
      if (toolCall && pushedAt < 0) {
        // The production shape: no `priority` field, so the CLI's own default (`next`) applies.
        prompts.push({ ...io.userMessage("Also include the word SECOND in your final reply."), uuid: second });
        pushedAt = seen.length - 1;
        seen.push("<< pushed SECOND >>");
      }
      if (m.type === "result") {
        const text = typeof m.result === "string" ? m.result : "";
        results.push({ at: seen.length - 1, text: text.slice(0, 200), subtype: m.subtype });
        const secondDone = lifecycle.some((l) => l.uuid === second && (l.state === "completed" || l.state === "cancelled"));
        if (results.length >= 2 || secondDone || pushedAt < 0) stop();
        else quiet = setTimeout(stop, QUIET_AFTER_RESULT_MS);
      }
    }
  } finally {
    clearTimeout(budget);
    if (quiet) clearTimeout(quiet);
    try { rmSync(cwd, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }

  const report = { model: MODEL, pushedAfterToolCall: pushedAt >= 0, results, lifecycle, stream: seen };
  t.diagnostic(JSON.stringify(report, null, 2));
  assert.ok(pushedAt >= 0, "the model never called the tool, so nothing was pushed mid-turn — inconclusive");
  assert.equal(results.length, 1, "FOLDED: one `result` answers both the running turn and the mid-turn push");
  assert.match(results[0].text, /SECOND/, "the folded turn's final text answers the push");
  const started = lifecycle.find((l) => l.uuid === second && l.state === "started");
  assert.ok(started, "the fold announces itself: `command_lifecycle{started}` for the pushed uuid");
  assert.equal(started.resultsBefore, 0, "…before the running turn's `result`, which is what tells a fold from a turn of its own");
  assert.ok(started.at > pushedAt, "…and after the push");
});
