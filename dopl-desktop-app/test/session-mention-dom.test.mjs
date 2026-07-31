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

// ── THE GAP (audit R3): a renderer state with init === null AND a populated stream ────
// Nothing anywhere constructed one, which is exactly the H1 failure the last round fixed: a
// dropped `init` leaves the composer with no peer name, and an @-tag then mis-delivers. These
// two run FIRST, against the virgin controller, so `state.init` is genuinely null while the
// stream fills — the shape a window really has when events arrive before (or instead of) the
// init payload.

test("GAP init===null: a full stream still renders, and no identity is invented", () => {
  feed({ type: "turn", role: "assistant", text: "on it", streaming: false });
  feed({ type: "counterparty", from: "David", text: "thanks" });
  feed({ type: "tool_use", toolUseId: "t1", name: "Bash", inputFull: { command: "ls" } });
  feed({ type: "outbound_post", toolUseId: "t2", to: "David", text: "sent" });
  feed({ type: "error", message: "boom" });
  const kids = $("stream").children;
  assert.equal(kids.length, 5, "every item renders with no init to key off");
  assert.deepEqual(
    kids.map((n) => (n.classList.contains("lane-me") ? "me" : n.classList.contains("lane-them") ? "them" : null)),
    ["me", "them", "me", null, null],
    "the lane mapping keys on the item KIND, never on init"
  );
  // renderInit() returns early rather than painting a header out of nothing.
  assert.equal($("channelName").textContent, "", "no header identity is invented");
  assert.equal(document.title, "", "and the native window title is left alone");
});

test("GAP init===null: a peer tag is UNDELIVERABLE, never silently mis-addressed", () => {
  type("@");
  assert.ok(!pop.classList.contains("hidden"), "the popup still works without an init");
  assert.equal(rows().length, 1, "the self row only: there is no peer name to derive a slug from");
  assert.deepEqual(rowText(rows()[0]), ["@my-agent", "Your agent"]);
  // `@their-agent` is a permanent alias, but only ALONGSIDE a real peer. With no init it has
  // to fall through to a literal steer; the H1 symptom was a draft leaving as a peer post.
  const before = sent.length;
  type("@their-agent ship it");
  assert.ok(pop.classList.contains("hidden"), "no peer row to offer");
  key("Enter");
  assert.deepEqual(sent.slice(before), [["send", "@their-agent ship it"]], "one steer, nothing to the peer");
  assert.ok(!sent.some((call) => call[0] === "sendToPeer"), "sendToPeer was never reached");
  assert.equal(steer.value, "");
  type(""); // leave the composer as the tests below expect to find it
});

// ── N-PARTY: a popup that can only offer the self row SAYS SO ─────────────────
// Still running against the virgin controller (init === null), which is the same shape a
// GROUP channel opens with: channel-context.resolve binds a counterparty only for `isDirect`,
// so "Open session" on a group thread card has none, and the peer row cannot be derived.
// One bare row reads as a broken popup rather than as the fail-closed limit it is — and the
// next keystroke is L4, which routes "@carol-agent do X" to the operator's own agent silently.

test("N-PARTY: with no counterparty the popup STATES the limit under the one row", () => {
  type("@");
  assert.equal(rows().length, 1, "the self row only, unchanged");
  const note = pop.children.find((c) => c.className === "mention-pop__note");
  assert.ok(note, "the limit is on screen, not left to be inferred from a short list");
  assert.equal(note.textContent, "Only your own agent can be addressed from this session.");
  assert.equal(note.getAttribute("role"), "presentation", "it is not an option a reader can pick");
  assert.equal(pop.children[0].className, "mention-pop__label", "the label is still first");
  assert.equal(pop.children.at(-1), note, "and the note is LAST, so the option indices are untouched");
  assert.equal(steer.getAttribute("aria-activedescendant"), "mentionOpt0", "which the ARIA pointer proves");
  key("Escape");
  assert.equal(pop.children.length, 0, "it goes away with the popup, like every other row");
  type("");
});

