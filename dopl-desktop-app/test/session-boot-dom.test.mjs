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
  // No `inboundDecision` yet ON PURPOSE: it models an OLDER preload, which is the case
  // FIX F10 is about (the tests below add it, then assert the stamp waits for it).
  permission: (...a) => sent.push(["permission", ...a]),
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
  // v3.1: `init` alone no longer reads as idle. With the header Stop button deleted, the pause
  // morph had to widen to cover the FIRST turn (which emits no status until it ends), so an
  // idle click is one taken after main says the agent is resting.
  feed({ type: "status", phase: "running", activity: "idle" });
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

// RE-PINNED for v2.7 L1: my agent's text and its tool cards join the operator's turns on
// the RIGHT; only the peer's delivered reply is on the left; decisions stay full width.
test("boot: my agent's text + tools go RIGHT, the peer goes LEFT, decisions get NO lane", () => {
  feed({ type: "turn", role: "assistant", text: "on it", streaming: false });
  feed({ type: "counterparty", from: "David", text: "thanks" });
  feed({ type: "tool_use", toolUseId: "t1", name: "Bash", inputFull: { command: "ls" } });
  feed({ type: "outbound_post", toolUseId: "t2", to: "David", text: "sent" });
  feed({ type: "inbound_pending", pendingId: "p1", from: "David", text: "wait" });
  feed({ type: "paused" }); // the v2.3 park notice

  const lanes = $("stream").children.map((n) => (
    n.classList.contains("lane-me") ? "me" : n.classList.contains("lane-them") ? "them" : null
  ));
  assert.deepEqual(lanes, ["me", "me", "me", "them", "me", null, null, null]);
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

// ── FIX F3: a DENIED post stops claiming it was sent ──────────────────────────
// The outbound bubble is painted while the tool_use streams, i.e. BEFORE any decision lands,
// so a Deny (or a failure) must correct it.

const outbounds = () => $("stream").children.filter((n) => n.classList.contains("outbound"));
const bannerLabel = (node) => {
  const banner = node.children.find((c) => c.classList.contains("outbound__banner"));
  return banner.children.find((c) => c.className.includes("outbound__label"));
};

// RE-PINNED for v2.7 FIX F9: this test used to assert that a DOCK Deny flipped the bubble
// (markOutboundNotSent). That call is deleted, and the case it served cannot happen any more:
// an own-channel post never reaches the dock (main sends `outbound_gate` and the card decides
// itself), and the one post the dock still shows — a CROSS-channel one — is not classified as
// an outbound_post, so it has no bubble in the lane at all. What is pinned now is that a dock
// click leaves the outbound lane untouched, and that the tool_result belt still corrects it.
test("boot: FIX F9 — a DOCK deny leaves the outbound lane alone; the tool_result belt corrects it", () => {
  feed({ type: "outbound_post", toolUseId: "t9", to: "David", addressed: true, text: "the draft" });
  const node = outbounds().at(-1);
  assert.equal(bannerLabel(node).textContent, "Sent to David", "optimistic while streaming");
  feed({
    type: "permission_request", requestId: "r9", toolUseId: "t9", ownChannel: false,
    name: "mcp__dopl__dopl_channel", inputSummary: "dopl_channel · post", inputFull: { op: "post", body: "the draft" },
  });
  $("btnDeny").fire("click");
  assert.deepEqual(sent.at(-1), ["permission", "r9", "deny"], "the deny still crosses the bridge");
  assert.ok(!node.classList.contains("is-not-sent"), "the dock does not reach into the lane");
  feed({ type: "tool_result", toolUseId: "t9", ok: false, resultSummary: "Denied by operator" });
  assert.equal(bannerLabel(node).textContent, "Not sent", "the record stops claiming delivery");
  assert.ok(node.classList.contains("is-not-sent"));
});

test("boot: FIX F3 — main's failing tool_result corrects the bubble too (no click needed)", () => {
  feed({ type: "outbound_post", toolUseId: "t10", to: "David", text: "second draft" });
  const node = outbounds().at(-1);
  feed({ type: "tool_result", toolUseId: "t10", ok: false, resultSummary: "Denied by operator" });
  assert.equal(bannerLabel(node).textContent, "Not sent");
  assert.ok(node.classList.contains("is-not-sent"));
});

test("boot: FIX F3 — an ALLOWED post keeps reading 'Sent to David'", () => {
  feed({ type: "outbound_post", toolUseId: "t11", to: "David", addressed: true, text: "third draft" });
  const node = outbounds().at(-1);
  feed({ type: "tool_result", toolUseId: "t11", ok: true, resultSummary: "posted" });
  assert.equal(bannerLabel(node).textContent, "Sent to David");
  assert.ok(!node.classList.contains("is-not-sent"));
});

// ── v2.7 L3: the outbound decision card, driven through the REAL controller ────
// Traps (c) and (d) end to end: the card answers with its OWN requestId (never the dock's
// queue head), a request queued behind it still owns the dock, and the decision resolves
// the card IN PLACE — renderStream creates a node once per index and only calls update().

const cardParts = (node) => ({
  row: node.children.find((c) => c.classList.contains("row")),
  dest: node.children.find((c) => c.classList.contains("outbound-pending__to")),
});

test("boot L3: a gating post paints ONE inline card, and the dock stays closed", () => {
  const before = $("stream").children.length;
  feed({ type: "outbound_post", toolUseId: "t20", to: "David", addressed: true, text: "the gated draft", pending: true, ownChannel: true });
  assert.equal($("stream").children.length, before + 1, "exactly one artifact for the post");
  const node = outbounds().at(-1);
  assert.ok(node.classList.contains("outbound-pending"));
  assert.equal(bannerLabel(node).textContent, "Sending to David", "it does not claim delivery yet");
  assert.equal(cardParts(node).dest.textContent, "To: David", "an ADDRESSED own-channel post names the recipient the CALL named");
  assert.ok(!$("permissionDock").classList.contains("is-active"), "a post never uses the dock");
  // Not answerable until main mints the requestId (fail closed).
  assert.deepEqual(cardParts(node).row.children.map((b) => b.disabled), [true, true, true]);
  feed({ type: "outbound_gate", requestId: "r20", toolUseId: "t20" });
  assert.deepEqual(cardParts(node).row.children.map((b) => b.disabled), [false, false, false]);
});

test("boot L3 (c): a Bash request queued BEHIND the post owns the dock", () => {
  feed({ type: "permission_request", requestId: "r21", name: "Bash", inputSummary: "$ ls", inputFull: { command: "ls" } });
  assert.ok($("permissionDock").classList.contains("is-active"), "the dock is not left blank");
  assert.equal($("permTool").textContent, "Bash", "it shows the NON-post request");
  assert.ok($("permQueueNote").classList.contains("hidden"), "and the post is not counted as waiting");
});

test("boot L3 (c)/(d): Send decides by the CARD's requestId and resolves it in place", async () => {
  const node = outbounds().find((n) => n.classList.contains("outbound-pending"));
  cardParts(node).row.children[0].fire("click"); // Send
  assert.deepEqual(sent.at(-1), ["permission", "r20", "allow-once"], "the card's OWN requestId");
  await new Promise((r) => setTimeout(r, 0)); // the stamp waits for main, like the inbound gate
  assert.ok(!node.classList.contains("outbound-pending"), "the pending accent is dropped");
  assert.equal(bannerLabel(node).textContent, "Sent to David", "the SAME node is now the delivered record");
  assert.ok(cardParts(node).row.classList.contains("hidden"), "no decision affordance left");
  assert.equal(node.children.find((c) => c.classList.contains("outbound__body")).textContent, "the gated draft");
  // The Bash request behind it is untouched and still dockable.
  assert.equal($("permTool").textContent, "Bash");
  $("btnAllowOnce").fire("click");
  assert.deepEqual(sent.at(-1), ["permission", "r21", "allow-once"]);
  assert.ok(!$("permissionDock").classList.contains("is-active"));
});

test("boot L3: Deny resolves a card to 'Not sent'; a PARK's deny echo does the same", async () => {
  feed({ type: "outbound_post", toolUseId: "t22", to: "David", addressed: true, text: "denied draft", pending: true, ownChannel: true });
  feed({ type: "outbound_gate", requestId: "r22", toolUseId: "t22" });
  const denied = outbounds().at(-1);
  cardParts(denied).row.children[2].fire("click"); // Deny
  assert.deepEqual(sent.at(-1), ["permission", "r22", "deny"]);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(bannerLabel(denied).textContent, "Not sent");
  assert.ok(denied.classList.contains("is-not-sent"));

  // A PARK deny-closes every awaited request and echoes permission_resolved{deny}. Before
  // v2.7 a parked pending post's record read "Sent to peer" forever.
  feed({ type: "outbound_post", toolUseId: "t23", to: "David", addressed: true, text: "parked draft", pending: true, ownChannel: true });
  feed({ type: "outbound_gate", requestId: "r23", toolUseId: "t23" });
  const stale = outbounds().at(-1);
  assert.equal(bannerLabel(stale).textContent, "Sending to David");
  feed({ type: "permission_resolved", requestId: "r23", decision: "deny" }); // what parkEffects emits
  assert.equal(bannerLabel(stale).textContent, "Not sent", "a stale card fails closed");
  assert.ok(cardParts(stale).row.classList.contains("hidden"));
});

// ── FIX F1: a Send that RACED a park must never stamp the post 'sent' ─────────
// main/session-ipc used to answer {ok:true} for any live session, even when the park's
// denyPending had already fail-closed this requestId — and the park's own
// permission_resolved{deny} echo cannot undo the stamp (markOutboundDecided only touches a
// card still 'pending'). The IPC now reports whether a LIVE resolver really took it, so the
// controller's res.ok===false path is what keeps this card honest.

test("boot F1: an {ok:false} decision leaves the card answerable, then the deny echo resolves it", async () => {
  const real = globalThis.doplSession.permission;
  globalThis.doplSession.permission = (...a) => { sent.push(["permission", ...a]); return Promise.resolve({ ok: false }); };
  feed({ type: "outbound_post", toolUseId: "t24", to: "David", addressed: true, text: "raced draft", pending: true, ownChannel: true });
  feed({ type: "outbound_gate", requestId: "r24", toolUseId: "t24", text: "raced draft", to: "David", addressed: true });
  const raced = outbounds().at(-1);
  cardParts(raced).row.children[0].fire("click"); // Send
  // FIX F7: the click disabled all three buttons before the invoke resolved.
  assert.deepEqual(cardParts(raced).row.children.map((b) => b.disabled), [true, true, true], "no double-click window");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(bannerLabel(raced).textContent, "Sending to David", "NEVER stamped 'Sent'");
  assert.ok(raced.classList.contains("outbound-pending"), "still the decision card");
  assert.deepEqual(cardParts(raced).row.children.map((b) => b.disabled), [false, false, false], "and answerable again");
  // The park's echo is what settles it, fail closed.
  feed({ type: "permission_resolved", requestId: "r24", decision: "deny" });
  assert.equal(bannerLabel(raced).textContent, "Not sent");
  globalThis.doplSession.permission = real;
});

test("boot F7: a rejected invoke also hands the buttons back", async () => {
  const real = globalThis.doplSession.permission;
  globalThis.doplSession.permission = () => Promise.reject(new Error("bridge gone"));
  feed({ type: "outbound_post", toolUseId: "t25", to: "David", addressed: true, text: "thrown draft", pending: true, ownChannel: true });
  feed({ type: "outbound_gate", requestId: "r25", toolUseId: "t25", text: "thrown draft", to: "David", addressed: true });
  const node = outbounds().at(-1);
  cardParts(node).row.children[2].fire("click"); // Deny
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(cardParts(node).row.children.map((b) => b.disabled), [false, false, false]);
  assert.equal(bannerLabel(node).textContent, "Sending to David", "a throw claims nothing either");
  globalThis.doplSession.permission = real;
});

// ── FIX F3: a pending post with NO requestId hides the row instead of showing dead buttons ──
// The gate PREDICTION said this post would stop, then canUseTool auto-allowed it (the
// operator flipped auto-approve on mid-turn), so no `outbound_gate` ever arrives. The card
// used to sit there with three disabled buttons until the tool_result self-healed it.

test("boot F3: an unanswerable pending card shows NO button row (and the result heals it)", () => {
  feed({ type: "outbound_post", toolUseId: "t26", to: "David", addressed: true, text: "auto-allowed draft", pending: true, ownChannel: true });
  const node = outbounds().at(-1);
  const row = cardParts(node).row;
  assert.ok(row.classList.contains("hidden"), "no dead controls while main is not awaiting");
  assert.ok(node.classList.contains("outbound-pending"), "it is still visibly a draft, not a delivery");
  assert.equal(cardParts(node).dest.textContent, "To: David", "the destination line still reads");
  // The requestId arriving makes it answerable and the row appears.
  feed({ type: "outbound_gate", requestId: "r26", toolUseId: "t26", text: "auto-allowed draft", to: "David", addressed: true });
  assert.ok(!cardParts(node).row.classList.contains("hidden"));
  // And with no gate at all, the tool_result self-heal is what resolves it.
  feed({ type: "outbound_post", toolUseId: "t27", to: "David", addressed: true, text: "healed draft", pending: true, ownChannel: true });
  const healed = outbounds().at(-1);
  assert.ok(cardParts(healed).row.classList.contains("hidden"));
  feed({ type: "tool_result", toolUseId: "t27", ok: true, resultSummary: "posted" });
  assert.equal(bannerLabel(healed).textContent, "Sent to David");
  assert.ok(cardParts(healed).row.classList.contains("hidden"), "and it stays hidden once delivered");
});

// ── FIX F10: the gate card locks only once main has taken the decision ────────
// Stamping first (and disabling all three buttons) locked the card even when the call
// never reached main — an older preload with no `inboundDecision` left the operator with
// a dead card for a message main was still holding.

const gateCards = () => $("stream").children.filter((n) => n.classList.contains("inbound-pending"));
const gateParts = (card) => ({
  buttons: card.children.find((c) => c.className === "row").children,
  note: card.children.find((c) => c.className && c.className.includes("inbound-pending__note")),
});

test("boot: FIX F10 — an OLDER preload (no inboundDecision) leaves the card LIVE", () => {
  feed({ type: "inbound_pending", pendingId: "p2", from: "David", text: "ping" });
  const { buttons, note } = gateParts(gateCards().at(-1));
  buttons[0].fire("click"); // Accept
  assert.deepEqual(buttons.map((b) => b.disabled), [false, false, false], "nothing was locked");
  assert.ok(note.classList.contains("hidden"), "and no outcome was claimed");
});

test("boot: FIX F10 — the card locks only AFTER the invoke resolves", async () => {
  let settle = null;
  globalThis.doplSession.inboundDecision = (...a) => {
    sent.push(["inbound", ...a]);
    return new Promise((resolve) => { settle = resolve; });
  };
  feed({ type: "inbound_pending", pendingId: "p3", from: "David", text: "ping" });
  const { buttons, note } = gateParts(gateCards().at(-1));
  buttons[2].fire("click"); // Decline
  assert.deepEqual(sent.at(-1), ["inbound", "p3", "decline"]);
  assert.deepEqual(buttons.map((b) => b.disabled), [false, false, false], "still live while main decides");
  settle({ ok: true });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(buttons.map((b) => b.disabled), [true, true, true], "locked once main took it");
  assert.equal(note.textContent, "Declined");
});

test("boot: FIX F10 — an {ok:false} (or a rejected invoke) keeps the card answerable", async () => {
  globalThis.doplSession.inboundDecision = () => Promise.resolve({ ok: false });
  feed({ type: "inbound_pending", pendingId: "p4", from: "David", text: "ping" });
  const first = gateParts(gateCards().at(-1));
  first.buttons[0].fire("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(first.buttons.map((b) => b.disabled), [false, false, false], "main never heard it");

  globalThis.doplSession.inboundDecision = () => Promise.reject(new Error("bridge gone"));
  feed({ type: "inbound_pending", pendingId: "p5", from: "David", text: "ping" });
  const second = gateParts(gateCards().at(-1));
  second.buttons[0].fire("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(second.buttons.map((b) => b.disabled), [false, false, false], "a throw never locks it either");
});

test("boot: FIX F10 — main's own inbound_resolved echo still stamps the card", async () => {
  globalThis.doplSession.inboundDecision = () => Promise.resolve({ ok: true });
  feed({ type: "inbound_pending", pendingId: "p6", from: "David", text: "ping" });
  const { buttons, note } = gateParts(gateCards().at(-1));
  feed({ type: "inbound_resolved", pendingId: "p6", decision: "accepted-task" });
  assert.deepEqual(buttons.map((b) => b.disabled), [true, true, true]);
  assert.equal(note.textContent, "Accepted for this session");
});

// ── the ended session still locks the composer ────────────────────────────────

test("boot: an ended session refuses to send", () => {
  feed({ type: "ended", outcome: "completed", summary: "done" });
  const before = sent.length;
  steer.value = "too late";
  send.fire("click");
  assert.equal(sent.length, before, "no steer crosses the bridge after the end");
});
