// Tests for the v1.7.5 session-window CHROME layer:
//   renderer/session/session-chrome.js — the pure helpers (D1 header/window identity
//   priority, D5 send/pause morph predicate, D7 composer auto-grow cap math), plus
//   the STRUCTURAL assertions that pin the markup/CSS decisions the pure helpers
//   drive (D2 no chip row, D3 flush top corners, D4 composer width, D5 icon button,
//   D6 no placeholder).
//
// session-chrome.js is DOM/electron-free and UMD-wrapped like session-viewmodel.js,
// so it loads directly via createRequire; the markup/CSS checks read the files as
// text (the same discipline session-render.test.mjs uses for the permission dock).
//
// BRITTLENESS (audit R3): those text checks used to pin exact formatting and declaration
// ORDER, and to slice by the first `indexOf` of two markers — a slice that reads "" (and
// passes every negative assertion inside it VACUOUSLY) the moment the two markers swap
// places. They now go through test/helpers/source-probe.mjs: `declsOf` compares a rule as
// {prop: value}, `ruleOf`/`hasRule` match an EXACT selector, and `between`/`orderOf` throw
// on a missing or inverted marker instead of quietly returning nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { between, orderOf, declsOf, ruleOf, hasRule, anySelector } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const chrome = require(R("session-chrome.js"));
const vm = require(R("session-viewmodel.js"));
const { headerIdentity, windowTitle, sendButtonMode, sendButtonLabel, growHeight } = chrome;
const { streamLane, laneClass } = chrome;

const HTML = readFileSync(R("session.html"), "utf8");
const CSS = readFileSync(R("session.css"), "utf8");
const TOKENS = readFileSync(R("tokens.css"), "utf8");
const JS = readFileSync(R("session.js"), "utf8");

// ── D1: ONE identity priority — taskTitle > peer > channel > "Session" ────────

test("headerIdentity: the task title wins the header, the peer becomes the subtitle", () => {
  const id = headerIdentity({ taskTitle: "Ship the invoice import", from: "David", channelName: "Ops" });
  assert.equal(id.title, "Ship the invoice import");
  assert.equal(id.subtitle, "David", "the next identity down rides the caption line");
  assert.equal(id.avatarName, "David", "the avatar still keys off the PEER when we know one");
});

test("headerIdentity: no task title -> the peer name IS the header, no subtitle echo", () => {
  const id = headerIdentity({ from: "David", channelName: "Ops" });
  assert.equal(id.title, "David");
  assert.equal(id.subtitle, "", "the channel is not printed under the peer");
  assert.equal(id.avatarName, "David");
});

test("headerIdentity: no task title and no peer -> the channel name", () => {
  const id = headerIdentity({ channelName: "Ops room" });
  assert.equal(id.title, "Ops room");
  assert.equal(id.subtitle, "");
  assert.equal(id.avatarName, "Ops room", "with no peer the avatar initials come from the title");
});

test("headerIdentity: nothing at all -> 'Session' (the last-resort label)", () => {
  for (const init of [null, undefined, {}, { taskTitle: null, from: null, channelName: null }]) {
    const id = headerIdentity(init);
    assert.equal(id.title, "Session");
    assert.equal(id.subtitle, "");
    assert.equal(id.avatarName, "Session", "the avatar is ALWAYS drawable — never a black box");
  }
});

test("headerIdentity: a task title with no peer falls back to the channel for the subtitle", () => {
  assert.equal(headerIdentity({ taskTitle: "Reconcile Q3", channelName: "Ops" }).subtitle, "Ops");
  assert.equal(headerIdentity({ taskTitle: "Reconcile Q3" }).subtitle, "", "nothing left to show");
});

test("headerIdentity: blank / whitespace-only fields count as absent", () => {
  const id = headerIdentity({ taskTitle: "   ", from: "\n\t", channelName: "Ops" });
  assert.equal(id.title, "Ops");
  assert.equal(id.subtitle, "");
});

