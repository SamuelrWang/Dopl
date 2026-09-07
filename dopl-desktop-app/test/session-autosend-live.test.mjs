// MESSAGING, READ LIVE AT THE GATE (2026-09-06, Samuel's settings overhaul, item 8 — successor
// to this file's 2026-08-31 AUTO-SEND suite).
//
// ⚠ THE FILE KEEPS ITS NAME ON PURPOSE. What it pins is not a record, it is a PROPERTY: the
// channel's send posture is consulted at the single Axis-B decision point on EVERY decision, so
// it applies to all of the operator's agents in that channel IMMEDIATELY — every spawn shape,
// every turn shape, ON and OFF alike. That property is what the 2026-08-31 ruling bought and it
// is unchanged; only the record behind it moved.
//
// THE DEFECT THE 2026-08-31 RULING CLOSED, reported by Samuel as "I toggled auto-posting and it
// still asks, and it has been broken forever": the switch was FROZEN into `state.messageMode` at
// launch and never consulted again, which gave it four silent ways to not be in effect —
//   1. a session already running never re-read the store, so it did nothing until relaunch;
//   2. a reopened/recreated shell drops its startModes (H2), flooring to auto_inbound;
//   3. a crash resume floors the same way;
//   4. a PRIVATE (panel) or DIRECTED turn withdrew the OUT half it had granted.
// Every one was individually deliberate; their SUM was a switch that read ON while every post
// asked. Shapes 1-3 are still pinned below, against the new source.
//
// ── ⚠ WHAT ITEM 8 CHANGED, AND WHAT IT DELIBERATELY DID NOT ────────────────────────────────
//
// AUTO-SEND IS GONE. It was a SECOND control over the SAME axis as the launch posture's
// `messages`, and the two disagreed by construction: `messages` was frozen at launch, auto-send
// was read live, and `autoSendMessageMode` FORCED the out half on over whatever `messages` said.
// An operator could set Messaging to `ask` and still have agents posting unattended.
//
//   · `autoSendMessageMode` is DELETED — there is nothing left to force, because Messaging IS
//     the posture. The old §1 "TRANSFORM" case died with it, and is not replaced: a test for a
//     function whose whole job was to override the operator's pick would be pinning the defect.
//   · `effectiveMessageMode` now reads `channel-prefs.getLaunchPosture(channelId).messages`
//     LIVE, falling back to the session's frozen value ONLY when the store cannot be read.
//   · **SHAPE 4 IS UNCHANGED IN THE END, AND THE ROUND TRIP IS WORTH RECORDING.** Item 8's first
//     draft applied the private-turn withdrawal ALWAYS — a reply drafted from the operator's own
//     private words would have waited for a Send click even at full auto. Samuel OVERTURNED that
//     on 2026-09-06: *"If the user puts auto let's just have it full auto."* An OUT-half posture
//     defeats the withdrawal, exactly as the deleted toggle did. The exposure is real and is
//     stated in `session-private.js`; his judgement is that a posture which says auto and then
//     holds a draft is the worse surprise. ⚠ THE RULING IS NARROW: only the OUT half defeats it,
//     so `ask` and `auto_inbound` still withdraw, and the IN half survives on every path.
//   · **THE WINDOWLESS FLOOR IS RE-APPLIED** at the live read. The stored value is the operator's
//     pick and carries no floor; the frozen one had one applied at launch. Without this, a
//     windowless session on a default (`ask`) channel would gate its own-channel READS — and a
//     gated read in a windowless session is a DENIED read, so the agent could not look at the
//     thread it was answering. That is F-236 reached from the other end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const M = (p) => join(MAIN, p);
const read = (p) => readFileSync(M(p), "utf8");

