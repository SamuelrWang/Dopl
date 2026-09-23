// THE VERSIONED, RUNTIME-KEYED LAUNCH SELECTION — `main/launch-selection.js`, the record that
// replaced one global tool mode plus one global model plus a separately stored runtime pick.
//
// ⚠ **THE PROPERTY THIS FILE EXISTS FOR IS THAT ONE RUNTIME'S CHOICES ARE NEVER READ, WRITTEN OR
// COERCED THROUGH ANOTHER RUNTIME'S VOCABULARY.** That is Samuel's Decisions #1 and #2 of the
// 2026-09-21 runtime-parity plan, and it is not a preference: `Accept edits` is not a Codex
// approval mode (Codex separates approval policy from sandbox containment, and `granular` has no
// Claude analogue), and a Claude model id is not a member of any Codex roster. Before this record
// existed, `main/channel-prefs.js` and `main/agent-defaults.js` each imported
// `main/session-model.js` — the DEFAULT runtime's frozen id table — and validated every runtime's
// model through it, so a Codex pick could not be stored at all and `session-engine.js` coerced any
// Codex id to the literal string `default` on its way to the Codex launch spec.
//
// ⚠ **AND THE SECOND PROPERTY IS THAT EVERY UNREADABLE STATE RESOLVES NARROWER, NEVER WIDER.** The
// plan's scope boundary is explicit: unknown, stale or partially migrated values resolve to the
// narrowest supported behaviour and surface a recoverable `needs review` state. **Unrestricted is
// never a migration fallback.** Each case below that has a fallback asserts the DIRECTION, not
// just that something was chosen.
//
// ⚠ DRIVEN AGAINST THE REAL ADAPTERS, NOT A FIXTURE. `ctx` is `main/runtime/index.js ›
// selectionContext()`, so "Codex accepts a Codex value" is a statement about the shipped Codex
// descriptor. A fixture that mirrors an adapter is a copy that drifts with it
// (`runtime-capability.test.ts`'s rule, applied on this side of the bridge).
//
// Run: `node --test dopl-desktop-app/test/launch-selection.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sentinelBlock } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const req = createRequire(import.meta.url);

const sel = req(join(MAIN, "launch-selection.js"));
const RUNTIME = req(join(MAIN, "runtime", "index.js"));
const ctx = RUNTIME.selectionContext();

const DEFAULT_ID = ctx.defaultId;
const NARROW = (id) => ctx.narrowestToolFor(id);

// ── 1. THE VERSION IS READ BEFORE ANYTHING ELSE ──────────────────────────────────────────────

test("an ABSENT record is the restrictive selection and says NOTHING", () => {
  // ⚠ ABSENT IS NOT CORRUPT. A channel nobody has configured really does start at the narrowest
  // settings, and saying so is the truth rather than a fault an operator has to act on. A review
  // sentence here would fire for every channel on the machine.
  const res = sel.normalizeSelection(ctx, null);
  assert.deepEqual(res.selection, { v: sel.SELECTION_VERSION, runtime: "", messages: "ask", byRuntime: {} });
  assert.deepEqual(res.review, []);
  assert.equal(res.stored, false, "…and the caller can still tell 'never configured' from 'read back'");
});

test("a FUTURE version resolves restrictive, keeps only the PICK, and surfaces `needs review`", () => {
  // ⚠ `v: 3` could mean `messages` gained a fifth member or that `byRuntime`'s values changed
  // shape. Reading the fields this build happens to recognise is how a widened setting arrives
  // silently, so everything a future version might have re-meant is dropped.
  const res = sel.normalizeSelection(ctx, {
    v: 99,
    runtime: "codex",
    messages: "auto_both",
    byRuntime: { codex: { tools: "never", model: "gpt-5-codex", native: { sandbox_mode: "danger-full-access" } } },
  });
  assert.equal(res.selection.messages, "ask");
  assert.deepEqual(res.selection.byRuntime, {});
  // ⚠ THE PICK SURVIVES BECAUSE CHOOSING A RUNTIME WIDENS NOTHING — every adapter re-derives its
  // own deny lists and Axis-A vocabulary, and the four gate steps ahead of Axis A are core's on
  // all of them (`channel-runtime.js`'s header is the one spelling of that argument). Keeping it
  // strands nobody and moves no operator to another vendor.
  assert.equal(res.selection.runtime, "codex");
  assert.equal(res.review.length, 1);
  assert.match(res.review[0], /newer version of Dopl/);
  assert.equal(sel.toLegacyPosture(ctx, res.selection).tools, NARROW("codex"),
    "and the effective tool setting is that runtime's NARROWEST, never its widest");
});

