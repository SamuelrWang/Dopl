// Tests for the v2.7 L3 OUTBOUND DECISION CARD: the message the agent wants to send to
// the peer stops on an INLINE card in the stream (Send / Send for this session / Deny)
// instead of in the bottom permission dock, and that ONE card becomes the delivered
// record in place.
//
// The four hazards this file exists to pin:
//   (a) SINGLE ARTIFACT — the outbound bubble is emitted while the tool_use streams,
//       BEFORE canUseTool decides. There must be exactly ONE stream item per post
//       attempt: pending while awaiting, delivered on Send, not-sent on Deny.
//   (b) postedThisTurn accounting is untouched (it still drives awaiting_peer).
//   (c) the card decides by its OWN requestId, and a request queued BEHIND a post is
//       still the one the dock surfaces.
//   (d) the card resolves IN PLACE (its own update() morphs the DOM), because
//       session.js's renderStream creates a node once per index and never rebuilds it.
// Plus: park survival (a parked pending post must fail closed, not read "Sent" forever)
// and the AXIS B bypass (v2.9: messageMode auto_outbound / auto_both — no card at all,
// the delivered bubble exactly as before; it was `autoApprove` before the two axes).
//
// Four layers: the pure view-model, the pure reducer (source extraction), main/session-io
// (required directly — it is electron-free), and the real DOM factories against a stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { declsOf, fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const vm = require(R("session-viewmodel.js"));
const chrome = require(R("session-chrome.js"));
const io = require(join(HERE, "..", "main", "session-io.js"));
const profiles = require(join(HERE, "..", "main", "session-profiles.js"));
const CSS = readFileSync(R("session.css"), "utf8");
const JS = readFileSync(R("session.js"), "utf8");
const PRELOAD = readFileSync(R("session-preload.js"), "utf8");

const last = (s) => s.items[s.items.length - 1];
const CHANNEL_TOOL = "mcp__dopl__dopl_channel";
const POST = { op: "post", body: "Shipping the invoice import tonight." };

// A post that will GATE, as main paints it at tool_use time.
const gating = (extra) => ({
  type: "outbound_post", toolUseId: "t1", to: "David", text: "the draft",
  pending: true, ownChannel: true, ...extra,
});
const pendingCard = (extra) => vm.reduceEvent(vm.initialState(), gating(extra));

// ── (a) ONE artifact per post attempt ─────────────────────────────────────────────

test("L3: a GATING post paints ONE pending item, not a bubble plus a dock entry", () => {
  const s = pendingCard();
  assert.equal(s.items.length, 1, "exactly one stream artifact");
  assert.equal(last(s).kind, "outbound", "the same kind it will resolve into");
  assert.equal(last(s).status, "pending");
  assert.equal(last(s).requestId, null, "main has not minted it yet");
  assert.equal(last(s).ownChannel, true);
  assert.equal(last(s).text, "the draft", "the drafted body is on the card");
  assert.deepEqual(s.permissions, [], "a post NEVER enters the dock queue");
  assert.equal(vm.nextPermission(s), null);
});

test("L3: a NON-gating post is byte-identical to v2.6 (delivered bubble, no card state)", () => {
  const s = vm.reduceEvent(vm.initialState(), { type: "outbound_post", toolUseId: "t1", to: "David", text: "sent" });
  assert.equal(last(s).status, undefined, "no status at all — the optimistic sent bubble");
  assert.equal(last(s).requestId, undefined);
  assert.equal(last(s).ownChannel, undefined);
});

test("L3: the FULL gate sequence still leaves exactly one item (pending -> delivered)", () => {
  let s = pendingCard();
  s = vm.reduceEvent(s, { type: "outbound_gate", requestId: "r1", toolUseId: "t1" });
  s = vm.reduceEvent(s, { type: "permission_resolved", requestId: "r1", decision: "allow-once" });
  s = vm.reduceEvent(s, { type: "tool_result", toolUseId: "t1", ok: true, resultSummary: "posted" });
  assert.equal(s.items.length, 1, "no duplicate bubble anywhere in the sequence");
  assert.equal(last(s).status, "sent");
});