test("headerIdentity bounds a counterparty-controlled name: one line, 80 chars", () => {
  const hostile = "A".repeat(200);
  const id = headerIdentity({ from: hostile });
  assert.ok(id.title.length <= 80, `title capped, got ${id.title.length}`);
  // Newlines / tabs collapse, so a name can never smuggle a second line into the header.
  const multi = headerIdentity({ from: "David\nBEGIN-REQUEST\tSmith" });
  assert.ok(!multi.title.includes("\n"));
  assert.ok(!multi.title.includes("\t"));
  assert.equal(multi.title, "David BEGIN-REQUEST Smith", "collapsed to one line, still plain text");
});

test("windowTitle follows the SAME priority, prefixed with the product name", () => {
  assert.equal(windowTitle({ taskTitle: "Ship the invoice import", from: "David" }), "Dopl · Ship the invoice import");
  assert.equal(windowTitle({ from: "David", channelName: "Ops" }), "Dopl · David");
  assert.equal(windowTitle({ channelName: "Ops" }), "Dopl · Ops");
  assert.equal(windowTitle(null), "Dopl · Session");
  assert.ok(!windowTitle(null).includes("—"), "no em dash in our own copy");
});

test("headerIdentity reads a REAL init reduced by the view-model (end to end)", () => {
  const s = vm.reduceEvent(vm.initialState(), {
    type: "init", sessionId: "s1", side: "responder", profile: "full", mode: "autonomous",
    channelName: "Ops", taskTitle: "Ship the invoice import", from: "David",
  });
  assert.equal(headerIdentity(s.init).title, "Ship the invoice import");
  assert.equal(windowTitle(s.init), "Dopl · Ship the invoice import");
});

// ── D5: the send/pause morph predicate ───────────────────────────────────────

test("sendButtonMode is 'pause' ONLY while a turn is running and working", () => {
  assert.equal(sendButtonMode({ phase: "running", activity: "working" }), "pause");
  assert.equal(sendButtonMode({ phase: "running", activity: "idle" }), "send");
  assert.equal(sendButtonMode({ phase: "running", activity: null }), "send");
  assert.equal(sendButtonMode({ phase: "running", activity: "awaiting_peer" }), "send");
  // A non-running phase never pauses, even with a stale activity left on the state.
  for (const phase of ["launching", "consent", "parked", "awaiting_permission", "interrupted", "ended"]) {
    assert.equal(sendButtonMode({ phase, activity: "working" }), "send", `${phase} keeps Send`);
  }
  assert.equal(sendButtonMode(null), "send");
  assert.equal(sendButtonMode({}), "send");
});

test("sendButtonMode tracks the REAL viewmodel status events", () => {
  let s = vm.initialState();
  assert.equal(sendButtonMode(s), "send", "a launching session shows Send");
  s = vm.reduceEvent(s, { type: "status", phase: "running", activity: "working" });
  assert.equal(sendButtonMode(s), "pause");
  s = vm.reduceEvent(s, { type: "status", phase: "running", activity: "idle" });
  assert.equal(sendButtonMode(s), "send");
  s = vm.reduceEvent(s, { type: "status", phase: "parked" });
  assert.equal(sendButtonMode(s), "send", "a parked session offers Send, not Pause");
});

// ── FIX #6: the gate phase must not make the button lie ───────────────────────────
// The inbound gate rides on `phase` (a pending card pins it to awaiting_inbound so the pill
// keeps reading "Message waiting"), while `activity` still says what the agent is doing. If
// the predicate keyed on phase==='running' alone, a turn that is genuinely mid-flight showed
// Send and the operator had no way to pause it for as long as a card sat unanswered.

