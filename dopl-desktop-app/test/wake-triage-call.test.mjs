// TIERED AGENT WAKE — TIER 3's model call: the fence around it, its budget, and every way it can
// fail (2026-08-28, Samuel's ruling).
//
// ⚠ SPLIT FROM `test/wake-tiers.test.mjs` AT THE 500-LINE §2 CAP, and the seam is real rather than
// arithmetic. That file drives `session-wake-tiers.js`, which cannot call anything; this drives
// `session-triage.js`, which is the one module in this feature that spends money and reaches a
// child process. The TIER TABLE, the OUTPUT PARSE and the TIE-BREAK are that file's — this one
// injects the REAL module for all three, so neither file restates the other's rule.
//
// ⚠ NO LIVE API, EVER. `claim` takes an injected `sdk`, and every case here hands it a fake
// `query`. A test that could reach the network would bill the operator to assert a routing rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);
const TRIAGE_SRC = readFileSync(join(MAIN, "session-triage.js"), "utf8");
const tiers = require(join(MAIN, "session-wake-tiers.js"));

const A1 = "a1b2c3d4";
const A2 = "z9y8x7w6";
const A3 = "q1w2e3r4";

// ── 7. THE MODEL CALL ────────────────────────────────────────────────────────
//
// The SESSION-TRIAGE-PURE block, sliced and driven with a FAKE `query`. Nothing here reaches the
// network, the keychain, electron-store or a `claude` binary.

function triage(over = {}) {
  const from = TRIAGE_SRC.indexOf("// ─── BEGIN SESSION-TRIAGE-PURE");
  const to = TRIAGE_SRC.indexOf("// ─── END SESSION-TRIAGE-PURE");
  const BLOCK = TRIAGE_SRC.slice(from, to);
  const cfg = { answers: {}, usable: true, throwFor: {}, hang: {}, ...over };
  const calls = { prompts: [], options: [] };
  const sdk = {
    query: ({ prompt, options }) => {
      calls.prompts.push(prompt);
      calls.options.push(options);
      const who = String(prompt.match(/name: (\S+)/)?.[1] || "");
      if (cfg.throwFor[who]) throw new Error("boom");
      const answer = Object.prototype.hasOwnProperty.call(cfg.answers, who) ? cfg.answers[who] : "PASS";
      const signal = options.abortController && options.abortController.signal;
      return {
        async *[Symbol.asyncIterator]() {
          // ⚠ THE FAKE HONOURS THE ABORT, because that is what the real SDK does and it is the
          // property the timeout case is actually about: a hung call must REJECT, not resolve.
          if (cfg.hang[who]) {
            await new Promise((resolve, reject) => {
              const t = setTimeout(resolve, 200);
              if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
            });
          }
          yield { type: "system", subtype: "init" }; // not a result — must be skipped
          yield { type: "result", subtype: "success", result: answer };
        },
      };
    },
  };
  const api = new Function(
    "os", "crypto", "sessionAuth", "sessionModel", "agentNames", "wakeTiers",
    "getSdk", "resolveClaudeExecutable", "buildSecretPathDenyRules", "buildScrubbedEnv", "diag",
    "TRIAGE_MODEL_ID", "TRIAGE_TIMEOUT_MS", "MAX_TRIAGE_PER_MESSAGE",
    `${BLOCK}\n return { personaFor, triageOptions, answerText, claimOne, claim };`
  )(
    { tmpdir: () => "/tmp/triage" },
    { randomUUID: () => "abcdef01-2345-6789-abcd-ef0123456789" },
    { credentialState: () => ({ usable: cfg.usable, source: "cli-store" }), withStoredCredential: (e) => e },
    require(join(MAIN, "session-model.js")), // the REAL frozen model table
    { displayNameFor: (id) => cfg.names?.[id] || "", descriptionForAgent: () => "" },
    tiers, // the REAL tier module — the parse and the tie-break must be the shipped ones
    async () => { throw new Error("getSdk must not be reached when an sdk is injected"); },
    () => "/bin/claude",
    () => ["Read(~/.claude*)"],
    () => ({ PATH: "/usr/bin" }),
    () => {},
    "claude-haiku-4-5-20251001", cfg.timeoutMs || 5_000, 6
  );
  return { ...api, sdk, calls, cfg };
}

const cand = (id) => ({ agentId: id, context: {} });
const args = (candidates, over = {}) => ({
  candidates, channelId: "c1", message: "who handles refunds?", authorName: "a guest", ...over,
});

