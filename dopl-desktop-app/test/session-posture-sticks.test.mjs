// 2026-08-02 — "THE POSTURE DOESN'T STICK." The defects behind one operator complaint.
//
// The canUseTool gate was never the problem: main/session-io.grantArgs reads s.state.toolMode /
// s.state.messageMode per call and always did. Everything upstream of it was broken instead:
//
//   FIX 1   THE PRE-CONSENT SELECTS WERE WIRED TO NOTHING. Their IPC resolved the sender against
//           the LIVE-SESSION registry only, which a consent window is not in, so main answered
//           {ok:false} for every change made before Accept and the spawn then emitted the
//           hard-coded manual/ask, visibly dragging the select back.
//   FIX 1b  ...AND THE ARM WAS THEN SPENT BY THE WRONG SPAWN (the blocker). See section 2b.
//   FIX 2   THE CONTROL LIED. Nothing on either side of the bridge read the answer.
//   FIX 3   THE IDLE TIMER measured time since the last turn ENDED, not idleness, so a card open
//           for 15 minutes parked the session underneath the operator and reset both axes.
//   FIX 4   A TEAM SESSION COULD NEVER BE ARMED. startSession discarded startModes for any
//           parkedShell; session-team spawns every team session as one.
//
// METHOD: the directory idiom — slice the REAL functions (helpers/source-probe fnOf/between)
// and DRIVE them with fakes, plus the real reducer block. No test here asserts on source text
// where it could assert on behavior; the source pins that remain are about what a spawn shape
// PASSES, which is not observable any other way without booting electron.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf, between } from "./helpers/source-probe.mjs";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const IPC = M("session-ipc.js");
const CONSENT = M("session-consent.js");
const ENGINE = M("session-engine.js");
const TEAM = M("session-team.js");
const PARK = M("session-park.js");
const DELIVER = M("channel-deliver.js");

const { normalizeToolMode, normalizeMessageMode } = require("../main/session-profiles.js");
const { initialSessionState, sessionReducer, POSTURE_RESET_NOTE } = loadReducer();

const WIDE = { tools: "bypass", messages: "auto_both" };

// ── harness: the REAL consent-registry writes ────────────────────────────────
// armModes + takeStartModes sliced out of main/session-consent.js and given the two free
// vars they close over there (`registry`, `sendToEntry`). Nothing is stubbed inside them.
function consentRegistry() {
  const registry = new Map();
  const echoed = [];
  const src = `${fnOf(CONSENT, "armModes")}\n${fnOf(CONSENT, "takeStartModes")}
               return { armModes, takeStartModes };`;
  const api = new Function("registry", "sendToEntry", src)(
    registry, (e, payload) => echoed.push({ key: e.key, payload })
  );
  return { registry, echoed, ...api };
}

function consentEntry(reg, key, sender) {
  const e = { key, win: { webContents: { id: sender } }, modes: null, decided: false };
  reg.registry.set(key, e);
  return e;
}

// ── harness: the REAL IPC mode handlers ──────────────────────────────────────
// Both `ipcMain.handle` registrations are sliced whole, so the arrow bodies under test are the
// shipped ones (including the dispatch payloads and gate.drainInbound), and `modeChange` +
// `touch` come out of the same file. The only fakes are the injected engine bundle, the
// consent module and the gate — exactly what register() is handed in production.
function ipcHarness({ session, consent }) {
  const handlers = new Map();
  const drained = [];
  const dispatched = [];
  const engine = {
    getSessionBySender: (sender) => (session && session.senderId === sender ? session : null),
    getConsentBySender: (sender) => {
      if (!consent) return null;
      for (const e of consent.registry.values()) if (e.win.webContents.id === sender) return e;
      return null;
    },
    dispatch: (s, evt) => {
      dispatched.push(evt);
      s.state = sessionReducer(s.state, evt).state; // the REAL reducer stores the axis
      return true;
    },
  };
  const src = [
    fnOf(IPC, "touch"),
    fnOf(IPC, "modeChange"),
    between(IPC, "ipcMain.handle('session:set-tool-mode'", "// ── Item 8: the pre-consent Accept", "session-ipc"),
  ].join("\n");
  new Function("ipcMain", "engine", "sessionConsent", "gate", "normalizeToolMode", "normalizeMessageMode", "diag", src)(
    { handle: (channel, fn) => handlers.set(channel, fn) },
    engine, consent, { drainInbound: (s) => drained.push(s.key) },
    normalizeToolMode, normalizeMessageMode, () => {}
  );
  return {
    engine, drained, dispatched,
    tool: (sender, mode) => handlers.get("session:set-tool-mode")({ sender }, { mode }),
    message: (sender, mode) => handlers.get("session:set-message-mode")({ sender }, { mode }),
  };
}

