// SCROLL FIX tests — "the stream owns the scroll" in the session window.
//
// The stuck/sticky feel had two causes, and this file pins the fix for both:
//   1. NESTED SCROLLERS stole the wheel. .tool-card__body pre and .tool-result were each
//      240px;overflow:auto, so a gesture that landed on an expanded card scrolled that
//      little box — and Chromium latches a continuous gesture to the scroller it started
//      on, so the transcript stopped dead until the pointer left the card. .tool-result's
//      cap is GONE (main caps that string at 240 chars, so it can never need one) and the
//      pre keeps a LARGE 60vh cap plus explicit wheel forwarding.
//   2. THE AUTO-PIN fought the reader: a 48px band, re-applied on EVERY renderAll (which
//      fires for folder / avatar / status / dock repaints too).
//
// SOURCE EXTRACTION: session.js is an IIFE renderer controller, so its two pure decisions
// live in a fenced BEGIN/END SESSION-SCROLL-PURE block (the session-io / session-dispatch
// idiom). We slice the block, prove it is DOM-free, and evaluate it to get the helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const JS = readFileSync(R("session.js"), "utf8");
const CSS = readFileSync(R("session.css"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-SCROLL-PURE";
const END = "// ─── END SESSION-SCROLL-PURE";
const from = JS.indexOf(BEGIN);
const to = JS.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-SCROLL-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-SCROLL-PURE sentinel missing");
assert.ok(to > from, "SESSION-SCROLL-PURE sentinels out of order");
const BLOCK = JS.slice(from, to);

for (const banned of ["document", "window", "els.", "addEventListener", "state.", "require("]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-SCROLL-PURE block must not reference ${banned}`);
}

const { shouldPinStream, streamTail, forwardedWheelDelta } = new Function(
  BLOCK + "\nreturn { shouldPinStream, streamTail, forwardedWheelDelta };"
)();

// ── 1. the pin decision: was-at-the-actual-bottom AND the stream really grew ───

test("shouldPinStream: the TRUTH TABLE — both inputs are required", () => {
  // gap (px from the bottom) × tailChanged.
  const rows = [
    [0, true, true, "at the bottom + new content -> follow the stream"],
    [7, true, true, "inside the 8px band still counts as the bottom"],
    [8, true, false, "8px is OUTSIDE the band — the reader has moved, leave them"],
    [9, true, false, "just past the band -> never yanked"],
    [400, true, false, "reading history -> never yanked"],
    [0, false, false, "at the bottom but NOTHING grew -> no pin (the renderAll storm)"],
    [400, false, false, "neither -> no pin"],
    [-120, true, true, "a stream shorter than its viewport is at the bottom by definition"],
  ];
  for (const [gap, changed, want, why] of rows) {
    assert.equal(shouldPinStream(gap, changed), want, why + ` (gap=${gap}, changed=${changed})`);
  }
});

test("shouldPinStream: the band is 8px, NOT the old 48px reading band", () => {
  assert.equal(shouldPinStream(47, true), false, "the old band would have pinned here");
  assert.match(BLOCK, /PIN_BAND_PX = 8;/, "the number stays in one named place");
  assert.ok(!/< 48/.test(JS), "no 48px pin band survives in the controller");
});

test("shouldPinStream: an UNMEASURED stream (NaN gap) still lands at the bottom", () => {
  // A fresh window has never scrolled, so nothing has measured a gap: the initial open must
  // still show the newest item rather than the top of a restored transcript.
  assert.equal(shouldPinStream(NaN, true), true);
  assert.equal(shouldPinStream(undefined, true), true);
  assert.equal(shouldPinStream(NaN, false), false, "...but still only when something grew");
});

test("shouldPinStream: only a literal true on both sides pins (no truthy coercion)", () => {
  assert.equal(shouldPinStream(0, 1), false, "a truthy non-boolean is not a change signal");
  assert.equal(shouldPinStream(0, "yes"), false);
});

// ── the growth gate: what counts as "the stream grew" ─────────────────────────

test("streamTail: a NEW item changes the tail (count)", () => {
  const a = [{ kind: "turn", role: "agent", text: "hi" }];
  const b = a.concat([{ kind: "tool", toolUseId: "t1", name: "bash" }]);
  assert.notEqual(streamTail(a), streamTail(b));
});

test("streamTail: a STREAMING turn taking more text changes the tail (length)", () => {
  const open = { kind: "turn", role: "agent", text: "Look", streaming: true };
  const more = { ...open, text: "Looking at the invoice import" };
  assert.notEqual(streamTail([open]), streamTail([more]), "a growing reply is followed");
});

test("streamTail: identity — a different last item of the same shape is a different tail", () => {
  const one = [{ kind: "inbound_pending", pendingId: "p1", text: "ping" }];
  const two = [{ kind: "inbound_pending", pendingId: "p2", text: "ping" }];
  assert.notEqual(streamTail(one), streamTail(two));
  const tool = [{ kind: "tool", toolUseId: "t1", text: undefined }];
  const tool2 = [{ kind: "tool", toolUseId: "t2", text: undefined }];
  assert.notEqual(streamTail(tool), streamTail(tool2));
});

test("streamTail: a NON-stream repaint leaves the tail identical (the whole point)", () => {
  // renderAll fires for folder labels, avatar fills, status pills, the dock and the close
  // panel. None of those touch `items`, so the tail cannot change and the view cannot jump.
  const items = [
    { kind: "request", lane: "them", from: "David", text: "Ship the invoice import" },
    { kind: "tool", toolUseId: "t1", name: "bash", status: "pending", resultSummary: null },
  ];
  const before = streamTail(items);
  assert.equal(streamTail(items.slice()), before, "the same items -> the same tail");
  // A tool_result patches the LAST item in place (status + resultSummary). The card is a
  // default-closed <details>, so nothing about the reader's view moved: no pin.
  const patched = items.slice(0, 1).concat([{ ...items[1], status: "ok", resultSummary: "done" }]);
  assert.equal(streamTail(patched), before, "a result landing in a closed card never yanks");
});

test("streamTail: empty / junk input is a stable sentinel", () => {
  assert.equal(streamTail([]), "0");
  assert.equal(streamTail(null), "0");
  assert.equal(streamTail(undefined), "0");
  assert.equal(streamTail("nope"), "0");
});

// ── 2. wheel forwarding: an inner scroller never latches the transcript ───────

const CAN_SCROLL = { top: 100, height: 900, client: 300 }; // 600px of travel, parked in the middle

test("forwardedWheelDelta: a box with travel LEFT keeps its own gesture", () => {
  const { top, height, client } = CAN_SCROLL;
  assert.equal(forwardedWheelDelta(top, height, client, 40, 0), 0, "down, room below -> the box scrolls");
  assert.equal(forwardedWheelDelta(top, height, client, -40, 0), 0, "up, room above -> the box scrolls");
});

test("forwardedWheelDelta: at the BOTTOM edge, a downward wheel goes to the stream", () => {
  assert.equal(forwardedWheelDelta(600, 900, 300, 40, 0), 40, "the whole delta, unscaled");
  assert.equal(forwardedWheelDelta(599.4, 900, 300, 40, 0), 40, "1px of slack for fractional pixels");
  assert.equal(forwardedWheelDelta(600, 900, 300, -40, 0), 0, "...but upward is still the box's");
});

test("forwardedWheelDelta: at the TOP edge, an upward wheel goes to the stream", () => {
  assert.equal(forwardedWheelDelta(0, 900, 300, -40, 0), -40);
  assert.equal(forwardedWheelDelta(1, 900, 300, -40, 0), -40, "the same 1px of slack");
  assert.equal(forwardedWheelDelta(0, 900, 300, 40, 0), 0, "downward is the box's to take");
});

test("forwardedWheelDelta: a box that cannot scroll AT ALL never takes the gesture", () => {
  // Short content inside a capped box (the common case now that the cap is 60vh): the
  // browser would not scroll it either, but it is the latch this closes that matters.
  assert.equal(forwardedWheelDelta(0, 120, 300, 40, 0), 40, "no travel -> the stream, both ways");
  assert.equal(forwardedWheelDelta(0, 120, 300, -40, 0), -40);
  assert.equal(forwardedWheelDelta(0, 300, 300, 40, 0), 40, "exactly the viewport -> no travel");
});

test("forwardedWheelDelta: a horizontal-only wheel is left alone", () => {
  assert.equal(forwardedWheelDelta(600, 900, 300, 0, 0), 0, "deltaY 0 -> nothing to forward");
});

test("forwardedWheelDelta: deltaMode — lines are scaled, pages are left to the browser", () => {
  assert.equal(forwardedWheelDelta(600, 900, 300, 3, 1), 48, "DOM_DELTA_LINE: 3 * 16px");
  assert.equal(forwardedWheelDelta(0, 900, 300, -3, 1), -48, "and upward at the top edge");
  assert.equal(forwardedWheelDelta(600, 900, 300, -3, 1), 0, "direction still decides first");
  assert.equal(forwardedWheelDelta(600, 900, 300, 1, 2), 0, "DOM_DELTA_PAGE: let it chain natively");
});

test("forwardedWheelDelta: junk geometry is never turned into a scroll jump", () => {
  assert.equal(forwardedWheelDelta(0, 900, 300, NaN, 0), 0);
  assert.equal(forwardedWheelDelta(0, 900, 300, undefined, 0), 0);
  assert.equal(forwardedWheelDelta(NaN, NaN, NaN, 40, 0), 40, "unmeasurable box -> the stream");
});

// ── the wiring + the CSS the fix rests on ─────────────────────────────────────

test("wiring: the stream listens for its own scroll and forwards the wheel", () => {
  assert.match(JS, /addEventListener\("scroll"/, "the gap is measured from the USER's scroll");
  assert.match(JS, /bottomGap = s\.scrollHeight - s\.scrollTop - s\.clientHeight/);
  assert.match(JS, /addEventListener\("wheel"[\s\S]*?\{ passive: false \}\)/, "preventDefault needs a non-passive listener");
  assert.match(JS, /e\.preventDefault\(\)/, "the inner box must not also consume the gesture");
  assert.match(
    JS,
    /INNER_SCROLLERS = "\.tool-card__body pre, \.outbound-pending \.outbound__body"/,
    "both capped boxes that live INSIDE the stream"
  );
  assert.match(JS, /wireStreamScroll\(\);/, "and it is actually wired at boot");
  // The pin is read from the stored gap, never re-measured after the paint (a card that
  // grows must not silently un-pin a reader who is sitting at the bottom).
  assert.match(JS, /if \(shouldPinStream\(bottomGap, tailChanged\)\)/);
});

test("CSS: the tool card's OUTPUT block has no scroller of its own any more", () => {
  const result = CSS.slice(CSS.indexOf(".tool-result {"), CSS.indexOf(".tool-result {") + 400);
  const rule = result.slice(0, result.indexOf("}"));
  // Declarations only — the rule still CARRIES a comment saying why the cap is gone.
  assert.ok(!/^\s*max-height\s*:/m.test(rule), "the 240px cap is GONE (main caps the string at 240 chars)");
  assert.ok(!/^\s*overflow\s*:\s*auto/m.test(rule), "and with it the wheel trap");
  assert.match(rule, /white-space: pre-wrap;/, "wrapping is what actually contained it");
  assert.match(rule, /overflow-wrap: anywhere;/);
});

test("CSS: the one genuinely unbounded block keeps a LARGE cap, not a 240px one", () => {
  const pre = CSS.slice(CSS.indexOf(".tool-card__body pre {"), CSS.indexOf(".tool-result {"));
  assert.match(pre, /max-height: 60vh;/, "60vh: pretty(inputFull) can be a whole file");
  assert.match(pre, /overflow: auto;/, "so it still scrolls — the wheel forwarding is what unsticks it");
});

test("CSS: overscroll-behavior is NOT the fix (it blocks chaining, the opposite)", () => {
  // The stylesheet EXPLAINS why it is absent; what must never appear is the declaration.
  assert.ok(!/^\s*overscroll-behavior\s*:/m.test(CSS), "chaining is wanted here, not suppressed");
});

// ── BOOT: the same two decisions through the REAL wiring ─────────────────────
// A stub DOM (the session-boot-dom idiom, trimmed to what this path touches) so the
// listeners themselves are exercised: a regex cannot prove that the scroll handler is on
// the stream, that the gap it stores is the one the pin reads, or that a forwarded wheel
// actually moves the transcript.

function makeEl() {
  const node = {
    tagName: "DIV", className: "", textContent: "", value: "", children: [], _attrs: {},
    style: {}, checked: false, scrollHeight: 0, scrollTop: 0, clientHeight: 0, _listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(k, fn) { (this._listeners[k] = this._listeners[k] || []).push(fn); },
    fire(k, ev) { for (const fn of this._listeners[k] || []) fn(ev || {}); },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    replaceChildren(...kids) { this.children = kids.slice(); },
    replaceChild(nu, old) { const i = this.children.indexOf(old); if (i >= 0) this.children[i] = nu; return old; },
    closest() { return null; },
    querySelectorAll() { return []; },
  };
  const has = (c) => node.className.split(/\s+/).filter(Boolean).includes(c);
  node.classList = {
    add(...cs) { const s = new Set(node.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.add(c)); node.className = [...s].join(" "); },
    remove(...cs) { const s = new Set(node.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.delete(c)); node.className = [...s].join(" "); },
    contains: has,
    toggle(c, on) { if (on === undefined ? !has(c) : on) node.classList.add(c); else node.classList.remove(c); },
  };
  return node;
}

const byId = new Map();
globalThis.document = {
  createElement: () => makeEl(),
  getElementById: (id) => { if (!byId.has(id)) byId.set(id, makeEl()); return byId.get(id); },
  title: "",
};
globalThis.window = globalThis;
globalThis.getComputedStyle = () => ({ lineHeight: "21px", paddingTop: "6px", paddingBottom: "6px" });
globalThis.doplSession = {
  sessionId: "s1", onEvent() {}, send() {}, permission() {}, interrupt() {}, end() {},
  closeTask() {}, consentDecision() {}, setToolMode() {}, setMessageMode() {},
  folder: { get: () => Promise.resolve({ label: null }), choose: () => Promise.resolve({ label: null }), clear: () => Promise.resolve({ label: null }) },
};

const require_ = createRequire(import.meta.url);
globalThis.DoplSessionVM = require_(R("session-viewmodel.js"));
globalThis.DoplSessionChrome = require_(R("session-chrome.js"));
globalThis.DoplSessionRender = require_(R("session-render.js"));
new Function(JS)(); // boot the controller against the stub

const feed = globalThis.__sessionFeed;
const stream = byId.get("stream");
// A transcript taller than its viewport: 300px of window over 5000px of content.
const grow = (h) => { stream.scrollHeight = h; stream.clientHeight = 300; };
const scrollTo = (top) => { stream.scrollTop = top; stream.fire("scroll"); };

test("boot: the initial open lands at the bottom (nothing has scrolled yet)", async () => {
  await Promise.resolve(); // flush the folder.get() seed render
  grow(5000);
  feed({ type: "turn", role: "agent", text: "first", streaming: false });
  assert.equal(stream.scrollTop, 5000, "a fresh window follows the newest item");
});

test("boot: a reader who scrolled UP is never yanked back down", () => {
  scrollTo(0); // gap 4700 — reading the top of the transcript
  feed({ type: "turn", role: "agent", text: "second", streaming: false });
  assert.equal(stream.scrollTop, 0, "the agent working does not move the view");
  feed({ type: "turn", role: "agent", text: "third", streaming: false });
  assert.equal(stream.scrollTop, 0, "...and keeps not moving it");
});

test("boot: scrolling back to the bottom re-arms the pin", () => {
  scrollTo(4700); // gap 0
  feed({ type: "turn", role: "agent", text: "fourth", streaming: false });
  assert.equal(stream.scrollTop, 5000, "back to following");
});

test("boot: a NON-stream renderAll never re-pins (the 48px-band bug)", () => {
  scrollTo(4700); // at the bottom, pin armed
  feed({ type: "folder", label: "~/Projects" });
  assert.equal(stream.scrollTop, 4700, "a folder label repaint leaves the view alone");
  feed({ type: "status", phase: "running", activity: "working" });
  assert.equal(stream.scrollTop, 4700, "so does a status pill");
  feed({ type: "avatars", self: null, from: null });
  assert.equal(stream.scrollTop, 4700, "so does an avatar fill");
});

test("boot: a wheel over an inner scroller AT ITS EDGE moves the STREAM", () => {
  scrollTo(2000);
  let prevented = false;
  const box = { scrollTop: 600, scrollHeight: 900, clientHeight: 300 }; // parked at its bottom
  const target = { closest: () => box };
  stream.fire("wheel", { target, deltaY: 40, deltaMode: 0, preventDefault: () => { prevented = true; } });
  assert.equal(stream.scrollTop, 2040, "the transcript absorbed the delta");
  assert.equal(prevented, true, "and the inner box does not also latch it");
});

test("boot: a wheel over an inner scroller with travel LEFT is left alone", () => {
  scrollTo(2000);
  let prevented = false;
  const box = { scrollTop: 100, scrollHeight: 900, clientHeight: 300 }; // room below
  stream.fire("wheel", { target: { closest: () => box }, deltaY: 40, deltaMode: 0, preventDefault: () => { prevented = true; } });
  assert.equal(stream.scrollTop, 2000, "the box keeps its own gesture");
  assert.equal(prevented, false, "nothing is intercepted");
});

test("boot: a wheel over the stream itself is never intercepted", () => {
  scrollTo(2000);
  let prevented = false;
  stream.fire("wheel", { target: { closest: () => null }, deltaY: 40, deltaMode: 0, preventDefault: () => { prevented = true; } });
  assert.equal(stream.scrollTop, 2000, "the browser does its normal thing");
  assert.equal(prevented, false);
});

test("CSS: the outer scroll chain and the item pins are untouched", () => {
  assert.match(CSS, /\.stream-wrap \{ flex: 1; min-height: 0; display: flex; \}/);
  assert.match(CSS, /\.stream \{\n\s*flex: 1; min-height: 0; overflow-y: auto;/);
  assert.match(CSS, /\.stream > \* \{ flex: 0 0 auto; \}/);
  // The pending-draft cap STAYS: it is what keeps Send / Deny reachable. It is unstuck by
  // the wheel forwarding above instead of by removing the cap.
  assert.match(CSS, /\.outbound-pending \.outbound__body \{\n\s*max-height: 200px; overflow: auto;/);
});
