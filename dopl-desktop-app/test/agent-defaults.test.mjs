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
import { codeOf, sentinelBlock } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const SRC = readFileSync(join(MAIN, "agent-defaults.js"), "utf8");
const req = createRequire(import.meta.url);

// ⚠ SLICED BY THE FENCE, NOT BY LINE NUMBERS — a comment added above the block must not move
// this suite onto a different program.
const block = sentinelBlock(SRC, "AGENT-DEFAULTS-VALIDATE");
const { normalizeDefaults, effectiveDefaults, defaultsRejections } = new Function(
  `${block}\n return { normalizeDefaults, effectiveDefaults, defaultsRejections };`
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

test("the factory answer is the MOST RESTRICTIVE one, and chaining is off", () => {
  assert.deepEqual(wire(null), { v: sel.SELECTION_VERSION, runtime: "", messages: "ask", level: "ask", byRuntime: {}, agentChain: false });
});

test("MESSAGING validates HARD — an unknown value rejects the WHOLE record", () => {
  assert.equal(norm({ messages: "always" }), null);
  assert.equal(norm({ tools: "bypass" }), null, "a record with no messaging axis is not a record");
  assert.equal(norm({ v: 3, runtime: "codex", level: "full" }), null);
});

test("a non-record is not a record", () => {
  for (const bad of [null, undefined, 0, "", "manual", [], [OK]]) assert.equal(norm(bad), null, JSON.stringify(bad));
});

test("extra properties are dropped — nothing but the validated members is ever stored", () => {
  const out = norm({ ...OK, v: 3, at: 1, path: "/etc/passwd", tools2: "bypass" });
  assert.deepEqual(Object.keys(out).sort(), ["agentChain", "byRuntime", "level", "messages", "runtime", "v"]);
});

test("agentChain is `=== true` and nothing else, because it lifts a bound", () => {
  assert.equal(norm({ ...OK, agentChain: true }).agentChain, true);
  for (const truthy of ["true", 1, {}, [], "yes"]) assert.equal(norm({ ...OK, agentChain: truthy }).agentChain, false, String(truthy));
  assert.equal(norm(OK).agentChain, false, "absent is off");
});

test("a LEGACY (no `v`) record migrates its default-runtime tools into a level; the pick is kept", () => {
  const out = norm({ tools: "bypass", messages: "auto_both", model: "claude-opus-5", runtime: "codex" });
  assert.equal(out.v, sel.SELECTION_VERSION);
  assert.equal(out.runtime, "codex");
  assert.equal(out.level, "full");
  assert.deepEqual(out.byRuntime, {});
});

test("a v2 defaults record migrates like a channel's: an explicit, different Codex record keeps its own level", () => {
  const out = norm({
    v: 2, runtime: "", messages: "auto_both", agentChain: true,
    byRuntime: { claude: { tools: "bypass", model: "claude-opus-5" }, codex: { tools: "on-request", native: { sandbox_mode: "read-only", reasoningEffort: "high" } } },
  });
  assert.equal(out.level, "full");
  assert.deepEqual(out.byRuntime, { codex: "ask" });
  assert.equal(out.agentChain, true);
});

test("a FUTURE-version record resolves restrictive; only the pick survives", () => {
  const out = norm({ v: 9, runtime: "codex", messages: "auto_inbound", level: "full", agentChain: true });
  assert.equal(out.messages, "ask");
  assert.equal(out.level, "ask");
  assert.equal(out.runtime, "codex");
});

test("a v3 level for a runtime this build does not register is KEPT and never read", () => {
  const out = norm({ ...OK, v: 3, level: "auto", byRuntime: { "some-future-runtime": "full" } });
  assert.deepEqual(out.byRuntime, { "some-future-runtime": "full" });
  assert.equal(out.runtime, "");
});

test("the WIRE is the stored record plus the chaining flag; no per-runtime words ride it", () => {
  const w = wire(norm({ ...OK, v: 3, level: "auto" }));
  assert.deepEqual(w, { v: sel.SELECTION_VERSION, runtime: "", messages: "auto_inbound", level: "auto", byRuntime: {}, agentChain: false });
  assert.equal("tools" in w || "native" in w || "model" in w, false);
});

test("a WRITE with an unknown level, or naming a per-runtime word, is REJECTED; a read floors it", () => {
  assert.equal(defaultsRejections(sel, ctx, { ...OK, v: 3, level: "max" }).length, 1);
  assert.equal(defaultsRejections(sel, ctx, { ...OK, tools: "bypass" }).length, 1);
  assert.equal(norm({ ...OK, v: 3, level: "max" }).level, "ask");
  assert.deepEqual(defaultsRejections(sel, ctx, { ...OK, v: 3, level: "full", runtime: "codex" }), []);
});

test("the pure block really is pure — it is sliced and evaluated, so it may not reach out", () => {
  const code = codeOf(block);
  assert.ok(!/\brequire\s*\(|\bstore\./.test(code), "no store or require inside the fence");
  assert.ok(!/electron/.test(code), "no electron inside the fence");
  assert.ok(!/manual|accept_edits|bypass|claude-|gpt-|sandbox_mode/.test(code), "no runtime's vocabulary inside the fence");
});