const liveSession = (senderId) => ({ key: "ch:th", senderId, state: initialSessionState({}) });

// ── 1. THE THREE SENDER SHAPES ───────────────────────────────────────────────

test("(a) a LIVE-session sender: the axis is stored on the session, {ok:true} states it", () => {
  const session = liveSession(7);
  const h = ipcHarness({ session });
  assert.deepEqual(h.tool(7, "bypass"), { ok: true, tool: "bypass", message: "ask" });
  assert.equal(session.state.toolMode, "bypass", "grantDecision reads exactly this field");
  assert.deepEqual(h.message(7, "auto_both"), { ok: true, tool: "bypass", message: "auto_both" });
  assert.equal(session.state.messageMode, "auto_both");
  assert.equal(session.operatorTouched, true, "a mode click is the operator using this window");
  assert.deepEqual(h.drained, ["ch:th"], "AXIS B still drains the held inbound queue; AXIS A never did");
});

test("(a) a live session coerces FAIL-CLOSED on junk, and the {ok} reports the coerced value", () => {
  const session = liveSession(7);
  const h = ipcHarness({ session });
  for (const junk of ["BYPASS", "bypass ", "yolo", "", null, 1, {}]) {
    assert.deepEqual(h.tool(7, junk), { ok: true, tool: "manual", message: "ask" }, String(junk));
    assert.equal(session.state.toolMode, "manual");
  }
});

test("(b) a CONSENT-ONLY sender: the pick lands on that card's entry and {ok:true} comes back", () => {
  // THE DEFECT, driven: before FIX 1 this sender resolved to no live session and the handler
  // returned {ok:false} with nothing stored anywhere.
  const consent = consentRegistry();
  const entry = consentEntry(consent, "ch:th", 42);
  const h = ipcHarness({ session: null, consent });

  assert.deepEqual(h.tool(42, "bypass"), { ok: true, tool: "bypass", message: "ask" });
  assert.deepEqual(entry.modes, { tools: "bypass", messages: "ask" },
    "the untouched axis is stored at its most restrictive member, never left absent");
  assert.deepEqual(h.message(42, "auto_both"), { ok: true, tool: "bypass", message: "auto_both" });
  assert.deepEqual(entry.modes, { tools: "bypass", messages: "auto_both" });
  assert.deepEqual(h.dispatched, [], "no reducer dispatch: there is no session yet, by design");
  assert.deepEqual(h.drained, [], "and nothing to drain");
});

test("(b) the card is ECHOED both axes, so the selects can only show what main recorded", () => {
  const consent = consentRegistry();
  consentEntry(consent, "ch:th", 42);
  const h = ipcHarness({ session: null, consent });
  h.tool(42, "auto");
  h.message(42, "auto_inbound");
  assert.deepEqual(consent.echoed.map((x) => x.payload), [
    { type: "modes", tool: "auto", message: "ask" },
    { type: "modes", tool: "auto", message: "auto_inbound" },
  ]);
});

test("(b) a consent sender coerces fail-closed too — the card cannot arm an unknown mode", () => {
  const consent = consentRegistry();
  const entry = consentEntry(consent, "ch:th", 42);
  const h = ipcHarness({ session: null, consent });
  assert.deepEqual(h.tool(42, "sudo"), { ok: true, tool: "manual", message: "ask" });
  assert.deepEqual(entry.modes, { tools: "manual", messages: "ask" });
});

test("(b) a DECIDED card refuses: {ok:false}, nothing stored, nothing echoed", () => {
  // The adoption gap, from main's side. Accept has landed and the spawn is about to consume
  // the pair, so a late change would silently not apply — say so instead.
  const consent = consentRegistry();
  const entry = consentEntry(consent, "ch:th", 42);
  entry.decided = true;
  const h = ipcHarness({ session: null, consent });
  assert.deepEqual(h.tool(42, "bypass"), { ok: false });
  assert.equal(entry.modes, null);
  assert.deepEqual(consent.echoed, []);
});

