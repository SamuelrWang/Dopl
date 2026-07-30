// Tests for the v1.7.4 P1/P2 renderer view-model additions (parked pill + inline paused
// note + reopen-shell notice) in renderer/session/session-viewmodel.js. Split out of
// session-render.test.mjs to keep both files under the §2 500-line cap. Same discipline:
// the module is DOM/electron-free and UMD-wrapped, so it loads directly via createRequire.
//
// v2.5 round 2 also homes the STATUS-PILL truth cases here: FIX #1 (the inbound-gate phase
// label) and FIX #17 (the gated variant of the paused note).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ruleOf, declsOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const vm = require(fileURLToPath(new URL("../renderer/session/session-viewmodel.js", import.meta.url)));
const { initialState, reduceEvent, statusText, statusDotKey, nextPermission } = vm;

const last = (s) => s.items[s.items.length - 1];

test("statusText/statusDotKey render a parked session as the calm 'Paused' pill", () => {
  // Parked is not `running`, so the phase label wins regardless of a stale activity.
  assert.equal(statusText("parked", null), "Paused");
  assert.equal(statusText("parked", "working"), "Paused");
  assert.equal(statusDotKey("parked", null), "is-parked");
});

test("a `status: parked` event moves the phase to parked (composer stays enabled — not ended)", () => {
  const s = reduceEvent(initialState(), { type: "status", phase: "parked" });
  assert.equal(s.phase, "parked");
  assert.equal(s.ended, null, "parked NEVER sets the ended state, so the composer stays enabled");
});

test("a `paused` event drops the one-line inline note (info level, no em dash)", () => {
  const s = reduceEvent(initialState(), { type: "paused" });
  assert.equal(last(s).kind, "notice");
  assert.equal(last(s).level, "info");
  assert.match(last(s).text, /^Paused after inactivity\./);
  assert.ok(!last(s).text.includes("—"), "renderer copy has no em dash");
});

// ── FIX #1: the inbound-gate phase label ──────────────────────────────────────────
// PHASE_LABEL.awaiting_inbound read "Awaiting reply", which says the INVERSE of what is
// true: nobody is waiting on the peer, the peer's message is already here waiting on the
// operator. The gate now rides on `phase` (FIX #6 pins it while a card is pending), so this
// label is what the pill shows whenever the operator has a message to answer.

test("FIX #1: the awaiting_inbound PHASE reads 'Message waiting', never 'Awaiting reply'", () => {
  for (const activity of [null, "working", "idle", "awaiting_peer", "awaiting_permission", "awaiting_inbound"]) {
    assert.equal(statusText("awaiting_inbound", activity), "Message waiting", `activity ${activity}`);
  }
  assert.equal(statusDotKey("awaiting_inbound", "working"), "is-awaiting_inbound");
  assert.ok(!statusText("awaiting_inbound", null).includes("—"), "no em dash in copy");
});

test("FIX #1: a `status` carrying the gate moves the pill (it only ever moves on a status)", () => {
  let s = reduceEvent(initialState(), { type: "status", phase: "running", activity: "working" });
  assert.equal(statusText(s.phase, s.activity), "Working");
  s = reduceEvent(s, { type: "status", phase: "awaiting_inbound", activity: "awaiting_inbound" });
  assert.equal(statusText(s.phase, s.activity), "Message waiting", "the held card is visible in the chrome");
});

// ── FIX #17: the paused note when the park lands on a HELD message ────────────────

test("FIX #17: a gated `paused` note stops telling the operator to wait for a reply", () => {
  const plain = reduceEvent(initialState(), { type: "paused" });
  const gated = reduceEvent(initialState(), { type: "paused", gated: true });
  assert.match(last(plain).text, /wait for a reply/, "the ungated copy is unchanged");
  assert.ok(!last(gated).text.includes("wait for a reply"), "the reply already arrived");
  assert.match(last(gated).text, /^Paused after inactivity\. Accept the waiting message/);
  assert.equal(last(gated).level, "info");
  for (const t of [last(plain).text, last(gated).text]) assert.ok(!t.includes("—"), "no em dash");
  // Anything other than an explicit true keeps the ordinary copy.
  for (const g of [false, null, undefined, "yes", 1]) {
    assert.equal(last(reduceEvent(initialState(), { type: "paused", gated: g })).text, last(plain).text, String(g));
  }
});

