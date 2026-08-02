// THE REQUEST LIFECYCLE STRIP, renderer half — one line saying where a sent request got to.
//
// It exists because a requester had no answer at all between pressing send and a reply landing:
// the peer's accept or decline never reached this machine's window. The line reads Sent ->
// Accepted / Declined / Replied, and every state is driven by an event already on the wire.
//
// THE SHAPE IS FORCED BY THE §2 CAP. session.js, session-render.js and session-viewmodel.js are
// at (or within three lines of) the 500-line limit, and this line needs nothing any of them
// holds — no transcript item, no reducer state, no factory. So it takes the session-auth-ui.js
// route instead: one static element, one narrow preload sink, a self-contained script. This file
// pins that route end to end, because the parts are in four different files and none of them
// fails on its own if one goes missing.
//
// No jsdom: a tiny element stub lets the real module be EXERCISED, and the markup / CSS / preload
// claims are read structurally through helpers/source-probe.mjs, which parses rather than greps.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { declsOf, ruleOf, orderOf } from "./helpers/source-probe.mjs";

const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const M = (p) => fileURLToPath(new URL("../main/" + p, import.meta.url));
const UI = readFileSync(R("session-request-ui.js"), "utf8");
const HTML = readFileSync(R("session.html"), "utf8");
const CSS = readFileSync(R("session.css"), "utf8");
const PRELOAD = readFileSync(R("session-preload.js"), "utf8");
const PARK = readFileSync(M("session-park.js"), "utf8");

const require = createRequire(import.meta.url);
const ring = (() => {
  const src = readFileSync(M("session-replay.js"), "utf8");
  const from = src.indexOf("// ─── BEGIN SESSION-REPLAY-RING");
  const to = src.indexOf("// ─── END SESSION-REPLAY-RING");
  assert.ok(from !== -1 && to > from, "SESSION-REPLAY-RING sentinels missing");
  return new Function(`${src.slice(from, to)}\n return { createRing, ringRecord, isPinned };`)();
})();

// ── the module, exercised ───────────────────────────────────────────────────────

function elStub() {
  const classes = new Set(["hidden"]); // the markup ships hidden
  return {
    textContent: null,
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name),
    },
    classes,
  };
}

// The module is an IIFE with no exports, so it is evaluated with `document` / `window` as
// parameters — the same way it sees them as free variables in the page.
function mount(over = {}) {
  const cfg = { element: true, bridge: true, ...over };
  const el = elStub();
  const doc = { getElementById: (id) => (id === "requestStatus" && cfg.element ? el : null) };
  let handler = null;
  const win = { doplSession: cfg.bridge ? { request: { onStatus: (cb) => { handler = cb; } } } : {} };
  new Function("document", "window", UI)(doc, win);
  return { el, send: (payload) => handler(payload), bound: () => typeof handler === "function" };
}

test("each of the four states paints its own words", () => {
  const cases = [
    ["sent", "Request sent"],
    ["accepted", "Request accepted"],
    ["declined", "Request declined"],
    ["replied", "Reply received"],
  ];
  for (const [status, text] of cases) {
    const h = mount();
    h.send({ type: "request_status", status });
    assert.equal(h.el.textContent, text, status);
    assert.equal(h.el.classList.contains("hidden"), false, `${status} is visible`);
  }
});

test("the two OUTCOMES take a tone class; the two in-flight states stay muted", () => {
  const tones = { sent: [], accepted: [], declined: ["is-declined"], replied: ["is-replied"] };
  for (const status of Object.keys(tones)) {
    const h = mount();
    h.send({ type: "request_status", status });
    assert.equal(h.el.classList.contains("is-declined"), tones[status].includes("is-declined"), status);
    assert.equal(h.el.classList.contains("is-replied"), tones[status].includes("is-replied"), status);
  }
});