test("(c) an UNKNOWN sender: {ok:false}, and neither registry is written", () => {
  const consent = consentRegistry();
  const entry = consentEntry(consent, "ch:th", 42);
  const session = liveSession(7);
  const h = ipcHarness({ session, consent });
  assert.deepEqual(h.tool(99, "bypass"), { ok: false });
  assert.deepEqual(h.message(99, "auto_both"), { ok: false });
  assert.equal(session.state.toolMode, "manual", "a stranger cannot move a session it does not own");
  assert.equal(entry.modes, null, "nor a card it does not own");
});

test("a live session WINS over a consent entry sharing the window (the resolution order)", () => {
  const consent = consentRegistry();
  const entry = consentEntry(consent, "ch:th", 7);
  const session = liveSession(7);
  const h = ipcHarness({ session, consent });
  h.tool(7, "bypass");
  assert.equal(session.state.toolMode, "bypass");
  assert.equal(entry.modes, null, "the adopted session is authoritative, not the stale card");
});

// FIX L1 — the twin defect on the ANSWER these handlers return ({ok:false} for a change main had
// already applied) lives with the rest of the "a surface may only claim what main did" wave, in
// test/session-decision-truth.test.mjs.

// ── 2. WHAT THE ADOPTED SESSION ACTUALLY STARTS WITH ─────────────────────────
// The real construction site from session-engine.startSession, sliced and evaluated against the
// real initialSessionState and the real takeStartModes. `adoptsConsent` (FIX 1b) is part of the
// spec, so every case below states which spawn shape it is driving.

function startedState(spec, consent) {
  const src = ENGINE.slice(ENGINE.indexOf("const consentModes = sessionConsent.takeStartModes"),
    ENGINE.indexOf("const context = { ...(spec.context || {})"));
  assert.ok(src.includes("initialSessionState("), "the construction site moved — reslice it");
  return new Function("spec", "initialSessionState", "readCaps", "sessionConsent", `${src}\n return state;`)(
    spec, initialSessionState, () => ({}), consent);
}

// A card armed on BOTH axes and NOT yet accepted, through the real IPC handlers and the real
// registry writes. Every FIX 1b case starts from one: an empty registry could not fail.
function armedCard(key, sender) {
  const consent = consentRegistry();
  consentEntry(consent, key, sender);
  const h = ipcHarness({ session: null, consent });
  h.tool(sender, "bypass");
  h.message(sender, "auto_both");
  return consent;
}

test("Accept -> the adopted session STARTS on the pair the operator picked on the card", () => {
  // End to end over the two real halves: the IPC handler stores it, startSession consumes it.
  // s.state.toolMode is what session-io.grantArgs hands grantDecision on the first tool call.
  const consent = armedCard("ch:th", 42);
  const state = startedState({ key: "ch:th", side: "responder", mode: "interactive", adoptsConsent: true }, consent);
  assert.equal(state.toolMode, "bypass");
  assert.equal(state.messageMode, "auto_both");
  assert.equal(state.allowForTask.length, 0, "a posture is still not a grant");
  assert.equal(state.inboundForTask, false);
});

test("an UNTOUCHED card seeds nothing: the spawn starts at manual/ask", () => {
  const consent = consentRegistry();
  consentEntry(consent, "ch:th", 42);
  const state = startedState({ key: "ch:th", side: "responder", adoptsConsent: true }, consent);
  assert.equal(state.toolMode, "manual");
  assert.equal(state.messageMode, "ask");
});

test("the consent arm is SINGLE USE and scoped to the entry — a second spawn finds nothing", () => {
  const consent = armedCard("ch:th", 42);
  assert.equal(startedState({ key: "ch:th", adoptsConsent: true }, consent).toolMode, "bypass");
  assert.equal(startedState({ key: "ch:th", adoptsConsent: true }, consent).toolMode, "manual", "consumed, not stored");
  // ...and it was never visible to any other slot in the first place.
  consentEntry(consent, "ch:th", 42).modes = { tools: "bypass", messages: "auto_both" };
  assert.equal(startedState({ key: "ch:other", adoptsConsent: true }, consent).toolMode, "manual", "another key sees nothing");
});

test("the consent card BEATS the channel-keyed web-card arm when both are present", () => {
  const consent = consentRegistry();
  const entry = consentEntry(consent, "ch:th", 42);
  entry.modes = { tools: "accept_edits", messages: "ask" };
  const state = startedState({ key: "ch:th", startModes: WIDE, adoptsConsent: true }, consent);
  assert.equal(state.toolMode, "accept_edits", "the card the human was looking at wins");
  assert.equal(state.messageMode, "ask");
});