// ── the requestId handover + the three decisions ───────────────────────────────────

test("L3: outbound_gate hands the pending card the requestId main minted", () => {
  const s0 = pendingCard();
  const s = vm.reduceEvent(s0, { type: "outbound_gate", requestId: "r1", toolUseId: "t1" });
  assert.equal(last(s).requestId, "r1");
  assert.equal(last(s0).requestId, null, "the original state is never mutated");
});

test("L3: outbound_gate is a no-op for an unknown id, a missing id, or a resolved card", () => {
  const s0 = pendingCard();
  assert.equal(vm.reduceEvent(s0, { type: "outbound_gate", requestId: "r1", toolUseId: "nope" }), s0);
  assert.equal(vm.reduceEvent(s0, { type: "outbound_gate", requestId: "r1" }), s0);
  assert.equal(vm.reduceEvent(s0, { type: "outbound_gate", toolUseId: "t1" }), s0);
  // A card that already resolved can never be re-opened by a late echo.
  const done = vm.markOutboundDecided(vm.reduceEvent(s0, { type: "outbound_gate", requestId: "r1", toolUseId: "t1" }), "r1", "deny");
  assert.equal(last(done).status, "not_sent");
  assert.equal(vm.reduceEvent(done, { type: "outbound_gate", requestId: "r9", toolUseId: "t1" }), done);
  const sentDone = vm.markOutboundDecided(vm.reduceEvent(s0, { type: "outbound_gate", requestId: "r1", toolUseId: "t1" }), "r1", "allow-once");
  assert.equal(vm.reduceEvent(sentDone, { type: "outbound_gate", requestId: "r9", toolUseId: "t1" }), sentDone);
});

test("L3 RACE: auto-approve turned OFF mid-post turns the DELIVERED bubble back into a card", () => {
  // The artifact is painted at tool_use time from the prediction; if the operator flips the
  // toggle off before canUseTool runs, main really is awaiting a decision — so the record
  // must ask for one instead of standing there claiming the peer already has it.
  let s = vm.reduceEvent(vm.initialState(), { type: "outbound_post", toolUseId: "t1", to: "David", text: "draft" });
  assert.equal(last(s).status, undefined, "painted as a delivery");
  s = vm.reduceEvent(s, { type: "outbound_gate", requestId: "r1", toolUseId: "t1", ownChannel: true });
  assert.equal(last(s).status, "pending", "converted to the decision card");
  assert.equal(last(s).requestId, "r1");
  assert.equal(last(s).ownChannel, true, "and it still knows where it was going");
  assert.equal(s.items.length, 1, "still ONE artifact");
});

const gated = () => vm.reduceEvent(pendingCard(), { type: "outbound_gate", requestId: "r1", toolUseId: "t1" });

test("L3: Send / Send for this session DELIVER the card; Deny marks it not sent", () => {
  for (const decision of ["allow-once", "allow-task"]) {
    const s = vm.reduceEvent(gated(), { type: "permission_resolved", requestId: "r1", decision });
    assert.equal(last(s).status, "sent", decision);
  }
  const denied = vm.reduceEvent(gated(), { type: "permission_resolved", requestId: "r1", decision: "deny" });
  assert.equal(last(denied).status, "not_sent");
});

test("L3: markOutboundDecided FAILS CLOSED on anything that is not an explicit allow", () => {
  for (const junk of ["allow", "ALLOW-ONCE", "yes", "", null, undefined, 1, "bypass"]) {
    const s = vm.markOutboundDecided(gated(), "r1", junk);
    assert.equal(last(s).status, "not_sent", `${String(junk)} can never deliver a message`);
  }
  const s0 = gated();
  assert.equal(vm.markOutboundDecided(s0, "other", "allow-once"), s0, "another card's id is a no-op");
  assert.equal(vm.markOutboundDecided(s0, undefined, "allow-once"), s0, "a missing id is a no-op");
});

