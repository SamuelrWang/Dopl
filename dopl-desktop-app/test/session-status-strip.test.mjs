// STATUS-STRIP LAYOUT tests — "no text child can grow the row".
//
// THE BUG (observed live, v2.9): the .status-strip rendered ~550px TALL. Its contents sat
// vertically centred in a huge empty bordered box above the stream, the model meta
// `claude-opus-5[1m]` broke onto THREE lines, the Messages select was clipped at the right
// window edge, and the permission posture was not legible at all.
//
// ROOT CAUSE: the session window is 520px wide and 520px MIN wide, so the strip has ~478px
// of content box, and v2.9 pushed the row's natural width to roughly 800px by adding the two
// <select> axes. The row did not wrap, so flexbox had to place that deficit on the children
// that could shrink. `.mode-select` / `.folder-pill` / `.perm-warn` are `flex: none`, and
// `.status-spacer` is basis-0 (scaled shrink factor 0), which left exactly two text spans —
// and `.perm-posture` carried `min-width: 0`, i.e. NO automatic minimum at all. It absorbed
// nearly the whole deficit, collapsed to a near-zero-width column, and then wrapped its ~140
// characters of copy one word per line. THAT is the 550px. `.status-meta` clamped at
// min-content, which for a hyphenated model id is a post-hyphen fragment, hence three lines.
// `align-items: center` was never the cause; it is why the survivors floated mid-box.
//
// THE PINS BELOW are the invariant, not the pixels: every text child of the strip declares a
// one-line guarantee AND a width floor, the two selects stay unshrinkable, and the strip
// wraps rather than clipping — a permission control the operator cannot reach is worse than
// a row that took two lines.
//
// Structural assertions only, through test/helpers/source-probe.mjs (`declsOf` / `ruleOf`),
// which compare PARSED rules: re-ordering declarations or running a formatter is not a
// failure, the values stay pinned, and a missing rule throws instead of passing vacuously.
// No DOM, no computed style — this suite never launches the app.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { declsOf, ruleOf } from "./helpers/source-probe.mjs";

const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const M = (p) => fileURLToPath(new URL("../main/" + p, import.meta.url));
const CSS = readFileSync(R("session.css"), "utf8");
const HTML = readFileSync(R("session.html"), "utf8");
const WINDOW_SRC = readFileSync(M("session-window.js"), "utf8");

// The `flex` shorthand as [grow, shrink, basis]. Written out rather than asserted as a
// literal string so `flex: 1 1 100%` and a future `flex: 1 1 100%` with different spacing
// both read the same, and so a test can ask about the BASIS specifically.
function flexParts(value) {
  const parts = String(value).trim().split(/\s+/);
  if (parts.length === 1 && parts[0] === "none") return { grow: "0", shrink: "0", basis: "auto" };
  return { grow: parts[0], shrink: parts[1], basis: parts[2] };
}

const px = (value) => {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(String(value).trim());
  return m ? Number(m[1]) : NaN;
};

// ── 1. the strip wraps; it does NOT clip ──────────────────────────────────────

test("the status strip WRAPS instead of squeezing its children onto one line", () => {
  const strip = declsOf(CSS, ".status-strip");
  assert.equal(strip["flex-wrap"], "wrap", "the row must be allowed a second line");
  // A row gap is only meaningful once it has wrapped, so its presence is part of the fix:
  // `gap: <row> <column>`, column unchanged at the original 12px.
  const gap = String(strip.gap).trim().split(/\s+/);
  assert.equal(gap.length, 2, `gap must carry a row gap for the wrapped case, got ${strip.gap}`);
  assert.ok(px(gap[0]) > 0, "a non-zero row gap so two lines do not collide");
  assert.equal(gap[1], "12px", "the column gap is unchanged");
});

test("the strip does NOT hide its overflow — a clipped control is unreachable", () => {
  // The bug report's third symptom was the Messages select clipped at the window edge.
  // The fix removes the overflow (by wrapping); hiding it would have made the folder pill
  // and the Messages select silently unreachable instead of merely ugly.
  const strip = declsOf(CSS, ".status-strip");
  for (const prop of ["overflow", "overflow-x", "overflow-y"]) {
    assert.equal(strip[prop], undefined, `.status-strip must not declare ${prop}`);
  }
});

