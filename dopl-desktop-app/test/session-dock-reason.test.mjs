// THE DOCK'S REASON LINE (2026-08-02) — the second half of the gate-reason wave.
//
// main has stamped a machine-readable `gateReason` on EVERY gate payload since the reason codes
// landed, and session-render turns it into one line on the inline outbound card. The DOCK — the
// surface that shows Bash, Write, WebFetch and a CROSS-channel post — never showed it, for two
// reasons that both had to be fixed:
//   1. the view-model's `permission_request` whitelist DROPPED the field, so it never reached
//      the renderer at all;
//   2. `markOutboundGated`'s whitelist dropped it too, which meant the inline card's reason row
//      was dead code from the day it shipped whenever the card was CREATED by the gate.
// Without the line, an uncovered tool under `bypass` reads as a broken toggle, which is exactly
// how an operator learns to stop trusting the gate and turn it off for the wrong reason.
//
// This boots the REAL controller against a stub DOM (the session-boot-dom idiom) and drives the
// real permission_request path, so a broken element id or a stripped field fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));

function makeEl(tag) {
  const node = {
    tagName: String(tag).toUpperCase(), className: "", textContent: "", value: "",
    children: [], _attrs: {}, style: {}, disabled: false, _listeners: {},
    scrollHeight: 33, scrollTop: 0, clientHeight: 100,
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(k, fn) { (this._listeners[k] = this._listeners[k] || []).push(fn); },
    fire(k, ev) { for (const fn of this._listeners[k] || []) fn(ev || {}); },
    setAttribute(k, v) { this._attrs[k] = v; if (k === "class") this.className = v; },
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
    toggle(c, on) { const want = on === undefined ? !has(c) : !!on; if (want) node.classList.add(c); else node.classList.remove(c); },
  };
  return node;
}

const byId = new Map();
const $ = (id) => byId.get(id);
globalThis.document = {
  createElement: (t) => makeEl(t),
  getElementById: (id) => { if (!byId.has(id)) byId.set(id, makeEl("div")); return byId.get(id); },
  title: "",
};
globalThis.window = globalThis;
globalThis.getComputedStyle = () => ({ lineHeight: "21px", paddingTop: "6px", paddingBottom: "6px" });
globalThis.doplSession = {
  sessionId: "s1", onEvent() {}, send() {}, permission() {}, inboundDecision() {},
  interrupt() {}, end() {}, consentDecision() {},
  setToolMode() {}, setMessageMode() {}, setModel() {},
  folder: { get: () => Promise.resolve({ label: null }), choose: () => Promise.resolve({ label: null }), clear: () => Promise.resolve({ label: null }) },
};

globalThis.DoplSessionFormat = require(R("session-format.js"));
globalThis.DoplSessionLabels = require(R("session-labels.js"));
globalThis.DoplSessionHistoryVM = require(R("session-history-vm.js"));
globalThis.DoplSessionOutboundVM = require(R("session-outbound-vm.js"));
globalThis.DoplSessionVM = require(R("session-viewmodel.js"));
globalThis.DoplSessionChrome = require(R("session-chrome.js"));
globalThis.DoplSessionRender = require(R("session-render.js"));
globalThis.DoplSessionModesUI = require(R("session-modes-ui.js"));
new Function(readFileSync(R("session.js"), "utf8"))(); // boot the real controller

const feed = globalThis.__sessionFeed;
const render = globalThis.DoplSessionRender;
const vm = globalThis.DoplSessionVM;

const request = (over = {}) => feed({
  type: "permission_request", requestId: "r1", name: "Bash",
  inputSummary: '{"command":"ls"}', inputFull: { command: "ls" }, ...over,
});
const resolve = (requestId) => feed({ type: "permission_resolved", requestId, decision: "deny" });

// ── the line renders, from the code main really sends ────────────────────────

test("the dock names WHY it is asking, in the same words the inline card uses", () => {
  request({ gateReason: "not-covered-by-bypass" });
  assert.equal($("permWhy").textContent, render.gateReasonText("not-covered-by-bypass"));
  assert.match($("permWhy").textContent, /does not cover this tool/);
  assert.equal($("permWhy").classList.contains("hidden"), false, "and it is visible");
  resolve("r1");
});