test("L3: a card only ever answers for ITSELF (two pending posts, one decision)", () => {
  let s = pendingCard();
  s = vm.reduceEvent(s, { type: "outbound_gate", requestId: "r1", toolUseId: "t1" });
  s = vm.reduceEvent(s, { type: "outbound_post", toolUseId: "t2", to: "David", text: "second", pending: true, ownChannel: true });
  s = vm.reduceEvent(s, { type: "outbound_gate", requestId: "r2", toolUseId: "t2" });
  s = vm.reduceEvent(s, { type: "permission_resolved", requestId: "r2", decision: "deny" });
  assert.deepEqual(s.items.map((i) => i.status), ["pending", "not_sent"], "only r2 resolved");
});

// ── PARK: a stale card fails closed instead of claiming delivery ───────────────────

test("L3 PARK: the park's fail-closed deny echo resolves a pending post to 'Not sent'", () => {
  // parkEffects emits ONE permission_resolved{deny} per awaited requestId (v2.3 FIX #6).
  // Before v2.7 the post's record sat there reading "Sent to peer" forever.
  const s = vm.reduceEvent(gated(), { type: "permission_resolved", requestId: "r1", decision: "deny" });
  assert.equal(last(s).status, "not_sent", "a parked, query-less session never claims delivery");
});

test("L3 PARK: the reducer really does emit that echo for the post's own requestId", () => {
  // Source-extracted so this can never drift from the shipped reducer. A post gates through
  // the SAME `permission_request` event as any other tool, which is exactly why park,
  // denyPending and the auto-approve drain already cover it — no new event type was added.
  const SRC = readFileSync(join(HERE, "..", "main", "session-reducer.js"), "utf8");
  const BEGIN = "// ─── BEGIN SESSION-REDUCER";
  const END = "// ─── END SESSION-REDUCER";
  const from = SRC.indexOf(BEGIN);
  const to = SRC.indexOf(END);
  assert.ok(from !== -1 && to > from, "session-reducer sentinels missing/out of order");
  const { initialSessionState, sessionReducer } = new Function(
    `${SRC.slice(from, to)}\n return { initialSessionState, sessionReducer };`
  )();
  const running = sessionReducer(initialSessionState(), { type: "launched", payload: { type: "init" } }).state;

  // The stream-time artifact records the post for the turn-end status (trap (b), unchanged).
  const posted = sessionReducer(running, {
    type: "outbound_post",
    payload: { type: "outbound_post", toolUseId: "t1", to: "David", text: "draft", pending: true, ownChannel: true },
  }).state;
  assert.equal(posted.postedThisTurn, true, "postedThisTurn still set at stream time");
  assert.deepEqual(posted.postedToolUseIds, ["t1"]);

  // The gate is an ordinary permission_request carrying the card's payload.
  const awaiting = sessionReducer(posted, {
    type: "permission_request", requestId: "r1", name: CHANNEL_TOOL + "#post",
    payload: { type: "outbound_gate", requestId: "r1", toolUseId: "t1" },
  });
  assert.deepEqual(awaiting.state.pendingPermissions, ["r1"], "tracked like any gated tool");
  assert.deepEqual(awaiting.effects[0].payload, { type: "outbound_gate", requestId: "r1", toolUseId: "t1" });

  // A park deny-closes it fail-closed AND tells the renderer, which resolves the card.
  const parked = sessionReducer(awaiting.state, { type: "idle_timeout" });
  assert.equal(parked.effects[0].type, "denyPending", "the SDK promise is denied first");
  const echo = parked.effects.find((e) => e.type === "emit" && e.payload.type === "permission_resolved");
  assert.deepEqual(echo.payload, { type: "permission_resolved", requestId: "r1", decision: "deny" });
  assert.deepEqual(parked.state.pendingPermissions, []);

  // (b) A DENY's failing tool_result still un-counts the post, so the turn ends idle and
  // the status pill never claims "Waiting for reply" for a message that never left.
  const corrected = sessionReducer(awaiting.state, {
    type: "tool_result", payload: { type: "tool_result", toolUseId: "t1", ok: false },
  });
  assert.equal(corrected.state.postedThisTurn, false);
  assert.equal(sessionReducer(corrected.state, { type: "result", turnCostUsd: 0 }).state.activity, "idle");

  // An ALLOWED post keeps the count, so the turn still ends awaiting_peer.
  assert.equal(sessionReducer(awaiting.state, { type: "result", turnCostUsd: 0 }).state.activity, "awaiting_peer");
});

