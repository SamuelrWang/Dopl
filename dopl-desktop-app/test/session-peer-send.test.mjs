// BOOT test for the v2.8 SEND path: one composer, two addressees, driven through the real
// controller (the session-boot-dom.test.mjs idiom, with the mention modules registered).
//
// What is pinned here is the thing a regex cannot see: WHICH bridge method a draft reaches,
// what the delivered bytes are, and what the stream shows afterwards. A peer-addressed draft
// must reach `sendToPeer` and NOTHING else — never session:send, never a local turn item,
// never an outbound card — and the resulting peer_message bubble must report its own outcome.

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
const send = $("btnSend");
const stream = $("stream");

const type = (value) => { steer.value = value; steer.fire("input"); };
const clickSend = () => send.fire("click");
const bubbles = () => stream.children.filter((n) => n.classList.contains("role-peer-msg"));
const partsOf = (node) => {
  const head = node.children.find((c) => c.className === "cp-head");
  return {
    avatar: head.children[0],
    who: head.children.find((c) => c.className === "who"),
    body: node.children.find((c) => c.className === "body"),
    status: node.children.find((c) => c.className === "peer-msg__status"),
  };
};

feed({ type: "init", sessionId: "s1", side: "requester", channelName: "Ops", from: "David" });

// ── the routing decision ──────────────────────────────────────────────────────

test("a PEER-tagged draft reaches sendToPeer with the tag stripped, and nothing else", () => {
  const before = sent.length;
  const items = stream.children.length;
  type("@their-agent ship it");
  clickSend();
  assert.deepEqual(sent.slice(before), [["sendToPeer", "ship it"]], "exactly ONE bridge call");
  assert.equal(steer.value, "", "the field is cleared like any send");
  assert.equal(stream.children.length, items, "and NO local turn item was appended");
});

test("the DERIVED slug routes identically to the permanent alias", () => {
  const before = sent.length;
  type("@david-agent ship it too");
  clickSend();
  assert.deepEqual(sent.slice(before), [["sendToPeer", "ship it too"]]);
});

test("@my-agent is byte-identical to no tag at all (L2)", () => {
  type("@my-agent do X");
  clickSend();
  const tagged = sent.at(-1);
  type("do X");
  clickSend();
  assert.deepEqual(tagged, ["send", "do X"]);
  assert.deepEqual(sent.at(-1), tagged, "the same bytes on the same channel");
  const turns = stream.children.filter((n) => n.classList.contains("role-operator"));
  assert.equal(turns.length, 2, "both painted a local operator turn (a steer, not a post)");
});

test("L3: a BARE tag sends nothing at all", () => {
  const before = sent.length;
  for (const draft of ["@their-agent", "@their-agent   ", "@my-agent"]) {
    type(draft);
    clickSend();
    assert.equal(sent.length, before, `${draft} has no message in it`);
    assert.equal(steer.value, draft, "and the draft is left alone, not silently eaten");
  }
  type("");
});

test("L4: an unrecognized tag is a normal steer, @ and all", () => {
  const before = sent.length;
  type("@nobody-agent hello");
  clickSend();
  assert.deepEqual(sent.slice(before), [["send", "@nobody-agent hello"]]);
});

// ── the send/pause morph override ─────────────────────────────────────────────

test("a peer-tagged draft forces the SEND glyph while my agent is mid-turn", () => {
  feed({ type: "status", phase: "running", activity: "working" });
  assert.ok(send.classList.contains("is-running"), "the pause glyph, as always");
  type("@their-agent while it works");
  assert.ok(!send.classList.contains("is-running"), "a peer-addressed draft is not pausable");
  assert.equal(send.getAttribute("aria-label"), "Send");
});

test("...and the click SENDS instead of interrupting", () => {
  const before = sent.length;
  clickSend();
  assert.deepEqual(sent.slice(before), [["sendToPeer", "while it works"]], "never bridge.interrupt()");
});

test("clearing the tag hands the pause affordance straight back", () => {
  type("steer it instead");
  assert.ok(send.classList.contains("is-running"));
  assert.equal(send.getAttribute("aria-label"), "Pause the agent");
  clickSend();
  assert.deepEqual(sent.at(-1), ["interrupt"], "the pause click is untouched by v2.8");
  assert.equal(steer.value, "steer it instead", "a pause click never eats the draft");
  type("");
  feed({ type: "status", phase: "running", activity: "idle" });
});

// ── the peer_message bubble ───────────────────────────────────────────────────

test("operator_post paints MY OWN bubble, right-laned, addressed and Sending", () => {
  feed({ type: "operator_post", localId: "L1", to: "David", text: "ship it" });
  const node = bubbles().at(-1);
  assert.ok(node.classList.contains("bubble") && node.classList.contains("role-peer-msg"));
  assert.ok(node.classList.contains("lane-me"), "it is this machine's output");
  assert.ok(!node.classList.contains("lane-them"));
  const p = partsOf(node);
  assert.equal(p.who.textContent, "You to David's agent");
  assert.equal(p.body.textContent, "ship it");
  assert.equal(p.status.textContent, "Sending");
  assert.equal(p.avatar.className, "cp-avatar", "the SELF avatar (initials until a photo lands)");
  assert.equal(p.avatar.textContent, "Y");
  assert.ok(!node.classList.contains("is-failed"));
});

