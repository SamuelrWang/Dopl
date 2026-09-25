// THE LAUNCH SELECTION — `main/launch-selection.js`, v3: one permission LEVEL (Ask / Auto / Full)
// that each runtime applies in its own native settings, plus the runtime pick and the message axis.
//
// ⚠ TWO PROPERTIES. (1) Every unreadable state resolves NARROWER, never wider: Ask is the fail-closed
// level, and unrestricted is never a migration fallback. (2) A migrated record keeps what the operator
// explicitly chose — the channel level is the selected runtime's explicit choice, a runtime with no
// record inherits it, and a runtime with its own explicit, different record keeps its own level.
//
// ⚠ DRIVEN AGAINST THE REAL ADAPTERS: `ctx` is `main/runtime/index.js › selectionContext()`. The v2
// fixtures are the shapes production stores wrote (`electron-store` › `channelLaunchSelection`).
//
// Run: `node --test dopl-desktop-app/test/launch-selection.test.mjs`

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { codeOf, sentinelBlock } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const req = createRequire(import.meta.url);

const sel = req(join(MAIN, "launch-selection.js"));
const ctx = req(join(MAIN, "runtime", "index.js")).selectionContext();
const norm = (raw) => sel.normalizeSelection(ctx, raw);
const text = (s, id) => {
  const x = sel.settingsFor(ctx, s, id);
  return ctx.settingText(id || s.runtime || ctx.defaultId, x.tools, x.native);
};

describe("1. the version is read before anything else", () => {
  test("ABSENT is the restrictive selection and says nothing", () => {
    const res = norm(null);
    assert.deepEqual(res.selection, { v: 3, runtime: "", messages: "ask", level: "ask", byRuntime: {} });
    assert.deepEqual(res.review, []);
    assert.equal(res.stored, false);
  });
  test("a FUTURE version resolves restrictive, keeps only the pick, and is reviewed", () => {
    const res = norm({ v: 9, runtime: "codex", messages: "auto_both", level: "full" });
    assert.equal(res.selection.level, "ask");
    assert.equal(res.selection.messages, "ask");
    assert.equal(res.selection.runtime, "codex");
    assert.match(res.review.join(), /newer version of Dopl/);
  });
  test("a MALFORMED record resolves restrictive and keeps no pick", () => {
    for (const raw of ["x", [], { v: 1, runtime: "codex" }]) {
      const res = norm(raw);
      assert.equal(res.selection.level, "ask");
      assert.equal(res.selection.runtime, "");
      assert.equal(res.review.length, 1);
    }
  });
  test("an unknown level floors to Ask and is reviewed; an unregistered runtime's entry is kept, never read", () => {
    const res = norm({ v: 3, runtime: "", messages: "ask", level: "yolo", byRuntime: { codex: "max", future: "full" } });
    assert.equal(res.selection.level, "ask");
    assert.deepEqual(res.selection.byRuntime, { future: "full" }, "codex's bad entry equals the floored channel level, so no override");
    assert.equal(res.review.length, 2);
  });
  test("an unregistered pick reads as the default and is not repaired", () => {
    assert.equal(norm({ v: 3, runtime: "nope", messages: "ask", level: "auto" }).selection.runtime, "");
  });
});

describe("2. one level, each runtime in its own words", () => {
  const full = norm({ v: 3, runtime: "", messages: "auto_both", level: "full", byRuntime: {} }).selection;
  test("Full is bypass on Claude, never/danger-full-access on Codex, run-everything on Cursor", () => {
    assert.equal(text(full, "claude"), "bypass");
    assert.equal(text(full, "codex"), "never/danger-full-access");
    assert.equal(text(full, "cursor"), "run-everything");
  });
  test("the wire's legacy pair is the SELECTED runtime's word", () => {
    assert.deepEqual(sel.toLegacyPosture(ctx, full), { tools: "bypass", messages: "auto_both" });
    assert.deepEqual(sel.toLegacyPosture(ctx, { ...full, runtime: "codex" }), { tools: "never", messages: "auto_both" });
  });
  test("an override wins for its runtime only", () => {
    const s = norm({ v: 3, runtime: "", messages: "ask", level: "full", byRuntime: { codex: "ask" } }).selection;
    assert.equal(sel.levelFor(ctx, s, "codex"), "ask");
    assert.equal(sel.levelFor(ctx, s, "claude"), "full");
    assert.equal(sel.levelFor(ctx, s, "cursor"), "full");
  });
});

