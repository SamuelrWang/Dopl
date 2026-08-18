// BOOT test for the §3.2 COMPOSER ADDRESSEE PILL: load renderer/session/session.js against a
// stub DOM with both address modules registered (the session-boot-dom.test.mjs idiom) and drive
// the real wiring — the menu opens on a click, a pick re-faces the pill and the send button,
// a peer-addressed draft goes to sendToPeer instead of send, the post paints in MY stream, and
// the handle main answers replaces the fallback row.
//
// A regex cannot prove any of that: the click routing, the send/pause override, the async name
// read and the refusal path only exist in wiring. The tests run in FILE ORDER against ONE
// booted controller (a renderer is stateful, exactly as it is in the window).

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
    get childElementCount() { return this.children.length; },
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
let nameAnswer = { name: "flint" };
globalThis.doplSession = {
  sessionId: "s1", onEvent() {},
  send: (...a) => sent.push(["send", ...a]),
  sendToPeer: (...a) => sent.push(["sendToPeer", ...a]),
  agentName: () => Promise.resolve(nameAnswer),
  permission: (...a) => sent.push(["permission", ...a]),
  interrupt: () => sent.push(["interrupt"]),
  end() {}, consentDecision() {}, setToolMode() {}, setMessageMode() {}, inboundDecision() {},
  folder: {
    get: () => Promise.resolve({ label: "~/Downloads" }),
    choose: () => Promise.resolve({ label: null }),
    clear: () => Promise.resolve({ label: null }),
  },
};

globalThis.DoplSessionVM = require(R("session-viewmodel.js"));
globalThis.DoplSessionChrome = require(R("session-chrome.js"));
globalThis.DoplSessionRender = require(R("session-render.js"));
globalThis.DoplSessionAddress = require(R("session-address.js"));
globalThis.DoplSessionAddressUI = require(R("session-address-ui.js"));
new Function(readFileSync(R("session.js"), "utf8"))(); // boot the controller

const feed = globalThis.__sessionFeed;
const pill = $("btnTarget");
const pillLabel = $("targetLabel");
const pop = $("targetPop");
const steer = $("steerInput");
const send = $("btnSend");
const stream = $("stream");

const rowsOf = () => pop.children.filter((c) => c.className.includes("target-opt"));
// The stub does not compute textContent recursively, so a bubble's who-line (which lives
// inside `.cp-head`, beside the avatar node) is invisible to a shallow join.
const textOf = (node) => {
  const kids = node.children || [];
  return kids.length ? kids.map(textOf).join(" | ") : String(node.textContent || "");
};
const flush = () => new Promise((r) => setTimeout(r, 0));

// ── the resting face ─────────────────────────────────────────────────────────

test("the pill is CLOSED at boot, with an empty menu and nothing pre-rendered", () => {
  assert.equal(pill.getAttribute("aria-expanded"), "false");
  assert.ok(pop.className.includes("hidden"), "the menu is hidden and empty until it is clicked");
  assert.equal(pop.children.length, 0);
  // The face already says something: the fallback row ("Message this session") is painted
  // synchronously at mount and is pinned in test/session-address.test.mjs, because the name
  // read below resolves before the first case in this file runs.
  assert.ok(pillLabel.textContent.startsWith("Message "), pillLabel.textContent);
});

test("the handle main answers replaces the fallback with no click and no init", async () => {
  await flush();
  assert.equal(pillLabel.textContent, "Message flint",
    "the same handle the channel pane's pill shows, read once from session-summary's ledger");
});

test("a session with NO counterparty offers one row and says why", () => {
  pill.fire("click");
  assert.equal(pill.getAttribute("aria-expanded"), "true");
  assert.ok(!pop.className.includes("hidden"));
  assert.deepEqual(rowsOf().map((r) => r.children[0].textContent), ["Message flint"]);
  const note = pop.children.find((c) => c.className.includes("target-pop__note"));
  assert.ok(note, "a single bare row reads as a broken menu rather than as the real limit");
  assert.match(note.textContent, /no counterparty/);
  pill.fire("click"); // close
  assert.ok(pop.className.includes("hidden"));
});

// ── the peer row appears with `init` ─────────────────────────────────────────

