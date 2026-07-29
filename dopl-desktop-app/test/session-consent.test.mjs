// Tests for the pre-consent decision core (main/session-consent.js, Track T3).
// SOURCE EXTRACTION: the BEGIN/END SESSION-CONSENT block has no electron / SDK / fs
// refs, so we slice it from the real source and evaluate it verbatim in a plain Node
// context — the test can never drift from what ships (same idiom as session-reducer /
// the consent-watcher WATCHER-PURE block).
//
// The security-critical property (item 8, §H-1): `consentTransition` NEVER returns a
// start-query effect from the pending state — NO agent/tool/SDK work before Accept.
// Accept resolves only to `approve` (flip the consent row + poke the watcher) and an
// emit; the SDK query is started later by the engine adopting the window, never here.
// This is asserted STRUCTURALLY below (no effect type outside a tiny whitelist, and
// never a start-query descriptor, for EVERY event applied to a pending window).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-consent.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-CONSENT";
const END = "// ─── END SESSION-CONSENT";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-CONSENT sentinel missing");
assert.notEqual(to, -1, "END SESSION-CONSENT sentinel missing");
assert.ok(to > from, "session-consent sentinels out of order");
const BLOCK = SRC.slice(from, to);

const { initialConsentState, consentTransition } = new Function(
  `${BLOCK}
   return { initialConsentState, consentTransition };`
)();

const effTypes = (effects) => effects.map((e) => e.type);
const findEff = (effects, type) => effects.find((e) => e.type === type);

// ── initial state ────────────────────────────────────────────────────────────

test("initialConsentState is a fresh pending window", () => {
  assert.deepEqual(initialConsentState(), { phase: "pending" });
});

// ── pending -> accepted (ADOPT path) ─────────────────────────────────────────

test("pending + accept -> accepted; approve (row+poke) + consent_resolved:accepted, NO start-query", () => {
  const r = consentTransition({ phase: "pending" }, { type: "accept" });
  assert.equal(r.state.phase, "accepted");
  assert.deepEqual(effTypes(r.effects), ["approve", "emit"]);
  // `approve` flips the consent row + pokes the watcher; it does NOT run agent work.
  assert.deepEqual(findEff(r.effects, "approve"), { type: "approve" });
  const emitted = findEff(r.effects, "emit");
  assert.deepEqual(emitted.payload, { type: "consent_resolved", decision: "accepted" });
});

// ── pending -> denied (calm echo + close) ────────────────────────────────────

test("pending + deny -> denied; a single decline effect (the row is denied + poked)", () => {
  const r = consentTransition({ phase: "pending" }, { type: "deny" });
  assert.equal(r.state.phase, "denied");
  assert.deepEqual(r.effects, [{ type: "decline" }]);
});

// ── pending -> parked (OS close without deciding / local expiry) ──────────────

test("pending + park -> parked with NO effects (row stays pending, answerable later)", () => {
  const r = consentTransition({ phase: "pending" }, { type: "park" });
  assert.equal(r.state.phase, "parked");
  assert.deepEqual(r.effects, []);
});

test("pending + expire -> parked with NO effects (mirrors park; row untouched here)", () => {
  const r = consentTransition({ phase: "pending" }, { type: "expire" });
  assert.equal(r.state.phase, "parked");
  assert.deepEqual(r.effects, []);
});

test("an unknown event on a pending window is an inert no-op (still pending)", () => {
  const r = consentTransition({ phase: "pending" }, { type: "wat" });
  assert.equal(r.state.phase, "pending");
  assert.deepEqual(r.effects, []);
});

// ── idempotency / first-answer-wins ──────────────────────────────────────────

test("every terminal phase ignores every later event — no re-fire (first-answer-wins)", () => {
  for (const phase of ["accepted", "denied", "parked"]) {
    const state = { phase };
    for (const ev of [{ type: "accept" }, { type: "deny" }, { type: "park" }, { type: "expire" }]) {
      const r = consentTransition(state, ev);
      assert.equal(r.state, state, `${phase} state returned unchanged`);
      assert.deepEqual(r.effects, [], `${phase} + ${ev.type} fires no effects`);
    }
  }
});

test("accept then accept: the second accept is a no-op (window already accepted)", () => {
  const first = consentTransition({ phase: "pending" }, { type: "accept" });
  const second = consentTransition(first.state, { type: "accept" });
  assert.deepEqual(second.effects, [], "a re-click cannot re-approve or re-emit");
});

// ── STRUCTURAL: no work before accept (§H-1) ─────────────────────────────────

test("NO transition from pending EVER returns a start-query effect (no agent work pre-Accept)", () => {
  const ALLOWED = new Set(["approve", "decline", "emit"]);
  const FORBIDDEN = /start|query|spawn|sdk|tool|mcp|launch|exec|run/i;
  for (const type of ["accept", "deny", "park", "expire", "adopt", "close", "wat", undefined]) {
    const { effects } = consentTransition({ phase: "pending" }, { type });
    for (const eff of effects) {
      assert.ok(ALLOWED.has(eff.type), `pending+${type} produced a non-whitelisted effect: ${eff.type}`);
      assert.doesNotMatch(eff.type, FORBIDDEN, `pending+${type} produced a work-shaped effect: ${eff.type}`);
    }
  }
});