test("every code main can stamp on a DOCK payload renders a line", () => {
  // The dock shows work tools and cross-channel posts, so these are the codes it really sees.
  for (const code of ["not-covered-by-bypass", "unclassified-tool", "awaiting-approval",
    "hard-denied", "cross-channel-post", "malformed-post-fields", "channel-op-approval-required"]) {
    request({ requestId: code, gateReason: code });
    assert.ok($("permWhy").textContent.length > 0, code);
    assert.equal($("permWhy").classList.contains("hidden"), false, code);
    resolve(code);
  }
});

test("an ABSENT or UNKNOWN code renders NO line, and the row is hidden — never a guess", () => {
  // M1: the prototype keys are in this list on purpose. `GATE_REASON["constructor"]` answered a
  // FUNCTION, and `|| ""` does not catch one, so the dock's textContent took the source of Object.
  for (const gateReason of [undefined, null, "", "why-not", 7, {}, "<img src=x onerror=alert(1)>",
    "constructor", "toString", "valueOf", "__proto__"]) {
    request({ requestId: "r-" + String(gateReason), gateReason });
    assert.equal($("permWhy").textContent, "", JSON.stringify(gateReason));
    assert.equal($("permWhy").classList.contains("hidden"), true, JSON.stringify(gateReason));
    resolve("r-" + String(gateReason));
  }
});

test("the line CLEARS when the next card has no reason (it belongs to the card, not the dock)", () => {
  request({ requestId: "a", gateReason: "unclassified-tool" });
  assert.ok($("permWhy").textContent.length > 0);
  request({ requestId: "b", name: "Write" }); // queued behind it, with no code
  resolve("a"); // ...and now b is the head
  assert.equal($("permWhy").textContent, "", "the previous card's reason does not linger");
  assert.equal($("permWhy").classList.contains("hidden"), true);
  resolve("b");
});

test("the reason is TEXT, never markup: a code-shaped payload cannot reach the DOM as HTML", () => {
  request({ requestId: "x", gateReason: "<script>alert(1)</script>" });
  assert.equal($("permWhy").textContent, "", "an unknown code renders nothing at all");
  assert.ok(!/\.innerHTML|insertAdjacentHTML|outerHTML/.test(readFileSync(R("session.js"), "utf8")),
    "and the controller has no HTML sink for one to reach even if it were known");
  resolve("x");
});

// ── the field survives the whitelist that used to strip it ───────────────────

test("the view-model's permission_request whitelist now PASSES gateReason through", () => {
  const s = vm.reduceEvent(vm.initialState(), {
    type: "permission_request", requestId: "r9", name: "Bash", gateReason: "awaiting-approval",
  });
  assert.equal(s.permissions[0].gateReason, "awaiting-approval");
  // Absent stays absent, exactly as main sends it.
  const bare = vm.reduceEvent(vm.initialState(), { type: "permission_request", requestId: "r8", name: "Bash" });
  assert.equal(bare.permissions[0].gateReason, undefined);
});

test("markOutboundGated carries it too, on BOTH the update and the CREATE path", () => {
  // FIX F5's create path is the one that mattered: a gate whose stream-time artifact never
  // landed paints the whole card from the gate payload, so a stripped field left that card
  // with no explanation at all.
  const created = vm.markOutboundGated(vm.initialState(), {
    toolUseId: "t1", requestId: "r1", ownChannel: true, text: "shipping tonight",
    gateReason: "message-approval-required",
  });
  assert.equal(created.items[0].gateReason, "message-approval-required");

  let s = vm.reduceEvent(vm.initialState(), { type: "outbound_post", toolUseId: "t2", text: "hi", pending: true });
  s = vm.markOutboundGated(s, { toolUseId: "t2", requestId: "r2", ownChannel: true, gateReason: "cross-channel-post" });
  assert.equal(s.items[0].gateReason, "cross-channel-post");
  assert.equal(s.items[0].requestId, "r2");
});

test("the dock element is declared hidden and sits with the rest of the card's context", () => {
  const HTML = readFileSync(R("session.html"), "utf8");
  assert.match(HTML, /class="perm-why text-caption hidden" id="permWhy"/, "starts hidden");
  const why = HTML.indexOf('id="permWhy"');
  assert.ok(HTML.indexOf('id="permPostTo"') < why, "destination first");
  assert.ok(why < HTML.indexOf('id="permPost"'), "then the reason, then the body under decision");
});
