// BOOT test: load renderer/session/session.js (the imperative controller) against a
// stub DOM and drive the v1.7.5 chrome paths end to end — D1 header identity + window
// title, D2 (no badge row is built), D5 send/pause morph + click routing, D7 composer
// auto-grow. Until now session.js itself was only checked structurally; this exercises
// the real wiring, so a broken element id or a mis-routed click fails here.
//
// The stub models only what the controller touches (getElementById, classList,
// textContent/value, style, addEventListener + a fire() helper, getComputedStyle). No
// jsdom, same discipline as session-render-dom.test.mjs — which also installs a
// globalThis.document, and which node --test isolates in its own process.
//
// The tests run in FILE ORDER against ONE booted controller (a renderer is inherently
// stateful: `state` accumulates across events, exactly as it does in the window).

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
// A 14px body at line-height 1.5 == 21px per line, 6px padding top + bottom.
globalThis.getComputedStyle = () => ({ lineHeight: "21px", paddingTop: "6px", paddingBottom: "6px" });

// The preload bridge, recording every privileged call the controller makes.
const sent = [];
globalThis.doplSession = {
  sessionId: "s1",
  onEvent() {},
  send: (...a) => sent.push(["send", ...a]),
  permission() {}, releaseInbound() {},
  interrupt: () => sent.push(["interrupt"]),
  end() {}, closeTask() {}, consentDecision() {}, setAutoApprove() {},
  folder: {
    get: () => Promise.resolve({ label: "~/Downloads" }),
    choose: () => Promise.resolve({ label: null }),
    clear: () => Promise.resolve({ label: null }),
  },
};

globalThis.DoplSessionVM = require(R("session-viewmodel.js"));
globalThis.DoplSessionChrome = require(R("session-chrome.js"));
globalThis.DoplSessionRender = require(R("session-render.js"));
new Function(readFileSync(R("session.js"), "utf8"))(); // boot the controller

const feed = globalThis.__sessionFeed; // the controller's mock-event hook
const send = $("btnSend");
const steer = $("steerInput");

// ── D1: the header + native title follow ONE identity priority ────────────────

test("boot: an init with a task title paints title / subtitle / avatar / window title", () => {
  feed({
    type: "init", sessionId: "s1", side: "responder", profile: "full", mode: "autonomous",
    channelName: "Ops", taskTitle: "Ship the invoice import", from: "David",
  });
  assert.equal($("channelName").textContent, "Ship the invoice import", "the TASK names the header");
  assert.equal($("taskTitle").textContent, "David", "the peer drops to the caption line");
  assert.equal($("peerAvatar").textContent, "D", "initials come from the peer");
  assert.equal(document.title, "Dopl · Ship the invoice import");
});

test("boot: the fallback chain is peer -> channel -> 'Session', and the avatar always paints", () => {
  feed({ type: "init", channelName: "Ops", from: "David" });
  assert.equal($("channelName").textContent, "David");
  assert.equal($("taskTitle").textContent, "", "no task title -> no caption echo");
  assert.equal($("peerAvatar").textContent, "D");

  feed({ type: "init", channelName: "Ops" });
  assert.equal($("channelName").textContent, "Ops");
  assert.equal($("peerAvatar").textContent, "O", "no peer -> initials from the title");

  feed({ type: "init" });
  assert.equal($("channelName").textContent, "Session");
  assert.equal($("peerAvatar").textContent, "S", "never an empty (or black) avatar");
  assert.equal(document.title, "Dopl · Session");
});

test("boot: a peer photo replaces the initials with a bounded data: <img>", () => {
  const PEER = "data:image/png;base64,BBB";
  feed({ type: "init", from: "David", fromAvatar: PEER });
  const avatar = $("peerAvatar");
  assert.ok(avatar.classList.contains("has-img"), "the token drops its border for the photo");
  const img = avatar.children[0].children.find((c) => c.tagName === "IMG");
  assert.equal(img.getAttribute("src"), PEER);
});

test("boot: D2 — no badge chips are built for side / profile / mode", () => {
  // The fields are on the state (init above carried them); the header just ignores them.
  assert.equal(byId.has("badgeRow"), false, "the controller never even looks up #badgeRow");
});

// ── D5: one button, two behaviors ─────────────────────────────────────────────

test("boot: an idle click sends the trimmed steer with NO priority argument", () => {
  feed({ type: "init", from: "David" });
  steer.value = "  go on  ";
  send.fire("click");
  assert.deepEqual(sent.at(-1), ["send", "go on"], "priority plumb dropped from the renderer");
  assert.equal(steer.value, "", "the field is cleared");
  assert.equal(steer.style.height, "33px", "D7: back to ONE line after send");
});