test("FIX #6: a mid-flight turn is still pausable while a message waits at the gate", () => {
  assert.equal(sendButtonMode({ phase: "awaiting_inbound", activity: "working" }), "pause");
  // Everything else under the gate phase keeps Send — nothing to pause.
  for (const activity of ["idle", "awaiting_peer", "awaiting_permission", "awaiting_inbound", "parked", null]) {
    assert.equal(sendButtonMode({ phase: "awaiting_inbound", activity }), "send", `activity ${activity}`);
  }
});

test("FIX #6: the pill and the button stay truthful across a real gate sequence", () => {
  let s = vm.reduceEvent(vm.initialState(), { type: "status", phase: "running", activity: "working" });
  assert.equal(sendButtonMode(s), "pause");
  // The gate holds a message mid-turn: the pill names the card, the button keeps Send
  // because the reducer's hold reports the session as awaiting the operator.
  s = vm.reduceEvent(s, { type: "status", phase: "awaiting_inbound", activity: "awaiting_inbound" });
  assert.equal(vm.statusText(s.phase, s.activity), "Message waiting");
  assert.equal(sendButtonMode(s), "send");
  // The operator types instead of answering: the agent is working again, the card remains.
  s = vm.reduceEvent(s, { type: "status", phase: "awaiting_inbound", activity: "working" });
  assert.equal(vm.statusText(s.phase, s.activity), "Message waiting", "the card is still the headline");
  assert.equal(sendButtonMode(s), "pause", "but the live turn can be paused");
  // Answering it releases the phase.
  s = vm.reduceEvent(s, { type: "status", phase: "running", activity: "working" });
  assert.equal(vm.statusText(s.phase, s.activity), "Working");
  assert.equal(sendButtonMode(s), "pause");
});

test("sendButtonLabel gives the exact aria-labels, with no em dash", () => {
  assert.equal(sendButtonLabel("send"), "Send");
  assert.equal(sendButtonLabel("pause"), "Pause the agent");
  assert.equal(sendButtonLabel("nonsense"), "Send", "unknown mode falls back to Send");
  assert.ok(!sendButtonLabel("pause").includes("—"));
});

// ── D7: composer auto-grow cap math ──────────────────────────────────────────
// A 14px body at line-height 1.5 == 21px per line, with 12px vertical padding:
// one line = 33px, the 3-line cap = 75px.

test("growHeight grows with the content up to exactly 3 line-heights, then stops", () => {
  assert.equal(growHeight(33, 21, 3, 12), 33, "one line");
  assert.equal(growHeight(54, 21, 3, 12), 54, "two lines");
  assert.equal(growHeight(75, 21, 3, 12), 75, "three lines — the cap, exactly");
  assert.equal(growHeight(76, 21, 3, 12), 75, "one px past the cap is clamped");
  assert.equal(growHeight(600, 21, 3, 12), 75, "a long paste is clamped (the field scrolls)");
});

test("growHeight never shrinks below one line", () => {
  assert.equal(growHeight(0, 21, 3, 12), 33);
  assert.equal(growHeight(10, 21, 3, 12), 33);
  assert.equal(growHeight(-50, 21, 3, 12), 33, "a bogus scrollHeight still yields one line");
});

test("growHeight folds the vertical padding into both the floor and the cap", () => {
  assert.equal(growHeight(600, 21, 3, 0), 63, "no padding -> 3 * 21");
  assert.equal(growHeight(600, 21, 3, -5), 63, "a negative padding is treated as 0");
  assert.equal(growHeight(600, 20, 2, 8), 48, "2 * 20 + 8");
});

test("growHeight degrades safely on a non-numeric or missing line-height", () => {
  assert.equal(growHeight(200, 0, 3, 12), 200, "no measurable line-height -> the raw scrollHeight");
  assert.equal(growHeight(200, NaN, 3, 12), 200);
  assert.equal(growHeight(200, "21", 3, "12"), 75, "numeric strings (getComputedStyle) parse");
  assert.equal(growHeight(200, 21, 0, 12), 75, "a bogus maxLines falls back to 3");
  assert.equal(growHeight(200, 21, 1, 12), 33, "maxLines 1 pins it to one line");
});