test("L3: an allow-once echo resolves a pending card to delivered", () => {
  // Whatever produced the allow (this window's Send, or main's own echo) lands the same way.
  const s = vm.reduceEvent(gated(), { type: "permission_resolved", requestId: "r1", decision: "allow-once" });
  assert.equal(last(s).status, "sent", "the operator opted out of being asked mid-post");
});

// ── (c) the dock still surfaces the next NON-post request ──────────────────────────

test("L3 (c): a Bash request queued BEHIND a post is the one the dock shows", () => {
  let s = pendingCard();
  s = vm.reduceEvent(s, { type: "outbound_gate", requestId: "r1", toolUseId: "t1" });
  s = vm.reduceEvent(s, { type: "permission_request", requestId: "r2", name: "Bash", inputSummary: "$ ls", inputFull: { command: "ls" } });
  assert.equal(s.permissions.length, 1, "only the non-post request is queued");
  assert.equal(vm.nextPermission(s).name, "Bash", "the dock is never left blank behind a post");
  // And answering the Bash request leaves the post's card untouched.
  s = vm.reduceEvent(s, { type: "permission_resolved", requestId: "r2", decision: "allow-once" });
  assert.equal(vm.nextPermission(s), null);
  assert.equal(s.items[0].status, "pending", "the post is still awaiting its own decision");
});

// ── the tool_result belt (a post that fails after Send, or a decision we never saw) ──

test("L3: a tool_result still resolves the card as a belt (ok -> sent, error -> not sent)", () => {
  const ok = vm.reduceEvent(gated(), { type: "tool_result", toolUseId: "t1", ok: true });
  assert.equal(last(ok).status, "sent");
  const bad = vm.reduceEvent(gated(), { type: "tool_result", toolUseId: "t1", ok: false, resultSummary: "Denied by operator" });
  assert.equal(last(bad).status, "not_sent");
});

// ── main/session-io: the gate PREDICTION + the suppressed double artifact ──────────

const assistantMsg = (blocks) => ({ type: "assistant", message: { content: blocks } });
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const mkSession = (over) => ({ profile: "full", channelId: "ch1", state: { allowForTask: [], messageMode: "ask" }, ...over });

test("io: postWillGate mirrors canUseTool — gate by default, NOT under a grant or AXIS B", () => {
  assert.equal(io.postWillGate(mkSession(), POST), true, "nothing granted -> the card appears");
  // v2.9: the outbound half of the MESSAGE axis replaced the auto-approve toggle here.
  assert.equal(io.postWillGate(mkSession({ state: { allowForTask: [], messageMode: "auto_outbound" } }), POST), false,
    "auto send outgoing -> no card, the post just goes");
  // FIX F7: the post grant is scoped to the EXACT body, so the key is built from the same
  // call, not hand-written — a body-blind constant no longer suppresses anything.
  const postGrant = profiles.grantKeyFor(CHANNEL_TOOL, POST, "ch1");
  assert.equal(io.postWillGate(mkSession({ state: { allowForTask: [postGrant], messageMode: "ask" } }), POST), false,
    "the scoped task grant for THIS body -> no card either");
  assert.equal(io.postWillGate(mkSession({ state: { allowForTask: [postGrant], messageMode: "ask" } }),
    { ...POST, body: "ssh key: AAAA" }), true, "...but a DIFFERENT body is a different decision");
  // A grant taken on another op does NOT suppress the card (FIX F2 scoping).
  assert.equal(io.postWillGate(mkSession({ state: { allowForTask: [CHANNEL_TOOL + "#op:read"], messageMode: "ask" } }), POST), true);
  // And the TOOL axis can never send a message, not even at `bypass` (THE INVARIANT).
  assert.equal(io.postWillGate(mkSession({ state: { allowForTask: [], toolMode: "bypass" } }), POST), true);
});