test("a later state REPLACES the earlier one, tone included", () => {
  const h = mount();
  h.send({ type: "request_status", status: "accepted" });
  h.send({ type: "request_status", status: "declined" });
  assert.equal(h.el.textContent, "Request declined");
  assert.equal(h.el.classList.contains("is-declined"), true);
  h.send({ type: "request_status", status: "replied" });
  assert.equal(h.el.classList.contains("is-declined"), false, "one tone at a time");
  assert.equal(h.el.classList.contains("is-replied"), true);
});

test("an UNKNOWN status paints nothing at all — the copy table is closed", () => {
  // The wire carries a status WORD, never display copy, so a payload can never put a string of
  // its own choosing on the screen. Anything outside the four hides the line instead.
  for (const bad of ["", "SENT", "acknowledged", "constructor", "toString", null, undefined, 7, {}, ["sent"]]) {
    const h = mount();
    h.send({ type: "request_status", status: bad });
    assert.equal(h.el.textContent, "", `status ${JSON.stringify(bad)} must paint nothing`);
    assert.equal(h.el.classList.contains("hidden"), true);
  }
  const junk = mount();
  junk.send(null);
  assert.equal(junk.el.textContent, "");
});

test("a session that never sent a request shows NO chrome: blank and hidden at boot", () => {
  const h = mount();
  assert.equal(h.el.textContent, "", "painted empty before any event");
  assert.equal(h.el.classList.contains("hidden"), true);
});

test("with no element or no bridge it binds nothing and throws nothing", () => {
  assert.doesNotThrow(() => mount({ element: false }), "a standalone open has no strip in the DOM");
  const noBridge = mount({ bridge: false });
  assert.equal(noBridge.bound(), false, "an older preload simply never delivers a status");
  assert.equal(noBridge.el.textContent, "", "and the line stays blank rather than half-drawn");
});

test("every string reaches the DOM through textContent — no innerHTML anywhere", () => {
  assert.ok(!UI.includes("innerHTML"), "the strip never builds markup");
  assert.ok(!UI.includes("insertAdjacent"));
});

// ── the markup ──────────────────────────────────────────────────────────────────

test("the strip element is in the status strip, hidden, and carries the type scale", () => {
  assert.match(HTML, /<span class="request-status text-caption hidden" id="requestStatus"/,
    "static markup, shipped hidden, on the semantic type scale");
  // Between the context meter and the spacer: it belongs with the captions, not with the
  // controls, and it must not displace the existing children the layout suite pins in order.
  assert.equal(orderOf(HTML, 'id="ctxMeter"', 'id="requestStatus"', "session.html"), true);
  assert.equal(orderOf(HTML, 'id="requestStatus"', 'class="status-spacer"', "session.html"), true);
});

test("the module is loaded as a local script, AFTER the element exists", () => {
  assert.match(HTML, /<script src="session-request-ui\.js"><\/script>/);
  assert.equal(orderOf(HTML, 'id="requestStatus"', 'src="session-request-ui.js"', "session.html"), true);
  // It is independent of the transcript controller, exactly like the sign-in banner, so it
  // loads beside it rather than before it.
  assert.equal(orderOf(HTML, 'src="session.js"', 'src="session-request-ui.js"', "session.html"), true);
});

// ── the layout invariant the strip enforces on every text child ─────────────────

test("the line cannot grow the status strip by collapsing", () => {
  // The 550px-tall-strip rule (test/session-status-strip): every text child of the row needs a
  // one-line guarantee or an unshrinkable box. This has both.
  const d = declsOf(CSS, ".request-status");
  assert.equal(d["white-space"], "nowrap");
  assert.equal(d.overflow, "hidden");
  assert.equal(d["text-overflow"], "ellipsis");
  assert.equal(d.flex, "none", "it never joins the shrink budget");
});