test("boot: the session knows its peer (the peer row is derived from the init name)", () => {
  feed({ type: "init", sessionId: "s1", side: "requester", channelName: "Ops", from: "David" });
  assert.ok(pop.classList.contains("hidden"), "the popup starts hidden and empty");
  assert.equal(pop.children.length, 0);
});

test("N-PARTY: with a real peer the note is GONE (two real rows explain themselves)", () => {
  type("@");
  assert.equal(rows().length, 2);
  assert.equal(pop.children.find((c) => c.className === "mention-pop__note"), undefined);
  type("");
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

// ── R1: an IME candidate commit must never send, and must never accept a tag ──
// Chromium fires keydown with key "Enter" and `isComposing: true` when a CJK candidate is
// COMMITTED (older builds only set keyCode 229). The handler used to preventDefault and then
// either accept the highlighted @-row or call sendSteer(), so confirming a candidate shipped a
// half-composed message — and a peer-tagged one leaves this machine into the peer's channel,
// where it cannot be recalled. The guard is the FIRST line of the keydown handler, ahead of
// the popup delegation, which is why the popup-open case below is the load-bearing one.

test("R1: a COMPOSING Enter with the popup OPEN accepts nothing and sends nothing", () => {
  for (const [label, ev] of [
    ["isComposing", { key: "Enter", shiftKey: false, isComposing: true }],
    ["keyCode 229", { key: "Enter", shiftKey: false, keyCode: 229 }], // older Chromium
  ]) {
    const before = sent.length;
    type("@d");
    assert.ok(!pop.classList.contains("hidden"), `${label}: the popup is open`);
    let prevented = false;
    steer.fire("keydown", { ...ev, preventDefault: () => { prevented = true; } });
    assert.equal(steer.value, "@d", `${label}: no tag was accepted`);
    assert.equal(sent.length, before, `${label}: nothing crossed the bridge`);
    assert.equal(prevented, false, `${label}: the IME keeps its own keystroke`);
    assert.ok(!pop.classList.contains("hidden"), `${label}: and the popup is still open`);
  }
});

test("R1: a COMPOSING Enter with the popup CLOSED does not send the draft either", () => {
  const before = sent.length;
  type("にほんご");
  assert.ok(pop.classList.contains("hidden"), "no leading @, so no popup to consume it");
  steer.fire("keydown", { key: "Enter", shiftKey: false, isComposing: true, preventDefault() {} });
  assert.equal(sent.length, before, "the half-composed draft stays in the operator's hands");
  assert.equal(steer.value, "にほんご", "and the field is not cleared");
  steer.fire("keydown"); // the harness idiom is `ev || {}`: the absent properties must not throw
  assert.equal(sent.length, before, "an event with no key is not an Enter");
});

test("R1: the Enter AFTER the composition ends still sends, exactly once", () => {
  const ev = key("Enter");
  assert.deepEqual(sent.at(-1), ["send", "にほんご"], "the committed text is delivered");
  assert.ok(ev.prevented, "and the newline is suppressed as before");
  assert.equal(steer.value, "");
});

test("R1: the popup's own handleKey refuses a composing Enter (attach() is public API)", () => {
  // session.js returns before delegating, so this second guard only matters for another
  // caller of attach() — which is exactly why it is worth pinning rather than assuming.
  const input = makeEl("textarea");
  const host = makeEl("div");
  const options = [{ slug: "my-agent", kind: "self", label: "Your agent", aliases: [] }];
  const popup = globalThis.DoplSessionMentionUI.attach({ input, host, getOptions: () => options });
  input.value = "@my";
  input.fire("input");
  assert.ok(popup.isOpen(), "the popup is showing the self row");
  assert.equal(popup.handleKey({ key: "Enter", isComposing: true }), false, "not consumed");
  assert.equal(popup.handleKey({ key: "Enter", keyCode: 229 }), false);
  assert.equal(input.value, "@my", "and nothing was accepted");
  assert.equal(popup.handleKey({ key: "Enter" }), true, "a real Enter still accepts");
  assert.equal(input.value, "@my-agent ");
});