test("io: sdkRenderEvents marks a gating post PENDING — still ONE event, still no tool card", () => {
  const msg = assistantMsg([toolUse("t1", CHANNEL_TOOL, POST)]);
  const evs = io.sdkRenderEvents(msg, "ch1", "Bob", () => true);
  assert.equal(evs.length, 1, "one artifact: the generic tool card stays suppressed");
  assert.deepEqual(evs[0].payload, {
    type: "outbound_post", toolUseId: "t1", to: "Bob", text: POST.body,
    pending: true, ownChannel: true,
  });
});

test("io: an auto-approved post carries NO pending marker (the v2.6 payload, exactly)", () => {
  const msg = assistantMsg([toolUse("t1", CHANNEL_TOOL, POST)]);
  for (const predicate of [() => false, undefined, null, "nonsense", () => "yes"]) {
    const evs = io.sdkRenderEvents(msg, "ch1", "Bob", predicate);
    assert.deepEqual(evs[0].payload, { type: "outbound_post", toolUseId: "t1", to: "Bob", text: POST.body },
      "only an explicit true marks a post pending");
  }
});

test("io: the AXIS B auto-send bypass still dispatches NOTHING (no card, no dock)", async () => {
  const s = { profile: "full", channelId: "ch1", state: { allowForTask: [], messageMode: "auto_outbound" }, pendingPermissions: new Map(), pendingNames: new Map() };
  const events = [];
  const res = await io.makeCanUseTool(s, (_s, ev) => events.push(ev))(CHANNEL_TOOL, POST, { requestId: "rA", toolUseID: "tA" });
  assert.deepEqual(res, { behavior: "allow" });
  assert.deepEqual(events, [], "the operator opted out of being asked");
  assert.equal(s.pendingPermissions.size, 0, "and nothing is parked");
});

// ── (d) the DOM card, and the in-place resolution ─────────────────────────────────

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

const parts = (rec) => {
  const kids = rec.el.children;
  return {
    label: kids.find((c) => c.classList.contains("outbound__banner")).children.find((c) => c.className.includes("outbound__label")),
    dest: kids.find((c) => c.classList.contains("outbound-pending__to")),
    body: kids.find((c) => c.classList.contains("outbound__body")),
    row: kids.find((c) => c.classList.contains("row")),
  };
};
const card = (item, sent) => render.makeOutbound(item, { vm, onOutboundDecide: (id, d) => sent && sent.push([id, d]) });
const PENDING = { toolUseId: "t1", to: "David", text: "the draft", status: "pending", requestId: "r1", ownChannel: true, avatarKey: "self" };

test("DOM: the pending card shows the destination, the drafted body, and Send / Deny", () => {
  const rec = card(PENDING);
  assert.ok(rec.el.classList.contains("outbound"), "it is the delivered record's own surface");
  assert.ok(rec.el.classList.contains("outbound-pending"), "plus the pending accent");
  const p = parts(rec);
  assert.equal(p.label.textContent, "Sending to David", "not a delivery claim");
  // v2.x: an own-channel destination NAMES the peer, so a legitimate delivery no longer
  // reads like the cross-channel warning it shares this slot with.
  assert.equal(p.dest.textContent, "To: David's agent");
  assert.ok(!p.dest.classList.contains("hidden"));
  assert.ok(!p.dest.classList.contains("is-cross"));
  assert.equal(p.body.textContent, "the draft", "the operator approves WHAT is being said");
  assert.deepEqual(p.row.children.map((b) => b.textContent), ["Send", "Send for this session", "Deny"]);
  assert.ok(!p.row.classList.contains("hidden"));
  for (const s of ["Sending to David", "To: David's agent", "Send", "Send for this session", "Deny"]) {
    assert.ok(!s.includes("—"), "no em dash in copy");
  }
});

// RE-PINNED for FIX F7: a click LOCKS the card at once (before the invoke resolves), so the
// three verbs are fired on three cards, and a second click on a clicked card is swallowed.
test("DOM: each button sends its OWN requestId with the existing dock verb", () => {
  const fired = [];
  for (const i of [0, 1, 2]) {
    const sent = [];
    const rec = card(PENDING, sent);
    parts(rec).row.children[i].fire("click");
    fired.push(sent[0]);
    assert.deepEqual(parts(rec).row.children.map((b) => b.disabled), [true, true, true], "locked on click");
    parts(rec).row.children[(i + 1) % 3].fire("click");
    assert.equal(sent.length, 1, "a second click never doubles the decision");
  }
  assert.deepEqual(fired, [["r1", "allow-once"], ["r1", "allow-task"], ["r1", "deny"]]);
});

