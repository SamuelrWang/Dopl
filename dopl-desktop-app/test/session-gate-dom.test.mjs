// Renderer tests for the v2.5 surfaces: the INBOUND GATE card (D1), the gated-post body
// in the permission dock (D2), and the read-only channel HISTORY (D3).
//
// Two layers, the same discipline as session-render-dom.test.mjs:
//   1. PURE — the view-model reduce cases + the lane mapping (no DOM).
//   2. DOM-EXEC — a tiny document stub (node --test isolates this file's process) so the
//      real factories are exercised: the three gate buttons and what they send, the
//      lock-after-decision, and the muted history bubbles.
// Plus the structural guards: textContent only, the CSP untouched, no absolute paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const vm = require(R("session-viewmodel.js"));
const chrome = require(R("session-chrome.js"));
const HTML = readFileSync(R("session.html"), "utf8");
const CSS = readFileSync(R("session.css"), "utf8");
const JS = readFileSync(R("session.js"), "utf8");
const PRELOAD = readFileSync(R("session-preload.js"), "utf8");

const last = (s) => s.items[s.items.length - 1];

// ── D1 (pure): the gate card state machine ────────────────────────────────────────

test("inbound_pending starts UNDECIDED (the card shows all three choices)", () => {
  const s = vm.reduceEvent(vm.initialState(), { type: "inbound_pending", pendingId: "p1", from: "David", text: "ping" });
  assert.equal(last(s).kind, "inbound_pending");
  assert.equal(last(s).decision, null);
  assert.equal(last(s).released, false);
});

test("markInboundDecided stamps accepted / accepted-task / declined without mutating", () => {
  const s0 = vm.reduceEvent(vm.initialState(), { type: "inbound_pending", pendingId: "p1", from: "D", text: "x" });
  for (const [decision, released] of [["accepted", true], ["accepted-task", true], ["declined", false]]) {
    const s = vm.markInboundDecided(s0, "p1", decision);
    assert.equal(last(s).decision, decision);
    assert.equal(last(s).released, released, `${decision} -> released:${released}`);
    assert.equal(last(s0).decision, null, "the original state is never mutated");
  }
});

test("markInboundDecided FAILS CLOSED on a junk decision (a card can never look accepted)", () => {
  const s0 = vm.reduceEvent(vm.initialState(), { type: "inbound_pending", pendingId: "p1", from: "D", text: "x" });
  for (const junk of ["allow", "ACCEPTED", "", null, undefined, 1]) {
    const s = vm.markInboundDecided(s0, "p1", junk);
    assert.equal(last(s).decision, "declined", `${String(junk)} reads as declined`);
    assert.equal(last(s).released, false);
  }
  assert.equal(vm.markInboundDecided(s0, "nope", "accepted"), s0, "an unknown id is a no-op");
});

test("an `inbound_resolved` echo from main marks the same card (auto-accept included)", () => {
  let s = vm.reduceEvent(vm.initialState(), { type: "inbound_pending", pendingId: "p1", from: "D", text: "x" });
  s = vm.reduceEvent(s, { type: "inbound_resolved", pendingId: "p1", decision: "accepted-task" });
  assert.equal(last(s).decision, "accepted-task");
});

// ── D2 (pure): the drafted post body the dock renders ─────────────────────────────

test("permissionPostBody returns the body of a gated dopl_channel post", () => {
  assert.equal(
    vm.permissionPostBody({ name: "mcp__dopl__dopl_channel", inputFull: { op: "post", body: "on it" } }),
    "on it"
  );
  assert.equal(vm.permissionPostBody({ name: "dopl_channel", inputFull: { op: "post", body: "bare name" } }), "bare name");
});

test("permissionPostBody is EMPTY for every other tool, op, and malformed input", () => {
  const cases = [
    { name: "Bash", inputFull: { command: "ls", body: "not a message" } },
    { name: "mcp__dopl__dopl_kb", inputFull: { op: "post", body: "wrong tool" } },
    { name: "mcp__dopl__dopl_channel", inputFull: { op: "open", body: "wrong op" } },
    { name: "mcp__dopl__dopl_channel", inputFull: { op: "post", body: { not: "a string" } } },
    { name: "mcp__dopl__dopl_channel", inputFull: null },
    { name: "mcp__dopl__dopl_channel" },
    {},
    null,
  ];
  for (const perm of cases) assert.equal(vm.permissionPostBody(perm), "", JSON.stringify(perm));
});