test("a MALFORMED record resolves restrictive too, and keeps no pick", () => {
  for (const bad of ["x", 7, [], true]) {
    const res = sel.normalizeSelection(ctx, bad);
    assert.deepEqual(res.selection, sel.emptySelection(), JSON.stringify(bad));
    assert.equal(res.review.length, 1, "…and it is reviewable rather than silent");
  }
});

test("an UNREADABLE stored tool mode FLOORS to the narrowest and is reviewed", () => {
  // ⚠ A READ FLOORS WHERE A WRITE REJECTS. A record already on disk cannot be "rejected" —
  // refusing to read it would strand the channel — so it resolves narrower and says so.
  const res = sel.normalizeSelection(ctx, {
    v: 2, runtime: "codex", messages: "ask", byRuntime: { codex: { tools: "bypass" } },
  });
  assert.equal(res.selection.byRuntime.codex.tools, NARROW("codex"));
  assert.notEqual(res.selection.byRuntime.codex.tools, "bypass");
  assert.match(res.review.join(" "), /narrowest/);
});

test("an UNREGISTERED runtime reads as the default and is NOT repaired in place", () => {
  const res = sel.normalizeSelection(ctx, {
    v: 2, runtime: "some-future-runtime", messages: "ask", byRuntime: {},
  });
  assert.equal(res.selection.runtime, "", "the launch lands on the default adapter");
});

test("a record for an UNREGISTERED runtime is KEPT verbatim and never read", () => {
  // ⚠ A DOWNGRADE MUST NOT DESTROY WHAT AN UPGRADE STORED. It cannot be validated (no descriptor)
  // and cannot be launched (nothing resolves the id), so it is carried and ignored — strictly
  // narrower than dropping it, because dropping it makes re-upgrading a silent reset.
  const res = sel.normalizeSelection(ctx, {
    v: 2, runtime: "", messages: "ask", byRuntime: { "some-future-runtime": { tools: "wide-open" } },
  });
  assert.deepEqual(res.selection.byRuntime["some-future-runtime"], { tools: "wide-open" });
  assert.equal(sel.toLegacyPosture(ctx, res.selection).tools, NARROW(""),
    "and it reaches no launch: the wire answers the DEFAULT adapter's narrowest");
});

// ── 2. MIGRATION EQUIVALENCE ─────────────────────────────────────────────────────────────────

test("a legacy record migrates into the DEFAULT runtime's half, UNTRANSLATED", () => {
  const res = sel.fromLegacy(ctx, { tools: "bypass", messages: "auto_both", model: "claude-opus-5" }, "codex");
  assert.equal(res.selection.runtime, "codex");
  assert.equal(res.selection.messages, "auto_both");
  // ⚠ THE LEGACY `model` IS DROPPED (2026-09-23): no launch record stores one any more.
  assert.deepEqual(res.selection.byRuntime[DEFAULT_ID], { tools: "bypass" });
  assert.equal(res.selection.byRuntime.codex, undefined,
    "nothing is invented for the selected runtime — there is no Codex synonym for `bypass`");
  assert.deepEqual(res.review, [], "a clean migration is SILENT; thousands take this path once");
});