test("boot: a running turn morphs the button to pause and the click INTERRUPTS", () => {
  feed({ type: "status", phase: "running", activity: "working" });
  assert.ok(send.classList.contains("is-running"), "the pause glyph is shown");
  assert.equal(send.getAttribute("aria-label"), "Pause the agent");

  steer.value = "queued";
  send.fire("click");
  assert.deepEqual(sent.at(-1), ["interrupt"], "the existing session:interrupt IPC");
  assert.equal(steer.value, "queued", "a pause click never eats the draft");
});

test("boot: Enter still SENDS while running (the steer queues in main)", () => {
  let prevented = false;
  steer.fire("keydown", { key: "Enter", shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.ok(prevented, "the newline is suppressed");
  assert.deepEqual(sent.at(-1), ["send", "queued"]);
});

test("boot: Shift+Enter does NOT send (it is a newline)", () => {
  const before = sent.length;
  steer.value = "line one";
  steer.fire("keydown", { key: "Enter", shiftKey: true, preventDefault() {} });
  assert.equal(sent.length, before, "nothing crossed the bridge");
});

test("boot: leaving 'working' restores the Send affordance", () => {
  feed({ type: "status", phase: "running", activity: "idle" });
  assert.ok(!send.classList.contains("is-running"));
  assert.equal(send.getAttribute("aria-label"), "Send");
});

// ── D7: the field grows to 3 lines, then stops ────────────────────────────────

test("boot: auto-grow tracks the content and caps at 3 line-heights", () => {
  steer.scrollHeight = 54; // two lines
  steer.fire("input");
  assert.equal(steer.style.height, "54px");

  steer.scrollHeight = 600; // a long paste
  steer.fire("input");
  assert.equal(steer.style.height, "75px", "3 * 21 + 12 — then the field scrolls");

  steer.scrollHeight = 33; // deleted back down
  steer.fire("input");
  assert.equal(steer.style.height, "33px", "it shrinks back to one line");
});

// ── chat lanes: the booted controller stamps them on the real stream ──────────
// The two turns already in the stream came from the composer (the D5 tests above),
// so they prove the OPERATOR path end to end: composer -> reduceEvent -> lane-me.

test("boot: the composer's own turns land in the stream right-aligned (lane-me)", () => {
  const kids = $("stream").children;
  assert.equal(kids.length, 2, "the two steers sent above are the only stream items so far");
  for (const node of kids) {
    assert.ok(node.classList.contains("lane-me"), "a typed steer is right-aligned");
    assert.ok(!node.classList.contains("lane-them"));
  }
});

test("boot: agent text + the peer reply go LEFT; tool / outbound / pending / notice get NO lane", () => {
  feed({ type: "turn", role: "assistant", text: "on it", streaming: false });
  feed({ type: "counterparty", from: "David", text: "thanks" });
  feed({ type: "tool_use", toolUseId: "t1", name: "Bash", inputFull: { command: "ls" } });
  feed({ type: "outbound_post", toolUseId: "t2", to: "David", text: "sent" });
  feed({ type: "inbound_pending", pendingId: "p1", from: "David", text: "wait" });
  feed({ type: "paused" }); // the v2.3 park notice

  const lanes = $("stream").children.map((n) => (
    n.classList.contains("lane-me") ? "me" : n.classList.contains("lane-them") ? "them" : null
  ));
  assert.deepEqual(lanes, ["me", "me", "them", "them", null, null, null, null]);
  // The park notice still renders as the calm info line (v2.3 rendering intact).
  const notice = $("stream").children.at(-1);
  assert.ok(notice.classList.contains("notice") && notice.classList.contains("level-info"));
  assert.match(notice.textContent, /^Paused after inactivity\./);
});

test("boot: the permission dock is chrome, not a lane — it never takes an alignment class", () => {
  feed({ type: "permission_request", requestId: "r1", name: "Bash", inputSummary: "$ ls", inputFull: {} });
  const dock = $("permissionDock");
  assert.ok(dock.classList.contains("is-active"), "the dock surfaced the gate");
  assert.ok(!dock.classList.contains("lane-me") && !dock.classList.contains("lane-them"));
  feed({ type: "permission_resolved", requestId: "r1", decision: "allow-once" });
  assert.ok(!dock.classList.contains("is-active"));
});

// ── the ended session still locks the composer ────────────────────────────────

test("boot: an ended session refuses to send", () => {
  feed({ type: "ended", outcome: "completed", summary: "done" });
  const before = sent.length;
  steer.value = "too late";
  send.fire("click");
  assert.equal(sent.length, before, "no steer crosses the bridge after the end");
});