// ── chat lanes: the item-KIND → alignment mapping ─────────────────────────────
// RE-PINNED for v2.7 L1. The window is now two-SIDED, not two-SPEAKER: the right lane is
// everything that originates on THIS machine (the operator's typed turns, HIS agent's
// text, and the agent's tool activity) and the left lane is only what the peer sent back.
// So an assistant/agent turn moved 'them' -> 'me' and a tool card moved null -> 'me'.

test("streamLane: EVERY turn takes the right ('me') lane — typed or spoken by my agent", () => {
  assert.equal(streamLane({ kind: "turn", role: "operator" }), "me");
  assert.equal(streamLane({ kind: "turn", role: "user" }), "me");
  // v2.7 L1: the agent's own text is MINE, not the peer's — it moved to the right lane.
  assert.equal(streamLane({ kind: "turn", role: "assistant" }), "me");
  assert.equal(streamLane({ kind: "turn", role: "agent" }), "me");
  // An unknown / missing role is still this machine's output -> still the right lane.
  assert.equal(streamLane({ kind: "turn" }), "me");
  assert.equal(streamLane({ kind: "turn", role: "weird" }), "me");
});

test("streamLane: a tool card is my agent's own work, so it takes the right lane too", () => {
  assert.equal(streamLane({ kind: "tool" }), "me", "v2.7 L1: commands sit with my side");
  assert.equal(laneClass({ kind: "tool" }), "lane-me");
});

test("streamLane: the counterparty's inbound reply is the ONLY left ('them') lane", () => {
  assert.equal(streamLane({ kind: "counterparty", from: "David" }), "them");
});

test("streamLane: decisions and system lines get NO lane (full stream width)", () => {
  // A DECISION is neither side of the conversation, so the outbound card, the inbound
  // gate card and every system line keep the full width.
  for (const kind of ["outbound", "outbound_pending", "inbound_pending", "notice", "history_divider", "milestone", "thinking"]) {
    assert.equal(streamLane({ kind }), null, `${kind} must stay full width`);
    assert.equal(laneClass({ kind }), "", `${kind} carries no lane class`);
  }
  assert.equal(streamLane(null), null, "a junk item is never laned");
  assert.equal(streamLane({}), null);
  assert.equal(laneClass(undefined), "");
});

test("laneClass returns the exact CSS class names the stylesheet defines", () => {
  assert.equal(laneClass({ kind: "turn", role: "operator" }), "lane-me");
  assert.equal(laneClass({ kind: "turn", role: "assistant" }), "lane-me");
  assert.equal(laneClass({ kind: "counterparty" }), "lane-them");
});

test("streamLane reads REAL view-model items (kind stamped by reduceEvent)", () => {
  let s = vm.reduceEvent(vm.initialState(), { type: "turn", role: "operator", text: "go" });
  s = vm.reduceEvent(s, { type: "turn", role: "assistant", text: "on it" });
  s = vm.reduceEvent(s, { type: "counterparty", from: "David", text: "thanks" });
  s = vm.reduceEvent(s, { type: "tool_use", toolUseId: "t1", name: "Bash", inputFull: {} });
  s = vm.reduceEvent(s, { type: "outbound_post", to: "David", text: "sent" });
  s = vm.reduceEvent(s, { type: "inbound_pending", pendingId: "p1", from: "David", text: "wait" });
  s = vm.reduceEvent(s, { type: "paused" }); // the v2.3 park notice
  assert.deepEqual(
    s.items.map((it) => streamLane(it)),
    ["me", "me", "them", "me", null, null, null]
  );
  // A PENDING post (v2.7 L3) is the same `outbound` kind, and still un-laned.
  const gated = vm.reduceEvent(vm.initialState(), { type: "outbound_post", toolUseId: "t2", to: "David", text: "draft", pending: true });
  assert.equal(streamLane(gated.items[0]), null, "the decision card is full width too");
});