test("FIX #6: the park-emitted permission_resolved clears the renderer's permission dock", () => {
  // A pending gate is showing in the dock; park (main) emits permission_resolved{deny} for
  // it, and the renderer drops it so the parked, query-less window shows no live prompt.
  let s = reduceEvent(initialState(), {
    type: "permission_request", requestId: "r1", name: "Bash", inputSummary: "$ ls", inputFull: {},
  });
  assert.ok(nextPermission(s), "the dock shows the pending gate");
  s = reduceEvent(s, { type: "status", phase: "parked" });
  s = reduceEvent(s, { type: "permission_resolved", requestId: "r1", decision: "deny" });
  assert.equal(nextPermission(s), null, "the dock is cleared once park resolves the pending gate");
  assert.equal(s.phase, "parked", "the pill stays Paused — not a lying 'running'");
});

test("a `notice` event appends a caller-supplied calm line (P2 reopen shell)", () => {
  // FIX #14: main's reopen copy changed (it no longer points away from a window that is
  // about to PAINT the thread); the view-model just passes whatever main sends through.
  const s = reduceEvent(initialState(), { type: "notice", level: "info", text: "Reopened. Nothing is running yet, so send a message to continue." });
  assert.equal(last(s).kind, "notice");
  assert.equal(last(s).level, "info");
  assert.equal(last(s).text, "Reopened. Nothing is running yet, so send a message to continue.");
  // Level defaults to info; text coerces safely.
  const d = reduceEvent(initialState(), { type: "notice", text: null });
  assert.equal(last(d).level, "info");
  assert.equal(last(d).text, "");
});

// ── FIX F3: `is-request` is a LIVE class, not a dead marker ────────────────────
// Homed here rather than in session-render.test.mjs / session-render-dom.test.mjs, both of
// which are within a few lines of the §2 500-line cap. Structural on purpose: the class is
// applied by session-render.js and the ONLY thing that can make it visible is a CSS rule, so
// what a regression would look like is exactly one of these two halves going missing.

test("FIX F3: the initiating-request item is styled, so the opener is not just another turn", () => {
  const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
  const JS = readFileSync(R("session-render.js"), "utf8");
  const CSS = readFileSync(R("session.css"), "utf8");
  assert.match(JS, /rec\.el\.classList\.add\("is-request"\)/, "makeRequest still marks the opener");
  const rule = ruleOf(CSS, ".bubble.is-request");
  assert.ok(rule, "`is-request` must have a CSS rule (it had none at all: an invisible marker)");
  const decls = declsOf(CSS, ".bubble.is-request");
  const props = Object.keys(decls);
  assert.ok(props.some((p) => /^(background|border)/.test(p)), "the distinction is a surface / hairline one");
  // SURFACE ONLY, like .bubble.role-operator: a 2-class selector outranks .lane-me, so this
  // recipe must never take over the lane's alignment or width. Asked property by property, so
  // a `border-width` can never be mistaken for the banned `width`.
  for (const banned of ["align-self", "width", "max-width", "margin-left", "margin-right"]) {
    assert.ok(!(banned in decls), `${banned} belongs to the lane, not the surface`);
  }
  // Tokens only: no raw hex, no rgba() recipe of its own.
  const values = Object.values(decls).join(" ");
  assert.ok(!/#[0-9a-fA-F]{3,8}|rgba?\(/.test(values), values);
  assert.match(values, /var\(--/, "and it reaches for a token");
  // It must come AFTER the role surfaces (same specificity: source order is what makes it win).
  const operator = ruleOf(CSS, ".bubble.role-operator");
  assert.ok(operator, ".bubble.role-operator must exist for the ordering to mean anything");
  assert.ok(rule.open > operator.open, "declared last");
});