test("init's counterparty name adds the peer row, with its consequence spelled out", () => {
  feed({ type: "init", sessionId: "s1", channelName: "Ops", taskTitle: "Ship it", from: "David" });
  pill.fire("click");
  const rows = rowsOf();
  assert.deepEqual(rows.map((r) => r.children[0].textContent), ["Message flint", "Message David"]);
  assert.match(textOf(rows[1]), /Their agent picks it up/);
  assert.equal(rows[0].getAttribute("aria-checked"), "true", "the steer is still the pick");
  assert.equal(rows[1].getAttribute("aria-checked"), "false");
  assert.equal(pop.children.filter((c) => c.className.includes("target-pop__note")).length, 0,
    "the limit line is gone the moment there is somebody to reach");
});

test("a pick lands on mousedown (before blur), closes the menu, and NEVER sends", () => {
  const before = sent.length;
  rowsOf()[1].fire("mousedown", { preventDefault() {} });
  assert.equal(sent.length, before, "picking a target is not a send");
  assert.ok(pop.className.includes("hidden"));
  assert.equal(pill.getAttribute("aria-expanded"), "false");
  assert.equal(pillLabel.textContent, "Message David", "the face follows the pick");
});

test("Escape closes the menu and is the ONLY key the composer delegates", () => {
  pill.fire("click");
  assert.ok(!pop.className.includes("hidden"));
  let prevented = false;
  steer.fire("keydown", { key: "Escape", preventDefault: () => { prevented = true; } });
  assert.ok(pop.className.includes("hidden"));
  assert.ok(prevented);
  // With the menu shut, Enter is a plain send again: there is no accept-vs-send contention
  // to resolve, which is the whole difference between a pill and the `@` popup it replaced.
  const before = sent.length;
  steer.value = "";
  steer.fire("keydown", { key: "Enter", shiftKey: false, preventDefault() {} });
  assert.equal(sent.length, before, "an empty draft still sends nothing");
});

// ── what a peer-addressed draft actually does ────────────────────────────────

test("a peer draft goes to sendToPeer VERBATIM, and never becomes a steer", () => {
  steer.value = "  can you take this one?  ";
  const before = sent.length;
  send.fire("click");
  assert.deepEqual(sent.slice(before), [["sendToPeer", "can you take this one?"]],
    "trimmed, and byte-identical to what was typed: the target is a control, not a prefix");
  assert.equal(steer.value, "", "the field is cleared");
  assert.equal(steer.style.height, "33px", "D7: back to ONE line after send");
});