test("migration EQUIVALENCE: the legacy wire answers exactly what it answered before", () => {
  // ⚠ THE TABLE IS THE CASE. Every one of these is a record that exists on disk today, and the
  // third column is what `channel-prefs.js › getLaunchPosture` answered for it before U5 — minus
  // `model`, which left the wire on 2026-09-23 (Samuel: "We don't need a pin model in the settings").
  const cases = [
    [null, "", { tools: NARROW(""), messages: "ask" }],
    [{ tools: "manual", messages: "ask" }, "", { tools: "manual", messages: "ask" }],
    [{ tools: "bypass", messages: "auto_both" }, "", { tools: "bypass", messages: "auto_both" }],
    [{ tools: "auto", messages: "auto_inbound", model: "claude-opus-5" }, "",
      { tools: "auto", messages: "auto_inbound" }],
    // ⚠ A CODEX-SELECTED CHANNEL IS THE ONE ROW WHOSE WIRE VALUE MOVES, AND IT IS NOT A BEHAVIOUR
    // CHANGE. `manual` is not a Codex mode, so the gate already coerced it to Codex's narrowest at
    // every decision (`capability.js › normalizeToolMode`); what changes is that the wire now says
    // so instead of saying `manual` and being coerced on the other side of the bridge.
    [{ tools: "manual", messages: "ask" }, "codex", { tools: NARROW("codex"), messages: "ask" }],
  ];
  for (const [legacy, runtime, expected] of cases) {
    const res = sel.fromLegacy(ctx, legacy, runtime);
    assert.deepEqual(sel.toLegacyPosture(ctx, res.selection), expected,
      `${JSON.stringify(legacy)} on ${runtime || "(default)"}`);
  }
});

test("a HALF-VALID legacy pair is no pair: nothing migrates and the channel reads unconfigured (P3-34)", () => {
  for (const legacy of [
    { tools: "garbage", messages: "auto_both" },
    { tools: "bypass", messages: "garbage" },
    { tools: "on-request", messages: "ask" }, // never a pre-U5 word
    { messages: "auto_both" },
  ]) {
    const res = sel.fromLegacy(ctx, legacy, "");
    assert.equal(res.stored, false, JSON.stringify(legacy));
    assert.deepEqual(res.selection, sel.emptySelection());
    assert.equal(sel.legacyPreset(ctx, legacy), null, "…and presence agrees (`hasLaunchPosture`)");
  }
});

// ── 3. A CODEX RECORD, WITHOUT PASSING THROUGH ANOTHER RUNTIME'S ENUMS ───────────────────────

test("a Codex record accepts Codex values — its mode and its CONTAINMENT native axis", () => {
  const res = sel.patchSelection(ctx, sel.emptySelection(), {
    runtime: "codex",
    tools: "on-request",
    native: { sandbox_mode: "read-only" },
  });
  assert.deepEqual(res.review, []);
  assert.deepEqual(res.selection.byRuntime.codex, {
    tools: "on-request",
    native: { sandbox_mode: "read-only" },
  });
  // ⚠ NEITHER VALUE IS A MEMBER OF THE DEFAULT RUNTIME'S VOCABULARY, which is the point: before U5
  // the mode rejected the whole write and the sandbox had nowhere to be stored at all.
  assert.equal(ctx.toolModeFor(DEFAULT_ID, "on-request"), NARROW(DEFAULT_ID));
});

test("NO PIN (2026-09-23): a model and a MODEL-scoped native key are DROPPED, silently", () => {
  // Samuel: "We don't need a pin model in the settings." A launch's model is the launcher's pick,
  // the identity's, or the runtime's default — never a stored one — and the reasoning effort is a
  // property OF a model, so it goes with it. The CONTAINMENT axis beside it stays.
  const res = sel.patchSelection(ctx, sel.emptySelection(), {
    runtime: "codex",
    tools: "on-request",
    model: "gpt-5-codex",
    native: { sandbox_mode: "read-only", reasoningEffort: "high" },
  });
  assert.deepEqual(res.review, [], "nothing narrowed, so nothing is reviewed");
  assert.deepEqual(res.selection.byRuntime.codex, { tools: "on-request", native: { sandbox_mode: "read-only" } });
  // A record an older build wrote WITH both reads harmlessly, with no review either.
  const old = sel.normalizeSelection(ctx, {
    v: 2, runtime: "codex", messages: "ask",
    byRuntime: {
      codex: { model: "gpt-5-codex", native: { reasoningEffort: "high" } },
      [DEFAULT_ID]: { tools: "bypass", model: "claude-opus-5" },
    },
  });
  assert.deepEqual(old.review, []);
  assert.equal(old.selection.byRuntime.codex, undefined, "a record that held only a model and an effort is no record");
  assert.deepEqual(old.selection.byRuntime[DEFAULT_ID], { tools: "bypass" });
  assert.equal("model" in sel.toLegacyPosture(ctx, old.selection), false, "and no model reaches the wire");
  // A patch carrying ONLY a model is a no-op, not a clear of anything else.
  const s = sel.patchSelection(ctx, old.selection, { model: "claude-fable-5" }).selection;
  assert.deepEqual(s.byRuntime, old.selection.byRuntime);
});