describe("3. migration from v2 (production-shaped records)", () => {
  test("REGRESSION 2026-09-25: a bypass/auto_both channel with no Codex record → Full, and Codex launches at never/danger-full-access", () => {
    const stored = { v: 2, runtime: "", messages: "auto_both", byRuntime: { claude: { tools: "bypass" } } };
    const res = norm(stored);
    assert.equal(res.stored, true);
    assert.equal(res.selection.level, "full");
    assert.deepEqual(res.selection.byRuntime, {});
    assert.equal(text(res.selection, "codex"), "never/danger-full-access");
    assert.deepEqual(res.review, []);
  });
  test("Claude manual → Ask, accept_edits → Ask (reviewed: it meant more), auto → Auto", () => {
    const at = (tools) => norm({ v: 2, runtime: "", messages: "ask", byRuntime: { claude: { tools } } });
    assert.equal(at("manual").selection.level, "ask");
    assert.equal(at("accept_edits").selection.level, "ask");
    assert.match(at("accept_edits").review.join(), /"accept_edits" is now ask \(manual\)/);
    assert.equal(at("auto").selection.level, "auto");
  });
  test("an explicit Codex record wins for Codex (never widened to the Claude-derived level)", () => {
    const res = norm({ v: 2, runtime: "", messages: "auto_both", byRuntime: { claude: { tools: "bypass" }, codex: { tools: "untrusted" } } });
    assert.equal(res.selection.level, "full");
    assert.deepEqual(res.selection.byRuntime, { codex: "ask" });
    assert.equal(text(res.selection, "codex"), "on-request/workspace-write");
    assert.equal(text(res.selection, "claude"), "bypass");
  });
  test("the SELECTED runtime's explicit choice is the channel level; the default runtime's record keeps its own", () => {
    const res = norm({ v: 2, runtime: "codex", messages: "ask", byRuntime: { codex: { tools: "never", native: { sandbox_mode: "danger-full-access" } }, claude: { tools: "manual" } } });
    assert.equal(res.selection.level, "full");
    assert.deepEqual(res.selection.byRuntime, { claude: "ask" });
  });
  test("a Codex never on workspace-write is NOT Full (Full needs danger-full-access too) and is reviewed", () => {
    const res = norm({ v: 2, runtime: "codex", messages: "ask", byRuntime: { codex: { tools: "never", native: { sandbox_mode: "workspace-write" } } } });
    assert.equal(res.selection.level, "auto");
    assert.match(res.review.join(), /never\/workspace-write/);
  });
  test("no explicit tools anywhere → Ask; a v2 '' key folds into the default runtime (P3-05)", () => {
    assert.equal(norm({ v: 2, runtime: "", messages: "ask", byRuntime: {} }).selection.level, "ask");
    assert.equal(norm({ v: 2, runtime: "", messages: "ask", byRuntime: { "": { tools: "bypass" } } }).selection.level, "full");
  });
  test("IDEMPOTENT: re-reading the migrated record (as the next write stores it) changes nothing", () => {
    const fixtures = [
      { v: 2, runtime: "", messages: "auto_both", byRuntime: { claude: { tools: "bypass" } } },
      { v: 2, runtime: "codex", messages: "ask", byRuntime: { claude: { tools: "bypass" }, codex: { tools: "granular" } } },
      { v: 2, runtime: "cursor", messages: "auto_inbound", byRuntime: { cursor: { tools: "auto-review", native: { sandbox: "disabled" } } } },
    ];
    for (const f of fixtures) {
      const once = norm(f).selection;
      const twice = norm(JSON.parse(JSON.stringify(once))).selection;
      assert.deepEqual(twice, once);
      assert.deepEqual(sel.patchSelection(ctx, once, {}).selection, once);
    }
  });
  test("a pre-U5 pair migrates in the default runtime's words", () => {
    const res = sel.fromLegacy(ctx, { tools: "bypass", messages: "auto_both" }, "codex");
    assert.equal(res.selection.level, "full");
    assert.equal(res.selection.runtime, "codex");
    assert.equal(sel.fromLegacy(ctx, { tools: "bypass", messages: "nope" }, "").stored, false, "a half-valid pair is no pair (P3-34)");
  });
});

describe("4. the write path", () => {
  const base = norm({ v: 3, runtime: "", messages: "ask", level: "auto", byRuntime: { codex: "ask" } }).selection;
  test("a level write sets the one control for every runtime and clears the overrides", () => {
    const s = sel.patchSelection(ctx, base, { level: "full" }).selection;
    assert.equal(s.level, "full");
    assert.deepEqual(s.byRuntime, {});
  });
  test("an unknown level, messaging value, or a per-runtime word is REJECTED whole", () => {
    assert.match(sel.patchRejections(ctx, base, { level: "max" }).join(), /not a permission level/);
    assert.match(sel.patchRejections(ctx, base, { messages: "all" }).join(), /messaging/);
    assert.match(sel.patchRejections(ctx, base, { tools: "bypass" }).join(), /no longer stored/);
    assert.match(sel.patchRejections(ctx, base, { native: { sandbox_mode: "danger-full-access" } }).join(), /no longer stored/);
    assert.deepEqual(sel.patchRejections(ctx, base, { level: "ask", messages: "auto_both", runtime: "codex" }), []);
  });
  test("own-key: a runtime switch moves no level and no override", () => {
    const s = sel.patchSelection(ctx, base, { runtime: "codex" }).selection;
    assert.equal(s.level, "auto");
    assert.deepEqual(s.byRuntime, { codex: "ask" });
    assert.equal(sel.patchSelection(ctx, base, { runtime: "nope" }).selection.runtime, "");
  });
  test("byRuntime (the seed's whole-map replace) is re-validated", () => {
    const s = sel.patchSelection(ctx, base, { byRuntime: { codex: "full", claude: "bogus" } });
    assert.deepEqual(s.selection.byRuntime, { codex: "full", claude: "ask" });
    assert.equal(s.review.length, 1);
  });
});

test("5. the shape module holds NO runtime's vocabulary", () => {
  const src = req("node:fs").readFileSync(join(MAIN, "launch-selection.js"), "utf8");
  const code = codeOf(sentinelBlock(src, "LAUNCH-SELECTION"));
  assert.ok(!/\brequire\s*\(|\bstore\./.test(code), "no store or require inside the fence");
  assert.ok(!/manual|accept_edits|bypass|untrusted|on-request|claude|codex|cursor|gpt-|sandbox_mode|reasoningEffort/i.test(code));
});