// ── 2b. FIX 1b (BLOCKER): the arm belongs to the ADOPTING spawn and to nothing else ──
// The registry is keyed sessionKey(channelId, taskId) — the SAME key recreateParkedShell,
// openFromChannel, openRequesterShell and startResume all spawn under — and startSession read it
// UNCONDITIONALLY, so a card armed but not yet accepted was spent by whichever spawn reached that
// key first: `operatorArmed` is `!!consentModes`, so the parked-shell refusal opened for a
// peer-driven wake, and the operator's own later Accept then started at manual/ask. Both halves
// are asserted below against a NON-EMPTY registry; the stub these cases used could not have failed.

const PEER_DRIVEN = {
  "recreated parked shell (a peer reply on an old thread)": { parkedShell: true, side: "responder", resumeSdkId: "sdk-1" },
  "openFromChannel shell (the operator opened the thread to read it)": { parkedShell: true, side: "requester", resumeSdkId: null },
  "requester shell (the operator's own typed request)": { parkedShell: true, side: "requester" },
  "crash resume (session-park.startResume)": { side: "responder", resumeSdkId: "sdk-1" },
};

test("FIX 1b: a pending armed card is INVISIBLE to every spawn shape but the one adopting it", () => {
  for (const [label, spec] of Object.entries(PEER_DRIVEN)) {
    const consent = armedCard("ch:th", 42);
    const state = startedState({ key: "ch:th", mode: "interactive", ...spec }, consent);
    assert.deepEqual({ t: state.toolMode, m: state.messageMode }, { t: "manual", m: "ask" }, label);
    assert.deepEqual(consent.takeStartModes("ch:th"), WIDE,
      `${label}: and the arm is still there for the Accept it was picked for`);
  }
});

test("FIX 1b: the ADOPTING launch takes it, exactly once", () => {
  const consent = armedCard("ch:th", 42);
  const first = startedState({ key: "ch:th", adoptsConsent: true }, consent);
  assert.deepEqual({ t: first.toolMode, m: first.messageMode }, { t: "bypass", m: "auto_both" });
  const second = startedState({ key: "ch:th", adoptsConsent: true }, consent);
  assert.deepEqual({ t: second.toolMode, m: second.messageMode }, { t: "manual", m: "ask" },
    "consumed, not stored: a second adopt on the same key finds nothing");
});

test("FIX 1b: `adoptsConsent` is STRICT — a truthy non-true value reads no arm and spends none", () => {
  for (const flag of [1, "true", "yes", {}, []]) {
    const consent = armedCard("ch:th", 42);
    const state = startedState({ key: "ch:th", adoptsConsent: flag }, consent);
    assert.deepEqual({ t: state.toolMode, m: state.messageMode }, { t: "manual", m: "ask" }, String(flag));
    assert.deepEqual(consent.takeStartModes("ch:th"), WIDE, String(flag));
  }
});

test("FIX 1b: THE REPRODUCTION — a peer wake, then the operator's Accept, on the same key", () => {
  const consent = armedCard("ch:th", 42);
  // 1. the peer replies on that thread and the inbound gate recreates the dormant shell.
  const shell = startedState({ key: "ch:th", parkedShell: true, side: "responder", resumeSdkId: "sdk-1" }, consent);
  assert.deepEqual({ t: shell.toolMode, m: shell.messageMode }, { t: "manual", m: "ask" },
    "a wake nobody approved must never start at bypass/auto_both");
  assert.equal(shell.parked, true, "and it is still a dormant shell");
  // 2. the operator now clicks Accept on the card they armed.
  const adopted = startedState({ key: "ch:th", adoptsConsent: true }, consent);
  assert.deepEqual({ t: adopted.toolMode, m: adopted.messageMode }, { t: "bypass", m: "auto_both" },
    "and the spawn they DID approve still starts on the pair they picked");
});