test("DOM: a card main is not awaiting yet has DISABLED buttons (fail closed)", () => {
  const rec = card({ ...PENDING, requestId: null });
  assert.deepEqual(parts(rec).row.children.map((b) => b.disabled), [true, true, true]);
  // FIX F3: and the row is HIDDEN, so an unanswerable card does not read as broken.
  assert.ok(parts(rec).row.classList.contains("hidden"), "three dead buttons are never shown");
  // The requestId lands (outbound_gate) -> answerable, and the row appears.
  rec.update({ ...PENDING });
  assert.deepEqual(parts(rec).row.children.map((b) => b.disabled), [false, false, false]);
  assert.ok(!parts(rec).row.classList.contains("hidden"));
});

test("DOM (d): Send RESOLVES THE CARD IN PLACE — it becomes the delivered bubble", () => {
  const rec = card(PENDING);
  const before = rec.el;
  rec.update({ ...PENDING, status: "sent" });
  assert.equal(rec.el, before, "the SAME node: renderStream never rebuilds on a kind change");
  assert.ok(!rec.el.classList.contains("outbound-pending"), "the pending accent is dropped");
  assert.ok(rec.el.classList.contains("outbound"), "leaving exactly the delivered recipe");
  assert.ok(!rec.el.classList.contains("is-not-sent"));
  const p = parts(rec);
  assert.equal(p.label.textContent, "Sent to David");
  assert.ok(p.row.classList.contains("hidden"), "the decision affordance is gone");
  assert.ok(p.dest.classList.contains("hidden"));
  assert.deepEqual(p.row.children.map((b) => b.disabled), [true, true, true], "and locked");
  assert.equal(p.body.textContent, "the draft", "the body it delivered stays");
});

test("DOM (d): Deny resolves the same node to the muted 'Not sent' treatment", () => {
  const rec = card(PENDING);
  rec.update({ ...PENDING, status: "not_sent" });
  assert.ok(rec.el.classList.contains("is-not-sent"));
  assert.ok(!rec.el.classList.contains("outbound-pending"));
  assert.equal(parts(rec).label.textContent, "Not sent");
  assert.ok(parts(rec).row.classList.contains("hidden"));
  assert.equal(parts(rec).body.textContent, "the draft", "the stopped draft is still readable");
});

test("DOM: a DELIVERED post (auto-approved) shows no decision surface at all", () => {
  const rec = card({ toolUseId: "t1", to: "David", text: "sent", avatarKey: "self" });
  assert.ok(!rec.el.classList.contains("outbound-pending"));
  const p = parts(rec);
  assert.equal(p.label.textContent, "Sent to David", "exactly as it rendered before v2.7");
  assert.ok(p.row.classList.contains("hidden"));
  assert.ok(p.dest.classList.contains("hidden"));
  assert.deepEqual(p.row.children.map((b) => b.disabled), [true, true, true]);
});

test("DOM: the card marks a CROSS-channel destination (fail-suspicious, like the dock)", () => {
  for (const own of [false, undefined, "true", 1]) {
    const rec = card({ ...PENDING, ownChannel: own });
    const p = parts(rec);
    assert.equal(p.dest.textContent, "To: another channel", JSON.stringify(own));
    assert.ok(p.dest.classList.contains("is-cross"), "a missing marker can never look routine");
  }
});

test("DOM: outboundLabel is the single source of the card's copy", () => {
  assert.equal(render.outboundLabel({ status: "pending", to: "David" }), "Sending to David");
  assert.equal(render.outboundLabel({ status: "pending" }), "Sending to the channel");
  assert.equal(render.outboundLabel({ status: "not_sent", to: "David" }), "Not sent");
  assert.equal(render.outboundLabel({ to: "David" }), "Sent to David");
  assert.ok(!render.outboundLabel({ status: "pending", to: "David" }).includes("—"));
});

