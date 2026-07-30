// DOM-exec tests for the session-window factories (renderer/session/session-render.js).
//
// session-render.js touches `document` ONLY inside a factory, so requiring it is
// DOM-free; a tiny stub lets us actually EXERCISE the factories (item 8 tool-card
// collapse, item 2 counterparty avatar) without pulling in jsdom. Split out of
// session-render.test.mjs purely to respect the HARD 500-line-per-file cap.
//
// The stub models only the surface the factories use: createElement, className,
// textContent, appendChild, and a minimal classList.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vm = require(
  fileURLToPath(new URL("../renderer/session/session-viewmodel.js", import.meta.url))
);

function makeEl(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: "",
    textContent: "",
    children: [],
    _attrs: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {},
    setAttribute(k, v) { this._attrs[k] = v; if (k === "class") this.className = v; },
    getAttribute(k) { return this._attrs[k]; },
    replaceChildren(...kids) { this.children = kids.slice(); },
    replaceChild(nu, old) { const i = this.children.indexOf(old); if (i >= 0) this.children[i] = nu; else this.children.push(nu); return old; },
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
globalThis.document = { createElement: (t) => makeEl(t) };
const render = require(
  fileURLToPath(new URL("../renderer/session/session-render.js", import.meta.url))
);

// ── item 2: the counterparty lane renders an initials-on-token avatar ─────────

test("makeCounterparty renders an initials avatar from the peer name (item 2)", () => {
  const rec = render.makeCounterparty({ from: "David", text: "hi" });
  const head = rec.el.children[0];
  const avatar = head.children.find((c) => c.classList.contains("cp-avatar"));
  assert.ok(avatar, "a cp-avatar is rendered");
  assert.equal(avatar.textContent, "D");
});

// ── item 8: tool cards default COLLAPSED ──────────────────────────────────────

test("makeTool: head is always visible; body is a CLOSED <details> with the result hidden (item 8)", () => {
  const rec = render.makeTool(
    { name: "Bash", inputSummary: "$ ls", inputFull: { command: "ls" } },
    { vm }
  );
  const root = rec.el;
  assert.ok(root.classList.contains("tool-card"));

  // Head (name + summary + status) is OUTSIDE the details → always visible.
  const head = root.children[0];
  assert.ok(head.classList.contains("tool-card__head"));
  const status = head.children.find((c) => c.classList.contains("tool-status"));
  assert.ok(status, "the run status lives in the always-visible head");
  const summary = head.children.find((c) => c.classList.contains("tool-card__summary"));
  assert.equal(summary.textContent, "$ ls");

  // Body is the <details> itself, default CLOSED (no `open`).
  const body = root.children[1];
  assert.equal(body.tagName, "DETAILS");
  assert.ok(body.classList.contains("tool-card__body"));
  assert.ok(!body._attrs.open && !body.open, "the details must start CLOSED");

  // The result lives INSIDE the details and starts hidden.
  const result = body.children.find((c) => c.classList.contains("tool-result"));
  assert.ok(result, "the result is inside the details (not dumped into the stream)");
  assert.ok(result.classList.contains("hidden"), "the result is hidden until the user expands");
});

test("makeTool.update fills the result + status but keeps the result inside the closed details (item 8)", () => {
  const rec = render.makeTool({ name: "Bash", inputFull: { command: "ls" } }, { vm });
  rec.update({ status: "ok", resultSummary: "2 files" });

  const body = rec.el.children[1];
  assert.equal(body.tagName, "DETAILS");
  assert.ok(!body._attrs.open && !body.open, "still collapsed after a result arrives");

  const result = body.children.find((c) => c.classList.contains("tool-result"));
  assert.equal(result.textContent, "2 files");
  assert.ok(!result.classList.contains("hidden"), "the result is revealed but stays inside the details");

  const status = rec.el.children[0].children.find((c) => c.classList.contains("tool-status"));
  assert.equal(status.textContent, "Done");
  assert.ok(status.classList.contains("is-ok"));
});

// ── item 1/5/6: per-author avatar STATE (pure reducer over init + `avatars`) ───

test("initialState carries null self/peer avatars; init copies the warm-cache URIs", () => {
  const s0 = vm.initialState();
  assert.equal(s0.selfAvatar, null);
  assert.equal(s0.peerAvatar, null);
  const SELF = "data:image/png;base64,AAA";
  const PEER = "data:image/png;base64,BBB";
  const s = vm.reduceEvent(s0, { type: "init", channelName: "Ops", from: "Alice", selfAvatar: SELF, fromAvatar: PEER });
  assert.equal(s.selfAvatar, SELF);
  assert.equal(s.peerAvatar, PEER, "the IPC `fromAvatar` field maps to peerAvatar state");
});

test("a cold init (null avatars) keeps an already-filled avatar; `avatars` OR-merges", () => {
  const PEER = "data:image/png;base64,BBB";
  let s = vm.reduceEvent(vm.initialState(), { type: "avatars", from: PEER });
  s = vm.reduceEvent(s, { type: "init", channelName: "Ops", from: "Alice" }); // no avatar fields
  assert.equal(s.peerAvatar, PEER, "a cold init must not wipe a filled avatar");
  // A follow-up `avatars` with only `self` set must NOT clear the peer (§B.1).
  s = vm.reduceEvent(s, { type: "avatars", self: "data:image/png;base64,CCC", from: null });
  assert.equal(s.selfAvatar, "data:image/png;base64,CCC");
  assert.equal(s.peerAvatar, PEER, "a null field is OR-merged, not overwritten");
});

test("avatarKey stamping: turn/outbound → 'self', counterparty → 'peer'", () => {
  const R = vm.reduceEvent, S = vm.initialState;
  const lastOf = (s) => s.items[s.items.length - 1];
  assert.equal(lastOf(R(S(), { type: "turn", role: "assistant", text: "hi" })).avatarKey, "self");
  assert.equal(lastOf(R(S(), { type: "turn", role: "operator", text: "go" })).avatarKey, "self");
  assert.equal(lastOf(R(S(), { type: "outbound_post", to: "Alice", text: "sent" })).avatarKey, "self");
  assert.equal(lastOf(R(S(), { type: "counterparty", from: "Alice", text: "reply" })).avatarKey, "peer");
});

// ── item 1/5/6: per-author avatars via a bounded data: <img> ──────────────────

const DATA_SELF = "data:image/png;base64,SELF";
const DATA_PEER = "data:image/jpeg;base64,PEER";
// A ctx whose avatarFor maps role keys to distinct data URIs.
const ctxBoth = { vm, avatarFor: (k) => (k === "self" ? DATA_SELF : k === "peer" ? DATA_PEER : null) };
const imgIn = (node) => node.children.find((c) => c.tagName === "IMG");

test("avatarNode(dataUri) renders an <img> whose src IS the data: URI (never innerHTML)", () => {
  const node = render.avatarNode(DATA_SELF, "S");
  assert.ok(node.classList.contains("av"), "the data case wraps in .av");
  const img = imgIn(node);
  assert.ok(img, "an <img> is rendered");
  assert.equal(img.getAttribute("src"), DATA_SELF, "src is exactly the data: URI");
  assert.equal(img.getAttribute("alt"), "", "alt is empty (decorative)");
});

test("avatarNode falls back to the .cp-avatar initials when no data URI (cold/none)", () => {
  const node = render.avatarNode(null, "S");
  assert.ok(node.classList.contains("cp-avatar"), "null → initials span");
  assert.equal(node.textContent, "S");
  assert.ok(!imgIn(node), "no <img> in the fallback");
});

test("avatarNode NEVER puts a remote/http URL in img.src — it falls back to initials", () => {
  const node = render.avatarNode("https://lh3.googleusercontent.com/evil", "S");
  assert.ok(node.classList.contains("cp-avatar"), "a non-data: string falls through to initials");
  assert.ok(!imgIn(node), "a remote URL can never reach img.src");
});

test("avatarFor('self') vs ('peer') yield DIFFERENT avatar nodes (two authors → two photos)", () => {
  const turn = render.makeTurn({ role: "assistant", text: "hi", avatarKey: "self" }, ctxBoth);
  const cp = render.makeCounterparty({ from: "Alice", text: "reply", avatarKey: "peer" }, ctxBoth);
  const selfImg = imgIn(turn.el.children[0].children[0]); // bubble > cp-head > .av > img
  const peerImg = imgIn(cp.el.children[0].children[0]);
  assert.equal(selfImg.getAttribute("src"), DATA_SELF, "the agent turn shows MY photo");
  assert.equal(peerImg.getAttribute("src"), DATA_PEER, "the counterparty shows the PEER photo");
  assert.notEqual(selfImg.getAttribute("src"), peerImg.getAttribute("src"), "distinct sources");
});

test("a late `avatars` fill repaints an already-rendered bubble (initials → photo)", () => {
  let uri = null;
  const ctx = { vm, avatarFor: () => uri }; // starts cold (null)
  const rec = render.makeCounterparty({ from: "Alice", text: "hi", avatarKey: "peer" }, ctx);
  assert.ok(rec.el.children[0].children[0].classList.contains("cp-avatar"), "starts as initials");
  uri = DATA_PEER; // the `avatars` event lands
  rec.update({ from: "Alice", text: "hi", avatarKey: "peer" });
  const img = imgIn(rec.el.children[0].children[0]);
  assert.ok(img, "update() repaints the bubble with the photo");
  assert.equal(img.getAttribute("src"), DATA_PEER);
});

// ── item 4: the outbound post is a styled COMPONENT (banner + body) ───────────

test("makeOutbound renders a banner component (banner node + body node), NOT raw text", () => {
  const rec = render.makeOutbound({ to: "Alice", text: "on it", avatarKey: "self" }, ctxBoth);
  assert.ok(rec.el.classList.contains("outbound"));
  const banner = rec.el.children.find((c) => c.classList.contains("outbound__banner"));
  const body = rec.el.children.find((c) => c.classList.contains("outbound__body"));
  assert.ok(banner, "a distinct banner band exists");
  assert.ok(body, "the posted body is its own node");
  // The banner holds the SELF avatar photo + an uppercase SENT-TO label.
  const label = banner.children.find((c) => c.classList.contains("outbound__label"));
  assert.equal(label.textContent, "Sent to Alice", "label carries the peer (CSS uppercases it)");
  assert.ok(label.classList.contains("text-label"), "the label uses the uppercase kit class");
  const av = imgIn(banner.children[0]);
  assert.equal(av.getAttribute("src"), DATA_SELF, "the banner avatar is MY photo");
  assert.equal(body.textContent, "on it");
});

test("makeOutbound with no `to` labels 'Posted to channel' (resolved O-6)", () => {
  const rec = render.makeOutbound({ text: "fyi", avatarKey: "self" }, ctxBoth);
  const banner = rec.el.children.find((c) => c.classList.contains("outbound__banner"));
  const label = banner.children.find((c) => c.classList.contains("outbound__label"));
  assert.equal(label.textContent, "Posted to channel");
});

// ── chat lanes: which factories stamp a lane class on their root ──────────────
// The mapping itself is pinned in session-chrome.test.mjs; here we prove the DOM
// factories actually apply it (and that the full-width kinds apply nothing).

const laneOf = (node) => ({
  me: node.classList.contains("lane-me"),
  them: node.classList.contains("lane-them"),
});

test("lanes: an OPERATOR turn is right-aligned (lane-me), never lane-them", () => {
  const rec = render.makeTurn({ role: "operator", text: "go", avatarKey: "self" }, ctxBoth);
  assert.deepEqual(laneOf(rec.el), { me: true, them: false });
  assert.ok(rec.el.classList.contains("role-operator"), "the surface recipe is unchanged");
});

test("lanes: the agent's own text is left-aligned (lane-them)", () => {
  for (const role of ["assistant", "agent", undefined, "weird"]) {
    const rec = render.makeTurn({ role, text: "on it", avatarKey: "self" }, ctxBoth);
    assert.deepEqual(laneOf(rec.el), { me: false, them: true }, `role=${role} sits left`);
  }
});

test("lanes: a counterparty reply is left-aligned (lane-them)", () => {
  const rec = render.makeCounterparty({ from: "David", text: "thanks", avatarKey: "peer" }, ctxBoth);
  assert.deepEqual(laneOf(rec.el), { me: false, them: true });
  assert.ok(rec.el.classList.contains("role-counterparty"));
});

test("lanes: tool / outbound / inbound_pending / notice carry NEITHER lane class", () => {
  const items = [
    render.makeTool({ name: "Bash", inputFull: { command: "ls" } }, { vm }),
    render.makeOutbound({ to: "David", text: "sent", avatarKey: "self" }, ctxBoth),
    render.makeInboundPending({ pendingId: "p1", from: "David", text: "wait" }, {}),
    render.makeNotice({ level: "info", text: "Paused after inactivity." }),
  ];
  for (const rec of items) {
    assert.deepEqual(laneOf(rec.el), { me: false, them: false }, rec.el.className + " stays full width");
  }
});

test("lanes: a streaming update never drops the lane class", () => {
  const rec = render.makeTurn({ role: "operator", text: "go", streaming: true }, ctxBoth);
  rec.update({ role: "operator", text: "go on", streaming: false });
  assert.deepEqual(laneOf(rec.el), { me: true, them: false }, "update() only touches is-streaming");
});