test("the lane recipes live in the stylesheet and own align-self + the 66% cap", () => {
  assert.deepEqual(declsOf(CSS, ".lane-me"), { "align-self": "flex-end", "max-width": "66%" });
  assert.deepEqual(declsOf(CSS, ".lane-them"), { "align-self": "flex-start", "max-width": "66%" });
  // No laned item's SURFACE recipe may re-declare alignment: `.bubble.role-x` is two
  // classes and would outrank the single-class lane selector.
  for (const role of [".bubble.role-agent", ".bubble.role-operator", ".bubble.role-counterparty"]) {
    assert.ok(!("align-self" in declsOf(CSS, role)), `${role} carries the surface only`);
  }
  // v2.7 L1/L2: the tool card is LANED now, so its recipe must not pin itself either.
  const tool = declsOf(CSS, ".tool-card");
  assert.ok(!("align-self" in tool), "the laned tool card lets the lane class align it");
  assert.equal(tool["min-width"], "0", "the item-4 overflow guards stay");
  assert.equal(tool["max-width"], "100%");
  // v2.7 CASCADE: the lanes are declared AFTER the surfaces they must beat, because
  // .bubble / .tool-card carry `max-width: 100%` at the same single-class specificity.
  // Read off the PARSED rules, so a selector that is only mentioned in a comment (or has
  // been deleted outright) cannot satisfy the ordering with an indexOf of -1.
  const at = (sel) => {
    const rule = ruleOf(CSS, sel);
    assert.ok(rule, `${sel} must be a real rule`);
    return rule.open;
  };
  assert.ok(at(".lane-me") > at(".bubble"), "lanes come after .bubble");
  assert.ok(at(".lane-me") > at(".tool-card"), "and after .tool-card");
  // Decisions + system lines keep the full width via their own recipes.
  const outbound = declsOf(CSS, ".outbound");
  assert.equal(outbound["align-self"], "stretch");
  assert.equal(outbound["max-width"], "100%");
  assert.equal(declsOf(CSS, ".inbound-pending")["align-self"], "stretch");
});

// ── v2.7 L2: the command line is markedly smaller and the box is gone ─────────

test("L2: the tool card drops the box (border / radius / fill / card padding)", () => {
  const tool = declsOf(CSS, ".tool-card");
  assert.ok(!("border-radius" in tool), "no boxy card frame");
  assert.notEqual(tool.overflow, "hidden");
  assert.ok(!("background" in tool), "no card fill");
  assert.equal(tool["border-left"], "1px solid var(--border-strong)", "at most a hairline left rule");
  // The head no longer paints its own band, and the body is not an inset well.
  const head = declsOf(CSS, ".tool-card__head");
  assert.ok(!("background" in head) && !("border-bottom" in head), "the head band is gone");
  const body = declsOf(CSS, ".tool-card__body");
  assert.ok(!("background" in body) && !("box-shadow" in body), "the inset well is gone");
});

// ── v2.x FIX 2/3/4: aligned width, lowercase name, LEFT arrow, no "Show details" ──────

test("FIX 2: the laned tool card fills the lane (width:100%) so command lines share a left edge", () => {
  assert.equal(declsOf(CSS, ".tool-card").width, "100%", "the card no longer shrinks to fit its content");
  // The 66% number stays in ONE place — the lane recipe caps it; the card only fills to it.
  assert.equal(declsOf(CSS, ".lane-me")["max-width"], "66%");
});

test("FIX 3: the tool name is LOWERCASE, never re-uppercased", () => {
  const name = declsOf(CSS, ".tool-card__name");
  assert.equal(name["text-transform"], "lowercase", "bash / list_calendars / dopl_channel, not shouted");
});

