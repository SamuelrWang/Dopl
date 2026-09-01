// TIERED AGENT WAKE — TIER 3's model call: the fence around it, its budget, and every way it can
// fail (2026-08-28, Samuel's ruling).
//
// ⚠ SPLIT FROM `test/wake-tiers.test.mjs` AT THE 500-LINE §2 CAP, and the seam is real rather than
// arithmetic. That file drives `session-wake-tiers.js`, which cannot call anything; this drives
// `session-triage.js`, which is the one module in this feature that spends money and reaches a
// child process. The TIER TABLE, the OUTPUT PARSE and the TIE-BREAK are that file's — this one
// injects the REAL module for all three, so neither file restates the other's rule.
//
// ⚠ NO LIVE API, EVER. `claim` takes an injected RUNTIME, and every case here hands it a fake one.
// A test that could reach the network would bill the operator to assert a routing rule.
//
// ⚠ 2026-08-31 (runtime-adapter port, step 3 / §2.3 item 7): the triage LAUNCH SHAPE moved to
// `main/runtime/claude/triage.js`. It was the SECOND independent assembly of a run on this
// platform, and every field in it is a FENCE — a fence only one of two spawn shapes applies is
// not a fence, which is why it now sits beside the session's own launch spec and is DECLARED by
// `descriptor.triage`. The CLAIMING logic — the timeout, the concurrency, the deterministic
// tie-break and the budget ceiling — stayed in `session-triage.js`, because none of it is
// platform-shaped. This file drives BOTH halves with the REAL implementations of each.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);
const TRIAGE_SRC = readFileSync(join(MAIN, "session-triage.js"), "utf8");
const ADAPTER_SRC = readFileSync(join(MAIN, "runtime", "claude", "triage.js"), "utf8");
const CLAUDE_DESCRIPTOR = require(join(MAIN, "runtime", "index.js")).descriptorFor(null);
const tiers = require(join(MAIN, "session-wake-tiers.js"));
// ⚠ READ FROM THE SOURCE, NEVER RESTATED. The cap moved 6 → 15 on 2026-09-01 with
// `MAX_CONCURRENT_SESSIONS`, and a test carrying its own copy of the number is a test that
// passes while the truncation it pins has silently changed shape.
const REAL_TRIAGE_CAP = Number(
  (TRIAGE_SRC.match(/^const MAX_TRIAGE_PER_MESSAGE = (\d+);$/m) || [])[1]
);

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
  const logged = [];
  // The REAL fence, sliced out of the adapter and driven with fakes for the two electron-bound
  // helpers it reaches. Every assertion about `calls.options` below is therefore about the
  // options a real triage call would carry.
  const adapter = new Function(
    "os", "loader", "sessionAuth", "sessionModel", "TRIAGE_MODEL_ID",
    `${fnOf(ADAPTER_SRC, "triageOptions")}\n${fnOf(ADAPTER_SRC, "answerText")}\n`
    + " return { triageOptions, answerText };"
  )(
    { tmpdir: () => "/tmp/triage" },
    () => ({
      buildSecretPathDenyRules: () => ["Read(~/.claude*)"],
      buildScrubbedEnv: () => ({ PATH: "/usr/bin" }),
      resolveClaudeExecutable: () => "/bin/claude",
    }),
    () => ({ withStoredCredential: (e) => e }),
    () => require(join(MAIN, "session-model.js")), // the REAL frozen model table
    CLAUDE_DESCRIPTOR.triage.model
  );
  const runtime = {
    triageSpec: ({ prompt, abortController }) => {
      const options = adapter.triageOptions(abortController);
      calls.prompts.push(prompt);
      calls.options.push(options);
      const who = String(prompt.match(/name: (\S+)/)?.[1] || "");
      return { start: () => startFake(who, prompt, options), answerText: adapter.answerText };
    },
  };
  function startFake(who, prompt, options) {
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
  }
  const api = new Function(
    "crypto", "sessionAuth", "agentNames", "wakeTiers", "runtimeRegistry", "diag",
    "TRIAGE_MODEL_ID", "TRIAGE_TIMEOUT_MS", "MAX_TRIAGE_PER_MESSAGE",
    `${BLOCK}\n return { personaFor, claimOne, claim };`
  )(
    { randomUUID: () => "abcdef01-2345-6789-abcd-ef0123456789" },
    { credentialState: () => ({ usable: cfg.usable, source: "cli-store" }) },
    { displayNameFor: (id) => cfg.names?.[id] || "", descriptionForAgent: () => "" },
    tiers, // the REAL tier module — the parse and the tie-break must be the shipped ones
    {
      runtimeFor: () => { throw new Error("the registry must not be reached when a runtime is injected"); },
      descriptorFor: () => CLAUDE_DESCRIPTOR,
    },
    // ⚠ THE DIAG IS CAPTURED, NOT DISCARDED (2026-08-31, wave D). It used to be `() => {}`, and
    // one line this module emits is load-bearing enough to assert: a runtime that declares NO
    // triage shape must say so as itself, not as a TypeError from dereferencing the `null` its
    // own contract documents.
    (...parts) => logged.push(parts.join(" ")),
    CLAUDE_DESCRIPTOR.triage.model, cfg.timeoutMs || 5_000, REAL_TRIAGE_CAP
  );
  return { ...api, runtime, calls, cfg, logged, answerText: adapter.answerText };
}