test("DOM: the un-laned card keeps the full stream width (v2.7 L1)", () => {
  assert.equal(chrome.laneClass({ kind: "outbound" }), "", "a decision is neither side");
  const rec = card(PENDING);
  assert.ok(!rec.el.classList.contains("lane-me") && !rec.el.classList.contains("lane-them"));
});

// ── wiring / stylesheet guards ─────────────────────────────────────────────────────

test("the controller decides by the card's own requestId, waiting for main like the gate", () => {
  assert.match(JS, /onOutboundDecide\(requestId, decision\)/);
  assert.match(JS, /if \(!requestId \|\| typeof bridge\.permission !== "function"\) return;/, "fail closed");
  assert.match(JS, /res && res\.ok === false/, "a refused decision leaves the card answerable");
  assert.match(JS, /vm\.markOutboundDecided\(state, requestId, decision\)/);
  // The dock still reads only the queue HEAD — which a post never joins.
  assert.match(JS, /const p = vm\.nextPermission\(state\);/);
});

test("the preload RETURNS main's own verdict for a permission decision, fail-closed", () => {
  assert.match(PRELOAD, /return ipcRenderer\.invoke\('session:permission'/);
  assert.match(PRELOAD, /'allow-once' \|\| s === 'allow-task' \|\| s === 'deny' \? s : 'deny'/);
});

test("a hidden window RESHOWS for an outbound decision (it needs the operator)", () => {
  const ENGINE = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");
  assert.match(ENGINE, /RESHOW_TYPES = new Set\(\['permission_request', 'counterparty', 'inbound_pending', 'outbound_gate'\]\)/);
});

test("the card's recipe is a full-width sibling of the inbound gate card, distinctly accented", () => {
  assert.deepEqual(declsOf(CSS, ".outbound-pending"), { "border-color": "var(--warning)" }, "its own accent");
  assert.equal(declsOf(CSS, ".outbound-pending .outbound__banner").background, "var(--bg-elevated)",
    "the delivered CTA band only appears once it has actually left");
  assert.equal(declsOf(CSS, ".outbound-pending__to.is-cross").color, "var(--danger)", "cross-channel is marked");
  const draft = declsOf(CSS, ".outbound-pending .outbound__body");
  assert.equal(draft["max-height"], "200px", "a long draft scrolls");
  assert.equal(draft.overflow, "auto");
  assert.equal(declsOf(CSS, ".outbound-pending .row")["flex-wrap"], "wrap", "the buttons wrap, never shrink-clip");
  // The delivered / not-sent recipes it morphs into are untouched.
  const delivered = declsOf(CSS, ".outbound");
  assert.equal(delivered["align-self"], "stretch");
  assert.equal(delivered["max-width"], "100%");
  assert.deepEqual(declsOf(CSS, ".outbound.is-not-sent"), { "border-color": "var(--border-strong)" });
});

// AUDIT R3(a) — THE FAIL-OPEN THIS FILE SHIPPED. The factory used to be extracted with
// `src.slice(src.indexOf("function makeOutbound("), src.indexOf("function makeNotice("))`,
// which is "" whenever makeNotice is declared ABOVE makeOutbound — and every negative
// assertion below then passes VACUOUSLY, i.e. moving one function silently disarmed an XSS
// guard while the suite stayed green. fnOf() brace-matches makeOutbound's REAL body, so
// there is no marker order left to invert.
test("no id or absolute path leaks into the card beyond the requestId it must answer with", () => {
  const src = readFileSync(R("session-render.js"), "utf8");
  const factory = fnOf(src, "makeOutbound");
  assert.ok(factory.startsWith("function makeOutbound("), "a REAL block, never an empty slice");
  assert.ok(factory.includes("outbound__body"), "and the whole body, not a prefix of it");
  assert.ok(!/toolUseId|sessionId|channelId|pendingId/.test(factory), "no ids are printed on the card");
  assert.ok(!/\.innerHTML|insertAdjacentHTML|outerHTML/.test(factory), "textContent only");
});