test("FIX 1b: exactly ONE site sets the flag, and it is launch()'s own adopt test", () => {
  // What a spawn shape PASSES is not observable without booting electron, and a second setter is
  // exactly how this regresses: any other shape spawning under the same key would spend the card.
  const setters = ENGINE.split("\n").filter((l) => /adoptsConsent:/.test(l));
  assert.equal(setters.length, 1, "one setter only");
  const body = fnOf(ENGINE, "launch");
  assert.match(body, /const adoptable = sessionConsent\.has\(key\)/, "off the value the cap branch uses");
  assert.match(body, /adoptsConsent: adoptable/, "and handed to startSession");
  for (const [name, src] of [["session-park", PARK], ["session-team", TEAM]]) {
    assert.ok(!/adoptsConsent/.test(src), `${name} must never hand the flag in`);
  }
});

// ── 3. FIX 4: the team-session arm ───────────────────────────────────────────
// The REAL registry, empty: a shape that hands in no arm must reach no arm, and driving that
// against `takeStartModes: () => null` proved nothing about the code that does the reading.

const noConsent = consentRegistry();

test("FIX 4: a PARKED SHELL that is explicitly OPERATOR-ARMED now keeps the posture", () => {
  const state = startedState({ key: "ch:a1", parkedShell: true, startModes: WIDE, operatorArmed: true }, noConsent);
  assert.deepEqual({ t: state.toolMode, m: state.messageMode }, { t: "bypass", m: "auto_both" });
  assert.equal(state.parked, true, "the shell is still DORMANT — the flag widens the posture, not the lifecycle");
  assert.equal(state.phase, "parked");
});

test("FIX 4: a bare recreate / reopen / wake still starts at manual/ask", () => {
  // The three shapes that reach startSession with parkedShell today and no human decision.
  // `startModes` present but unarmed is the important one: passing a posture is not authority.
  for (const [label, spec] of Object.entries({
    "bare recreated shell": { key: "k", parkedShell: true },
    "recreate that somehow carries modes but no arm": { key: "k", parkedShell: true, startModes: WIDE },
    "arm flag with no modes at all": { key: "k", parkedShell: true, operatorArmed: true },
    "operatorArmed as a truthy non-true value": { key: "k", parkedShell: true, startModes: WIDE, operatorArmed: 1 },
  })) {
    const state = startedState(spec, noConsent);
    assert.deepEqual({ t: state.toolMode, m: state.messageMode }, { t: "manual", m: "ask" }, label);
  }
});

test("FIX 4: session-team hands both fields to startSession instead of dropping them", () => {
  // Source-level because the alternative is booting the engine: what a spawn shape PASSES is
  // the whole defect (`parkedShell: true` + a discarded `startModes`), and it is not
  // observable from the outside.
  const body = fnOf(TEAM, "ensureSession");
  assert.match(body, /parkedShell: true/, "a team session is still a dormant shell");
  assert.match(body, /startModes: a\.startModes/, "and the posture is no longer dropped on the floor");
  assert.match(body, /operatorArmed: a\.operatorArmed === true/, "strict: only an explicit true arms");
});

test("FIX 4: the PEER-DRIVEN wake carries neither field, so a room message arms nothing", () => {
  // agentSpec is what channel-deliver hands wakeTeamSession. A message from the room is not a
  // human approving a posture, and this is the assertion that keeps it that way.
  const spec = new Function("io", "targeting", `${fnOf(DELIVER, "agentSpec")}\n return agentSpec;`)(
    { displayNameFor: () => "Sam" }, { resolveToolProfile: () => "full" }
  )({ channel: { id: "c1", name: "Ops" }, workspaceId: "w1" }, { id: "a1", name: "quartz" }, "u1");
  assert.equal(spec.startModes, undefined);
  assert.equal(spec.operatorArmed, undefined);
});

// ── 4. FIX 3: the idle timer ─────────────────────────────────────────────────
// A virtual-clock stand-in for session-engine's scheduleIdle: the effect sets the deadline to
// now + state.idleMs, `clearIdle` drops it, and nothing else touches it. The engine's real
// scheduleIdle is one clearTimeout + one setTimeout over exactly that, so this is the timer.

function clock(state) {
  const s = { state };
  const emitted = [];
  let now = 0;
  let fireAt = null;
  function dispatch(event) {
    const r = sessionReducer(s.state, event);
    s.state = r.state;
    for (const eff of r.effects) {
      if (eff.type === "scheduleIdle") fireAt = now + s.state.idleMs;
      else if (eff.type === "clearIdle") fireAt = null;
      else if (eff.type === "emit") emitted.push(eff.payload);
    }
    return r;
  }
  function advance(ms) {
    now += ms;
    if (fireAt !== null && now >= fireAt) { fireAt = null; dispatch({ type: "idle_timeout" }); }
  }
  return { s, emitted, dispatch, advance, armed: () => fireAt !== null };
}

