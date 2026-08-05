// Tests for renderer/session/session-address.js — the COMPOSER ADDRESSEE PILL's pure layer
// (rollback plan §3.2), plus the structural pins for the markup / CSS / wiring it drives.
//
// The module is UMD-wrapped and dependency-light (session-format.js only), so it loads
// directly via createRequire like session-chrome.js does. The DOM half is
// test/session-address-dom.test.mjs.
//
// WHAT IS WORTH PINNING HERE, given v2.8's `@` picker had ~500 lines of tests for the same two
// destinations: almost none of it. The tokenizer, the matcher, the caret state machine and the
// "an unrecognized tag is not a tag" rule are all GONE, because a picked target is a variable
// and the draft is plain text. What is left is the copy, the fallbacks, the one safety rule
// (`resolveTarget` collapsing a stale 'peer'), and the two stream reducer cases.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { declsOf, hasRule, orderOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const addr = require(R("session-address.js"));

const HTML = readFileSync(R("session.html"), "utf8");
const CSS = readFileSync(R("session.css"), "utf8");
const JS = readFileSync(R("session.js"), "utf8");
const SRC = readFileSync(R("session-address.js"), "utf8");

// ── the rows ──────────────────────────────────────────────────────────────────

test("the resting target is the WINDOW you are looking at, not the peer", () => {
  assert.equal(addr.DEFAULT_TARGET, addr.TARGET_SELF);
});

test("both rows are offered when the session has a counterparty", () => {
  const rows = addr.targetOptions({ sessionName: "flint", peerName: "David" });
  assert.deepEqual(rows.map((r) => r.key), ["self", "peer"]);
  assert.equal(rows[0].label, "Message flint");
  assert.equal(rows[1].label, "Message David");
});

test("each row states its CONSEQUENCE, and the peer row says whose agent picks it up", () => {
  const rows = addr.targetOptions({ sessionName: "flint", peerName: "David" });
  assert.match(rows[0].hint, /Steers the agent in this window/);
  // The two facts the operator cannot see: my agent is not involved, and theirs is.
  assert.match(rows[1].hint, /Their agent picks it up/);
  assert.match(rows[1].hint, /yours does not see it/);
});

test("NO counterparty -> the self row ALONE, and the menu says why", () => {
  const rows = addr.targetOptions({ sessionName: "flint", peerName: "" });
  assert.deepEqual(rows.map((r) => r.key), ["self"]);
  assert.equal(addr.note(rows), addr.SOLO_NOTE);
  assert.match(addr.SOLO_NOTE, /no counterparty/);
  // ...and says nothing at all when there IS a peer row.
  assert.equal(addr.note(addr.targetOptions({ peerName: "David" })), "");
});

test("a session with no handle yet names the WINDOW, never a placeholder agent", () => {
  // Main answers the handle over IPC after mount, and a desktop older than §3.2 never
  // answers at all. "Message this session" is true in both cases; "Message agent" is not.
  assert.equal(addr.selfLabel(""), "Message this session");
  assert.equal(addr.selfLabel(null), "Message this session");
  assert.equal(addr.peerLabel(""), "Message the peer");
});

test("both names are one-lined and bounded (they are counterparty-controlled text)", () => {
  const rows = addr.targetOptions({ sessionName: "a", peerName: "Da\nvid   Q" + "x".repeat(400) });
  assert.ok(!rows[1].label.includes("\n"), "no newline reaches the pill's face");
  assert.ok(rows[1].label.length <= "Message ".length + 80, "capped at the shared NAME_CAP");
  assert.match(addr.targetOptions({ peerName: "Da\nvid" })[1].label, /^Message Da vid$/);
});

// ── resolveTarget: the one safety rule ────────────────────────────────────────

test("a HELD 'peer' collapses to the steer once the peer row is gone", () => {
  // The peer name rides `init`, so a window can be picked-on and then re-inited (a park's
  // recreate, an auth hold's synthesized init) into a session with no counterparty. A stale
  // 'peer' would route the draft to sendToPeer, which posts with NO addressee at all.
  const solo = addr.targetOptions({ sessionName: "flint", peerName: "" });
  assert.equal(addr.resolveTarget("peer", solo), "self", "the words stay on this machine");
  assert.equal(addr.labelFor("peer", solo), "Message flint", "and the face agrees");
  const both = addr.targetOptions({ sessionName: "flint", peerName: "David" });
  assert.equal(addr.resolveTarget("peer", both), "peer");
});

test("a garbage target resolves to the steer, never to the peer", () => {
  const both = addr.targetOptions({ sessionName: "flint", peerName: "David" });
  for (const bad of [undefined, null, "", "constructor", "toString", "PEER", 0]) {
    assert.equal(addr.resolveTarget(bad, both), "self", String(bad));
  }
});