// ── 2. the two selects stay unshrinkable and reachable ────────────────────────

test("both permission selects are UNSHRINKABLE (flex: none) and carry no width cap", () => {
  const sel = declsOf(CSS, ".mode-select");
  assert.equal(sel.flex, "none", "a squeezed permission control is unreadable — it never shrinks");
  // One recipe, both axes: the markup uses the same class for Tools and for Messages, so
  // this single pin covers both controls.
  const labels = HTML.match(/class="mode-select"/g) || [];
  assert.equal(labels.length, 2, "exactly two axis controls ride this recipe");
  const input = declsOf(CSS, ".mode-select__input");
  assert.equal(input["max-width"], undefined, "no cap that could hide the selected value");
});

// ── 3. THE INVARIANT: no text child of the strip can grow the row ─────────────

test("no text child of the status strip can grow the row by collapsing", () => {
  // A child adds height only if it can be squeezed narrower than its content AND is free to
  // reflow into that narrower column. Every text child must break at least one of those legs:
  //
  //   ONE LINE     `white-space: nowrap` + `overflow: hidden` — width stops mattering to
  //                height entirely; a squeeze truncates instead of stacking.
  //   UNSHRINKABLE `flex: none` — the box IS its max-content width, so it never reflows.
  //   FULL WIDTH   `flex-basis: 100%` + a positive `min-width` — it cannot be narrower than
  //                the strip, so its reflow is bounded by the container, not by a collapse.
  //
  // `min-width: 0` is the declaration that caused the bug, and it is legal here only under
  // the ONE LINE guarantee, where a zero floor costs characters rather than height.
  const children = [".status-label", ".status-meta", ".perm-posture", ".perm-warn", ".folder-pill"];
  for (const sel of children) {
    const d = declsOf(CSS, sel);
    const flex = d.flex ? flexParts(d.flex) : null;
    const oneLine = d["white-space"] === "nowrap" && d.overflow === "hidden";
    const unshrinkable = Boolean(flex) && flex.shrink === "0";
    const fullWidth = Boolean(flex) && flex.basis === "100%" && px(d["min-width"]) > 0;
    assert.ok(oneLine || unshrinkable || fullWidth,
      `${sel} can be collapsed into a taller column: ${JSON.stringify(d)}`);
    if (d["min-width"] === "0") {
      assert.ok(oneLine || unshrinkable,
        `${sel} may only zero its floor behind a one-line or unshrinkable guarantee`);
    }
  }
});

test("the posture line gets its OWN full-width line, with a floor under the basis", () => {
  const p = declsOf(CSS, ".perm-posture");
  const flex = flexParts(p.flex);
  assert.equal(flex.basis, "100%", "basis 100% takes it off the controls' line and gives it the full width");
  // The exact declaration that caused the bug must not come back.
  assert.notEqual(p["min-width"], "0", "min-width: 0 is what let it collapse to a one-word column");
  const floor = px(p["min-width"]);
  assert.ok(floor > 0, `the posture needs a positive width floor, got ${p["min-width"]}`);
  // …and that floor must fit inside the narrowest window the app can be opened at, or the
  // floor itself would become a source of horizontal overflow.
  const minWidth = Number(/minWidth:\s*(\d+)/.exec(WINDOW_SRC)[1]);
  assert.ok(minWidth > 0, "session-window.js still pins a minWidth");
  assert.ok(floor < minWidth, `posture floor ${floor}px must fit the ${minWidth}px min window`);
});

test("the model meta is one unbreakable line — the three-line `claude-opus-5[1m]` fix", () => {
  const meta = declsOf(CSS, ".status-meta");
  assert.equal(meta["white-space"], "nowrap", "a model id is ONE token; it never breaks at its hyphens");
  assert.equal(meta.overflow, "hidden");
  assert.equal(meta["text-overflow"], "ellipsis", "a longer id truncates instead of stacking");
});