test("FIX 4: the disclosure is a LEFT ::before arrow on the head; the right chevron + row are gone", () => {
  // The head is the <details> summary now: it toggles, hides the native marker, and carries
  // the LEFT arrow that rotates open. The reduced-motion guard survives.
  const head = declsOf(CSS, ".tool-card__head");
  assert.equal(head.cursor, "pointer");
  assert.equal(head["list-style"], "none");
  assert.equal(declsOf(CSS, ".tool-card__head::-webkit-details-marker").display, "none");
  const arrow = declsOf(CSS, ".tool-card__head::before");
  assert.equal(arrow.content, '"›"');
  assert.match(arrow.transition, /^transform /);
  assert.equal(declsOf(CSS, ".tool-card[open] > .tool-card__head::before").transform, "rotate(90deg)");
  // The SAME selector again, this time inside the reduced-motion query (`at` picks it).
  assert.equal(declsOf(CSS, ".tool-card__head::before", { at: "prefers-reduced-motion" }).transition, "none");
  // The OLD right-side chevron on the body summary is fully removed — asked of the parsed
  // selector list, so the prose above it can mention the rule without resurrecting it.
  assert.ok(!hasRule(CSS, ".tool-card__body > summary"), "no body>summary rule survives");
  assert.ok(!anySelector(CSS, /\.tool-card__body\[open\]/), "no body[open] chevron rule survives");
});

test("L2: the type ramp steps DOWN and the overflow guards are intact", () => {
  const parts = [".tool-card", ".tool-card__head", ".tool-card__name", ".tool-card__summary"];
  for (const sel of parts) {
    assert.notEqual(declsOf(CSS, sel)["font-size"], "var(--text-small)", `${sel} is not 12px any more`);
  }
  const summary = declsOf(CSS, ".tool-card__summary");
  assert.equal(summary["font-size"], "var(--text-caption)", "the args preview steps to 11.5px");
  assert.equal(declsOf(CSS, ".tool-card__name")["font-size"], "var(--text-micro)");
  // v2.0 garble fixes (the reason this card was boxed in the first place) must survive.
  assert.equal(summary["text-overflow"], "ellipsis");
  assert.equal(summary["min-width"], "0");
  assert.equal(summary.flex, "1");
  const pre = declsOf(CSS, ".tool-card__body pre");
  assert.equal(pre["white-space"], "pre-wrap", "the pre still wraps");
  assert.equal(pre["overflow-wrap"], "anywhere");
  // SCROLL FIX: the pre's cap is deliberately re-pinned from 240px to 60vh — small enough
  // that a megabyte Write input cannot out-stand the scrollback, large enough that the box
  // is almost never the thing scrolling (and session.js forwards the wheel when it is).
  // (The old global `!/max-height: 240px/` grep is GONE: it pinned a magic number that no
  // longer exists anywhere, so it could only ever fail for an unrelated reason.)
  assert.equal(pre["max-height"], "60vh", "a LARGE cap, not a 240px wheel trap");
  assert.equal(pre.overflow, "auto");
  assert.deepEqual(declsOf(CSS, ".stream > *"), { flex: "0 0 auto" }, "stream children keep their natural height");
  // The status word stays legible at the smaller size (its own weight + colour keys).
  const status = declsOf(CSS, ".tool-status");
  assert.equal(status["font-size"], "var(--text-micro)");
  assert.equal(status["font-weight"], "600");
  assert.equal(declsOf(CSS, ".tool-status.is-ok").color, "var(--agent-on)");
  assert.equal(declsOf(CSS, ".tool-status.is-error").color, "var(--danger)");
});

// ── D2: the RESPONDER / FULL / AUTONOMOUS chip row is gone ───────────────────

