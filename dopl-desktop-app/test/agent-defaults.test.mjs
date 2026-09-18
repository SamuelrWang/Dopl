// THE DEFAULT AGENT SETTINGS VALIDATOR (main/agent-defaults.js) — what a channel created from
// now on starts its agents on.
//
// WHAT IT COSTS WHEN THIS IS WRONG. This record is copied verbatim into a new channel's own
// launch posture, and that posture decides what a spawned agent may do on this machine. The app
// window hosts remote content, so the renderer is a hostile input: a value outside the frozen
// enums that some later reader coerced in a permissive direction would hand a page `bypass`
// without the operator ever seeing the word. So every rule pinned here is fail-closed:
//
//   - only the eight frozen enum members are storable, on either axis;
//   - a rejected write produces NOTHING (no half-applied record);
//   - an unknown MODEL or RUNTIME is absent rather than fatal — the soft half, which is what
//     lets a desktop that predates an id still store a pair;
//   - `agentChain` is `=== true` and nothing else, because it lifts a bound;
//   - an absent or corrupt record resolves to the MOST RESTRICTIVE pair, which is the same pair
//     `channel-prefs.js › DEFAULT_PRESET` spells.
//
// ⚠ WHAT IS **NOT** HERE, DELIBERATELY. `seedChannel` — the inheritance point — is not a pure
// function: it reads and writes two store-backed modules. Its two load-bearing properties are
// pinned where they can be driven against the real thing:
//   · "the seed writes the posture through the ONE validating writer, and is reachable only from
//     the bound-sender IPC surface" — `test/session-preset-start.test.mjs`'s writer census;
//   · "the defaults record is never read on the session path" — the same file's reader census.
// A stubbed re-implementation of `seedChannel` here would assert about a copy of the program.
//
// WHY SOURCE EXTRACTION: agent-defaults.js pulls in electron-store, so it does not import under
// `node --test`. The validation half is fenced as a PURE block (no electron/fs/store/require
// refs) and sliced verbatim, the same pattern `_channel-prefs-block.mjs` uses.
//
// Run: `node --test dopl-desktop-app/test/agent-defaults.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "agent-defaults.js"), "utf8");

// ⚠ SLICED BY THE FENCE, NOT BY LINE NUMBERS — a comment added above the block must not move
// this suite onto a different program.
const block = SRC.slice(
  SRC.indexOf("// ─── BEGIN AGENT-DEFAULTS-VALIDATE"),
  SRC.indexOf("// ─── END AGENT-DEFAULTS-VALIDATE")
);
assert.ok(block.length > 0, "the pure block's fence is intact");
const {
  TOOL_MODES,
  MESSAGE_MODES,
  FACTORY_DEFAULTS,
  normalizeDefaults,
  effectiveDefaults,
} = new Function(
  `${block}\n return { TOOL_MODES, MESSAGE_MODES, FACTORY_DEFAULTS, normalizeDefaults, effectiveDefaults };`
)();

// The two injected normalizers, standing in for `session-model.js` and `channel-runtime.js`.
// ⚠ THEY ARE PASSED IN rather than required, which is what keeps the block pure — and it is also
// what lets this suite drive the SOFT half without loading the real registry.
const model = (v) => (v === "opus" || v === "sonnet" ? v : "");
const runtime = (v) => (v === "codex" || v === "cursor" ? v : "");
const norm = (raw) => normalizeDefaults(raw, model, runtime);

const OK = { tools: "accept_edits", messages: "auto_inbound" };

test("the frozen enums are exactly the eight members the posture record accepts", () => {
  // ⚠ SPELLED OUT rather than compared to `channel-prefs.js`'s copy: these two lists must AGREE,
  // and a test that derived one from the other could not notice them drifting apart together.
  assert.deepEqual(TOOL_MODES, ["manual", "accept_edits", "auto", "bypass"]);
  assert.deepEqual(MESSAGE_MODES, ["ask", "auto_inbound", "auto_outbound", "auto_both"]);
});

test("the factory pair is the MOST RESTRICTIVE one, and chaining is off", () => {
  // A machine that has never opened the Agents tab must seed nothing different from what a
  // channel got before this feature existed.
  assert.deepEqual(FACTORY_DEFAULTS, { tools: "manual", messages: "ask", agentChain: false });
});

