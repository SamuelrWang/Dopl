// THE DEFAULT AGENT SETTINGS VALIDATOR (main/agent-defaults.js) — what a channel created from
// now on starts its agents on.
//
// WHAT IT COSTS WHEN THIS IS WRONG. This record is copied verbatim into a new channel's own
// launch selection, and that selection decides what a spawned agent may do on this machine. The
// app window hosts remote content, so the renderer is a hostile input: a value outside what the
// SELECTED adapter declares, coerced in a permissive direction by some later reader, would hand a
// page the widest setting without the operator ever seeing the word. So every rule pinned here is
// fail-closed:
//
//   - MESSAGING is Dopl's own axis and validates HARD — an unknown value rejects the WHOLE record,
//     because a partially applied record is the "one switch, two meanings" confusion the axes
//     exist to remove;
//   - the RUNTIME-KEYED half validates SOFT and FAIL-CLOSED — an unknown model is ABSENT (the soft
//     half, which is what lets a desktop that predates an id still store the rest) and an unknown
//     MODE or NATIVE value falls to that adapter's NARROWEST, never to its widest;
//   - `agentChain` is `=== true` and nothing else, because it lifts a bound;
//   - an absent or corrupt record resolves to the MOST RESTRICTIVE answer.
//
// ── ⚠ WHAT U5 CHANGED HERE (2026-09-21) ─────────────────────────────────────────────────────
//
// The record was `{ tools, messages, agentChain, model?, runtime? }` with `tools` validated
// against `['manual','accept_edits','auto','bypass']` and `model` against the DEFAULT runtime's
// frozen id list. An operator whose default runtime was Codex could therefore not store a Codex
// model AT ALL — the write was dropped as "unknown" — and the tool word they picked was not a word
// that validator knew (`docs/REFACTOR-FINDINGS.md` F-390). It is a VERSIONED LAUNCH SELECTION plus
// one flag now: the same shape a channel's record has, because `seedChannel` copies one into the
// other and two shapes for one copy is how a field comes to be seeded on some channels and not
// others.
//
// ⚠ WHAT IS **NOT** HERE, DELIBERATELY. `seedChannel` — the inheritance point — is not a pure
// function: it reads and writes two store-backed modules. Its two load-bearing properties are
// pinned where they can be driven against the real thing:
//   · "the seed writes through the ONE validating writer, and is reachable only from the
//     bound-sender IPC surface" — `test/session-preset-start.test.mjs`'s writer census;
//   · "the defaults record is never read on the session path" — the same file's reader census.
// A stubbed re-implementation of `seedChannel` here would assert about a copy of the program.
//
// WHY SOURCE EXTRACTION: agent-defaults.js pulls in electron-store, so it does not import under
// `node --test`. The validation half is fenced as a PURE block (no electron/fs/store/require
// refs) and sliced verbatim, the same pattern `_channel-prefs-block.mjs` uses.
//
// ⚠ AND THE INJECTED HALVES ARE THE **REAL** ONES SINCE U5. The block takes the real
// `main/launch-selection.js` and the real `main/runtime/index.js › selectionContext()`, because
// what the cases are about is that a Codex value survives WITHOUT passing through another
// runtime's enums — and a fake vocabulary could not tell you that.
//
// Run: `node --test dopl-desktop-app/test/agent-defaults.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const SRC = readFileSync(join(MAIN, "agent-defaults.js"), "utf8");
const req = createRequire(import.meta.url);

// ⚠ SLICED BY THE FENCE, NOT BY LINE NUMBERS — a comment added above the block must not move
// this suite onto a different program.
const block = SRC.slice(
  SRC.indexOf("// ─── BEGIN AGENT-DEFAULTS-VALIDATE"),
  SRC.indexOf("// ─── END AGENT-DEFAULTS-VALIDATE")
);
assert.ok(block.length > 0, "the pure block's fence is intact");
const { MESSAGE_MODES, FACTORY_DEFAULTS, normalizeDefaults, effectiveDefaults } = new Function(
  `${block}\n return { MESSAGE_MODES, FACTORY_DEFAULTS, normalizeDefaults, effectiveDefaults };`
)();