test("D2: no badge row in the markup, the renderer, or the stylesheet", () => {
  assert.ok(!/badgeRow|badge-row/.test(HTML), "the #badgeRow node is removed from session.html");
  assert.ok(!/badgeRow|"badge"/.test(JS), "session.js no longer builds badge chips");
  // Asked of the DECLARED selectors, not of the raw text: the old `!/^\.badge/m` grep read
  // comments as readily as rules and depended on the recipe starting a line.
  assert.ok(!anySelector(CSS, /(^|[\s,>+~])\.badge/), "the .badge / .badge-row recipes are removed");
  // The profile/mode still REACH the renderer on init for future use.
  const s = vm.reduceEvent(vm.initialState(), { type: "init", side: "responder", profile: "full", mode: "autonomous" });
  assert.equal(s.init.side, "responder");
  assert.equal(s.init.profile, "full");
  assert.equal(s.init.mode, "autonomous");
});

// ── D1 markup: the avatar is always present, the black brand-mark is gone ────

test("D1: the black .brand-mark fallback is deleted; the peer avatar always shows", () => {
  assert.ok(!/brand-mark/.test(HTML), "no brand-mark node in session.html");
  assert.ok(!anySelector(CSS, /\.brand-mark/), "no .brand-mark recipe in session.css");
  assert.match(HTML, /id="peerAvatar"/, "the avatar token node stays");
  // The avatar recipe no longer starts hidden behind a `.has-peer` gate.
  assert.equal(declsOf(CSS, ".peer-avatar").display, "inline-flex", "the avatar is visible by default");
  assert.ok(!anySelector(CSS, /has-peer/), "the has-peer gate is gone with the brand-mark");
  assert.ok(!/has-peer/.test(JS));
});

// ── D3: the card sits FLUSH to the native title bar (shared recipe untouched) ─

test("D3: .app has no top padding and squares off only its TOP corners", () => {
  assert.equal(declsOf(CSS, ".app").padding, "0 8px 8px", "no top gap; sides + bottom keep the 8px inset");
  const float = declsOf(CSS, ".app.page-float");
  assert.equal(float["border-top-left-radius"], "0", "top-left squared");
  assert.equal(float["border-top-right-radius"], "0", "top-right squared");
  const squared = Object.keys(float).filter((p) => /^border-bottom-\w+-radius$/.test(p));
  assert.deepEqual(squared, [], "the bottom corners keep their radius");
});

test("D3: the SHARED .page-float recipe in tokens.css is NOT edited", () => {
  const float = declsOf(TOKENS, ".page-float");
  assert.equal(float["border-radius"], "14px", "the shared card radius is untouched");
  const overrides = Object.keys(float).filter((p) => /^border-top-\w+-radius$/.test(p));
  assert.deepEqual(overrides, [], "no session-specific override leaked into the kit");
});

// ── D4: the composer field lines up with the stream box ──────────────────────

test("D4: the composer has ZERO horizontal padding so it matches the stream width", () => {
  assert.deepEqual(declsOf(CSS, ".composer"), { padding: "10px 0" }, "10px vertical, 0 horizontal");
  // Both the stream box and the composer field are now inset only by .app's 8px.
  assert.equal(declsOf(CSS, ".app").padding, "0 8px 8px");
});

// ── D5 + D6: one compact icon button, no interrupt checkbox, no placeholder ──

test("D5: #btnSend is an icon button with BOTH inline SVG glyphs and an aria-label", () => {
  assert.match(HTML, /id="btnSend"[^>]*aria-label="Send"/, "idle aria-label is Send");
  assert.match(HTML, /class="send-btn auth-btn-3d"/, "it keeps the black kit face");
  assert.match(HTML, /send-btn__glyph--send/, "the up-arrow glyph");
  assert.match(HTML, /send-btn__glyph--pause/, "the pause glyph");
  assert.match(HTML, /<svg/, "the glyphs are INLINE svg (no external asset)");
  assert.ok(!/<img/.test(HTML), "no image asset was introduced");
  assert.ok(!/>Send</.test(HTML), "the text label is gone — it is an icon button now");
  // CSS swaps which glyph is visible off a single is-running class.
  assert.equal(declsOf(CSS, ".send-btn__glyph--pause").display, "none");
  assert.equal(declsOf(CSS, ".send-btn.is-running .send-btn__glyph--send").display, "none");
  assert.equal(declsOf(CSS, ".send-btn.is-running .send-btn__glyph--pause").display, "block");
});