test("Claude → Codex → Claude restores BOTH remembered tool settings and native sets", () => {
  let s = sel.emptySelection();
  s = sel.patchSelection(ctx, s, { runtime: DEFAULT_ID, tools: "bypass" }).selection;
  s = sel.patchSelection(ctx, s, { runtime: "codex" }).selection;
  // The switch alone changes nothing but the pick: the new runtime starts at ITS OWN defaults.
  assert.deepEqual(sel.toLegacyPosture(ctx, s), { tools: NARROW("codex"), messages: "ask" });
  s = sel.patchSelection(ctx, s, {
    tools: "never", native: { sandbox_mode: "danger-full-access" },
  }).selection;
  s = sel.patchSelection(ctx, s, { runtime: DEFAULT_ID }).selection;
  assert.deepEqual(sel.toLegacyPosture(ctx, s), { tools: "bypass", messages: "ask" });
  assert.deepEqual(sel.activeRecord(ctx, s).native, undefined, "the runtime with no such axis gets no bag");
  s = sel.patchSelection(ctx, s, { runtime: "codex" }).selection;
  assert.deepEqual(sel.toLegacyPosture(ctx, s), { tools: "never", messages: "ask" });
  assert.deepEqual(sel.activeRecord(ctx, s).native, { sandbox_mode: "danger-full-access" });
});

// ── 4. THE WRITE PATH: WHAT A VERSION-SKEWED RENDERER CANNOT SMUGGLE ─────────────────────────

test("a renderer cannot smuggle an unregistered RUNTIME past main", () => {
  const res = sel.patchSelection(ctx, sel.emptySelection(), { runtime: "some-future-runtime" });
  assert.equal(res.selection.runtime, "", "an id this build cannot resolve is not parked in the store");
  assert.match(res.review.join(" "), /not a runtime this version of Dopl can start/);
});

test("a renderer cannot smuggle an unknown TOOL word — the write is REJECTED WHOLE", () => {
  // ⚠ REJECTED, NOT FLOORED. A write is a claim about what the operator just chose; if this build
  // cannot honour it, storing something narrower would leave the control showing one thing and the
  // record holding another. The SPA reverts its optimistic pick on the refusal.
  const codex = sel.patchSelection(ctx, sel.emptySelection(), { runtime: "codex" }).selection;
  assert.deepEqual(sel.patchRejections(ctx, codex, { tools: "bypass" }).length, 1,
    "a DEFAULT-runtime word on a Codex channel is refused…");
  assert.deepEqual(sel.patchRejections(ctx, codex, { tools: "never" }), [],
    "…and that runtime's own word is accepted, which is F-390's actual fix");
  assert.deepEqual(sel.patchRejections(ctx, sel.emptySelection(), { tools: "never" }).length, 1,
    "…in both directions");
});

test("a renderer cannot smuggle an unknown MESSAGING value", () => {
  assert.equal(sel.patchRejections(ctx, sel.emptySelection(), { messages: "whenever" }).length, 1);
  assert.deepEqual(sel.patchRejections(ctx, sel.emptySelection(), { messages: "auto_both" }), []);
});

test("a renderer cannot smuggle a NATIVE key the adapter cannot spend", () => {
  // ⚠ DROPPED AND REVIEWED, not stored-and-ignored. A key main keeps but never spends is a control
  // that appears to work; INVARIANTS §11's rule is that such a control must be ABSENT.
  const res = sel.patchSelection(ctx, sel.emptySelection(), {
    runtime: "codex", native: { sandbox_mode: "read-only", bogus: "x", granular: "{}" },
  });
  assert.deepEqual(res.selection.byRuntime.codex.native, { sandbox_mode: "read-only" });
  assert.match(res.review.join(" "), /no native setting called "bogus"/);
  assert.match(res.review.join(" "), /no native setting called "granular"/);
});