// ── FIX #9 (pure): the DESTINATION of a gated post ────────────────────────────────
// The dock rendered the drafted body with no target at all, and inputSummary is a 140-char
// JSON slice that usually truncates the `channel` field away — so the exact cross-channel
// exfil case the outbound gate exists to catch (Read a file, op=post it into a DM with
// another member) looked exactly like a normal reply to the peer. Main stamps `ownChannel`
// on the permission payload (session-io, from session-profiles.isOwnChannelPost).

test("FIX #9: the destination line names this channel vs another one", () => {
  // v2.x: an own-channel post NAMES the recipient. "To: this channel" sat in the same slot
  // as the cross-channel warning, so a legitimate reply read as suspicious as an exfil
  // attempt; a screenshot of a real reply showed the red "To: another channel" treatment.
  assert.equal(vm.postDestinationText({ ownChannel: true, to: "David" }), "To: David's agent");
  assert.equal(vm.postDestinationText({ ownChannel: false, to: "David" }), "To: another channel");
  assert.equal(vm.isCrossChannelPost({ ownChannel: true, to: "David" }), false);
  assert.equal(vm.isCrossChannelPost({ ownChannel: false }), true);
  for (const s of [vm.postDestinationText({ ownChannel: true, to: "David" }), vm.postDestinationText({})]) {
    assert.ok(!s.includes("—"), "no em dash in copy");
  }
});

test("v2.x: an own-channel post with NO peer name falls back to 'To: this channel'", () => {
  for (const perm of [{ ownChannel: true }, { ownChannel: true, to: null }, { ownChannel: true, to: "" },
    { ownChannel: true, to: "   " }, { ownChannel: true, to: 7 }]) {
    const out = vm.postDestinationText(perm);
    const expected = typeof perm.to === "number" ? "To: 7's agent" : "To: this channel";
    assert.equal(out, expected, JSON.stringify(perm));
    assert.ok(!/undefined|null/.test(out), "never a placeholder");
    // Naming the peer NEVER re-classifies the destination — that stays main's verdict.
    assert.equal(vm.isCrossChannelPost(perm), false);
  }
});

test("v2.x: the peer name is collapsed and capped (it is a label, not prose)", () => {
  assert.equal(vm.postDestinationText({ ownChannel: true, to: " David   Kim\n" }), "To: David Kim's agent");
  const long = "D".repeat(200);
  const out = vm.postDestinationText({ ownChannel: true, to: long });
  assert.ok(out.length < 80, `capped, got ${out.length}`);
  assert.ok(out.startsWith("To: DDD") && out.endsWith("'s agent"));
  assert.ok(!out.includes("\n"), "no newline can break the label out of its line");
});

test("FIX #9: an ABSENT ownChannel marker fails SUSPICIOUS (never 'this channel')", () => {
  for (const perm of [{}, null, undefined, { ownChannel: "true" }, { ownChannel: 1 }]) {
    assert.equal(vm.postDestinationText(perm), "To: another channel", JSON.stringify(perm));
    assert.equal(vm.isCrossChannelPost(perm), true, "a missing marker can never look routine");
  }
});

test("FIX #9: main stamps ownChannel and the reducer carries it onto the dock item", () => {
  const own = vm.reduceEvent(vm.initialState(), {
    type: "permission_request", requestId: "r1", name: "mcp__dopl__dopl_channel",
    inputFull: { op: "post", body: "on it" }, ownChannel: true,
  });
  assert.equal(vm.nextPermission(own).ownChannel, true);
  // The DOCK payload carries no peer name (main routes own-channel posts to the inline card,
  // which does carry `to`), so the dock keeps the id-free fallback.
  assert.equal(vm.postDestinationText(vm.nextPermission(own)), "To: this channel");
  const cross = vm.reduceEvent(vm.initialState(), {
    type: "permission_request", requestId: "r2", name: "mcp__dopl__dopl_channel",
    inputFull: { op: "post", channel: "other-channel", body: "the file contents" }, ownChannel: false,
  });
  const p = vm.nextPermission(cross);
  assert.equal(p.ownChannel, false);
  assert.equal(vm.postDestinationText(p), "To: another channel");
  assert.equal(vm.permissionPostBody(p), "the file contents", "the body still renders in full");
});

