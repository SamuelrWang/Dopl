// F-118 — THE CONSENT CARD's "Open in Claude Code" button (renderer half).
//
// WHERE IT LANDS AND WHY. The desktop pre-consent window (main/session-consent.js ->
// session-render.makeConsent) is the surface that already asks "answer this request?", and
// it is the only one with room for a third answer. The v1.4 NATIVE NOTIFICATION keeps its
// two actions untouched: it is an OS banner with no way to report which rung was used and
// no way to relabel Accept afterwards.
//
// THE PROPERTY THE WHOLE FEATURE RESTS ON: the button DECIDES NOTHING. It never sends a
// consent decision, so the row stays pending on the server and Accept still spawns a Dopl
// session afterwards. That is why Accept is RELABELLED rather than disabled, and it is
// asserted here by driving the real factories with a bridge that would throw if the
// decision channel were touched.
//
// Two layers, the same discipline as session-gate-dom.test.mjs:
//   1. PURE  — the copy helpers (no DOM).
//   2. DOM-EXEC — a tiny document stub, so the REAL session-render.makeConsent and the REAL
//      session-attended-ui.mount build the card and the click is really fired.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { orderOf, fnOf, declsOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));

// REQUIRED BEFORE THERE IS A `document`, on purpose: both modules must touch the DOM only
// INSIDE a factory, never at module load, or a node require of either would throw here.
const attendedUi = require(R("session-attended-ui.js"));
const render = require(R("session-render.js"));

const ATTENDED_SRC = readFileSync(R("session-attended-ui.js"), "utf8");
const RENDER_SRC = readFileSync(R("session-render.js"), "utf8");
const JS = readFileSync(R("session.js"), "utf8");
const HTML = readFileSync(R("session.html"), "utf8");
const CSS = readFileSync(R("session.css"), "utf8");

// ── 1. PURE: the copy ─────────────────────────────────────────────────────────

test("the button says what it does, and Accept is relabelled rather than removed", () => {
  assert.equal(attendedUi.LABEL, "Open in Claude Code");
  assert.equal(attendedUi.OPENED_LABEL, "Opened in Claude Code");
  // Accept survives the handoff, so it has to say what it now MEANS: the alternative, not
  // the default. Nothing in this string implies the request was decided.
  assert.equal(attendedUi.SPAWN_INSTEAD, "Start a Dopl session instead");
});

test("each rung tells the operator what to do next, and a failure claims nothing", () => {
  assert.equal(
    attendedUi.resolvedNote("deep-link"),
    "Opened in Claude Code. The prompt is waiting there, unsent. Press Enter to start it."
  );
  assert.equal(attendedUi.resolvedNote("clipboard"), "Prompt copied. Paste it into Claude Code and press Enter.");
  assert.equal(attendedUi.resolvedNote(undefined), attendedUi.resolvedNote("deep-link"), "an unknown route reads as the link");
  assert.match(attendedUi.failureNote("bad-id"), /nothing was opened\. Accept still works\./);
  assert.match(attendedUi.failureNote("no-card"), /no longer open on this machine/);
  assert.match(attendedUi.failureNote(undefined), /Nothing was sent, and Accept still works\./);
  for (const note of ["deep-link", "clipboard"].map(attendedUi.resolvedNote).concat(
    ["bad-id", "no-card", undefined].map(attendedUi.failureNote),
    [attendedUi.LABEL, attendedUi.OPENED_LABEL, attendedUi.SPAWN_INSTEAD, attendedUi.BUSY_LABEL, attendedUi.BUSY_NOTE]
  )) {
    assert.doesNotMatch(note, /[—–]/, `house voice, no em dash: ${note}`);
  }
});

// ── DOM stub ─────────────────────────────────────────────────────────────────