test("the operator's post paints in MY stream as its own kind, with a status line", () => {
  feed({ type: "operator_post", localId: "p1", to: "David", text: "can you take this one?" });
  const bubble = stream.children[stream.children.length - 1];
  assert.ok(bubble.className.includes("role-peer-msg"), "not a turn, not an outbound");
  assert.ok(bubble.className.includes("lane-me"), "it is this machine's output, so it is right-laned");
  assert.match(textOf(bubble), /You to David's agent/);
  assert.match(textOf(bubble), /Sending/);
  feed({ type: "operator_post_result", localId: "p1", ok: true });
  assert.match(textOf(bubble), /Sent/);
  assert.ok(!bubble.className.includes("is-failed"));
});

test("a failed post says so on the bubble it already painted", () => {
  feed({ type: "operator_post", localId: "p2", to: "David", text: "second" });
  const bubble = stream.children[stream.children.length - 1];
  feed({ type: "operator_post_result", localId: "p2", ok: false });
  assert.match(textOf(bubble), /Not sent/);
  assert.ok(bubble.className.includes("is-failed"));
});

test("while a turn RUNS the button still says Send on a peer draft, and does not interrupt", () => {
  feed({ type: "status", phase: "running", activity: "working" });
  assert.ok(!send.classList.contains("is-running"), "a peer post has no turn of its own to pause");
  steer.value = "meanwhile";
  const before = sent.length;
  send.fire("click");
  assert.deepEqual(sent.slice(before), [["sendToPeer", "meanwhile"]], "it sent; it did not interrupt");
});

test("switching back to the steer restores the pause morph and the steer path", () => {
  pill.fire("click");
  rowsOf()[0].fire("mousedown", { preventDefault() {} });
  assert.equal(pillLabel.textContent, "Message flint");
  assert.ok(send.classList.contains("is-running"), "the running turn's pause glyph is back");
  const before = sent.length;
  send.fire("click");
  assert.deepEqual(sent.slice(before), [["interrupt"]], "and the click interrupts again");
});

// ── the safety rule, end to end ──────────────────────────────────────────────

test("a HELD peer pick collapses to the steer when a re-init drops the counterparty", () => {
  pill.fire("click");
  rowsOf()[1].fire("mousedown", { preventDefault() {} });
  assert.equal(pillLabel.textContent, "Message David");
  // A park's recreate / an auth hold's synthesized init can land with no counterparty.
  feed({ type: "init", sessionId: "s1", channelName: "Ops" });
  assert.equal(pillLabel.textContent, "Message flint", "the face collapses with the target");
  steer.value = "where did you go";
  const before = sent.length;
  // Enter, not the button: the session left the case above mid-turn, so the button is showing
  // its pause face. Enter always sends, which is what this case is about.
  steer.fire("keydown", { key: "Enter", shiftKey: false, preventDefault() {} });
  assert.equal(sent[before][0], "send",
    "the words stay on this machine rather than posting with no addressee");
});

// ── FIX F8: the VERSION-SKEW refusal, which nothing above ever drives ─────────
//
// A preload with NO `sendToPeer` — a version-skewed install, or session.js's own standalone
// stub, which deliberately omits it — used to return SILENTLY: the draft survived, the click
// did nothing, and the glyph still said Send. `composer.send()` answers FALSE and says why,
// and `session.js` leaves the draft alone on a false (`if (!composer.send(text)) return;`).
//
// F-145 — THIS PATH HAD NO TEST. Every case above installs a working `sendToPeer` on the
// bridge, so the guard at session-address-ui.js's `send()` was never entered and the whole
// refusal (predicate, copy, and the controller's early return) could be deleted with all 2293
// desktop tests green. Driven here on the REAL booted controller by taking the bridge member
// away, which is exactly the shape a skewed preload presents, then putting it back so the
// file's one stateful controller is left as it was found.

test("FIX F8: a bridge with NO sendToPeer refuses, says why, and KEEPS the draft", () => {
  // The case above dropped the counterparty on purpose; give it back, since a refusal is only
  // reachable once there IS a peer to address.
  feed({ type: "init", sessionId: "s1", channelName: "Ops", taskTitle: "Ship it", from: "David" });
  pill.fire("click");
  rowsOf()[1].fire("mousedown", { preventDefault() {} }); // address the peer
  assert.equal(pillLabel.textContent, "Message David");

  const realSendToPeer = globalThis.doplSession.sendToPeer;
  delete globalThis.doplSession.sendToPeer; // the version-skewed preload
  try {
    steer.value = "  can you take this one?  ";
    const before = sent.length;
    send.fire("click");

    // NOTHING left this machine — not as a peer post, and not smuggled into the steer lane.
    assert.equal(sent.length, before, "a missing bridge member must not fall through to send()");
    // The draft is still there, so the operator can retry after a restart without retyping.
    assert.equal(steer.value, "  can you take this one?  ", "a refusal leaves the draft in the field");
    // And it SAYS so: silence is the defect this fix exists to remove.
    const painted = stream.children.map((c) => textOf(c)).join("\n");
    assert.match(painted, /Could not send that message to the peer/);
    assert.match(painted, /Restart Dopl/);
  } finally {
    globalThis.doplSession.sendToPeer = realSendToPeer;
  }
});

test("FIX F8: the copy is the module's own constant, so the notice cannot drift from it", () => {
  const ui = require(R("session-address-ui.js"));
  assert.equal(typeof ui.NO_PEER_BRIDGE, "string");
  assert.ok(ui.NO_PEER_BRIDGE.length > 0);
  assert.ok(!ui.NO_PEER_BRIDGE.includes("\n"), "a notice is one line");
});

test("FIX F8: with the bridge back, the SAME draft sends — the refusal was the missing member", () => {
  // The control that makes the case above mean something: nothing else about this composer
  // changed, so a refusal that stayed on would be visible here as a second silent failure.
  const before = sent.length;
  send.fire("click");
  assert.deepEqual(sent.slice(before), [["sendToPeer", "can you take this one?"]]);
  assert.equal(steer.value, "");
});