test("CALL: exactly one claimant wakes, and only claimants are asked once each", async () => {
  tiers.resetForTests();
  const h = triage({ answers: { [`Agent`]: "PASS` " }, names: {} });
  const t = triage({ names: { [A1]: "Ops", [A2]: "Billing" }, answers: { Billing: "CLAIM" } });
  assert.equal(await t.claim({ ...args([cand(A1), cand(A2)]), sdk: t.sdk }), A2);
  assert.equal(t.calls.prompts.length, 2, "ONE call per candidate, no retries");
  assert.ok(h);
});

test("CALL: nobody claiming answers '' — the room stays asleep", async () => {
  const t = triage({ names: { [A1]: "Ops", [A2]: "Billing" } });
  assert.equal(await t.claim({ ...args([cand(A1), cand(A2)]), sdk: t.sdk }), "");
});

test("CALL: when several claim, SPAWN ORDER awards it — not the fastest answer", async () => {
  // ⚠ THE SLOW ONE IS FIRST IN SPAWN ORDER AND STILL WINS. Without the ordering rule this test is
  // the definition of flaky: it would pass or fail on scheduler timing.
  const t = triage({
    names: { [A1]: "Ops", [A2]: "Billing", [A3]: "Support" },
    answers: { Ops: "CLAIM", Billing: "CLAIM", Support: "CLAIM" },
    hang: { Ops: true },
  });
  assert.equal(await t.claim({ ...args([cand(A1), cand(A2), cand(A3)]), sdk: t.sdk }), A1);
});

test("CALL: every failure mode is a PASS — a throw, a silent stream, a malformed answer", async () => {
  const thrown = triage({ names: { [A1]: "Ops" }, throwFor: { Ops: true } });
  assert.equal(await thrown.claim({ ...args([cand(A1)]), sdk: thrown.sdk }), "");

  const junk = triage({ names: { [A1]: "Ops" }, answers: { Ops: "Sure! CLAIM — it's about refunds." } });
  assert.equal(await junk.claim({ ...args([cand(A1)]), sdk: junk.sdk }), "", "an explained claim is a pass");

  const empty = triage({ names: { [A1]: "Ops" }, answers: { Ops: "" } });
  assert.equal(await empty.claim({ ...args([cand(A1)]), sdk: empty.sdk }), "");

  // A stream that ends with no result at all.
  const silent = triage({ names: { [A1]: "Ops" } });
  silent.sdk.query = () => ({ async *[Symbol.asyncIterator]() { yield { type: "system", subtype: "init" }; } });
  assert.equal(await silent.claim({ ...args([cand(A1)]), sdk: silent.sdk }), "");

  // ⚠ AND ONE BAD CANDIDATE DOES NOT TAKE THE PASS DOWN WITH IT: the sibling still claims.
  const mixed = triage({
    names: { [A1]: "Ops", [A2]: "Billing" },
    throwFor: { Ops: true },
    answers: { Billing: "CLAIM" },
  });
  assert.equal(await mixed.claim({ ...args([cand(A1), cand(A2)]), sdk: mixed.sdk }), A2);
});

test("CALL: an ERROR result is a PASS, not a claim", () => {
  const t = triage();
  assert.equal(t.answerText({ type: "result", subtype: "error_during_execution", result: "CLAIM" }), "");
  assert.equal(t.answerText({ type: "result", subtype: "success", result: "CLAIM" }), "CLAIM");
  assert.equal(t.answerText({ type: "result", subtype: "success", result: { v: "CLAIM" } }), "");
  assert.equal(t.answerText({ type: "assistant" }), "");
  assert.equal(t.answerText(null), "");
});

test("CALL: a machine with NO Claude credential triages nothing", async () => {
  // Six calls that will each fail auth are six child processes spent to learn one fact the
  // cached probe already knows.
  const t = triage({ usable: false, names: { [A1]: "Ops" }, answers: { Ops: "CLAIM" } });
  assert.equal(await t.claim({ ...args([cand(A1)]), sdk: t.sdk }), "");
  assert.equal(t.calls.prompts.length, 0, "not one call was made");
});