test("FIX #9: main derives ownChannel from the SAME rule the grant key uses", () => {
  const profiles = readFileSync(fileURLToPath(new URL("../main/session-profiles.js", import.meta.url)), "utf8");
  assert.match(profiles, /function isOwnChannelPost\(input, sessionChannelId\)/);
  const IO = readFileSync(fileURLToPath(new URL("../main/session-io.js", import.meta.url)), "utf8");
  assert.match(IO, /ownChannel: isOwnChannelPost\(input, s\.channelId\)/, "one rule, no second opinion");
  assert.ok(!/ownChannelId|targetChannelId/.test(IO), "a boolean crosses the bridge, never another channel's id");
});

// ── FIX F3 (pure): a denied post's bubble stops claiming it was sent ───────────────
// The outbound bubble is appended while the tool_use STREAMS, before any decision lands, so
// a Deny has to correct it. RE-PINNED for v2.7 FIX F9: there used to be two paths — the
// failing tool_result main forwards, and an immediate markOutboundNotSent on the DOCK's Deny
// click. That second one is deleted: an own-channel post decides on its own inline card
// (markOutboundDecided, by requestId), and the only post left in the dock is a CROSS-channel
// one, which never renders as an outbound item at all, so there was no bubble to correct.

test("FIX F3: a FAILING tool_result flips the outbound bubble to not_sent", () => {
  let s = vm.reduceEvent(vm.initialState(), { type: "outbound_post", toolUseId: "t1", to: "David", text: "draft" });
  assert.equal(last(s).status, undefined, "it starts out as the optimistic sent bubble");
  s = vm.reduceEvent(s, { type: "tool_result", toolUseId: "t1", ok: false, resultSummary: "Denied by operator" });
  assert.equal(last(s).kind, "outbound");
  assert.equal(last(s).status, "not_sent");
});

test("FIX F3: a SUCCESSFUL tool_result confirms the same bubble", () => {
  let s = vm.reduceEvent(vm.initialState(), { type: "outbound_post", toolUseId: "t1", to: "David", text: "draft" });
  s = vm.reduceEvent(s, { type: "tool_result", toolUseId: "t1", ok: true });
  assert.equal(last(s).status, "sent");
});

