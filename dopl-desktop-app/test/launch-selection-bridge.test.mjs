// THE BRIDGE HALF OF THE RUNTIME-KEYED LAUNCH SELECTION (2026-09-21, U7/U8).
//
// ⚠ **SOURCE-ASSERTED BECAUSE THE HOLE IS AT AN END, NOT IN THE MIDDLE** — the discipline
// `test/agent-model-selection.test.mjs › SUPPLIED-ONLY` already states over the model key, applied
// to the three fields U5 made writable and U8 wired a control to. Neither end can drive the other
// in-process: the preload needs `electron`, and the validator is sliced pure.
//
// ⚠ **WHAT THIS FILE EXISTS FOR.** `renderer/app-preload.js` coerced an ABSENT `tools` /
// `messages` to `''` on every posture write. Before U5 that was harmless — the only writer always
// sent both — but `main/launch-selection.js › patchRejections` now REJECTS THE WHOLE WRITE when
// `tools` carries a value the SELECTED runtime does not offer, and `''` is such a value on every
// runtime. So a renderer that patched ONLY the runtime (which is what a Runtime row must do, or
// it files the old runtime's word under the new one) produced `{tools:'', messages:''}` and the
// write was refused with nothing on screen saying why. The two ends have to agree or the rule has
// a hole at whichever one forgets.
//
// ⚠ AND `native` / `byRuntime` HAD NO PATH AT ALL. U5 made the containment axis and the reasoning
// effort storable and spendable (`session-engine.js` stamps the bag at spawn); the bridge dropped
// them, so a control over either would have been F-390 again — the operator picks, the write
// "succeeds", and every agent launches on something else.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { between, codeOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// ⚠ `createRequire`, NOT AN IMPORT — `main/launch-selection.js` is CommonJS and, like every
// module this suite family drives, it must be reachable from an ESM test without a build step.
const requireMain = createRequire(import.meta.url);
const read = (...p) => readFileSync(join(HERE, "..", ...p), "utf8");
const PRELOAD = read("renderer", "app-preload.js");


test("PRELOAD: every launch-posture field is forwarded ONLY when the caller supplied one", () => {
  for (const key of ["tools", "messages", "runtime", "native"]) {
    assert.match(
      PRELOAD,
      new RegExp(`\\.\\.\\.\\(preset && preset\\.${key} !== undefined \\?`),
      `the preload must forward \`${key}\` on an own key`
    );
  }
  // ⚠ AND THE UNCONDITIONAL COERCIONS ARE GONE, not merely shadowed by a second spelling.
  assert.ok(
    !/tools: asMode\(preset && preset\.tools\)/.test(PRELOAD),
    "the unconditional `tools` coercion is what turned a runtime-only write into a refusal"
  );
  assert.ok(!/messages: asMode\(preset && preset\.messages\)/.test(PRELOAD));
  // ⚠ 2026-09-23 (Samuel: "We don't need a pin model in the settings"): `model` is NOT forwarded.
  assert.ok(!/preset\.model/.test(codeOf(PRELOAD)), "the stored model is deleted");
});


test("PRELOAD: the native bag crosses as a FLAT MAP OF STRINGS and nothing else", () => {
  // ⚠ NO NESTING, NO ARRAYS, NO NUMBERS — the same fail-closed coercion every other value on this
  // bridge takes. Main re-validates every key against the SELECTED adapter's declared dimensions.
  const body = between(PRELOAD, "const asNative", "const asRuntimeRecords");
  assert.match(body, /out\[String\(key\)\] = asMode\(native\[key\]\)/);
  assert.ok(!/JSON\.|structuredClone|Object\.assign/.test(body), "nothing structural may cross");
});

test("PRELOAD: the defaults write carries `v` and `byRuntime`, or main reads it as LEGACY", () => {
  // ⚠ THE FAILURE IS SILENT AND TOTAL. `agent-defaults.js › normalizeDefaults` branches on
  // `v == null`; without it the record is read as a pre-U5 one and its single global `tools`
  // migrates into the DEFAULT runtime's slot — so every write from the profile Agents tab ERASED
  // the operator's Codex sandbox.
  assert.match(PRELOAD, /\.\.\.\(defaults && defaults\.v !== undefined \? \{ v: Number\(defaults\.v\) \} : \{\}\)/);
  assert.match(PRELOAD, /byRuntime: asRuntimeRecords\(defaults\.byRuntime\)/);
  const body = between(PRELOAD, "const asRuntimeRecords", "contextBridge.exposeInMainWorld");
  for (const key of ["tools", "native"]) {
    assert.match(body, new RegExp(`record\\.${key} !== undefined`), `\`${key}\` is own-key inside a record too`);
  }
  // ⚠ 2026-09-23: no `model` inside a record, and none on the defaults write either.
  assert.ok(!/record\.model/.test(body), "a runtime record carries no model");
  assert.ok(!/defaults\.model/.test(codeOf(PRELOAD)), "the defaults write carries no model");
  assert.match(read("main", "agent-defaults.js"), /const legacy = raw\.v == null;/,
    "…and main's branch is the reason the key has to be there");
});

test("MAIN: a runtime-only patch is not a tool-axis claim, so it cannot be rejected for one", () => {
  // The in-process half. `patchRejections` is pure over an injected vocabulary, so it can be
  // driven with fake adapters exactly as `launch-selection.test.mjs` drives the rest.
  const selection = requireMain("../main/launch-selection");
  const ctx = {
    defaultId: "claude",
    known: (id) => id === "claude" || id === "codex",
    labelFor: (id) => (id === "codex" ? "Codex" : "Claude Code"),
    toolModeFor: (id, mode) => {
      const modes = id === "codex"
        ? ["untrusted", "granular", "on-request", "never"]
        : ["manual", "accept_edits", "auto", "bypass"];
      return modes.indexOf(mode) === -1 ? modes[0] : mode;
    },
    narrowestToolFor: (id) => (id === "codex" ? "untrusted" : "manual"),
    modelDimensionsFor: (id) => (id === "codex" ? ["reasoningEffort"] : []),
    nativeFor: (_id, raw) => ({ value: raw && typeof raw === "object" ? { ...raw } : {}, review: [] }),
  };
  const base = selection.patchSelection(ctx, selection.emptySelection(), {
    tools: "accept_edits",
  }).selection;

  assert.deepEqual(selection.patchRejections(ctx, base, { runtime: "codex" }), [],
    "a bare runtime switch claims nothing about the tool axis");
  assert.equal(selection.patchRejections(ctx, base, { tools: "", messages: "" }).length, 2,
    "…and the shape the OLD preload produced is refused on BOTH axes, which is the defect");

  // ⚠ AND THE SWITCH KEEPS BOTH SETS (Decisions #1 and #2).
  const switched = selection.patchSelection(ctx, base, { runtime: "codex" }).selection;
  assert.equal(switched.byRuntime.claude.tools, "accept_edits");
  const onCodex = selection.patchSelection(ctx, switched, {
    native: { sandbox_mode: "read-only", reasoningEffort: "high" },
  }).selection;
  assert.deepEqual(onCodex.byRuntime.codex.native, { sandbox_mode: "read-only" },
    "the MODEL-scoped effort is dropped (2026-09-23); the containment axis stays");
  assert.equal(onCodex.byRuntime.claude.tools, "accept_edits",
    "editing Codex may not touch Claude — that is the whole reason the record is runtime-keyed");
  const back = selection.patchSelection(ctx, onCodex, { runtime: "claude" }).selection;
  assert.equal(selection.activeRecord(ctx, back).tools, "accept_edits");
});
