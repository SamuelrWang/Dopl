// BOOT test for the v2.8 @-tag POPUP: load renderer/session/session.js against a stub DOM
// with the two mention modules registered (the session-boot-dom.test.mjs idiom) and drive the
// real wiring — the popup opens on a leading `@`, the arrows walk it, Enter/Tab ACCEPT without
// sending, Escape and blur close it, a mousedown picks without stealing focus, and an
// unrecognized tag is sent literally. A regex cannot prove any of that: the keydown
// delegation, the ARIA bookkeeping and the accept-then-auto-grow order only exist in wiring.
//
// The tests run in FILE ORDER against ONE booted controller (a renderer is stateful).

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
    children: [], _attrs: {}, style: {}, checked: false,
    scrollHeight: 33, scrollTop: 0, clientHeight: 100, _listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(k, fn) { (this._listeners[k] = this._listeners[k] || []).push(fn); },
    fire(k, ev) { for (const fn of this._listeners[k] || []) fn(ev || {}); },
    setAttribute(k, v) { this._attrs[k] = v; if (k === "class") this.className = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
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

const sent = [];
globalThis.doplSession = {
  sessionId: "s1", onEvent() {},
  send: (...a) => sent.push(["send", ...a]),
  sendToPeer: (...a) => sent.push(["sendToPeer", ...a]),
  permission: (...a) => sent.push(["permission", ...a]),
  interrupt: () => sent.push(["interrupt"]),
  end() {}, closeTask() {}, consentDecision() {}, setToolMode() {}, setMessageMode() {}, inboundDecision() {},
  folder: {
    get: () => Promise.resolve({ label: "~/Downloads" }),
    choose: () => Promise.resolve({ label: null }),
    clear: () => Promise.resolve({ label: null }),
  },
};

globalThis.DoplSessionVM = require(R("session-viewmodel.js"));
globalThis.DoplSessionChrome = require(R("session-chrome.js"));
globalThis.DoplSessionRender = require(R("session-render.js"));
globalThis.DoplSessionMention = require(R("session-mention.js"));
globalThis.DoplSessionMentionUI = require(R("session-mention-ui.js"));
new Function(readFileSync(R("session.js"), "utf8"))(); // boot the controller

const feed = globalThis.__sessionFeed;
const steer = $("steerInput");
const pop = $("mentionPop");
const send = $("btnSend");

// Typing: set the value and fire the real input event (the popup, auto-grow and the glyph
// repaint all hang off it, in that order).
const type = (value) => { steer.value = value; steer.fire("input"); };
// A keydown with a recording preventDefault, exactly as the browser hands it over.
function key(name, shiftKey) {
  const ev = { key: name, shiftKey: shiftKey === true, prevented: false, preventDefault() { this.prevented = true; } };
  steer.fire("keydown", ev);
  return ev;
}
const rows = () => pop.children.filter((c) => c.className.includes("mention-opt"));
const rowText = (r) => r.children.map((c) => c.textContent);
const selected = () => rows().findIndex((r) => r.classList.contains("is-sel"));

test("boot: the session knows its peer (the peer row is derived from the init name)", () => {
  feed({ type: "init", sessionId: "s1", side: "requester", channelName: "Ops", from: "David" });
  assert.ok(pop.classList.contains("hidden"), "the popup starts hidden and empty");
  assert.equal(pop.children.length, 0);
});

test("popup: a LEADING @ opens it with both rows, the label, and the ARIA bookkeeping", () => {
  type("@");
  assert.ok(!pop.classList.contains("hidden"));
  assert.equal(pop.children[0].textContent, "Tag an agent", "the popup label");
  assert.equal(rows().length, 2);
  assert.deepEqual(rowText(rows()[0]), ["@my-agent", "Your agent"]);
  assert.deepEqual(rowText(rows()[1]), ["@david-agent", "David's agent"]);
  assert.deepEqual(rows().map((r) => r.getAttribute("id")), ["mentionOpt0", "mentionOpt1"]);
  assert.deepEqual(rows().map((r) => r.getAttribute("role")), ["option", "option"]);
  assert.equal(steer.getAttribute("aria-expanded"), "true");
  assert.equal(steer.getAttribute("aria-activedescendant"), "mentionOpt0");
  assert.equal(selected(), 0, "the first row is highlighted");
  assert.deepEqual(rows().map((r) => r.getAttribute("aria-selected")), ["true", "false"]);
});

test("popup: typing narrows it to one row", () => {
  type("@d");
  assert.equal(rows().length, 1);
  assert.deepEqual(rowText(rows()[0]), ["@david-agent", "David's agent"]);
});

test("popup: the arrows walk the rows and WRAP, consuming the keystroke", () => {
  type("@");
  const down = key("ArrowDown");
  assert.ok(down.prevented, "the caret must not move while the popup owns the arrows");
  assert.equal(selected(), 1);
  assert.equal(steer.getAttribute("aria-activedescendant"), "mentionOpt1");
  key("ArrowDown");
  assert.equal(selected(), 0, "down from the last wraps to the first");
  key("ArrowUp");
  assert.equal(selected(), 1, "up from the first wraps to the last");
});

test("popup: Enter ACCEPTS the highlighted row and DOES NOT SEND", () => {
  const before = sent.length;
  type("@d"); // the peer row, alone and highlighted
  const ev = key("Enter");
  assert.ok(ev.prevented, "the send/newline is suppressed");
  assert.equal(sent.length, before, "nothing crossed the bridge");
  assert.equal(steer.value, "@david-agent ", "the tag is inserted, with the trailing space");
  assert.ok(pop.classList.contains("hidden"), "and the popup closes");
  assert.equal(pop.children.length, 0, "its rows are removed, not just hidden");
  assert.equal(steer.getAttribute("aria-expanded"), "false");
  // FIX F12: REMOVED, not blanked — a closed listbox has no active descendant, and an empty
  // aria-activedescendant is a present attribute pointing at no element.
  assert.equal(steer.getAttribute("aria-activedescendant"), null);
});

test("popup: accepting ran onAccept — the field re-grew and the glyph repainted", () => {
  steer.value = "";
  steer.style.height = "";
  steer.scrollHeight = 54; // as if the inserted tag wrapped to a second line
  type("@d");
  key("Enter");
  assert.equal(steer.style.height, "54px", "autoGrow ran from onAccept, not from the input event");
  assert.ok(!send.classList.contains("is-running"), "and the send glyph is the one showing");
  steer.scrollHeight = 33;
});

test("popup: Tab accepts too (and consumes the tab)", () => {
  const before = sent.length;
  type("@m");
  const ev = key("Tab");
  assert.ok(ev.prevented);
  assert.equal(steer.value, "@my-agent ");
  assert.equal(sent.length, before);
});

test("popup: Shift+Enter is NEVER consumed (it stays a newline)", () => {
  const before = sent.length;
  type("@d");
  const ev = key("Enter", true);
  assert.ok(!ev.prevented, "the popup passes it through");
  assert.equal(steer.value, "@d", "nothing was accepted");
  assert.equal(sent.length, before, "and nothing was sent");
  assert.ok(!pop.classList.contains("hidden"), "the popup is still open");
});

test("popup: Escape closes it, and the NEXT Enter sends what was typed", () => {
  type("@zzz"); // unrecognized: the popup already closed on the empty match set
  assert.ok(pop.classList.contains("hidden"));
  type("@d");
  const esc = key("Escape");
  assert.ok(esc.prevented, "Escape is consumed by the popup, not by the field");
  assert.ok(pop.classList.contains("hidden"));
  const ev = key("Enter");
  assert.ok(ev.prevented);
  assert.deepEqual(sent.at(-1), ["send", "@d"], "L4: an unrecognized tag is sent LITERALLY to my agent");
  assert.equal(steer.value, "");
});

test("popup: a blur closes it (clicking away is not a pick)", () => {
  type("@");
  assert.ok(!pop.classList.contains("hidden"));
  steer.fire("blur");
  assert.ok(pop.classList.contains("hidden"));
  assert.equal(pop.children.length, 0);
});

test("popup: a mousedown PICKS a row and preventDefault keeps the composer focused", () => {
  const before = sent.length;
  type("@");
  const ev = { prevented: false, preventDefault() { this.prevented = true; } };
  rows()[1].fire("mousedown", ev);
  assert.ok(ev.prevented, "preventDefault first, so the field never blurs");
  assert.equal(steer.value, "@david-agent ", "the row under the pointer is the one picked");
  assert.equal(sent.length, before, "a pick is not a send");
  assert.ok(pop.classList.contains("hidden"));
});

test("popup: mouseenter moves the highlight (so a click cannot pick a different row)", () => {
  type("@");
  assert.equal(selected(), 0);
  rows()[1].fire("mouseenter");
  assert.equal(selected(), 1);
  assert.equal(steer.getAttribute("aria-activedescendant"), "mentionOpt1");
  key("Escape");
});

test("popup: an unknown tag CLOSES it, and the raw text is sent literally", () => {
  type("@zz");
  assert.ok(pop.classList.contains("hidden"), "no empty shell hanging over the composer");
  const ev = key("Enter");
  assert.ok(ev.prevented);
  assert.deepEqual(sent.at(-1), ["send", "@zz"]);
});

test("popup: a MID-TEXT @ never opens it (tags are leading-only)", () => {
  type("ping @d");
  assert.ok(pop.classList.contains("hidden"));
  type("ping @david-agent");
  assert.ok(pop.classList.contains("hidden"));
  const ev = key("Enter");
  assert.ok(ev.prevented);
  assert.deepEqual(sent.at(-1), ["send", "ping @david-agent"], "the whole line goes to my agent, @ and all");
});

test("popup: with NO peer there is still a self row, and no tag can address a peer", () => {
  feed({ type: "init", channelName: "Ops" }); // a bare shell: no counterparty
  type("@");
  assert.equal(rows().length, 1, "the self row only");
  assert.deepEqual(rowText(rows()[0]), ["@my-agent", "Your agent"]);
  type("@their-agent x");
  assert.ok(pop.classList.contains("hidden"));
  key("Enter");
  assert.deepEqual(sent.at(-1), ["send", "@their-agent x"], "L4, never a peer post");
  feed({ type: "init", channelName: "Ops", from: "David" }); // restore the peer for what follows
});

// ── FIX F12: the ARIA shape of the popup itself ───────────────────────────────

test("FIX F12: the popup LABEL is role=presentation, not a bare child of the listbox", () => {
  type("@");
  const label = pop.children[0];
  assert.equal(label.className, "mention-pop__label", "the label is still the first child");
  assert.equal(label.getAttribute("role"), "presentation", "so it is not counted as an option");
  for (const r of rows()) assert.equal(r.getAttribute("role"), "option", "the real rows still are");
});

test("FIX F12: aria-activedescendant is REMOVED on close, never left pointing nowhere", () => {
  type("@");
  assert.equal(steer.getAttribute("aria-activedescendant"), "mentionOpt0", "set while open");
  key("Escape");
  assert.equal(steer.getAttribute("aria-activedescendant"), null);
  assert.equal(steer.getAttribute("aria-expanded"), "false", "and expanded is set to false, not removed");
});

// ── FIX F5 / F6: the two drafts that had no popup affordance at all ───────────

test("FIX F5: a draft that STARTS with a newline still opens the popup", () => {
  type("\n@");
  assert.ok(!pop.classList.contains("hidden"), "a leading newline is still leading whitespace");
  assert.equal(rows().length, 2);
  type("\n@their");
  assert.equal(rows().length, 1, "and it narrows to the peer");
  assert.deepEqual(rowText(rows()[0]), ["@david-agent", "David's agent"]);
});

test("FIX F5: ...and accepting from there sends to the PEER, tag stripped", () => {
  const before = sent.length;
  type("\n@th");
  key("Enter");
  assert.equal(steer.value, "\n@david-agent ", "the tag replaced the token, the newline is untouched");
  steer.value = "\n@david-agent hi";
  key("Enter");
  assert.deepEqual(sent.slice(before), [["sendToPeer", "hi"]], "what the popup promised is what was sent");
  assert.equal(steer.value, "");
});

test("FIX F6: typing the ALIAS surfaces the peer row (it used to close the popup)", () => {
  for (const draft of ["@t", "@th", "@their", "@their-agent"]) {
    type(draft);
    assert.ok(!pop.classList.contains("hidden"), `${draft} keeps the popup open`);
    assert.equal(rows().length, 1, draft);
    assert.deepEqual(rowText(rows()[0]), ["@david-agent", "David's agent"], "the row shows the CANONICAL slug");
  }
  key("Enter");
  assert.equal(steer.value, "@david-agent ", "accepting inserts the canonical slug, not the alias");
  type("");
});

// ── the D7 auto-grow behavior the popup shares the input event with ────────────
// Re-pinned here (session-boot-dom.test.mjs owns the same assertions) because the popup now
// registers its OWN input listener, ahead of autoGrow's.

test("auto-grow still tracks the content and caps at 3 line-heights", () => {
  type("");
  steer.scrollHeight = 54;
  steer.fire("input");
  assert.equal(steer.style.height, "54px");
  steer.scrollHeight = 600;
  steer.fire("input");
  assert.equal(steer.style.height, "75px", "3 * 21 + 12");
  steer.scrollHeight = 33;
  steer.fire("input");
  assert.equal(steer.style.height, "33px");
});