// ── the two stream reducer cases ──────────────────────────────────────────────

const base = () => ({ items: [] });

test("operator_post paints its OWN kind — not a turn, not an outbound", () => {
  const st = addr.reducePeerMessage(base(), {
    type: "operator_post", localId: "p1", to: "David", text: "ship it",
  });
  assert.deepEqual(st.items, [{
    kind: "peer_message", localId: "p1", to: "David", text: "ship it",
    status: "sending", avatarKey: "self",
  }]);
  // A turn would claim my agent saw it; an outbound would claim my agent drafted it.
  assert.equal(st.items[0].kind, "peer_message");
});

test("the who-line's name is bounded tighter than the pill's (FIX F1)", () => {
  const st = addr.reducePeerMessage(base(), {
    type: "operator_post", localId: "p1", to: "D".repeat(400), text: "x",
  });
  assert.ok(st.items[0].to.length <= 60, "an unbounded name pushed the body off screen");
  assert.match(addr.peerMessageWho("David"), /^You to David's agent$/);
  assert.match(addr.peerMessageWho(""), /^You to their agent$/);
});

test("the result FAILS CLOSED: only ok===true ever paints Sent", () => {
  const sent = (ok) => {
    const st = addr.reducePeerMessage(base(), { type: "operator_post", localId: "p1", text: "x" });
    return addr.reducePeerMessage(st, { type: "operator_post_result", localId: "p1", ok }).items[0].status;
  };
  assert.equal(sent(true), "sent");
  for (const bad of [false, undefined, null, "true", 1]) {
    assert.equal(sent(bad), "failed", String(bad));
  }
  assert.equal(addr.statusText("sent"), "Sent");
  assert.equal(addr.statusText("failed"), "Not sent");
  assert.equal(addr.statusText(undefined), "Sending");
});

test("a result stamps ONE bubble, and never re-stamps a settled one", () => {
  let st = base();
  st = addr.reducePeerMessage(st, { type: "operator_post", localId: "p1", text: "a" });
  st = addr.reducePeerMessage(st, { type: "operator_post", localId: "p1", text: "b" });
  st = addr.reducePeerMessage(st, { type: "operator_post_result", localId: "p1", ok: true });
  assert.deepEqual(st.items.map((i) => i.status), ["sent", "sending"], "the oldest match only");
  const again = addr.reducePeerMessage(st, { type: "operator_post_result", localId: "p1", ok: false });
  assert.deepEqual(again.items.map((i) => i.status), ["sent", "failed"], "a settled bubble is never reopened");
});

test("an event with no localId, and an unrelated event, both pass the state through", () => {
  const st = base();
  assert.equal(addr.reducePeerMessage(st, { type: "operator_post", text: "x" }), st);
  assert.equal(addr.reducePeerMessage(st, { type: "turn", localId: "p1" }), st);
  assert.equal(addr.reducePeerMessage(st, null), st);
});

// ── invariants ────────────────────────────────────────────────────────────────

test("the pure module is DOM / electron free and builds no markup", () => {
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const banned of ["document", "innerHTML", "electron", "ipcRenderer", "createElement"]) {
    assert.ok(!CODE.includes(banned), `session-address.js must not reference ${banned}`);
  }
});

test("no em dashes in copy that reaches the DOM", () => {
  for (const s of [addr.SELF_HINT, addr.PEER_HINT, addr.SOLO_NOTE, addr.MENU_LABEL,
    addr.selfLabel("flint"), addr.peerLabel("David"), addr.peerMessageWho("David")]) {
    assert.ok(!s.includes("—"), s);
  }
});

// ── the markup / CSS / wiring the pure layer drives ───────────────────────────

test("the pill lives INSIDE the composer field, beside send, with no baked-in copy", () => {
  assert.match(HTML, /id="btnTarget"[^>]*aria-haspopup="menu"/, "it announces its menu");
  assert.match(HTML, /id="btnTarget"[^>]*aria-controls="targetPop"/);
  assert.ok(orderOf(HTML, 'class="composer__controls"', 'id="btnTarget"', "pill placement"),
    "the pill is inside the field's control cluster, not in a row above it");
  assert.ok(orderOf(HTML, 'id="btnTarget"', 'id="btnSend"', "pill/send order"));
  // The face is written by JS: "Message flint" needs a handle main has not answered at parse
  // time, and a hardcoded placeholder would flash the wrong name.
  assert.match(HTML, /<span class="target-pill__label" id="targetLabel"><\/span>/);
});