test("D5: the Interrupt checkbox is gone and the renderer sends no priority", () => {
  assert.ok(!/interject/i.test(HTML), "no interject toggle in the markup");
  assert.ok(!/interject/i.test(CSS), "no .interject-toggle recipe");
  assert.ok(!/interject/i.test(JS), "no interject reference in the renderer");
  assert.match(JS, /bridge\.send\(text\)/, "a steer is always normal priority now");
  assert.ok(!/bridge\.send\(text, priority\)/.test(JS));
  // Running -> interrupt; not running -> send. Both routed through the pure predicate.
  assert.match(JS, /sendButtonMode\(state\) === "pause"/);
  assert.match(JS, /bridge\.interrupt\(\)/, "the pause click uses the existing interrupt IPC");
});

test("D5: the header Stop / End session / Close thread buttons are unchanged", () => {
  assert.match(HTML, /id="btnStop"[^>]*>Stop</);
  assert.match(HTML, /id="btnEnd"[^>]*>End session</);
  assert.match(HTML, /id="btnClose"[^>]*>Close thread</);
});

test("D6: the steer placeholder is deleted with no replacement text", () => {
  const ta = between(HTML, '<textarea class="steer-input"', "composer__controls", "steer field");
  assert.ok(!/placeholder/.test(ta), "no placeholder attribute on the steer field");
  assert.ok(!/Steer the agent/.test(HTML), "the old hint copy is gone everywhere");
  assert.ok(!/Shift\+Enter/.test(HTML));
});

// ── D7 markup: the CSS cap is derived from the real line-height ──────────────

test("D7: the field caps at 3 line-heights in CSS and grows via an input listener", () => {
  const field = declsOf(CSS, ".steer-input");
  assert.equal(field["line-height"], "1.5");
  assert.equal(field["max-height"], "calc(4.5em + 12px)", "3 * 1.5em + the 12px vertical padding");
  assert.equal(field["min-height"], "calc(1.5em + 12px)", "one line at rest");
  assert.equal(field["overflow-y"], "auto", "past the cap it scrolls");
  assert.equal(field.resize, "none", "the manual resize handle stays off");
  assert.match(JS, /addEventListener\("input", autoGrow\)/);
  assert.match(JS, /autoGrow\(\); \/\/ D7: back to a single line after send/);
});

// ── invariants: the security posture of this surface is unchanged ─────────────

test("the renderer stays textContent-only and the CSP is untouched", () => {
  assert.ok(!/\.innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(JS));
  const chromeSrc = readFileSync(R("session-chrome.js"), "utf8");
  assert.ok(!/document|innerHTML|electron|require\("electron"\)/.test(chromeSrc.replace(/\/\/.*$/gm, "")),
    "session-chrome.js is a pure string/number module (no DOM, no electron)");
  assert.match(HTML, /default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:/);
  assert.match(HTML, /<script src="session-chrome\.js"><\/script>/, "the chrome module is loaded as a local script");
  // The §2 formatter split (v2.7) is a local script too, loaded BEFORE the view-model that
  // re-exports it — load order is what makes the re-export work in the sandbox.
  assert.match(HTML, /<script src="session-format\.js"><\/script>/);
  assert.ok(orderOf(HTML, "session-format.js", "session-viewmodel.js", "script order"), "load order matters");
  const formatSrc = readFileSync(R("session-format.js"), "utf8");
  assert.ok(!/document|innerHTML|electron|require\("electron"\)/.test(formatSrc.replace(/\/\/.*$/gm, "")),
    "session-format.js is a pure string module (no DOM, no electron)");
  assert.equal(vm.summarizeToolInput("Bash", { command: "ls" }), "$ ls", "and the view-model re-exports it");
});