test("operator_post_result{ok:true} resolves that bubble IN PLACE to Sent", () => {
  const node = bubbles().at(-1);
  feed({ type: "operator_post_result", localId: "L1", ok: true });
  assert.equal(bubbles().at(-1), node, "the same node — renderStream only calls update()");
  assert.equal(partsOf(node).status.textContent, "Sent");
  assert.ok(!node.classList.contains("is-failed"));
});

test("a FAILED post says 'Not sent' and marks the bubble (fail closed)", () => {
  feed({ type: "operator_post", localId: "L2", to: "David", text: "this one fails" });
  const node = bubbles().at(-1);
  feed({ type: "operator_post_result", localId: "L2", ok: false });
  assert.equal(partsOf(node).status.textContent, "Not sent");
  assert.ok(node.classList.contains("is-failed"));
});

test("an unknown ok verdict never claims delivery either", () => {
  feed({ type: "operator_post", localId: "L3", to: "David", text: "garbled verdict" });
  const node = bubbles().at(-1);
  feed({ type: "operator_post_result", localId: "L3" });
  assert.equal(partsOf(node).status.textContent, "Not sent");
});

test("a post with no peer NAME still reads correctly (no dangling possessive)", () => {
  feed({ type: "operator_post", localId: "L4", to: null, text: "to the channel" });
  assert.equal(partsOf(bubbles().at(-1)).who.textContent, "You to their agent");
});

test("a late `avatars` event repaints an existing peer_message bubble", () => {
  const SELF = "data:image/png;base64,AAA";
  const node = bubbles().at(-1);
  feed({ type: "avatars", self: SELF, from: null });
  const av = partsOf(node).avatar;
  assert.equal(av.className, "av");
  assert.equal(av.children[0].getAttribute("src"), SELF, "a data: URI only, per the render rule");
});

test("the peer post never becomes a turn, an outbound card, or a permission", () => {
  const kinds = stream.children.map((n) => n.className);
  assert.equal(kinds.filter((c) => c.includes("outbound")).length, 0, "no outbound artifact exists");
  assert.ok(!$("permissionDock").classList.contains("is-active"), "no permission was ever requested");
  for (const node of bubbles()) {
    assert.ok(!node.classList.contains("role-operator"), "a post is not a steer");
    assert.ok(!node.classList.contains("role-agent"));
  }
});

test("the status pill is untouched by a peer post (it describes MY agent)", () => {
  const label = $("statusLabel").textContent;
  feed({ type: "operator_post", localId: "L5", to: "David", text: "another" });
  assert.equal($("statusLabel").textContent, label);
  feed({ type: "operator_post_result", localId: "L5", ok: true });
  assert.equal($("statusLabel").textContent, label);
});

// ── FIX F8: a version-skewed preload with no sendToPeer ───────────────────────
// The renderer checks `typeof bridge.sendToPeer` at SEND time, so deleting the method models
// an install whose preload predates @-addressing while the window already offers it.

test("FIX F8: no sendToPeer bridge -> a NOTICE in the stream, and the draft is kept", () => {
  const real = globalThis.doplSession.sendToPeer;
  delete globalThis.doplSession.sendToPeer;
  try {
    const before = sent.length;
    const bubblesBefore = bubbles().length;
    type("@their-agent version skew");
    clickSend();
    assert.equal(sent.length, before, "nothing crossed the bridge");
    assert.equal(bubbles().length, bubblesBefore, "and no peer_message bubble claims a send");
    assert.equal(steer.value, "@their-agent version skew", "the draft is the operator's, not ours to eat");
    const notice = stream.children.filter((n) => n.className.startsWith("notice")).at(-1);
    assert.ok(notice, "the failure is SAID, not swallowed");
    assert.equal(notice.className, "notice level-error");
    assert.match(notice.textContent, /Could not send that message to the peer\./);
    assert.match(notice.textContent, /Restart Dopl/, "and it says what to do about it");
    assert.ok(!notice.textContent.includes("—"), "no em dash in the copy");
  } finally {
    globalThis.doplSession.sendToPeer = real;
  }
});

test("FIX F8: with the bridge back, the SAME draft sends normally", () => {
  const before = sent.length;
  clickSend();
  assert.deepEqual(sent.slice(before), [["sendToPeer", "version skew"]], "no state was corrupted by the notice");
  assert.equal(steer.value, "");
});

// ── the ended session ─────────────────────────────────────────────────────────

test("an ENDED session refuses a peer-addressed send too", () => {
  feed({ type: "ended", outcome: "completed", summary: "done" });
  const before = sent.length;
  type("@their-agent too late");
  clickSend();
  assert.equal(sent.length, before, "nothing crosses the bridge after the end");
  assert.equal(steer.value, "@their-agent too late", "the draft is left in the field");
});