// ⚠ THE REAL SHAPE MODULE AND THE REAL ADAPTER VOCABULARY. `launch-selection.js` reaches nothing
// but the registry, and the registry is electron-free at load by contract — so both import
// cleanly here, and the Codex cases below are about the shipped Codex descriptor rather than a
// fixture that mirrors it.
const sel = req(join(MAIN, "launch-selection.js"));
const RUNTIME = req(join(MAIN, "runtime", "index.js"));
const ctx = RUNTIME.selectionContext();

const norm = (raw) => normalizeDefaults(sel, ctx, raw);
const wire = (stored) => effectiveDefaults(sel, ctx, stored);

const OK = { messages: "auto_inbound" };

test("the messaging enum is exactly Dopl's own four, and it does NOT move with the runtime", () => {
  // ⚠ SPELLED OUT rather than compared to another module's copy: these lists must AGREE, and a
  // test that derived one from the other could not notice them drifting apart together.
  // ⚠ AND THERE IS NO `TOOL_MODES` HERE ANY MORE (U5). Dopl — not either vendor — gates channel
  // delivery, so messaging is core's on every adapter; the TOOL axis belongs to the selected
  // runtime and is validated against its own declared options.
  assert.deepEqual(MESSAGE_MODES, ["ask", "auto_inbound", "auto_outbound", "auto_both"]);
});

test("the factory answer is the MOST RESTRICTIVE one, and chaining is off", () => {
  // A machine that has never opened the Agents tab must seed nothing different from what a
  // channel got before this feature existed.
  assert.deepEqual(FACTORY_DEFAULTS, { messages: "ask", agentChain: false });
  assert.deepEqual(wire(null), {
    tools: ctx.narrowestToolFor(""),
    messages: "ask",
    agentChain: false,
    model: null,
    runtime: "",
    v: sel.SELECTION_VERSION,
    byRuntime: {},
    native: {},
  });
});

test("MESSAGING validates HARD — an unknown value rejects the WHOLE record", () => {
  assert.equal(norm({ messages: "always" }), null);
  assert.equal(norm({ tools: "bypass" }), null, "a record with no messaging axis is not a record");
  assert.equal(norm({ v: 2, runtime: "codex", byRuntime: {} }), null);
});

test("a non-record is not a record", () => {
  for (const bad of [null, undefined, 0, "", "manual", [], [OK]]) {
    assert.equal(norm(bad), null, JSON.stringify(bad));
  }
});

test("extra properties are dropped — nothing but the validated members is ever stored", () => {
  const out = norm({ ...OK, at: 1, path: "/etc/passwd", tools2: "bypass" });
  assert.deepEqual(Object.keys(out).sort(), ["agentChain", "byRuntime", "messages", "runtime", "v"]);
});

test("agentChain is `=== true` and nothing else, because it lifts a bound", () => {
  assert.equal(norm({ ...OK, agentChain: true }).agentChain, true);
  for (const truthy of ["true", 1, {}, [], "yes"]) {
    assert.equal(norm({ ...OK, agentChain: truthy }).agentChain, false, String(truthy));
  }
  assert.equal(norm(OK).agentChain, false, "absent is off");
});

// ── U5: THE RUNTIME-KEYED HALF ───────────────────────────────────────────────────────────────

test("a LEGACY record migrates into the DEFAULT runtime's half, untranslated", () => {
  // ⚠ NO `v` ⇒ pre-U5. Its global `tools`/`model` are the DEFAULT runtime's vocabulary by
  // construction — the only thing the old validators could store — so that is whose record they
  // land in, WHATEVER runtime the operator had selected. Putting them under the SELECTED runtime
  // would be the migration asserting that `bypass` "is" some Codex approval mode, which is the
  // one-to-one mapping Samuel's Decision #1 refuses outright.
  const out = norm({ tools: "bypass", messages: "auto_both", model: "claude-opus-5", runtime: "codex" });
  assert.equal(out.v, sel.SELECTION_VERSION);
  assert.equal(out.runtime, "codex", "the pick is carried over");
  assert.deepEqual(out.byRuntime[ctx.defaultId], { tools: "bypass", model: "claude-opus-5" });
  assert.equal(out.byRuntime.codex, undefined, "nothing is invented for the selected runtime");
});