test("the status label is bounded too, and its pill lets the ellipsis engage", () => {
  const label = declsOf(CSS, ".status-label");
  assert.equal(label["white-space"], "nowrap", "'Awaiting permission' stays on one line");
  assert.equal(label.overflow, "hidden");
  assert.equal(label["text-overflow"], "ellipsis");
  // Without min-width:0 on the pill, the pill's automatic minimum is its own min-content and
  // the label above never actually gets to shrink, so the ellipsis would be dead code.
  assert.equal(declsOf(CSS, ".status-pill")["min-width"], "0");
});

test("the folder pill's static text cannot break in two behind its 260px cap", () => {
  const pill = declsOf(CSS, ".folder-pill");
  assert.equal(pill["white-space"], "nowrap", '"Working Directory:" is an anonymous flex item');
  assert.equal(pill["max-width"], "260px", "the cap stays; the label absorbs it");
  const label = declsOf(CSS, ".folder-pill__label");
  assert.equal(label["white-space"], "nowrap");
  assert.equal(label["text-overflow"], "ellipsis");
});

// ── 4. the same trap cannot hit the header or the composer ────────────────────

test("HEADER: the shrinkable identity column's text children are already bounded", () => {
  // .header-id / .header-title-row carry the same `min-width: 0` shape that sank the
  // posture, but every text child under them is nowrap + ellipsis, so a squeezed header
  // truncates instead of growing. This pin is what keeps that true.
  assert.equal(declsOf(CSS, ".header-id")["min-width"], "0");
  assert.equal(declsOf(CSS, ".header-title-row")["min-width"], "0");
  for (const sel of [".channel-name", ".task-title"]) {
    const d = declsOf(CSS, sel);
    assert.equal(d["white-space"], "nowrap", `${sel} must not reflow when the column collapses`);
    assert.equal(d.overflow, "hidden", `${sel} clips`);
    assert.equal(d["text-overflow"], "ellipsis", `${sel} truncates`);
  }
  // The controls are the unshrinkable side, exactly like the selects in the strip.
  assert.equal(declsOf(CSS, ".header-controls").flex, "none");
  assert.equal(declsOf(CSS, ".peer-avatar").flex, "none", "the avatar never squashes into an oval");
});

test("COMPOSER: its one text child is height-capped, so it cannot grow without bound", () => {
  // The composer has the same shrink dynamics (one flex:1 field beside flex:none controls)
  // but no collapsing-text failure mode: the field's height is capped in CSS, not implied by
  // its content width.
  const field = declsOf(CSS, ".steer-input");
  assert.equal(field.flex, "1");
  assert.equal(field["max-height"], "calc(4.5em + 12px)", "the D7 cap is the bound");
  assert.equal(field["overflow-y"], "auto", "past the cap it scrolls rather than pushing the stream");
  assert.equal(declsOf(CSS, ".composer__controls").flex, "none");
});

// ── 5. house rules on everything this fix touched ─────────────────────────────

test("the fix stays inside the token vocabulary: no raw hex, no px font sizes", () => {
  const touched = [".status-strip", ".status-pill", ".status-label", ".status-meta",
    ".perm-posture", ".mode-select", ".folder-pill", ".folder-pill__label"];
  for (const sel of touched) {
    const rule = ruleOf(CSS, sel);
    assert.ok(rule, `${sel} is declared`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(rule.decls), `${sel} uses token colours only`);
    const d = declsOf(CSS, sel);
    if (d["font-size"] !== undefined) {
      assert.match(d["font-size"], /^var\(--text-/, `${sel} uses the semantic type scale`);
    }
  }
});

test("the strip's markup is unchanged: same children, same order, no new copy", () => {
  // The fix is CSS-only. The reading order (posture right after the two selects it
  // describes) is part of the two-axis contract, so it must not have been shuffled to buy
  // a shorter row.
  const order = ["status-pill", "statusMeta", "toolMode", "messageMode", "permPosture",
    "permWarn", "status-spacer", "folderPill"];
  let at = -1;
  for (const marker of order) {
    const next = HTML.indexOf(marker, at + 1);
    assert.ok(next > at, `status-strip child out of order or missing: ${marker}`);
    at = next;
  }
});