test("the line stays inside the token vocabulary: no raw hex, no px font sizes", () => {
  for (const sel of [".request-status", ".request-status.is-replied", ".request-status.is-declined"]) {
    const rule = ruleOf(CSS, sel);
    assert.ok(rule, `${sel} is declared`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(rule.decls), `${sel} uses token colours only`);
    assert.ok(!/font-size:\s*\d/.test(rule.decls), `${sel} takes its size from .text-caption`);
  }
});

// ── the bridge ──────────────────────────────────────────────────────────────────

test("the preload fans the ONE type out to its own sink, buffering until it registers", () => {
  assert.match(PRELOAD, /const REQUEST_TYPES = \{ request_status: true \};/,
    "one payload type, named explicitly — never a prefix or a wildcard");
  assert.match(PRELOAD, /if \(payload && REQUEST_TYPES\[payload\.type\] === true\) \{/);
  // The transcript sink is UNCONDITIONAL below it, so the fan-out steals nothing from session.js
  // (whose view-model ignores the type in its `default` case).
  assert.equal(orderOf(PRELOAD, "REQUEST_TYPES[payload.type] === true", "if (typeof handler === 'function') deliver(payload);", "session-preload.js"), true);
  // Events emitted during window load must not be dropped before the script registers.
  assert.match(PRELOAD, /else requestBuffer\.push\(payload\);/);
  assert.match(PRELOAD, /if \(requestHandler && requestBuffer\.length\) \{/);
});

test("the bridge only RECEIVES: the strip has no control, so there is nothing to invoke", () => {
  const from = PRELOAD.indexOf("  request: {");
  const to = PRELOAD.indexOf("\n  },", from);
  assert.ok(from !== -1 && to > from, "the request member is declared on the bridge");
  const member = PRELOAD.slice(from, to);
  assert.ok(!member.includes("ipcRenderer.invoke"), "nothing on this surface calls into main");
  assert.equal((member.match(/\w+\(/g) || []).filter((s) => s === "onStatus(").length, 1, "exactly one member");
});

// ── the replay ──────────────────────────────────────────────────────────────────

test("a reload rebuilds the line: request_status is PINNED in the transcript ring", () => {
  assert.equal(ring.isPinned({ type: "request_status", status: "accepted" }), true);
  const r = ring.createRing(4, 1e9);
  ring.ringRecord(r, { type: "request_status", status: "sent" });
  for (let i = 0; i < 30; i += 1) ring.ringRecord(r, { type: "turn", text: "x".repeat(200) });
  assert.ok(r.entries.some((e) => e.type === "request_status"), "it survives eviction from the middle");
});

test("...and LAST-WINS, so four transitions leave ONE pinned entry, not four", () => {
  const r = ring.createRing(50, 1e9);
  for (const status of ["sent", "accepted", "replied"]) ring.ringRecord(r, { type: "request_status", status });
  const kept = r.entries.filter((e) => e.type === "request_status");
  assert.equal(kept.length, 1, "pins can never crowd out the transcript");
  assert.equal(kept[0].status, "replied", "and the survivor is the current state");
});

// ── the wire ────────────────────────────────────────────────────────────────────

test("main emits the FACT and nothing else — the copy lives in the renderer", () => {
  // Two emit sites, both carrying exactly {type, status}. If main ever started sending words,
  // the closed table above would stop being the only thing that can reach the screen.
  const sites = PARK.match(/deps\.emit\(s, \{ type: 'request_status'[^)]*\)/g) || [];
  assert.equal(sites.length, 2, "arm + advance, and no third writer");
  for (const site of sites) {
    assert.ok(!/text:|label:|title:/.test(site), `display copy on the wire: ${site}`);
  }
  // ...and the four words the renderer knows are the four the main-side rank table defines, so
  // neither side can grow a state the other cannot render.
  assert.match(PARK, /const REQUEST_STATUS_RANK = \{ sent: 0, accepted: 1, declined: 2, replied: 3 \};/);
  for (const status of ["sent", "accepted", "declined", "replied"]) {
    assert.ok(UI.includes(`${status}:`), `the renderer has copy for ${status}`);
  }
});