const cand = (id) => ({ agentId: id, context: {} });
const args = (candidates, over = {}) => ({
  candidates, channelId: "c1", message: "who handles refunds?", authorName: "a guest", ...over,
});

test("CALL: exactly one claimant wakes, and only claimants are asked once each", async () => {
  tiers.resetForTests();
  const h = triage({ answers: { [`Agent`]: "PASS` " }, names: {} });
  const t = triage({ names: { [A1]: "Ops", [A2]: "Billing" }, answers: { Billing: "CLAIM" } });
  assert.equal(await t.claim({ ...args([cand(A1), cand(A2)]), runtime: t.runtime }), A2);
  assert.equal(t.calls.prompts.length, 2, "ONE call per candidate, no retries");
  assert.ok(h);
});

test("CALL: nobody claiming answers '' — the room stays asleep", async () => {
  const t = triage({ names: { [A1]: "Ops", [A2]: "Billing" } });
  assert.equal(await t.claim({ ...args([cand(A1), cand(A2)]), runtime: t.runtime }), "");
});

test("CALL: when several claim, SPAWN ORDER awards it — not the fastest answer", async () => {
  // ⚠ THE SLOW ONE IS FIRST IN SPAWN ORDER AND STILL WINS. Without the ordering rule this test is
  // the definition of flaky: it would pass or fail on scheduler timing.
  const t = triage({
    names: { [A1]: "Ops", [A2]: "Billing", [A3]: "Support" },
    answers: { Ops: "CLAIM", Billing: "CLAIM", Support: "CLAIM" },
    hang: { Ops: true },
  });
  assert.equal(await t.claim({ ...args([cand(A1), cand(A2), cand(A3)]), runtime: t.runtime }), A1);
});

test("CALL: every failure mode is a PASS — a throw, a silent stream, a malformed answer", async () => {
  const thrown = triage({ names: { [A1]: "Ops" }, throwFor: { Ops: true } });
  assert.equal(await thrown.claim({ ...args([cand(A1)]), runtime: thrown.runtime }), "");

  const junk = triage({ names: { [A1]: "Ops" }, answers: { Ops: "Sure! CLAIM — it's about refunds." } });
  assert.equal(await junk.claim({ ...args([cand(A1)]), runtime: junk.runtime }), "", "an explained claim is a pass");

  const empty = triage({ names: { [A1]: "Ops" }, answers: { Ops: "" } });
  assert.equal(await empty.claim({ ...args([cand(A1)]), runtime: empty.runtime }), "");

  // A stream that ends with no result at all.
  const silent = triage({ names: { [A1]: "Ops" } });
  silent.runtime.triageSpec = () => ({
    start: () => ({ async *[Symbol.asyncIterator]() { yield { type: "system", subtype: "init" }; } }),
    answerText: silent.answerText,
  });
  assert.equal(await silent.claim({ ...args([cand(A1)]), runtime: silent.runtime }), "");

  // ⚠ AND ONE BAD CANDIDATE DOES NOT TAKE THE PASS DOWN WITH IT: the sibling still claims.
  const mixed = triage({
    names: { [A1]: "Ops", [A2]: "Billing" },
    throwFor: { Ops: true },
    answers: { Billing: "CLAIM" },
  });
  assert.equal(await mixed.claim({ ...args([cand(A1), cand(A2)]), runtime: mixed.runtime }), A2);
});

// ⚠ A RUNTIME THAT DECLARES NO TRIAGE IS NOT A RUNTIME THAT FAILED (2026-08-31, wave D).
// `contract.js › RUNTIME_METHODS` documents `triageSpec` as returning "the opaque triage launch
// payload, OR `null`", and two of the three shipped adapters answer `null` on purpose — they have
// no `maxTurns` analogue and no "offer no tools" option, so they cannot fence a call that reads
// untrusted guest text and decline to make one (`main/runtime/codex/triage.js`,
// `main/runtime/cursor/triage.js`). The `null` used to fall through to `run.start()` and surface
// as `"triage: call failed — Cannot read properties of null (reading 'start') (reads as PASS)"`:
// a TypeError an operator would read as a platform fault, for a call that was never made, once
// per dormant candidate per guest message, forever. The VERDICT was right and the SENTENCE was
// not, so this pins both halves.
test("CALL: a runtime that declares NO triage passes, and the log says so as itself", async () => {
  const t = triage({ names: { [A1]: "Ops", [A2]: "Billing" } });
  t.runtime.triageSpec = () => null; // the declared answer on a runtime with no triage shape
  assert.equal(await t.claim({ ...args([cand(A1), cand(A2)]), runtime: t.runtime }), "",
    "nobody claims — the same outcome as losing the race, and nothing hangs");
  const said = t.logged.filter((l) => l.includes("declares no triage shape"));
  assert.equal(said.length, 2, "one honest line per candidate asked");
  for (const line of said) {
    assert.match(line, /\bpass\b/, "the verdict is stated, not implied");
    assert.match(line, /no call was made/, "…and so is the fact that nothing was spent");
  }
  assert.equal(
    t.logged.filter((l) => /call failed|Cannot read properties/.test(l)).length,
    0,
    "a declared null must never be reported as a failed call"
  );
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
  assert.equal(await t.claim({ ...args([cand(A1)]), runtime: t.runtime }), "");
  assert.equal(t.calls.prompts.length, 0, "not one call was made");
});

