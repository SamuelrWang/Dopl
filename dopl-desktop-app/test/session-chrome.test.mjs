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

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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

test("streamLane: an operator turn takes the right ('me') lane, an agent turn the left", () => {
  assert.equal(streamLane({ kind: "turn", role: "operator" }), "me");
  assert.equal(streamLane({ kind: "turn", role: "assistant" }), "them");
  assert.equal(streamLane({ kind: "turn", role: "agent" }), "them");
  // An unknown / missing role is still the agent's own text -> the left lane.
  assert.equal(streamLane({ kind: "turn" }), "them");
  assert.equal(streamLane({ kind: "turn", role: "weird" }), "them");
});

test("streamLane: the counterparty's inbound reply takes the left ('them') lane", () => {
  assert.equal(streamLane({ kind: "counterparty", from: "David" }), "them");
});

test("streamLane: every NON-conversational kind gets NO lane (full stream width)", () => {
  for (const kind of ["tool", "outbound", "inbound_pending", "notice", "milestone", "thinking"]) {
    assert.equal(streamLane({ kind }), null, `${kind} must stay full width`);
    assert.equal(laneClass({ kind }), "", `${kind} carries no lane class`);
  }
  assert.equal(streamLane(null), null, "a junk item is never laned");
  assert.equal(streamLane({}), null);
  assert.equal(laneClass(undefined), "");
});

test("laneClass returns the exact CSS class names the stylesheet defines", () => {
  assert.equal(laneClass({ kind: "turn", role: "operator" }), "lane-me");
  assert.equal(laneClass({ kind: "turn", role: "assistant" }), "lane-them");
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
    ["me", "them", "them", null, null, null, null]
  );
});