test("the menu is out of flow above the field, so it never joins the flex sizing", () => {
  assert.match(HTML, /id="targetPop"[^>]*role="menu"/);
  assert.match(HTML, /class="target-pop hidden"/, "empty and hidden until the pill is clicked");
  const pop = declsOf(CSS, ".target-pop");
  assert.equal(pop.position, "absolute");
  assert.equal(pop.bottom, "calc(100% - 6px)", "it opens UPWARD: the composer is at the bottom");
  assert.equal(declsOf(CSS, ".composer").padding, "10px 0", "D4 is untouched");
  assert.ok(hasRule(CSS, ".composer"), "and the positioning context it needs still exists");
});

test("the pill and the bubble are token-only (no hardcoded colors)", () => {
  for (const sel of [".target-pill", ".target-opt__label", ".target-opt__hint",
    ".target-pop__note", ".bubble.role-peer-msg", ".peer-msg__status"]) {
    const decls = declsOf(CSS, sel);
    for (const [prop, value] of Object.entries(decls)) {
      assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(value), `${sel} { ${prop}: ${value} } hardcodes a color`);
    }
  }
});

test("the peer bubble's recipe is SURFACE ONLY, so it cannot outrank its lane", () => {
  // A 2-class selector beats .lane-me, so an align-self or width here would break the
  // right-lane alignment every other me-kind item gets.
  const decls = declsOf(CSS, ".bubble.role-peer-msg");
  for (const banned of ["align-self", "width", "max-width", "margin-left", "margin-right"]) {
    assert.ok(!(banned in decls), `.bubble.role-peer-msg must not declare ${banned}`);
  }
  assert.equal(decls["border-style"], "dashed", "what separates 'I said this' from 'I steered'");
});

test("both modules load as local scripts, BEFORE the controller that wires them", () => {
  // The markers are the FULL script tags, never the bare filenames: both names also appear in
  // this file's prose, and `session-address-ui.js` is named in a comment ABOVE the tag for
  // `session-address.js` — which is the marker-inside-a-comment inversion source-probe exists
  // to catch, and which caught it here.
  const tag = (f) => `<script src="${f}"></script>`;
  for (const f of ["session-address.js", "session-address-ui.js"]) assert.ok(HTML.includes(tag(f)), f);
  assert.ok(orderOf(HTML, tag("session-format.js"), tag("session-address.js"), "script order"),
    "the pure layer reads session-format.oneLine and throws without it");
  assert.ok(orderOf(HTML, tag("session-render.js"), tag("session-address-ui.js"), "script order"),
    "the DOM layer reads render.el / render.avatarNode");
  assert.ok(orderOf(HTML, tag("session-address.js"), tag("session-address-ui.js"), "script order"));
  assert.ok(orderOf(HTML, tag("session-address-ui.js"), tag("session.js"), "script order"));
});

// ── the main-process half: where the handle comes from ────────────────────────

test("the handle handler is READ-ONLY, and does not defer this session's park", () => {
  const IPC = readFileSync(fileURLToPath(new URL("../main/session-ipc.js", import.meta.url)), "utf8");
  const at = IPC.indexOf("ipcMain.handle('session:agent-name'");
  assert.notEqual(at, -1, "registered");
  assert.equal(IPC.split("ipcMain.handle('session:agent-name'").length - 1, 1, "exactly once");
  const handler = IPC.slice(at, IPC.indexOf("});", at));
  assert.match(handler, /getSessionBySender/, "the session is re-derived from event.sender, never trusted");
  assert.ok(!/engine\.dispatch/.test(handler), "reading a name is not a lifecycle event");
  // touch() bumps the LRU stamp, i.e. defers eviction. A window asking its own name at mount
  // is not the operator using it, so this read must not keep a parked shell alive.
  assert.ok(!/\btouch\(/.test(handler), "a passive read must not defer a park");
  assert.match(handler, /sessionSummary\.nameForSession\(s\)/, "the ledger's name, not a second one");
});

test("the preload exposes the read with no argument to forge", () => {
  const PRELOAD = readFileSync(R("session-preload.js"), "utf8");
  assert.match(PRELOAD, /agentName\(\) \{\n\s*return ipcRenderer\.invoke\('session:agent-name', \{\}\);\n\s*\},/);
});

test("the controller routes a peer draft AWAY from the steer, and never interrupts on one", () => {
  assert.match(JS, /if \(composer\.target\(\) === "peer"\)/, "the target decides the path");
  assert.match(JS, /if \(!composer\.send\(text\)\) return;/, "a refusal leaves the draft in the field");
  assert.match(JS, /sendButtonMode\(state\) === "pause" && composer\.target\(\) !== "peer"/,
    "a peer post is not a turn, so there is nothing of its own to interrupt");
  // The delegation is Escape-only. Enter must never be consumed by the menu: that contention
  // is exactly what the `@` popup had to solve and the pill does not have.
  assert.match(JS, /composer\.handleKey\(e\)/);
  assert.ok(!/composer\.handleKey\([^)]*\)[\s\S]{0,80}accept/i.test(JS), "no accept-on-Enter path");
});