test("a CODEX record accepts Codex values without passing through another runtime's enums", () => {
  // ⚠ THE UNIT'S HEADLINE. Before U5 every one of these three fields was validated against the
  // DEFAULT runtime's frozen lists: `on-request` is not one of its four tool words, `gpt-5-codex`
  // is not one of its four model ids, and it has no sandbox axis at all — so the tool word
  // rejected the whole write, the model was silently dropped, and the sandbox had nowhere to go.
  const out = norm({
    v: 2,
    runtime: "codex",
    messages: "auto_both",
    byRuntime: {
      codex: {
        tools: "on-request",
        model: "gpt-5-codex",
        native: { sandbox_mode: "read-only", reasoningEffort: "high" },
      },
    },
  });
  assert.deepEqual(out.byRuntime.codex, {
    tools: "on-request",
    model: "gpt-5-codex",
    native: { sandbox_mode: "read-only", reasoningEffort: "high" },
  });
});

test("BOTH runtimes' choices are remembered side by side, and the WIRE shows the selected one", () => {
  // Samuel's Decisions #1 and #2: Claude → Codex → Claude restores both remembered sets, and
  // neither is ever translated into the other.
  const stored = norm({
    v: 2,
    runtime: "codex",
    messages: "auto_both",
    byRuntime: {
      claude: { tools: "bypass", model: "claude-opus-5" },
      codex: { tools: "never", model: "gpt-5-codex", native: { sandbox_mode: "danger-full-access" } },
    },
  });
  const onCodex = wire(stored);
  assert.equal(onCodex.tools, "never");
  assert.equal(onCodex.model, "gpt-5-codex");
  assert.deepEqual(onCodex.native, { sandbox_mode: "danger-full-access" });
  const onClaude = wire({ ...stored, runtime: "claude" });
  assert.equal(onClaude.tools, "bypass");
  assert.equal(onClaude.model, "claude-opus-5");
  assert.deepEqual(onClaude.native, {}, "the runtime with no such axis gets no bag, not the other's");
  // ⚠ AND THE OTHER RUNTIME'S RECORD IS STILL THERE, untouched, in both directions.
  assert.equal(onClaude.byRuntime.codex.model, "gpt-5-codex");
});

test("the model validates SOFT, and ABSENT IS NOT A MEMBER", () => {
  const ok = norm({ ...OK, v: 2, byRuntime: { claude: { model: "claude-opus-5" } } });
  assert.equal(ok.byRuntime.claude.model, "claude-opus-5");
  // ⚠ AN UNKNOWN MODEL DOES NOT FAIL THE RECORD — a desktop that has not heard of a newer id must
  // still be able to store the rest; refusing the whole record over a model name is the wrong
  // trade in both directions.
  // ⚠ 2026-09-22: CLAUDE'S PICK RULE IS OPEN (its roster is live), so STORAGE keeps any
  // WELL-FORMED id — a record written while the CLI offered a model must not be erased by a build
  // that has not heard of it. The runtime boundary is enforced where it can be KNOWN: the picker
  // offers only that runtime's live catalog, and a launch naming an id its roster lacks is REFUSED
  // (`claude-live-roster.test.mjs`). What storage still refuses is anything that cannot BE an id.
  const kept = norm({ ...OK, v: 2, byRuntime: { claude: { model: "claude-opus-6[1m]" } } });
  assert.equal(kept.byRuntime.claude.model, "claude-opus-6[1m]", "a model this build predates is kept");
  const unknown = norm({ ...OK, v: 2, byRuntime: { claude: { model: "gpt 9; rm" } } });
  assert.equal(unknown.byRuntime.claude, undefined, "a malformed id is absent, and an empty record is no record");
  // ⚠ OMITTED RATHER THAN '' OR null, so a record from before the field and a record whose model
  // was cleared are the SAME record and no reader can grow a third state to get wrong.
  assert.equal(norm({ ...OK, v: 2, byRuntime: { claude: { tools: "bypass", model: "" } } })
    .byRuntime.claude.model, undefined);
});

test("an unreadable TOOL value falls to that adapter's NARROWEST, never to its widest", () => {
  // ⚠ A READ FLOORS WHERE A WRITE REJECTS, and the asymmetry is deliberate: a record already on
  // disk cannot be "rejected" — refusing to read it would strand the operator — so it resolves to
  // the narrowest supported behaviour, which is the plan's scope boundary verbatim. It must NEVER
  // resolve to unrestricted as a migration fallback.
  const out = norm({ ...OK, v: 2, runtime: "codex", byRuntime: { codex: { tools: "bypass" } } });
  assert.equal(out.byRuntime.codex.tools, ctx.narrowestToolFor("codex"));
  assert.notEqual(out.byRuntime.codex.tools, "bypass");
});