test("the lane recipes live in the stylesheet and own align-self + the 66% cap", () => {
  assert.match(CSS, /\.lane-me \{ align-self: flex-end; max-width: 66%; \}/);
  assert.match(CSS, /\.lane-them \{ align-self: flex-start; max-width: 66%; \}/);
  // The role recipes must NOT re-declare alignment: `.bubble.role-x` is two
  // classes and would outrank the single-class lane selector.
  const roles = CSS.slice(CSS.indexOf(".bubble.role-agent"), CSS.indexOf(".cp-head"));
  assert.ok(!/align-self/.test(roles), "role recipes carry the surface only");
  // Non-conversational stream items keep the full width.
  assert.match(CSS, /\.outbound \{\n\s*align-self: stretch;\n\s*max-width: 100%;/);
  assert.match(CSS, /\.tool-card \{\n\s*align-self: stretch;/);
  assert.match(CSS, /\.inbound-pending \{\n\s*align-self: stretch;/);
});

// ── D2: the RESPONDER / FULL / AUTONOMOUS chip row is gone ───────────────────

test("D2: no badge row in the markup, the renderer, or the stylesheet", () => {
  assert.ok(!/badgeRow|badge-row/.test(HTML), "the #badgeRow node is removed from session.html");
  assert.ok(!/badgeRow|"badge"/.test(JS), "session.js no longer builds badge chips");
  assert.ok(!/^\.badge/m.test(CSS), "the .badge / .badge-row recipes are removed");
  // The profile/mode still REACH the renderer on init for future use.
  const s = vm.reduceEvent(vm.initialState(), { type: "init", side: "responder", profile: "full", mode: "autonomous" });
  assert.equal(s.init.side, "responder");
  assert.equal(s.init.profile, "full");
  assert.equal(s.init.mode, "autonomous");
});

// ── D1 markup: the avatar is always present, the black brand-mark is gone ────

test("D1: the black .brand-mark fallback is deleted; the peer avatar always shows", () => {
  assert.ok(!/brand-mark/.test(HTML), "no brand-mark node in session.html");
  assert.ok(!/^\.brand-mark/m.test(CSS), "no .brand-mark recipe in session.css");
  assert.match(HTML, /id="peerAvatar"/, "the avatar token node stays");
  // The avatar recipe no longer starts hidden behind a `.has-peer` gate.
  const peer = CSS.slice(CSS.indexOf(".peer-avatar {"), CSS.indexOf(".channel-name"));
  assert.match(peer, /display: inline-flex/, "the avatar is visible by default");
  assert.ok(!/has-peer/.test(CSS), "the has-peer gate is gone with the brand-mark");
  assert.ok(!/has-peer/.test(JS));
});

// ── D3: the card sits FLUSH to the native title bar (shared recipe untouched) ─

test("D3: .app has no top padding and squares off only its TOP corners", () => {
  const app = CSS.slice(CSS.indexOf("\n.app {"), CSS.indexOf(".session-header,"));
  assert.match(app, /padding: 0 8px 8px/, "no top gap; sides + bottom keep the 8px inset");
  assert.match(app, /\.app\.page-float\s*\{[^}]*border-top-left-radius: 0/, "top-left squared");
  assert.match(app, /\.app\.page-float\s*\{[^}]*border-top-right-radius: 0/, "top-right squared");
  assert.ok(!/border-bottom-\w+-radius: 0/.test(app), "the bottom corners keep their radius");
});

test("D3: the SHARED .page-float recipe in tokens.css is NOT edited", () => {
  const float = TOKENS.slice(TOKENS.indexOf(".page-float {"), TOKENS.indexOf(".bento {"));
  assert.match(float, /border-radius: 14px/, "the shared card radius is untouched");
  assert.ok(!/border-top-left-radius/.test(TOKENS), "no session-specific override leaked into the kit");
});

// ── D4: the composer field lines up with the stream box ──────────────────────

test("D4: the composer has ZERO horizontal padding so it matches the stream width", () => {
  assert.match(CSS, /\.composer \{ padding: 10px 0; \}/, "10px vertical, 0 horizontal");
  // Both the stream box and the composer field are now inset only by .app's 8px.
  assert.match(CSS, /padding: 0 8px 8px/);
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
  assert.match(CSS, /\.send-btn__glyph--pause \{ display: none; \}/);
  assert.match(CSS, /\.send-btn\.is-running \.send-btn__glyph--send \{ display: none; \}/);
  assert.match(CSS, /\.send-btn\.is-running \.send-btn__glyph--pause \{ display: block; \}/);
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

test("D5: the header Stop / End session / Close task buttons are unchanged", () => {
  assert.match(HTML, /id="btnStop"[^>]*>Stop</);
  assert.match(HTML, /id="btnEnd"[^>]*>End session</);
  assert.match(HTML, /id="btnClose"[^>]*>Close task</);
});

test("D6: the steer placeholder is deleted with no replacement text", () => {
  const ta = HTML.slice(HTML.indexOf('<textarea class="steer-input"'), HTML.indexOf("composer__controls"));
  assert.ok(!/placeholder/.test(ta), "no placeholder attribute on the steer field");
  assert.ok(!/Steer the agent/.test(HTML), "the old hint copy is gone everywhere");
  assert.ok(!/Shift\+Enter/.test(HTML));
});

// ── D7 markup: the CSS cap is derived from the real line-height ──────────────

test("D7: the field caps at 3 line-heights in CSS and grows via an input listener", () => {
  const field = CSS.slice(CSS.indexOf(".steer-input {"), CSS.indexOf(".composer__controls"));
  assert.match(field, /line-height: 1\.5/);
  assert.match(field, /max-height: calc\(4\.5em \+ 12px\)/, "3 * 1.5em + the 12px vertical padding");
  assert.match(field, /min-height: calc\(1\.5em \+ 12px\)/, "one line at rest");
  assert.match(field, /overflow-y: auto/, "past the cap it scrolls");
  assert.match(field, /resize: none/, "the manual resize handle stays off");
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
});