test("both axes validate HARD — an unknown value on either rejects the WHOLE record", () => {
  assert.equal(norm({ tools: "root", messages: "ask" }), null);
  assert.equal(norm({ tools: "manual", messages: "always" }), null);
  // ⚠ A HALF-VALID PAIR IS REJECTED WHOLE, never partially applied: a record with one axis
  // stored and one defaulted is the "one switch, two meanings" confusion the two axes exist to
  // remove.
  assert.equal(norm({ tools: "bypass" }), null);
  assert.equal(norm({ messages: "auto_both" }), null);
});

test("a non-record is not a record", () => {
  for (const bad of [null, undefined, 0, "", "manual", [], [OK]]) {
    assert.equal(norm(bad), null, JSON.stringify(bad));
  }
});

test("extra properties are dropped — nothing but the validated members is ever stored", () => {
  const out = norm({ ...OK, at: 1, path: "/etc/passwd", tools2: "bypass" });
  assert.deepEqual(Object.keys(out).sort(), ["agentChain", "messages", "tools"]);
});

test("agentChain is `=== true` and nothing else, because it lifts a bound", () => {
  assert.equal(norm({ ...OK, agentChain: true }).agentChain, true);
  for (const truthy of ["true", 1, {}, [], "yes"]) {
    assert.equal(norm({ ...OK, agentChain: truthy }).agentChain, false, String(truthy));
  }
  assert.equal(norm(OK).agentChain, false, "absent is off");
});

test("the model validates SOFT, and ABSENT IS NOT A MEMBER", () => {
  assert.equal(norm({ ...OK, model: "opus" }).model, "opus");
  // ⚠ AN UNKNOWN MODEL DOES NOT FAIL THE PAIR — a desktop that has not heard of a newer id must
  // still be able to store a posture; refusing the permission pair over a model name is the
  // wrong trade in both directions.
  assert.ok(!("model" in norm({ ...OK, model: "gpt-9" })), "unknown is absent, not stored");
  // ⚠ OMITTED RATHER THAN '' OR null, so a record from before the field and a record whose model
  // was cleared are the SAME record and no reader can grow a third state to get wrong.
  assert.ok(!("model" in norm({ ...OK, model: "" })));
  assert.ok(!("model" in norm(OK)));
});

test("the runtime validates SOFT the same way, and '' is an absence rather than a pick", () => {
  assert.equal(norm({ ...OK, runtime: "codex" }).runtime, "codex");
  assert.ok(!("runtime" in norm({ ...OK, runtime: "borg" })));
  assert.ok(!("runtime" in norm({ ...OK, runtime: "" })));
  assert.ok(!("runtime" in norm(OK)));
});

test("the WIRE always carries `model` and `runtime`; STORAGE does not", () => {
  // ⚠ THE ASYMMETRY IS THE POINT, NOT AN INCONSISTENCY TO TIDY. The web's capability probes are
  // OWN-KEY tests, so a reply missing either key reads as "this desktop has no such concept" and
  // renders NO row — and the only way to store a value is the row that was never drawn.
  const stored = norm(OK);
  assert.ok(!("model" in stored) && !("runtime" in stored), "storage omits both");
  const wire = effectiveDefaults(stored);
  assert.deepEqual(wire, {
    tools: "accept_edits",
    messages: "auto_inbound",
    agentChain: false,
    model: null,
    runtime: "",
  });
});

test("an absent or unreadable record resolves to the factory pair, never to something wider", () => {
  assert.deepEqual(effectiveDefaults(null), {
    tools: "manual",
    messages: "ask",
    agentChain: false,
    model: null,
    runtime: "",
  });
});

test("a stored record's own model and runtime survive the trip to the wire", () => {
  const wire = effectiveDefaults(norm({ ...OK, model: "sonnet", runtime: "cursor", agentChain: true }));
  assert.equal(wire.model, "sonnet");
  assert.equal(wire.runtime, "cursor");
  assert.equal(wire.agentChain, true);
});

test("the pure block really is pure — it is sliced and evaluated, so it may not reach out", () => {
  // ⚠ THE SLICE IS ONLY HONEST IF THE BLOCK CANNOT TOUCH THE STORE. A `require`, a `store.` or an
  // `electron` reference inside the fence would mean this suite evaluates something the shipping
  // module does not, which is the failure mode source extraction is worth nothing without.
  // ⚠ COMMENTS STRIPPED FIRST: the fence's own header explains what it may not reach, in the
  // words it may not reach, so a raw-text scan would fail on the documentation of the rule.
  const code = block.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\brequire\s*\(|\bstore\./.test(code), "no store or require inside the fence");
  assert.ok(!/electron/.test(code), "no electron inside the fence");
});