// RE-PINNED for FIX F9: the by-toolUseId helper is GONE from the view-model, and with it the
// only way a dock click could reach into the outbound lane. What replaces it is the card's own
// by-requestId resolution (markOutboundDecided), pinned in session-outbound-card.test.mjs.
test("FIX F9: markOutboundNotSent is deleted — nothing exports or calls it any more", () => {
  assert.equal(vm.markOutboundNotSent, undefined, "no dead export left on the view-model");
  const VMSRC = readFileSync(R("session-viewmodel.js"), "utf8");
  assert.ok(!/function markOutboundNotSent/.test(VMSRC), "and no dead function body");
  assert.ok(!/markOutboundNotSent\(/.test(JS), "the controller's dock path no longer calls it");
  // And the surviving path is unreachable from the dock by construction: a cross-channel post
  // (the only post the dock still shows) renders as a TOOL card, never an outbound item.
  const cross = vm.reduceEvent(vm.initialState(), { type: "tool_use", toolUseId: "t9", name: "mcp__dopl__dopl_channel", inputFull: { op: "post" } });
  assert.equal(last(cross).kind, "tool", "nothing in the outbound lane for the dock to correct");
});

test("FIX F3: a tool_result still fills the ordinary TOOL card it belongs to", () => {
  let s = vm.reduceEvent(vm.initialState(), { type: "tool_use", toolUseId: "t2", name: "Bash", inputFull: { command: "ls" } });
  s = vm.reduceEvent(s, { type: "tool_result", toolUseId: "t2", ok: false, resultSummary: "boom" });
  assert.equal(last(s).kind, "tool");
  assert.equal(last(s).status, "error");
  assert.equal(last(s).resultSummary, "boom");
});

// ── D3 (pure): the history reduce ─────────────────────────────────────────────────

test("a `history` event appends ONE divider then the entries, in order", () => {
  const s = vm.reduceEvent(vm.initialState(), {
    type: "history",
    entries: [
      { from: "Sam", text: "kick off", lane: "me" },
      { from: "David", text: "on it", lane: "them" },
    ],
  });
  assert.deepEqual(s.items.map((i) => i.kind), ["history_divider", "history", "history"]);
  assert.equal(s.items[0].text, "History from the channel", "renderer-owned divider copy");
  assert.ok(!s.items[0].text.includes("—"), "no em dash in copy");
  assert.deepEqual(s.items.slice(1).map((i) => [i.lane, i.from, i.text]), [
    ["me", "Sam", "kick off"],
    ["them", "David", "on it"],
  ]);
});

test("a `history` event with no entries changes nothing (no empty divider)", () => {
  const s0 = vm.initialState();
  assert.equal(vm.reduceEvent(s0, { type: "history", entries: [] }), s0);
  assert.equal(vm.reduceEvent(s0, { type: "history" }), s0);
});

test("history entry fields are coerced, and an unknown lane defaults to 'me'", () => {
  const s = vm.reduceEvent(vm.initialState(), {
    type: "history",
    entries: [{ from: null, text: null, lane: "sideways" }],
  });
  assert.deepEqual([last(s).from, last(s).text, last(s).lane], ["", "", "me"]);
});

test("history items align like live turns; the divider and the gate card do NOT", () => {
  assert.equal(chrome.streamLane({ kind: "history", lane: "them" }), "them");
  assert.equal(chrome.streamLane({ kind: "history", lane: "me" }), "me");
  assert.equal(chrome.laneClass({ kind: "history", lane: "them" }), "lane-them");
  assert.equal(chrome.laneClass({ kind: "history", lane: "me" }), "lane-me");
  assert.equal(chrome.streamLane({ kind: "history_divider" }), null);
  assert.equal(chrome.laneClass({ kind: "inbound_pending" }), "", "the gate card stays full width");
});

// ── DOM-EXEC: the real factories ──────────────────────────────────────────────────

function makeEl(tag) {
  const node = {
    tagName: String(tag).toUpperCase(), className: "", textContent: "", children: [], _attrs: {},
    disabled: false, type: "", _listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(k, fn) { (this._listeners[k] = this._listeners[k] || []).push(fn); },
    fire(k) { for (const fn of this._listeners[k] || []) fn({}); },
    setAttribute(k, v) { this._attrs[k] = v; if (k === "class") this.className = v; },
    getAttribute(k) { return this._attrs[k]; },
    replaceChildren(...kids) { this.children = kids.slice(); },
    replaceChild(nu, old) { const i = this.children.indexOf(old); if (i >= 0) this.children[i] = nu; return old; },
  };
  const has = (c) => node.className.split(/\s+/).filter(Boolean).includes(c);
  node.classList = {
    add(...cs) { const set = new Set(node.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => set.add(c)); node.className = [...set].join(" "); },
    remove(...cs) { const set = new Set(node.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => set.delete(c)); node.className = [...set].join(" "); },
    contains: has,
    toggle(c, on) { const want = on === undefined ? !has(c) : !!on; if (want) node.classList.add(c); else node.classList.remove(c); },
  };
  return node;
}
globalThis.document = { createElement: (t) => makeEl(t) };
const render = require(R("session-render.js"));

const buttonsOf = (rec) => {
  const row = rec.el.children.find((c) => c.className === "row");
  return row ? row.children : [];
};

test("DOM: the gate card renders Accept / Accept for this session / Decline", () => {
  const rec = render.makeInboundPending({ pendingId: "p1", from: "David", text: "ping" }, {});
  assert.ok(rec.el.classList.contains("inbound-pending"));
  assert.deepEqual(buttonsOf(rec).map((b) => b.textContent), ["Accept", "Accept for this session", "Decline"]);
  const who = rec.el.children[0];
  assert.equal(who.textContent, "David sent a message");
  assert.equal(rec.el.children[1].textContent, "ping", "the message body is shown before the decision");
});

test("DOM: each button sends its own decision with the card's pendingId", () => {
  const sent = [];
  const rec = render.makeInboundPending(
    { pendingId: "p7", from: "David", text: "ping" },
    { onInboundDecide: (id, d) => sent.push([id, d]) }
  );
  for (const btn of buttonsOf(rec)) btn.fire("click");
  assert.deepEqual(sent, [["p7", "accept"], ["p7", "accept-task"], ["p7", "decline"]]);
});

test("DOM: a decided card LOCKS every button and states the outcome", () => {
  for (const [decision, note] of [["accepted", "Accepted"], ["accepted-task", "Accepted for this session"], ["declined", "Declined"]]) {
    const rec = render.makeInboundPending({ pendingId: "p1", from: "D", text: "x" }, {});
    assert.deepEqual(buttonsOf(rec).map((b) => b.disabled), [false, false, false]);
    rec.update({ pendingId: "p1", from: "D", text: "x", decision, released: decision !== "declined" });
    assert.deepEqual(buttonsOf(rec).map((b) => b.disabled), [true, true, true], decision);
    const noteNode = rec.el.children.find((c) => c.className && c.className.includes("inbound-pending__note"));
    assert.equal(noteNode.textContent, note);
    assert.ok(!noteNode.classList.contains("hidden"));
  }
});

test("DOM: a declined card is visually settled, not pretending to be live", () => {
  const rec = render.makeInboundPending({ pendingId: "p1", from: "D", text: "x" }, {});
  rec.update({ pendingId: "p1", decision: "declined", released: false });
  assert.ok(rec.el.classList.contains("is-declined"));
  assert.ok(!rec.el.classList.contains("is-released"));
});

test("DOM: FIX F3 — a not_sent outbound reads 'Not sent' on the muted surface", () => {
  const rec = render.makeOutbound({ toolUseId: "t1", to: "David", text: "draft", avatarKey: "self" }, {});
  const banner = rec.el.children.find((c) => c.classList.contains("outbound__banner"));
  const label = banner.children.find((c) => c.className.includes("outbound__label"));
  assert.equal(label.textContent, "Sent to David", "the streaming label is unchanged");
  rec.update({ toolUseId: "t1", to: "David", text: "draft", status: "not_sent", avatarKey: "self" });
  assert.equal(label.textContent, "Not sent", "a denied post never claims delivery");
  assert.ok(rec.el.classList.contains("is-not-sent"));
  assert.equal(rec.el.children.find((c) => c.classList.contains("outbound__body")).textContent, "draft",
    "the drafted body stays visible, it just is not a delivery");
  // The pure label helper is the single source of the copy.
  assert.equal(render.outboundLabel({ status: "not_sent", to: "David" }), "Not sent");
  assert.equal(render.outboundLabel({ to: "David" }), "Sent to David");
  assert.equal(render.outboundLabel({}), "Posted to channel");
  for (const s of ["Not sent", "Sent to David", "Posted to channel"]) assert.ok(!s.includes("—"), "no em dash in copy");
});

test("DOM: a history entry is a muted bubble on its stamped lane, with NO controls", () => {
  const them = render.makeHistory({ from: "David", text: "on it", lane: "them" });
  assert.ok(them.el.classList.contains("history-entry"));
  assert.ok(them.el.classList.contains("bubble"), "it reuses the bubble surface");
  assert.ok(them.el.classList.contains("lane-them"));
  assert.equal(them.el.children[0].textContent, "David");
  assert.equal(them.el.children[1].textContent, "on it");
  assert.equal(buttonsOf(them).length, 0, "read-only: nothing to click");
  const mine = render.makeHistory({ from: "", text: "kick off", lane: "me" });
  assert.ok(mine.el.classList.contains("lane-me"));
  assert.equal(mine.el.children[0].textContent, "You", "a missing name falls back per lane");
  assert.equal(render.makeHistory({ text: "x", lane: "them" }).el.children[0].textContent, "Counterparty");
});

test("DOM: the divider is a plain muted line, un-laned", () => {
  const rec = render.makeHistoryDivider({ text: "History from the channel" });
  assert.equal(rec.el.className, "history-divider");
  assert.equal(rec.el.textContent, "History from the channel");
});

test("DOM: the factory map routes the new kinds (an unknown kind would fall to a notice)", () => {
  const f = render.makeFactories({ vm });
  for (const kind of ["history", "history_divider", "inbound_pending"]) {
    assert.equal(typeof f[kind], "function", `${kind} has a factory`);
  }
});

// ── markup / controller / stylesheet guards ───────────────────────────────────────

test("the dock has a dedicated node for the drafted post body, hidden by default", () => {
  assert.match(HTML, /id="permPost"/);
  assert.match(HTML, /id="permPostLabel"/);
  assert.match(HTML, /class="perm-post concave-field hidden" id="permPost"/, "starts hidden, reuses the kit field");
  assert.match(JS, /vm\.permissionPostBody\(p\)/, "the controller asks the pure helper");
  assert.match(JS, /els\.permPost\.textContent = postBody/, "textContent only");
  assert.match(CSS, /\.perm-post \{/);
});

test("FIX #9: the dock has a destination node, hidden by default, marked when cross-channel", () => {
  assert.match(HTML, /class="perm-post-to text-caption hidden" id="permPostTo"/, "starts hidden");
  assert.ok(HTML.indexOf('id="permPostTo"') < HTML.indexOf('id="permPost"'),
    "the destination reads BEFORE the body, so the operator sees where it is going first");
  assert.match(JS, /els\.permPostTo\.textContent = postBody \? vm\.postDestinationText\(p\) : ""/, "textContent only");
  assert.match(JS, /els\.permPostTo\.classList\.toggle\("is-cross", !!postBody && vm\.isCrossChannelPost\(p\)\)/);
  assert.match(CSS, /\.perm-post-to \{/);
  assert.match(CSS, /\.perm-post-to\.is-cross \{/, "a cross-channel post is visually marked");
});

test("the gate + history recipes exist and keep the established stream language", () => {
  assert.match(CSS, /\.inbound-pending \{\n\s*align-self: stretch;/, "the gate card stays full width");
  assert.match(CSS, /\.inbound-pending \.row \{[\s\S]*?flex-wrap: wrap;/, "three buttons wrap, never shrink-clip");
  assert.match(CSS, /\.history-entry \{/);
  assert.match(CSS, /\.history-divider \{/);
  // The lane classes own alignment, so .history-entry must NOT re-declare align-self
  // (a 2-class selector would outrank the single-class lane recipe).
  const entry = CSS.slice(CSS.indexOf(".history-entry {"), CSS.indexOf(".history-divider {"));
  assert.ok(!/align-self/.test(entry), "the history bubble carries the surface only");
});

test("the renderer stays textContent-only and the CSP is untouched", () => {
  for (const [name, src] of [["session.js", JS], ["session-render.js", readFileSync(R("session-render.js"), "utf8")]]) {
    assert.ok(!/\.innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(src), `${name} uses no HTML sink`);
  }
  assert.match(HTML, /default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:/);
  assert.match(HTML, /<script src="session-labels\.js"><\/script>/, "the label split loads before the view-model");
  assert.ok(HTML.indexOf("session-labels.js") < HTML.indexOf("session-viewmodel.js"), "load order matters in the sandbox");
});

test("the preload coerces the gate decision FAIL-CLOSED before it crosses the bridge", () => {
  assert.match(PRELOAD, /inboundDecision\(pendingId, decision\)/);
  assert.match(PRELOAD, /'accept' \|\| s === 'accept-task' \? s : 'decline'/, "anything else declines");
  assert.match(PRELOAD, /session:inbound-decision/);
  // FIX F10: the invoke PROMISE is returned, so the renderer can wait for main before it
  // locks the card; the dead release-inbound accept alias is gone from both sides.
  assert.match(PRELOAD, /return ipcRenderer\.invoke\('session:inbound-decision'/);
  assert.ok(!/releaseInbound|release-inbound/.test(PRELOAD), "no dead alias in the bridge");
  assert.ok(!/releaseInbound/.test(JS), "and none in the controller");
  const IPC = readFileSync(fileURLToPath(new URL("../main/session-ipc.js", import.meta.url)), "utf8");
  assert.ok(!/release-inbound/.test(IPC), "the main handler is deleted too");
  // And the handler reports the GATE's verdict, not a blanket {ok:true} — a pendingId that
  // does not name the head must leave the card answerable rather than stamping it.
  assert.match(IPC, /ok: gate\.decideInbound\(s, p && p\.pendingId, p && p\.decision\) === true/);
});

// RE-PINNED for FIX F9: the third assertion used to be /markOutboundNotSent\(state, p\.toolUseId\)/
// on the dock's Deny path. That call is deliberately gone (see above), so what is pinned now is
// the path that replaced it: the card's own by-requestId resolution.
test("FIX F3/F10: the CSS carries the not-sent recipe and the gate stamp waits on main", () => {
  assert.match(CSS, /\.outbound\.is-not-sent \{/);
  assert.match(JS, /if \(typeof send !== "function"\) return;/, "an older preload leaves the card live");
  assert.match(JS, /res && res\.ok === false/, "a rejected decision does not lock the card");
  assert.match(JS, /vm\.markOutboundDecided\(state, requestId, decision\)/, "the card resolves itself");
  assert.ok(!/markOutboundNotSent\(/.test(JS), "and the dock never reaches into the outbound lane");
});

test("no absolute path or id leaks into the history surface (label-only rule, §H-9)", () => {
  const history = readFileSync(R("session-render.js"), "utf8");
  const factory = history.slice(history.indexOf("function makeHistory("), history.indexOf("function makeHistoryDivider("));
  assert.ok(!/pendingId|toolUseId|sessionId|channelId|authorUserId/.test(factory), "no ids in the read-only bubble");
});