test("an unreadable CONTAINMENT value floors to the NARROWEST, and says so", () => {
  // ⚠ The sandbox is CONTAINMENT, so an unreadable value resolves to the narrowest declared option.
  const res = sel.patchSelection(ctx, sel.emptySelection(), {
    runtime: "codex", native: { sandbox_mode: "danger-please" },
  });
  assert.deepEqual(res.selection.byRuntime.codex.native, { sandbox_mode: "read-only" });
  assert.match(res.review.join(" "), /narrowest/);
});

test("a patch is OWN-KEY throughout — a write that omits a field leaves it alone", () => {
  // ⚠ THE 2026-09-05 FAILURE, GENERALISED. A pick from a surface that knows nothing about native
  // settings must not rewrite the record whole and drop them on the floor.
  let s = sel.patchSelection(ctx, sel.emptySelection(), {
    runtime: "codex", tools: "never", native: { sandbox_mode: "read-only" },
  }).selection;
  s = sel.patchSelection(ctx, s, { messages: "auto_both" }).selection;
  assert.deepEqual(s.byRuntime.codex, { tools: "never", native: { sandbox_mode: "read-only" } });
  // ⚠ `{}` IS A REAL "CLEAR THEM", which is the other half of the same rule.
  s = sel.patchSelection(ctx, s, { native: {} }).selection;
  assert.equal(s.byRuntime.codex.native, undefined);
  assert.equal(s.byRuntime.codex.tools, "never", "…and clearing one field touches no other");
});

test("a patch's fields land on the runtime the PATCH selects, not the one selected before it", () => {
  // A single write that switches runtime AND sets that runtime's sandbox is one operation;
  // splitting it would write the new setting into the old runtime's record.
  const s = sel.patchSelection(ctx, sel.emptySelection(), {
    runtime: "codex", native: { sandbox_mode: "read-only" },
  }).selection;
  assert.deepEqual(s.byRuntime.codex.native, { sandbox_mode: "read-only" });
  assert.equal(s.byRuntime[DEFAULT_ID], undefined);
});

test("an unchanged field is RE-VALIDATED on every write, not carried untouched", () => {
  // ⚠ A value stored by a build that offered it and has since withdrawn it must not survive just
  // because nobody mentioned it. The merge happens BEFORE validation for exactly this reason.
  const smuggled = {
    v: 2, runtime: "codex", messages: "ask", byRuntime: { codex: { tools: "never", native: { bogus: "x" } } },
  };
  const s = sel.patchSelection(ctx, sel.normalizeSelection(ctx, smuggled).selection, { tools: "never" });
  assert.deepEqual(s.selection.byRuntime.codex, { tools: "never" });
});

// ── 5. THE MODULE MAY NOT KNOW A VENDOR ──────────────────────────────────────────────────────

test("the shape module holds NO runtime's vocabulary — the whole bar of the unit", () => {
  // ⚠ **THE VERIFICATION BAR U5 SETS, ASSERTED MECHANICALLY**: no shared storage or session-core
  // path imports one runtime's model/tool enums to validate another runtime's launch. The pure
  // block takes every vocabulary through the injected `ctx`, so a literal inside it would be this
  // record deciding what a vendor id means — which is the entire class of bug U5 removed.
  // ⚠ CODE LINES ONLY: the header explains the rule in the words the code may not use.
  const src = req("node:fs").readFileSync(join(MAIN, "launch-selection.js"), "utf8");
  const block = sentinelBlock(src, "LAUNCH-SELECTION");
  const code = block.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\brequire\s*\(|\bstore\./.test(code), "no store or require inside the fence");
  assert.ok(!/manual|accept_edits|bypass|untrusted|on-request|claude|codex|cursor|gpt-|sandbox_mode|reasoningEffort/i
    .test(code), "no runtime's vocabulary inside the fence");
});