const TTL = initialSessionState({}).idleMs;
const armedRunning = (patch) => clock({ ...initialSessionState({}), phase: "running", activity: "working", ...patch });
const card = (id) => ({ type: "permission_request", requestId: id, name: "Bash", payload: { type: "permission_request", requestId: id } });

test("FIX 3: a session with an OPEN CARD is never idle — the TTL restarts when it opens", () => {
  const c = armedRunning({ toolMode: "bypass", messageMode: "auto_both" });
  c.dispatch({ type: "launched", payload: {} }); // the only re-arm that existed before
  c.advance(TTL - 1);
  c.dispatch(card("r1")); // the operator is now reading a request
  c.advance(TTL - 1); // ...for almost another full TTL
  assert.equal(c.s.state.parked, false, "before FIX 3 this parked, deny-closing the very card on screen");
  assert.equal(c.s.state.toolMode, "bypass", "and took the posture with it");
  assert.deepEqual(c.s.state.pendingPermissions, ["r1"], "the request is still answerable");
});

test("FIX 3: answering the card restarts the TTL again (the decision is activity too)", () => {
  const c = armedRunning({});
  c.dispatch({ type: "launched", payload: {} });
  c.dispatch(card("r1"));
  c.advance(TTL - 1);
  c.dispatch({ type: "permission_decision", requestId: "r1", decision: "allow-once", name: "Bash" });
  c.advance(TTL - 1);
  assert.equal(c.s.state.parked, false);
});

test("FIX 3: a steer restarts it, so a session being typed at never parks mid-conversation", () => {
  const c = armedRunning({});
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL - 1);
  c.dispatch({ type: "steer", text: "keep going" });
  c.advance(TTL - 1);
  assert.equal(c.s.state.parked, false);
});

test("FIX 3: an accepted inbound turn restarts it (a turn was just pushed)", () => {
  const c = armedRunning({ messageMode: "auto_inbound" });
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL - 1);
  c.dispatch({ type: "inbound_arrived", pendingId: "p1", message: "hi", authorName: "Bob" });
  c.advance(TTL - 1);
  assert.equal(c.s.state.parked, false);
});

test("FIX 3: NO card and genuinely quiet past the TTL still PARKS, and states the reset", () => {
  // The park itself is kept: it exists for cost, and a session nobody is watching should stop.
  const c = armedRunning({ toolMode: "bypass", messageMode: "auto_both", inboundForTask: true, allowForTask: ["Bash"] });
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL);
  assert.equal(c.s.state.parked, true);
  assert.equal(c.s.state.toolMode, "manual");
  assert.equal(c.s.state.messageMode, "ask");
  assert.equal(c.s.state.inboundForTask, false, "standing grants die with the posture that framed them");
  assert.deepEqual(c.s.state.allowForTask, []);
  // ...and the window is TOLD. The reset used to be completely silent: the selects just moved.
  assert.ok(c.emitted.some((p) => p.type === "modes" && p.tool === "manual" && p.message === "ask"));
  const note = c.emitted.find((p) => p.type === "notice" && p.text === POSTURE_RESET_NOTE);
  assert.ok(note, "the park says what it took away");
  assert.equal(note.level, "info");
  assert.doesNotMatch(POSTURE_RESET_NOTE, /—/, "house voice: no em dashes");
});

test("FIX 3: a park from an ALREADY restrictive posture says nothing (it took nothing away)", () => {
  const c = armedRunning({});
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL);
  assert.equal(c.s.state.parked, true);
  assert.ok(!c.emitted.some((p) => p.type === "notice" && p.text === POSTURE_RESET_NOTE),
    "the line must never claim a change that did not happen");
});

test("FIX 3: the park still CLEARS the timer, so a parked shell does not re-park on a loop", () => {
  const c = armedRunning({ toolMode: "auto" });
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL);
  assert.equal(c.armed(), false, "parkEffects clearIdle wins over every re-arm above it");
  assert.equal(c.s.state.parked, true);
});

test("FIX 3: a PARKED session is not re-armed by a stale dock click", () => {
  const c = armedRunning({});
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL);
  c.dispatch({ type: "permission_decision", requestId: "r1", decision: "deny", name: "Bash" });
  assert.equal(c.armed(), false, "a dormant shell gets no timer; only a real wake re-arms one");
});