test("CALL: no candidates buys no call, and the budget truncates rather than refusing", async () => {
  const none = triage();
  assert.equal(await none.claim({ ...args([]), runtime: none.runtime }), "");
  assert.equal(none.calls.prompts.length, 0);

  // ⚠ TRUNCATION, NOT REFUSAL. An over-budget room triages its OLDEST candidates and the rest
  // stay asleep; refusing the whole pass would make a busy room stop answering guests entirely,
  // which is the failure this ruling exists to fix.
  const many = triage({ names: { [A1]: "Ops" }, answers: { Ops: "CLAIM" } });
  assert.ok(REAL_TRIAGE_CAP > 0, "MAX_TRIAGE_PER_MESSAGE moved or changed shape");
  const big = Array.from({ length: REAL_TRIAGE_CAP + 6 }, (_, i) => cand(`aaaaaaa${i % 10}`));
  await many.claim({ ...args([cand(A1), ...big]), runtime: many.runtime });
  assert.equal(many.calls.prompts.length, REAL_TRIAGE_CAP,
    "capped at MAX_TRIAGE_PER_MESSAGE");
});

// ── 8. THE FENCE AROUND THE CALL ─────────────────────────────────────────────

test("FENCE: a triage run reaches no Dopl surface, no tool and no channel folder", async () => {
  const t = triage({ names: { [A1]: "Ops" } });
  await t.claim({ ...args([cand(A1)]), runtime: t.runtime });
  const o = t.calls.options[0];
  assert.deepEqual(o.mcpServers, {}, "no dopl server: no channel read, no post, no knowledge");
  assert.deepEqual(o.allowedTools, [], "nothing shadowed past the gate");
  assert.deepEqual(o.settingSources, [], "no local settings file can widen it");
  assert.equal(o.permissionMode, "default", "and no permission mode can short-circuit canUseTool");
  assert.equal(o.maxTurns, 1, "one assistant turn: a denied tool call cannot be retried");
  assert.equal(o.cwd, "/tmp/triage", "the OS temp dir, never the operator's channel folder");
  assert.ok(o.disallowedTools.includes("Read(~/.claude*)"), "the credential-path deny rides along");
  // ⚠ THE LOAD-BEARING ONE. This platform has no "offer no tools" option — `options.tools = []` means NO
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
  await t.claim({ ...args([cand(A1)]), runtime: t.runtime });
  assert.equal(t.calls.options[0].model, "haiku");
  assert.match(ADAPTER_SRC, /const TRIAGE_MODEL_ID = 'claude-haiku-4-5-20251001';/,
    "the ruling's own id lives with the fence it spends");
  assert.equal(CLAUDE_DESCRIPTOR.triage.model, "claude-haiku-4-5-20251001",
    "…and it is DECLARED, so `session-triage.js` reads it rather than restating it");
  const sessionModel = require(join(MAIN, "session-model.js"));
  assert.equal(sessionModel.normalizeModelId("claude-haiku-4-5-20251001"), "claude-haiku-4-5-20251001",
    "the dated id is a member of the frozen list, so it cannot silently become 'default'");
});

test("FENCE: the call is TIME-BOUNDED, because it holds the channel's cursor", async () => {
  // A triage that cannot answer must not become a channel that stops draining.
  const t = triage({ timeoutMs: 5, names: { [A1]: "Ops" }, answers: { Ops: "CLAIM" }, hang: { Ops: true } });
  const started = Date.now();
  assert.equal(await t.claim({ ...args([cand(A1)]), runtime: t.runtime }), "", "an aborted call is a PASS");
  assert.ok(Date.now() - started < 200, "and it did not wait for the hung stream");
  assert.match(TRIAGE_SRC, /const TRIAGE_TIMEOUT_MS = 8_000;/);
});

test("FENCE: the router is told the AGENT's identity and the message, and nothing else", async () => {
  const t = triage({ names: { [A1]: "Ops" } });
  tiers.resetForTests();
  tiers.noteMessage("c1", "Alice", "we should look at the refund policy");
  await t.claim({ ...args([cand(A1)]), runtime: t.runtime });
  const p = t.calls.prompts[0];
  assert.match(p, /name: Ops/);
  assert.match(p, /who handles refunds\?/);
  assert.match(p, /we should look at the refund policy/, "the ring supplies the context, not a fetch");
  assert.ok(!p.includes("Bearer"), "no credential material can be in a prompt built from a persona");
  tiers.resetForTests();
});