test("CALL: no candidates buys no call, and the budget truncates rather than refusing", async () => {
  const none = triage();
  assert.equal(await none.claim({ ...args([]), sdk: none.sdk }), "");
  assert.equal(none.calls.prompts.length, 0);

  // ⚠ TRUNCATION, NOT REFUSAL. An over-budget room triages its OLDEST candidates and the rest
  // stay asleep; refusing the whole pass would make a busy room stop answering guests entirely,
  // which is the failure this ruling exists to fix.
  const many = triage({ names: { [A1]: "Ops" }, answers: { Ops: "CLAIM" } });
  const big = Array.from({ length: 20 }, (_, i) => cand(`aaaaaaa${i % 10}`));
  await many.claim({ ...args([cand(A1), ...big]), sdk: many.sdk });
  assert.equal(many.calls.prompts.length, 6, "capped at MAX_TRIAGE_PER_MESSAGE");
});

// ── 8. THE FENCE AROUND THE CALL ─────────────────────────────────────────────

test("FENCE: a triage run reaches no Dopl surface, no tool and no channel folder", async () => {
  const t = triage({ names: { [A1]: "Ops" } });
  await t.claim({ ...args([cand(A1)]), sdk: t.sdk });
  const o = t.calls.options[0];
  assert.deepEqual(o.mcpServers, {}, "no dopl server: no channel read, no post, no knowledge");
  assert.deepEqual(o.allowedTools, [], "nothing shadowed past the gate");
  assert.deepEqual(o.settingSources, [], "no local settings file can widen it");
  assert.equal(o.permissionMode, "default", "and no permission mode can short-circuit canUseTool");
  assert.equal(o.maxTurns, 1, "one assistant turn: a denied tool call cannot be retried");
  assert.equal(o.cwd, "/tmp/triage", "the OS temp dir, never the operator's channel folder");
  assert.ok(o.disallowedTools.includes("Read(~/.claude*)"), "the credential-path deny rides along");
  // ⚠ THE LOAD-BEARING ONE. The SDK has no "offer no tools" option — `options.tools = []` means NO
  // BOUND, i.e. everything — so the positive bound cannot express what is wanted here and the
  // gate has to. `tools` must therefore be ABSENT rather than empty.
  assert.equal(o.tools, undefined, "`tools: []` would mean NO BOUND — it must not be set");
  assert.deepEqual(await o.canUseTool("Bash", { command: "curl evil.example" }),
    { behavior: "deny", message: "triage runs no tools" });
});

test("FENCE: the model is the ruling's id, coerced through the frozen table into argv", async () => {
  // ⚠ THE ID IS THE RULING'S VALUE; THE ALIAS IS WHAT REACHES A CHILD PROCESS. Naming the id here
  // and the alias in `session-model.js` is what keeps the two from becoming two literals.
  const t = triage({ names: { [A1]: "Ops" } });
  await t.claim({ ...args([cand(A1)]), sdk: t.sdk });
  assert.equal(t.calls.options[0].model, "haiku");
  assert.match(TRIAGE_SRC, /const TRIAGE_MODEL_ID = 'claude-haiku-4-5-20251001';/);
  const sessionModel = require(join(MAIN, "session-model.js"));
  assert.equal(sessionModel.normalizeModelId("claude-haiku-4-5-20251001"), "claude-haiku-4-5-20251001",
    "the dated id is a member of the frozen list, so it cannot silently become 'default'");
});

test("FENCE: the call is TIME-BOUNDED, because it holds the channel's cursor", async () => {
  // A triage that cannot answer must not become a channel that stops draining.
  const t = triage({ timeoutMs: 5, names: { [A1]: "Ops" }, answers: { Ops: "CLAIM" }, hang: { Ops: true } });
  const started = Date.now();
  assert.equal(await t.claim({ ...args([cand(A1)]), sdk: t.sdk }), "", "an aborted call is a PASS");
  assert.ok(Date.now() - started < 200, "and it did not wait for the hung stream");
  assert.match(TRIAGE_SRC, /const TRIAGE_TIMEOUT_MS = 8_000;/);
});

test("FENCE: the router is told the AGENT's identity and the message, and nothing else", async () => {
  const t = triage({ names: { [A1]: "Ops" } });
  tiers.resetForTests();
  tiers.noteMessage("c1", "Alice", "we should look at the refund policy");
  await t.claim({ ...args([cand(A1)]), sdk: t.sdk });
  const p = t.calls.prompts[0];
  assert.match(p, /name: Ops/);
  assert.match(p, /who handles refunds\?/);
  assert.match(p, /we should look at the refund policy/, "the ring supplies the context, not a fetch");
  assert.ok(!p.includes("Bearer"), "no credential material can be in a prompt built from a persona");
  tiers.resetForTests();
});