const priv = require(M("session-private.js"));
const profiles = require(M("session-profiles.js"));
const io = require(M("session-io.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

const CH = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const THREAD = "11111111-2222-3333-4444-555555555555";

const sess = (over = {}) => ({
  key: `${CH}:${THREAD}:a1b2c3d4`,
  agentId: "a1b2c3d4",
  channelId: CH,
  taskId: THREAD,
  profile: "full",
  state: { toolMode: "manual", messageMode: "auto_both", activity: "idle", allowForTask: [] },
  ...over,
});
const post = (over = {}) => ({ op: "send", channel: CH, body: "here you go", ...over });

// ── The pure block, with the live read INJECTED — the only way to drive a STORED value in plain
// node, where `channel-prefs.js` cannot load (its electron-store) and `channelMessageMode`
// deliberately answers `''`. Same source-extraction idiom every other pure block uses.
// ⚠ `floorWindowlessMessage` IS INJECTED REAL, not stubbed: the floor is half of what this file
// now pins, and a fake would let the harness agree with itself while the gate did something else.
const SRC = read("session-private.js");
const body = SRC.slice(
  SRC.indexOf("// ─── BEGIN SESSION-PRIVATE-PURE"),
  SRC.indexOf("// ─── END SESSION-PRIVATE-PURE")
);
const slice = (channelMessageMode) =>
  new Function(
    "privateTurnMessageMode",
    "floorWindowlessMessage",
    "autoOutboundMode",
    "channelMessageMode",
    `${body}\nreturn { effectiveMessageMode, openPrivateTurn, isPrivateTurn };`
  )(
    profiles.privateTurnMessageMode,
    profiles.floorWindowlessMessage,
    // ⚠ INJECTED REAL (2026-09-06, the full-auto ruling): the same predicate the GATE asks about
    // the out half. A local stub here could let this suite agree with itself about which postures
    // count as "auto" while `grantDecision` disagreed.
    profiles.autoOutboundMode,
    channelMessageMode
  );

/** The real gate, with Axis B re-derived through the sliced live read. */
const decideWith = (stored, s, input) =>
  profiles.grantDecision({
    ...io.grantArgs(s, DOPL_CHANNEL_TOOL, input),
    messageMode: slice(() => stored).effectiveMessageMode(s),
  });

// ── 1. SHAPES 1-3: THE STORED VALUE WINS OVER THE FROZEN ONE ────────────────────

test("LIVE: a session whose frozen mode is `ask` still sends when the channel says auto", () => {
  // A reopened shell, a crash resume, or a session launched before the operator changed
  // Messaging: `state.messageMode` says ask/auto_inbound, and the live read must win anyway —
  // that is the whole content of "immediately".
  for (const frozen of ["ask", "auto_inbound"]) {
    const s = sess({ state: { toolMode: "manual", messageMode: frozen, activity: "idle", allowForTask: [] } });
    assert.equal(decideWith("auto_outbound", s, post()), "allow", `frozen ${frozen} must not gate the post`);
  }
});

test("LIVE: it narrows as immediately as it widens — a channel back on `ask` gates at once", () => {
  // ⚠ THE OFF DIRECTION IS THE ONE A FROZEN COPY BREAKS SILENTLY, and it is the direction that
  // matters for containment: a session launched at `auto_both` must stop sending the moment the
  // operator sets Messaging back to `ask`, without a relaunch.
  const s = sess(); // frozen auto_both
  assert.equal(decideWith("ask", s, post()), "gate");
});

test("LIVE: the frozen value is the fallback ONLY when the store cannot be read", () => {
  // `''` is this function's "could not READ" answer — never "the channel has no opinion", which
  // is a real `ask` (`channel-prefs.getLaunchPosture` never answers null).
  const s = sess();
  assert.equal(slice(() => "").effectiveMessageMode(s), "auto_both", "unreadable store → frozen value");
  // …and a session with no frozen value either lands on the most restrictive member, never a grant.
  assert.equal(slice(() => "").effectiveMessageMode({ channelId: CH }), "ask");
});

// ── 2. THE INBOUND HALF IS NOT WIDENED ──────────────────────────────────────────

test("LIVE: an outbound posture does not read the peer's words in unseen", () => {
  const s = sess({ state: { toolMode: "manual", messageMode: "ask", activity: "idle", allowForTask: [] } });
  assert.equal(decideWith("auto_outbound", s, { op: "read", channel: CH }), "gate",
    "auto_outbound consents to what LEAVES; the IN half is a separate consent");
});

// ── 3. THE WINDOWLESS FLOOR, RE-APPLIED AT THE LIVE READ ────────────────────────

test("FLOOR: a windowless session on an `ask` channel can still READ its own thread", () => {
  // ⚠ WITHOUT THE RE-FLOOR THIS IS A DENIED READ, NOT A GATED ONE — a windowless session has no
  // surface to answer a gate on. `ask` is the DEFAULT posture, so this is the common channel,
  // and the agent would be unable to look at the thread it was answering.
  const s = sess({ windowless: true, state: { toolMode: "manual", messageMode: "ask", activity: "idle", allowForTask: [] } });
  assert.equal(slice(() => "ask").effectiveMessageMode(s), "auto_inbound", "the IN half is floored");
  assert.equal(decideWith("ask", s, { op: "read", channel: CH }), "allow");
});

test("FLOOR: it raises the IN half and never the OUT half", () => {
  const s = sess({ windowless: true, state: { toolMode: "manual", messageMode: "ask", activity: "idle", allowForTask: [] } });
  assert.equal(decideWith("ask", s, post()), "gate", "a floored session still asks before it sends");
  // …and a windowed session is not floored at all: the pick stands as written.
  const windowed = sess({ state: { toolMode: "manual", messageMode: "ask", activity: "idle", allowForTask: [] } });
  assert.equal(slice(() => "ask").effectiveMessageMode(windowed), "ask");
});

// ── 4. THE PRIVATE-TURN WITHDRAWAL ──────────────────────────────────────────────

test("FULL AUTO: an OUT-half posture defeats the private-turn withdrawal", () => {
  // ⚠ SAMUEL'S RULING, 2026-09-06 — *"If the user puts auto let's just have it full auto."* This
  // case was `gate` for one day, while item 8's first draft applied the withdrawal always. He
  // weighed the exposure (a reply drafted from his own private words leaving unclicked) against
  // the surprise (a posture that says auto and then holds a draft) and ruled that the surprise is
  // worse. The setting is explicit, visible and the operator's own.
  for (const mode of ["auto_outbound", "auto_both"]) {
    const p = slice(() => mode);
    const s = sess();
    p.openPrivateTurn(s);
    assert.equal(p.isPrivateTurn(s), true, "the turn really is private");
    assert.equal(decideWith(mode, s, post()), "allow", `${mode} means full auto`);
  }
});

test("FULL AUTO: …and it is NARROW — only the OUT half defeats it", () => {
  // ⚠ THE RULING IS NOT A REPEAL OF 2026-08-22. `ask` and `auto_inbound` carry no out-half
  // consent, so a private turn on those postures still withdraws exactly as that ruling wrote it.
  // Without this case the ruling reads as "private turns no longer matter", which it is not.
  for (const mode of ["ask", "auto_inbound"]) {
    const p = slice(() => mode);
    const s = sess({ state: { toolMode: "manual", messageMode: mode, activity: "idle", allowForTask: [] } });
    p.openPrivateTurn(s);
    assert.equal(decideWith(mode, s, post()), "gate", `${mode} still withdraws`);
  }
  // …and the IN half survives on every path, so an agent asked a private question about a thread
  // can still go and look at it — the deliberate deviation from "as if the mode were ask".
  const p = slice(() => "auto_inbound");
  const s = sess({ state: { toolMode: "manual", messageMode: "auto_inbound", activity: "idle", allowForTask: [] } });
  p.openPrivateTurn(s);
  assert.equal(p.effectiveMessageMode(s), "auto_inbound");
});

// ── 5. ONE LIVE READER, ZERO FROZEN COPIES, AND THE OLD RECORD REALLY IS GONE ───

test("SOURCE: the one consumer is the live Axis-B read, and it reads the POSTURE", () => {
  assert.match(SRC, /require\('\.\/channel-prefs'\)\.getLaunchPosture/,
    "session-private.js holds the live read of the channel's Messaging value");
  // …the launch-time derivation bakes in no frozen copy…
  const prefs = read("channel-prefs.js");
  const rule = prefs.slice(
    prefs.indexOf("function windowlessMessageMode("),
    prefs.indexOf("function launchStartModes(")
  );
  assert.ok(!/getAutoSend/.test(rule.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")),
    "windowlessMessageMode must not bake a frozen copy into state");
  // …and the gate's argument builder routes Axis B through the one derivation.
  assert.match(read("session-io.js"), /messageMode: sessionPrivate\.effectiveMessageMode\(s\)/,
    "grantArgs reads Axis B through effectiveMessageMode and nothing else");
});

test("SOURCE: the auto-send record is deleted everywhere, not merely unread", () => {
  // ⚠ ASSERTED ON CODE, NOT ON COMMENTS. Every tombstone in this wave NAMES the deleted symbols,
  // so a naive grep for the name would pass against a file that still exports it. These strip
  // comments first, which is the same technique the `windowlessMessageMode` case above uses.
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/getAutoSend|setAutoSend/.test(strip(read("channel-prefs.js"))), "the store is gone");
  assert.ok(!/getAutoSend|setAutoSend/.test(strip(read("channel-dir-ipc.js"))), "the IPC ops are gone");
  assert.ok(!/autoSendMessageMode/.test(strip(SRC)), "the out-half override is gone");
  assert.equal(priv.autoSendMessageMode, undefined, "and it is not exported");
});

test("SOURCE: with no store, the live read answers '' — a fallback, never a grant", () => {
  // This very process IS that environment: `channel-prefs` cannot construct its electron-store
  // here, so the REAL module must fall back to the session's frozen value and then withdraw.
  assert.equal(priv.channelMessageMode(CH), "", "no store → no opinion");
  const s = sess();
  priv.openPrivateTurn(s);
  assert.equal(priv.effectiveMessageMode(s), "auto_inbound",
    "frozen auto_both, private turn → the withdrawal applies");
});