function makeEl(tag) {
  const node = {
    tagName: String(tag).toUpperCase(), className: "", textContent: "", children: [],
    disabled: false, type: "", _listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(k, fn) { (this._listeners[k] = this._listeners[k] || []).push(fn); },
    fire(k) { for (const fn of this._listeners[k] || []) fn({}); },
    replaceChildren(...kids) { this.children = kids.slice(); },
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

const hasClass = (node, cls) => !!node.className && node.className.split(/\s+/).includes(cls);
function findByClass(node, cls) {
  if (!node) return null;
  if (hasClass(node, cls)) return node;
  for (const child of node.children || []) {
    const hit = findByClass(child, cls);
    if (hit) return hit;
  }
  return null;
}

const CONSENT = { from: "David Chen", summary: "a request", channelName: "Ops", toolProfileLabel: "Full", cwdLabel: "~/Downloads" };

// Build the REAL card, wired exactly the way session.js wires it.
function card(over = {}) {
  const calls = { handoff: 0, args: [], decisions: [] };
  const result = over.result === undefined ? { ok: true, route: "deep-link" } : over.result;
  const bridge = "bridge" in over ? over.bridge : {
    attendedHandoff(...args) {
      calls.handoff++;
      calls.args.push(args);
      // `defer` hands the test the resolvers, so a decision can land WHILE the round trip
      // is out (FIX H-2's race: the card can go terminal before main answers).
      if (over.defer) return new Promise((res, rej) => { calls.settle = { res, rej }; });
      return over.rejects ? Promise.reject(new Error("bridge died")) : Promise.resolve(result);
    },
  };
  const ctx = {
    onConsentDecide: (d) => calls.decisions.push(d),
    attended: over.noHook ? null : (row, accept, note) => attendedUi.mount(row, accept, note, bridge),
  };
  const rec = render.makeConsent(CONSENT, ctx);
  const actions = findByClass(rec.el, "consent-actions");
  return {
    rec, calls, actions,
    note: findByClass(rec.el, "consent-note"),
    buttons: actions.children,
    labels: actions.children.map((b) => b.textContent),
    attend: actions.children.find((b) => b.textContent === attendedUi.LABEL) || null,
    accept: actions.children[0],
    deny: actions.children[actions.children.length - 1],
  };
}

// A microtask flush: mount() stamps the card on the bridge promise, exactly like the inbound
// gate does, so nothing may be asserted until that promise has settled.
const settle = () => Promise.resolve().then(() => {}).then(() => {}).then(() => {});

// ── 2. DOM-EXEC ───────────────────────────────────────────────────────────────

test("DOM: the button renders BESIDE Accept, before Deny", () => {
  const c = card();
  assert.deepEqual(c.labels, ["Accept", "Open in Claude Code", "Deny"]);
  assert.equal(c.attend.tagName, "BUTTON");
  assert.equal(c.attend.type, "button", "never a submit");
  assert.equal(c.attend.className, "ctl btn-light", "the secondary control style, not the primary one");
  assert.equal(c.attend.disabled, false);
});

test("DOM: the click asks main with NO argument, and never sends a consent decision", async () => {
  const c = card();
  c.attend.fire("click");
  await settle();
  assert.equal(c.calls.handoff, 1);
  assert.deepEqual(c.calls.args, [[]], "no id, no text: main resolves the card from the window");
  assert.deepEqual(c.calls.decisions, [], "the request was NOT accepted, denied or otherwise resolved");
});

test("DOM: a deep-link handoff marks the card and leaves Accept LIVE, relabelled", async () => {
  const c = card();
  c.attend.fire("click");
  await settle();
  assert.equal(c.note.textContent, attendedUi.resolvedNote("deep-link"));
  assert.ok(!hasClass(c.note, "hidden"), "the note is shown");
  assert.equal(c.attend.textContent, "Opened in Claude Code");
  assert.equal(c.attend.disabled, true, "one click, one terminal window");
  // THE POINT OF THE WHOLE DESIGN: the request is still answerable the Dopl way.
  assert.equal(c.accept.textContent, "Start a Dopl session instead");
  assert.equal(c.accept.disabled, false, "Accept is never disabled by a handoff");
  assert.equal(c.buttons[2].disabled, false, "and neither is Deny");
  c.accept.fire("click");
  assert.deepEqual(c.calls.decisions, ["accept"], "clicking it afterwards still spawns, exactly as today");
});

test("DOM: the clipboard rung says paste, and is otherwise identical", async () => {
  const c = card({ result: { ok: true, route: "clipboard" } });
  c.attend.fire("click");
  await settle();
  assert.equal(c.note.textContent, "Prompt copied. Paste it into Claude Code and press Enter.");
  assert.equal(c.accept.textContent, "Start a Dopl session instead");
  assert.equal(c.accept.disabled, false);
});

test("DOM: a refusal hands the button back and leaves Accept's label alone", async () => {
  for (const [reason, result] of [["bad-id", { ok: false, reason: "bad-id" }], ["no-card", { ok: false, reason: "no-card" }], ["nothing", null]]) {
    const c = card({ result });
    c.attend.fire("click");
    await settle();
    assert.equal(c.note.textContent, attendedUi.failureNote(result && result.reason), reason);
    assert.equal(c.attend.textContent, attendedUi.LABEL, `${reason}: retryable`);
    assert.equal(c.attend.disabled, false, `${reason}: the button comes back`);
    assert.equal(c.accept.textContent, "Accept", `${reason}: nothing happened, so nothing is relabelled`);
    assert.deepEqual(c.calls.decisions, []);
  }
});

test("DOM: a rejected invoke is a refusal too, never an unhandled rejection", async () => {
  const c = card({ rejects: true });
  c.attend.fire("click");
  await settle();
  assert.equal(c.note.textContent, attendedUi.failureNote("error"));
  assert.equal(c.attend.disabled, false);
  assert.equal(c.accept.textContent, "Accept");
});

test("DOM: a double click is ONE handoff (every invocation opens its own terminal window)", async () => {
  const c = card();
  c.attend.fire("click");
  c.attend.fire("click");
  c.attend.fire("click");
  await settle();
  assert.equal(c.calls.handoff, 1);
});

test("DOM: an older preload (no attendedHandoff) renders NO button at all", () => {
  // A dead control that reports "unsupported" on click is worse than an absent one on a card
  // whose other two buttons work. Same version-skew discipline as the composer.
  for (const bridge of [{}, { consentDecision() {} }, { attendedHandoff: "not a function" }, null, undefined]) {
    const c = card({ bridge });
    assert.deepEqual(c.labels, ["Accept", "Deny"], JSON.stringify(bridge));
    assert.equal(c.attend, null);
  }
  // ...and a card built with no hook at all (a harness, or a mid-wave caller) is unchanged.
  assert.deepEqual(card({ noHook: true }).labels, ["Accept", "Deny"]);
});

// ── FIX H-2: the third control joins the card's terminal-state lock ───────────
//
// It did not, and lock() only knew about Accept and Deny. Two live consequences, both of
// them a request answered twice: Accept then "Open in Claude Code" ran an attended session
// AND a spawning Dopl session on one request; Deny then the button prefilled a session to
// answer a request the operator had just declined (the registry entry lingers decided-but-
// present, so main would still have resolved the card from the window and opened the link).

test("DOM FIX H-2: after Accept the attended button is DISABLED, and a click does nothing", async () => {
  const c = card();
  c.accept.fire("click");
  assert.equal(c.attend.disabled, true, "the third control is locked with the pair");
  c.attend.fire("click");
  await settle();
  assert.equal(c.calls.handoff, 0, "no handoff on a request that is already being spawned");
  assert.deepEqual(c.calls.decisions, ["accept"], "and no second decision either");
  assert.equal(c.attend.textContent, attendedUi.LABEL, "nothing claims Claude Code was opened");
});

test("DOM FIX H-2: after Deny the attended button is DISABLED, and a click does nothing", async () => {
  const c = card();
  c.deny.fire("click");
  assert.equal(c.deny.textContent, "Deny", "the right button really is Deny");
  assert.equal(c.attend.disabled, true);
  c.attend.fire("click");
  await settle();
  assert.equal(c.calls.handoff, 0, "a declined request is never prefilled into a session");
  assert.deepEqual(c.calls.decisions, ["deny"]);
});

test("DOM FIX H-2: a terminal decision from ELSEWHERE (denied / expired) locks it too", () => {
  for (const [decision, note] of [["denied", "Request declined."], ["expired", "This request expired."]]) {
    const c = card();
    c.rec.update(decision); // the controller's path when the row is resolved off-window
    assert.equal(c.attend.disabled, true, decision);
    assert.equal(c.accept.disabled, true, decision);
    assert.equal(c.note.textContent, note, decision);
  }
});

test("DOM FIX H-2: a decision taken MID-FLIGHT wins, and the late answer changes nothing", async () => {
  // The lock can land while the invoke is out. From that moment the module says nothing more
  // about the card: no button handed back, no relabelled Accept, no note over the terminal one.
  const finishes = {
    refusal: (s) => s.res({ ok: false, reason: "error" }),
    success: (s) => s.res({ ok: true, route: "deep-link" }),
    rejection: (s) => s.rej(new Error("bridge died")),
  };
  for (const [label, finish] of Object.entries(finishes)) {
    const c = card({ defer: true });
    c.attend.fire("click");
    c.deny.fire("click");
    finish(c.calls.settle);
    await settle();
    assert.equal(c.attend.disabled, true, `${label}: the button stays locked`);
    assert.equal(c.note.textContent, "Declining the request…", `${label}: the terminal note stands`);
    assert.equal(c.accept.textContent, "Accept", `${label}: nothing is relabelled on a decided card`);
    assert.deepEqual(c.calls.decisions, ["deny"], `${label}: exactly one decision`);
  }
});

// ── L-2: a hook that throws must not take the card down ──────────────────────

test("L-2 DOM: a hook that THROWS costs the third button only; Accept and Deny survive", () => {
  const decisions = [];
  const ctx = {
    onConsentDecide: (d) => decisions.push(d),
    attended: () => { throw new Error("mount blew up"); },
  };
  let rec;
  assert.doesNotThrow(() => { rec = render.makeConsent(CONSENT, ctx); }, "the card still builds");
  const actions = findByClass(rec.el, "consent-actions");
  assert.deepEqual(actions.children.map((b) => b.textContent), ["Accept", "Deny"]);
  actions.children[1].fire("click");
  assert.deepEqual(decisions, ["deny"], "Deny still decides");
  // ...and lock() does not trip over the node it never got.
  assert.equal(actions.children[0].disabled, true);
  assert.equal(findByClass(rec.el, "consent-note").textContent, "Declining the request…");
});

test("DOM: mount() is inert without a row, and returns the node it made otherwise", () => {
  assert.equal(attendedUi.mount(null, null, null, { attendedHandoff() {} }), null);
  const row = makeEl("div");
  const rec = attendedUi.mount(row, null, null, { attendedHandoff() {} });
  assert.equal(rec.el, row.children[0], "appended to the row it was given");
  assert.doesNotThrow(() => row.children[0].fire("click"), "a missing accept / note is not a crash");
});

// ── 3. STRUCTURAL: the wiring, and the security discipline ────────────────────

test("makeConsent calls the hook where the button belongs, guarded, and LOCKS what it returns", () => {
  const fn = fnOf(RENDER_SRC, "makeConsent");
  assert.match(fn, /if \(ctx && typeof ctx\.attended === "function"\) attended = ctx\.attended\(actions, accept, note\);/);
  assert.ok(orderOf(fn, "actions.appendChild(accept);", "ctx.attended(actions", "makeConsent"), "after Accept");
  assert.ok(orderOf(fn, "ctx.attended(actions", "actions.appendChild(deny);", "makeConsent"), "and before Deny");
  assert.equal(fn.split("ctx.attended(").length - 1, 1, "one call site");
  // FIX H-2: the returned node is disabled by the SAME lock() Accept and Deny take, and the
  // record is stamped so a round trip still in flight knows the card is no longer answerable.
  assert.match(fn, /if \(attended\) \{ attended\.locked = true; attended\.el\.disabled = true; \}/);
  assert.ok(orderOf(fn, "let attended = null;", "const lock = (msg) =>", "makeConsent"), "held before the lock closes over it");
  assert.equal(fn.split("attended.el.disabled").length - 1, 1, "one place disables it: the lock");
  // L-2: the hook is called inside a try, so a throwing mount cannot cost Accept and Deny.
  assert.ok(orderOf(fn, "try {", "ctx.attended(actions", "makeConsent"), "the call sits inside a try");
  assert.match(fn, /\} catch \(_err\) \{ \/\* no third control; the pair still works \*\/ \}/);
});

test("session.js reads the module's global and hands it the bridge, and nothing else", () => {
  assert.match(JS, /const attendedUi = globalThis\.DoplSessionAttendedUI \|\| null; \/\/ F-118 consent-card button/);
  assert.match(JS, /attended: attendedUi \? \(row, accept, note\) => attendedUi\.mount\(row, accept, note, bridge\) : null,/);
  // OPTIONAL at boot, like the composer modules: a harness that stubs only VM / chrome /
  // render still opens the window, just without the third button.
  // The SCRIPT TAGS, not the bare filenames: session.js is named in a comment far above.
  assert.ok(
    orderOf(HTML, 'src="session-attended-ui.js"', 'src="session.js"', "session.html"),
    "loaded before the controller that reads its global"
  );
  assert.match(HTML, /<script src="session-attended-ui\.js"><\/script>/);
});

test("the action row can hold three controls without squeezing the card", () => {
  assert.equal(declsOf(CSS, ".consent-actions")["flex-wrap"], "wrap");
});

test("every string reaches the DOM via textContent, and the module reads no request data", () => {
  // Full-line comments dropped: this module EXPLAINS that it uses no innerHTML, and a raw
  // grep would read that sentence as the thing it forbids.
  const code = ATTENDED_SRC.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), "no HTML parsing");
  assert.match(code, /node\.textContent = text;/, "text is set as text");
  // It never even SEES the request: no body, no summary, no name, no id. Its whole input is
  // three nodes and a bridge, which is why there is nothing here to sanitize.
  assert.match(code, /function mount\(row, accept, note, bridge\) \{/);
  for (const field of ["bodyText", "summary", "requestId", "taskTitle", "channelId", "from"]) {
    assert.ok(!new RegExp(`\\b${field}\\b`).test(code), `the module reads ${field}`);
  }
  // `document` is touched only inside the el() factory, never at module load (this file
  // requires the module before there is a document at all, which is the live proof).
  assert.equal(code.split("document.").length - 1, 1);
  assert.match(fnOf(ATTENDED_SRC, "el"), /document\.createElement\(tag\)/);
});