test("a NATIVE key the adapter cannot spend is dropped; an unreadable CONTAINMENT value floors", () => {
  const out = norm({
    ...OK,
    v: 2,
    runtime: "codex",
    byRuntime: { codex: { native: { sandbox_mode: "danger-please", bogus: "x" } } },
  });
  // The narrowest declared sandbox, not the platform default and not the widest.
  assert.deepEqual(out.byRuntime.codex.native, { sandbox_mode: "read-only" });
});

test("a FUTURE-version record resolves restrictive and never keeps a stored setting", () => {
  // ⚠ `v: 9` could mean anything — that `messages` gained a fifth member, that `byRuntime`'s
  // values changed shape. Reading the fields this build happens to recognise is how a widened
  // setting arrives silently, so nothing but the runtime PICK survives (choosing a runtime widens
  // nothing: every adapter re-derives its own gate).
  const out = norm({
    v: 9,
    runtime: "codex",
    messages: "auto_inbound",
    byRuntime: { codex: { tools: "never", model: "gpt-5-codex" } },
    agentChain: true,
  });
  // ⚠ EVEN THE AXIS THIS BUILD RECOGNISES FALLS TO THE RESTRICTIVE MEMBER. `auto_inbound` is a
  // member of THIS version's messaging enum; what a v9 record means by it is not this build's to
  // assume, and reading the fields it happens to recognise is exactly how a widened setting
  // arrives silently. The HARD check above still REJECTS a value outside the enum — rejecting and
  // flooring are different answers to different questions (a write vs. a record on disk).
  assert.equal(out.messages, "ask", "a version this build cannot read resolves to the narrowest");
  assert.deepEqual(out.byRuntime, {}, "nothing a future version might have re-meant is kept");
  assert.equal(out.runtime, "codex", "…but the pick survives, because picking a runtime widens nothing");
  assert.equal(wire(out).tools, ctx.narrowestToolFor("codex"), "and the tool setting is the narrowest");
});

test("a record for a runtime this build does not register is KEPT and never read", () => {
  // A downgrade must not destroy what an upgrade stored: the record cannot be validated (there is
  // no descriptor) and cannot be launched (nothing resolves the id), so it is carried and ignored.
  // Dropping it would make re-upgrading a silent reset to the narrowest settings.
  const out = norm({
    ...OK, v: 2, byRuntime: { "some-future-runtime": { tools: "wide-open", model: "x" } },
  });
  assert.deepEqual(out.byRuntime["some-future-runtime"], { tools: "wide-open", model: "x" });
  assert.equal(out.runtime, "", "…and it is NOT selectable, so nothing launches on it");
  assert.equal(wire(out).tools, ctx.narrowestToolFor(""), "the wire answers the DEFAULT adapter's narrowest");
});

test("the WIRE always carries the legacy keys; STORAGE keeps them per runtime", () => {
  // ⚠ THE ASYMMETRY IS THE POINT, NOT AN INCONSISTENCY TO TIDY. The web's capability probes are
  // OWN-KEY tests, so a reply missing `tools`, `model` or `runtime` reads as "this desktop has no
  // such concept" and renders NO row — and the only way to store a value is the row that was never
  // drawn. `v` and `byRuntime` are ADDITIVE beside them: a renderer that knows about them reads the
  // whole per-runtime truth, one that does not sees the shape it always saw.
  const stored = norm(OK);
  assert.ok(!("tools" in stored) && !("model" in stored), "storage holds neither globally");
  assert.deepEqual(wire(stored), {
    tools: ctx.narrowestToolFor(""),
    messages: "auto_inbound",
    agentChain: false,
    model: null,
    runtime: "",
    v: sel.SELECTION_VERSION,
    byRuntime: {},
    native: {},
  });
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
  // ⚠ AND IT MAY NOT NAME A RUNTIME'S VOCABULARY EITHER (U5). Every mode, model id and native
  // setting arrives through the injected `ctx`; a literal here would be this record validating one
  // vendor's launch against another vendor's enums, which is the whole class of bug U5 removed.
  assert.ok(!/manual|accept_edits|bypass|claude-|gpt-|sandbox_mode/.test(code),
    "no runtime's vocabulary inside the fence");
});
