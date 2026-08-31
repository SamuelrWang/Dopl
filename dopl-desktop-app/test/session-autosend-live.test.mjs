// AUTO-SEND, READ LIVE AT THE GATE (2026-08-31, Samuel's ruling).
//
// THE DEFECT THIS PINS, reported by Samuel as "I toggled auto-posting and it still asks, and it
// has been broken forever": the channel's auto-send switch was FROZEN into `state.messageMode`
// at launch and then never consulted again, which gave it four silent ways to not be in effect —
//   1. a session already running never re-read the store, so the toggle did nothing until relaunch;
//   2. a reopened/recreated shell drops its startModes (H2), flooring to auto_inbound;
//   3. a crash resume floors the same way;
//   4. a PRIVATE (panel) or DIRECTED turn withdrew the OUT half the toggle had granted —
//      and the panel is the lane the operator actually drives agents from.
// Every one of those was individually deliberate; their SUM was a switch that read ON while
// every post asked. The ruling: the toggle is the channel-wide consent, it is read LIVE at the
// single Axis-B decision point (`session-private.js › effectiveMessageMode`), and it applies to
// all of the operator's agents in that channel IMMEDIATELY — every spawn shape, every turn
// shape, ON and OFF alike.

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
const post = (over = {}) => ({ op: "post", channel: CH, body: "here you go", ...over });

// ── The pure block, with the live read INJECTED — the only way to drive the ON case in plain
// node, where `channel-prefs.js` cannot load (its electron-store) and `channelAutoSend`
// deliberately answers false. Same source-extraction idiom every other pure block uses.
const SRC = read("session-private.js");
const body = SRC.slice(
  SRC.indexOf("// ─── BEGIN SESSION-PRIVATE-PURE"),
  SRC.indexOf("// ─── END SESSION-PRIVATE-PURE")
);
const slice = (channelAutoSend) =>
  new Function(
    "privateTurnMessageMode",
    "channelAutoSend",
    `${body}\nreturn { effectiveMessageMode, autoSendMessageMode, openPrivateTurn, isPrivateTurn };`
  )(profiles.privateTurnMessageMode, channelAutoSend);

// ── 1. THE TRANSFORM ─────────────────────────────────────────────────────────

test("TRANSFORM: the toggle forces the OUT half on and preserves the IN half exactly", () => {
  assert.equal(priv.autoSendMessageMode("ask"), "auto_outbound");
  assert.equal(priv.autoSendMessageMode("auto_inbound"), "auto_both");
  assert.equal(priv.autoSendMessageMode("auto_outbound"), "auto_outbound");
  assert.equal(priv.autoSendMessageMode("auto_both"), "auto_both");
  // ⚠ Junk fails toward `auto_outbound`, whose IN half is `ask` — the toggle means the OUT
  // half and must not smuggle inbound consent.
  assert.equal(priv.autoSendMessageMode("nonsense"), "auto_outbound");
  assert.equal(priv.autoSendMessageMode(undefined), "auto_outbound");
});

// ── 2. THE FOUR SILENT FAILURE SHAPES, EACH DRIVEN THROUGH THE REAL GATE ────────
// `grantArgs` builds the real arguments; only `messageMode` is re-derived through the sliced
// `effectiveMessageMode` with the live read injected — which is byte-for-byte the derivation
// production runs, minus the electron-store behind it.

const decideWith = (on, s, input) =>
  profiles.grantDecision({
    ...io.grantArgs(s, DOPL_CHANNEL_TOOL, input),
    messageMode: slice(() => on).effectiveMessageMode(s),
  });

test("ON overrides shape 4 — a post inside a PRIVATE turn auto-sends", () => {
  const p = slice(() => true);
  const s = sess();
  p.openPrivateTurn(s);
  assert.equal(p.isPrivateTurn(s), true, "the turn really is private");
  assert.equal(decideWith(true, s, post()), "allow",
    "toggle ON: the 2026-08-22 withdrawal yields to the channel-wide consent");
});

test("ON overrides shapes 1-3 — a session whose frozen mode is `ask` still auto-sends", () => {
  // A reopened shell, a crash resume, or a session launched before the toggle flipped: state
  // says ask/auto_inbound, and the live read must win anyway — that is what "immediately" means.
  for (const messageMode of ["ask", "auto_inbound"]) {
    const s = sess({ state: { toolMode: "manual", messageMode, activity: "idle", allowForTask: [] } });
    assert.equal(decideWith(true, s, post()), "allow", `frozen ${messageMode} must not gate the post`);
  }
});

test("OFF is immediate too — auto_both frozen at launch no longer carries the toggle", () => {
  // The frozen copy is deleted (`windowlessMessageMode` no longer reads the store), so with the
  // toggle OFF the only way a session auto-sends is an EXPLICIT posture/mode pick. A private
  // turn on such a session still withdraws — the 2026-08-22 protection stands when not opted out.
  const p = slice(() => false);
  const s = sess();
  assert.equal(decideWith(false, s, post()), "allow", "an explicit auto_both pick still works");
  p.openPrivateTurn(s);
  assert.equal(decideWith(false, s, post()), "gate", "and the private-turn withdrawal still stands");
});

test("ON does not widen INBOUND — reads on an `ask` session still follow the IN half", () => {
  const s = sess({ state: { toolMode: "manual", messageMode: "ask", activity: "idle", allowForTask: [] } });
  assert.equal(decideWith(true, s, { op: "read", channel: CH }), "gate",
    "auto-send consents to what LEAVES; it must not read the peer's words in unseen");
});

// ── 3. ONE LIVE READER, ZERO FROZEN COPIES — pinned at the source ───────────────

test("SOURCE: the toggle's one consumer is the live Axis-B read", () => {
  // The live read exists, lazy-required so plain-node requires keep working…
  assert.match(SRC, /require\('\.\/channel-prefs'\)\.getAutoSend/,
    "session-private.js holds the live read");
  // …the launch-time derivation no longer folds the store in…
  const prefs = read("channel-prefs.js");
  const rule = prefs.slice(
    prefs.indexOf("function windowlessMessageMode("),
    prefs.indexOf("function launchStartModes(")
  );
  assert.ok(!/getAutoSend/.test(rule.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")),
    "windowlessMessageMode must not bake a frozen copy of the toggle into state");
  // …and the gate's argument builder routes Axis B through the one derivation.
  assert.match(read("session-io.js"), /messageMode: sessionPrivate\.effectiveMessageMode\(s\)/,
    "grantArgs reads Axis B through effectiveMessageMode and nothing else");
});

test("SOURCE: in an environment with no store, the live read answers false — not a grant", () => {
  // This very process IS that environment: channel-prefs cannot construct its electron-store
  // here, so the real module must fall back to the withdrawal, exactly as before the ruling.
  const s = sess();
  priv.openPrivateTurn(s);
  assert.equal(priv.effectiveMessageMode(s), "auto_inbound",
    "no store → toggle reads false → the private turn withdraws as ruled in 2026-08-22");
});
