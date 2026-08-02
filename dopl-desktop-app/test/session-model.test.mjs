// THE PER-SESSION MODEL PICKER (2026-08-02).
//
// A third control in the status strip, and the one with the sharpest edge in this window: its
// value becomes `--model <argv>` on a child process. So the rule it is built on is the one
// channel-prefs.normalizePreset established for the two posture axes — a FROZEN ENUM, coerced
// or rejected at every boundary, failing closed to 'default' (which sets no model option at all
// and leaves the CLI its own pick, i.e. exactly what every session did before this existed).
//
// WHAT THIS FILE PROVES, and it drives the shipped code for all of it:
//   1. the enum and the argv it produces
//   2. the FOUR copies of that enum (main, the preload, the view-model, the durable whitelist)
//      still agree, and the picker's markup offers exactly them
//   3. buildSdkOptions carries the model on a fresh launch AND on a resume, from the one
//      assembly point, and coerces there too
//   4. the durable round trip preserves it, and a hostile stored value lands on 'default'
//   5. session:set-model from a LIVE sender, a CONSENT-card sender and an UNKNOWN sender
//   6. the diag line every axis change now leaves behind
//
// METHOD is the directory idiom: slice the REAL functions (helpers/source-probe fnOf/between)
// and drive them with fakes. No test here asserts on source text where it could assert on
// behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf, between } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const R = (p) => readFileSync(join(HERE, "..", "renderer", "session", p), "utf8");

const model = require("../main/session-model.js");
const IPC = M("session-ipc.js");
const QUERY = M("session-query.js");
const IO = M("session-io.js");
const STORE = M("session-store.js");
const PARK = M("session-park.js");
const ENGINE = M("session-engine.js");
const PRELOAD = R("session-preload.js");
const HTML = R("session.html");

const JUNK = ["", " ", null, undefined, 0, 1, true, {}, [], "Opus", "opus ", "sonnet;rm -rf /",
  "claude-opus-5", "--dangerously-skip-permissions", "opus --print", "haiku\n--model=x"];

// ── 0. the frozen tables stand alone ─────────────────────────────────────────
// The sentinel block evaluated in a plain Node context with NO require, NO electron and NO
// process state: the WATCHER-PURE idiom. It is what stops the two tables every other layer
// coerces against from quietly growing a dependency on app state.

test("the frozen tables evaluate standalone, with nothing in scope but themselves", () => {
  const SRC = M("session-model.js");
  const from = SRC.indexOf("// ─── BEGIN SESSION-MODEL");
  const to = SRC.indexOf("// ─── END SESSION-MODEL");
  assert.notEqual(from, -1, "BEGIN sentinel missing");
  assert.ok(to > from, "sentinels out of order");
  const block = SRC.slice(from, to);
  assert.ok(!/require\(|electron|process\.|require\b/.test(block), "the block reaches nothing");
  const pure = new Function(`${block}
    return { MODEL_CHOICES, normalizeModel, modelArg, contextWindowFor, promptTokens, contextEvent };`)();
  assert.deepEqual(pure.MODEL_CHOICES, model.MODEL_CHOICES);
  assert.equal(pure.modelArg("rm -rf /"), null);
  assert.equal(pure.contextWindowFor("claude-opus-5"), 1000000);
  assert.deepEqual(pure.contextEvent(0, "claude-opus-5"), null, "nothing measured, nothing said");
});

// ── 1. the enum, and the argv it produces ────────────────────────────────────

test("the picker offers exactly five choices, with the fail-closed one first", () => {
  assert.deepEqual(model.MODEL_CHOICES, ["default", "opus", "sonnet", "haiku", "fable"]);
  assert.equal(model.MODEL_CHOICES[0], "default",
    "[0] is the coercion target, the same convention 'manual' / 'ask' follow");
});

test("normalizeModel takes a member and refuses everything else", () => {
  for (const m of model.MODEL_CHOICES) assert.equal(model.normalizeModel(m), m);
  for (const junk of JUNK) assert.equal(model.normalizeModel(junk), "default", JSON.stringify(junk));
});

test("modelArg is the argv gate: null for 'default', the bare alias otherwise, junk NEVER", () => {
  assert.equal(model.modelArg("default"), null, "no model option at all — the CLI's own pick");
  assert.equal(model.modelArg("opus"), "opus");
  assert.equal(model.modelArg("fable"), "fable");
  for (const junk of JUNK) {
    assert.equal(model.modelArg(junk), null, JSON.stringify(junk));
  }
  // A shell-shaped string can never come back out, whatever went in.
  for (const m of model.MODEL_CHOICES) {
    const arg = model.modelArg(m);
    if (arg !== null) assert.match(arg, /^[a-z]+$/, "an alias is one lowercase word or it is nothing");
  }
});

// ── 2. the four copies of the list agree ─────────────────────────────────────
// Same discipline test/session-permission-axes applies to the two mode tables: a sandboxed
// preload cannot require main, the reducer-block extraction cannot either, and the durable
// whitelist is evaluated standalone — so the list is duplicated ON PURPOSE and pinned here.

test("every copy of the enum matches main/session-model.js, and the markup offers exactly it", () => {
  // (a) the preload's fail-closed coercion, driven rather than read.
  // `asStr` is the preload's own primitive coercion, handed in the way the preload's module
  // scope provides it — the coercion UNDER test is asModel itself.
  const asModel = new Function("asStr",
    `${between(PRELOAD, "const asModel =", "// The session id lives", "preload")}
     return asModel;`)((v) => String(v == null ? "" : v));
  for (const m of model.MODEL_CHOICES) assert.equal(asModel(m), m, `preload keeps ${m}`);
  for (const junk of JUNK) assert.equal(asModel(junk), "default", `preload refuses ${JSON.stringify(junk)}`);

  // (b) the view-model's echo guard.
  const vm = require(join(HERE, "..", "renderer", "session", "session-viewmodel.js"));
  for (const m of model.MODEL_CHOICES) {
    assert.equal(vm.reduceEvent(vm.initialState(), { type: "model", choice: m }).modelChoice, m);
  }
  for (const junk of JUNK) {
    assert.equal(vm.reduceEvent(vm.initialState(), { type: "model", choice: junk }).modelChoice, "default",
      JSON.stringify(junk));
  }

  // (c) the durable whitelist (section 4 drives it too; this is the LIST half).
  const durable = new Function(`${fnOf(STORE, "durableName")}\n${fnOf(STORE, "durableSessionRecord")}
                                return durableSessionRecord;`)();
  for (const m of model.MODEL_CHOICES) assert.equal(durable({ model: m }).model, m);

  // (d) the picker's own <option value="…"> set, in order.
  const at = HTML.indexOf('<label class="model-select">');
  assert.notEqual(at, -1, "the picker's own wrapper is in the strip");
  const label = HTML.slice(at, HTML.indexOf("</label>", at));
  const options = [...label.matchAll(/<option value="([a-z]+)">/g)].map((m2) => m2[1]);
  assert.deepEqual(options, model.MODEL_CHOICES, "the markup can only offer values main will spend");
  assert.ok(!/class="mode-select"/.test(label),
    "the picker is NOT a third permission axis and must not be countable as one");
});

// ── 3. buildSdkOptions: the ONE assembly point, on every spawn shape ─────────
// The real function, sliced and evaluated with fakes for every module it reaches. This is the
// same reason session-query exists: fresh launch, parked resume, recreated shell and the
// post-sign-in relaunch all come through here, so proving it once proves it for all four.

function assembled(s) {
  const src = `${fnOf(QUERY, "buildSdkOptions")}\n return buildSdkOptions;`;
  const fake = new Function(
    "buildSessionToolConfig", "channelDirs", "buildSecretPathDenyRules", "buildMcpServers",
    "sessionAuth", "buildScrubbedEnv", "sessionOutbound", "io", "deps", "diag",
    "withSessionStamp", "store", "resolveClaudeExecutable", "sessionModel", src
  )(
    () => ({ preApproved: [], disallowedTools: [], doplToolsPolicy: "full", builtinTools: [] }),
    { sessionSpawnDir: () => "/tmp" },
    () => [],
    () => ({}),
    { withStoredCredential: (e) => e },
    () => ({}),
    { wrapCanUseTool: () => () => {} },
    { makeCanUseTool: () => () => {} },
    { dispatch: () => {}, emitQuiet: () => {} },
    () => {},
    () => {},
    { slotKey: () => "c1:t1" },
    () => null,
    require("../main/session-model.js")
  );
  return fake(s);
}

const session = (over) => ({ profile: "full", channelId: "c1", workspaceId: "w1", taskId: "t1", ...over });

test("buildSdkOptions carries the picked model on a FRESH launch", () => {
  assert.equal(assembled(session({ model: "opus" })).model, "opus");
  assert.equal(assembled(session({ model: "fable" })).model, "fable");
});

test("buildSdkOptions carries it on a RESUME too — one assembly point, so park/resume is free", () => {
  const opts = assembled(session({ model: "sonnet", resumeSdkId: "sdk-1" }));
  assert.equal(opts.model, "sonnet");
  assert.equal(opts.resume, "sdk-1", "and the resume is still the only field that differs");
});

test("'default' sets NO model field at all, so the CLI keeps its own pick", () => {
  for (const s of [session({ model: "default" }), session({ model: null }), session({})]) {
    assert.ok(!("model" in s ? Object.prototype.hasOwnProperty.call(assembled(s), "model") : false),
      "an absent or default pick leaves the option unset");
    assert.equal(assembled(s).model, undefined);
  }
});

test("buildSdkOptions re-coerces: a hostile s.model can never reach argv", () => {
  for (const junk of JUNK) {
    assert.equal(assembled(session({ model: junk })).model, undefined, JSON.stringify(junk));
  }
});

test("the picker changed NOTHING else about the assembled options", () => {
  const opts = assembled(session({ model: "opus" }));
  assert.deepEqual(opts.settingSources, [], "the global allow-list still can never shadow a gate");
  assert.equal(opts.permissionMode, "default");
  assert.equal(opts.includePartialMessages, false);
});

// ── 4. the durable round trip ────────────────────────────────────────────────

const baseRecord = new Function(`${fnOf(IO, "baseRecord")}\n return baseRecord;`)();
const durable = new Function(`${fnOf(STORE, "durableName")}\n${fnOf(STORE, "durableSessionRecord")}
                              return durableSessionRecord;`)();
const live = (over = {}) => ({
  key: "c1:t1", sessionId: "s1", channelId: "c1", taskId: "t1", workspaceId: "w1",
  side: "responder", profile: "full", mode: "interactive", startedAt: 1,
  state: { phase: "running", turns: 0, costUsd: 0 }, context: {}, ...over,
});

test("the model survives the round trip a P2 recreate depends on", () => {
  for (const m of ["opus", "sonnet", "haiku", "fable"]) {
    assert.equal(durable(baseRecord(live({ model: m }))).model, m, m);
  }
  assert.equal(durable(baseRecord(live())).model, "default", "a session that never picked one");
});

test("a HOSTILE stored value coerces to 'default' on the way out of the projection", () => {
  // The store is a plain JSON file on disk. This is the whole reason the whitelist coerces.
  for (const junk of JUNK) {
    assert.equal(durable(baseRecord(live({ model: junk }))).model, "default", JSON.stringify(junk));
    assert.equal(durable({ model: junk }).model, "default", "and straight into the whitelist too");
  }
});

test("a record written BEFORE this field existed reopens on the CLI default, not on undefined", () => {
  const old = durable({ key: "c1:t1", channelId: "c1", phase: "parked" });
  assert.equal(old.model, "default");
  assert.equal(model.modelArg(old.model), null, "which assembles to no model option at all");
});

test("both record-driven resume shapes hand the stored pick back to startSession", () => {
  // What a spawn shape PASSES is not observable from outside without booting electron, and it
  // is the whole point: a recreate that dropped this would silently revert the operator's pick.
  for (const fn of ["recreateParkedShell", "startResume"]) {
    const body = fnOf(PARK, fn);
    assert.match(body, /model: rec\.model/, `${fn} carries the record's model`);
  }
});

test("startSession coerces what a spec hands in, and the consent card's pick WINS", () => {
  // The one line of the single construction site that decides a session's model. It is the
  // whole precedence rule, so it is asserted as one expression rather than in pieces.
  const line = ENGINE.split("\n").find((l) => l.includes("model: sessionModel.normalizeModel("));
  assert.ok(line, "the model assignment moved — reslice it");
  assert.match(line, /sessionConsent\.takeStartModel\(.*\) \|\| spec\.model/,
    "the entry-scoped card pick first, the spec's stored value second");
  assert.match(line, /sessionModel\.normalizeModel\(/, "and the pair is coerced, never trusted");
  // FIX 1b (2026-08-02): read behind the SAME adopt gate as the posture pair. Without it a
  // peer-driven wake spawning under that key spent the card's model pick before Accept could.
  assert.match(line, /spec\.adoptsConsent === true \? spec\.key : null/,
    "a non-adopting spawn hands a null key, which looks nothing up and takes nothing");
});

test("FIX 1b: the entry-keyed take really is a no-op for the null key a non-adopter hands it", () => {
  // The behavioural half of the pin above, against the REAL takeStartModel.
  const consent = consentRegistry();
  consentEntry(consent, "ch:th", 42);
  ipcHarness({ session: null, consent }).set(42, "opus");
  assert.equal(consent.takeStartModel(null), null, "a null key looks nothing up");
  assert.equal(consent.takeStartModel(undefined), null);
  assert.equal(consent.takeStartModel("ch:th"), "opus", "and the arm survives for the Accept");
});

// ── 5. session:set-model, from all three sender shapes ───────────────────────
// The REAL handler + the real modelChange, sliced whole and given exactly what register() is
// handed in production. The only fakes are the injected engine bundle and the consent module.

function ipcHarness({ session: live_, consent }) {
  const handlers = new Map();
  const emitted = [];
  const logged = [];
  const setModelCalls = [];
  const engine = {
    getSessionBySender: (sender) => (live_ && live_.senderId === sender ? live_ : null),
    getConsentBySender: (sender) => {
      if (!consent) return null;
      for (const e of consent.registry.values()) if (e.win.webContents.id === sender) return e;
      return null;
    },
    emitToSession: (s, payload) => emitted.push({ key: s.key, payload }),
  };
  const src = [
    fnOf(IPC, "touch"),
    fnOf(IPC, "modelChange"),
    between(IPC, "ipcMain.handle('session:set-model'", "// ── Item 8: the pre-consent Accept", "session-ipc"),
  ].join("\n");
  new Function("ipcMain", "engine", "sessionConsent", "normalizeModel", "modelArg", "diag", src)(
    { handle: (channel, fn) => handlers.set(channel, fn) },
    engine, consent, model.normalizeModel,
    (m) => { setModelCalls.push(m); return model.modelArg(m); },
    (...args) => logged.push(args.join(" "))
  );
  return {
    emitted, logged, setModelCalls,
    set: (sender, m) => handlers.get("session:set-model")({ sender }, { model: m }),
  };
}

// The REAL consent-registry writes, sliced like test/session-posture-sticks does for armModes.
function consentRegistry() {
  const CONSENT = M("session-consent.js");
  const registry = new Map();
  const echoed = [];
  const api = new Function("registry", "sendToEntry",
    `${fnOf(CONSENT, "armModel")}\n${fnOf(CONSENT, "takeStartModel")}
     return { armModel, takeStartModel };`)(registry, (e, payload) => echoed.push({ key: e.key, payload }));
  return { registry, echoed, ...api };
}

function consentEntry(reg, key, sender) {
  const e = { key, win: { webContents: { id: sender } }, modes: null, model: null, decided: false };
  reg.registry.set(key, e);
  return e;
}

const liveSession = (senderId) => ({ key: "ch:th", sessionId: "abcdef0123456789", senderId, model: "default" });

test("(a) a LIVE sender: the pick lands on the session AND on the running query", () => {
  const s = liveSession(7);
  const calls = [];
  s.query = { setModel: (m) => { calls.push(m); return Promise.resolve(); } };
  const h = ipcHarness({ session: s });
  assert.deepEqual(h.set(7, "opus"), { ok: true, model: "opus" });
  assert.equal(s.model, "opus", "buildSdkOptions reads exactly this field on the next resume");
  assert.deepEqual(calls, ["opus"], "and the LIVE query switched with no relaunch");
  assert.equal(s.operatorTouched, true, "a model click is the operator using this window");
  assert.deepEqual(h.emitted.map((e) => e.payload), [{ type: "model", choice: "opus" }],
    "the window is told, so the select shows what main recorded");
});

test("(a) back to 'default' hands the SDK undefined, its own 'use the default'", () => {
  const s = liveSession(7);
  const calls = [];
  s.query = { setModel: (m) => { calls.push(m); return Promise.resolve(); } };
  const h = ipcHarness({ session: s });
  h.set(7, "opus");
  assert.deepEqual(h.set(7, "default"), { ok: true, model: "default" });
  assert.deepEqual(calls, ["opus", undefined]);
});

test("(a) a live sender coerces FAIL-CLOSED on junk, and the {ok} reports the coerced value", () => {
  const s = liveSession(7);
  const calls = [];
  s.query = { setModel: (m) => { calls.push(m); return Promise.resolve(); } };
  const h = ipcHarness({ session: s });
  for (const junk of JUNK) {
    assert.deepEqual(h.set(7, junk), { ok: true, model: "default" }, JSON.stringify(junk));
    assert.equal(s.model, "default");
  }
  assert.deepEqual([...new Set(calls)], [undefined], "nothing but the SDK default ever crossed");
});

test("(a) a PARKED / held session has no query: the value still lands, for its next assembly", () => {
  const s = liveSession(7); // no s.query at all
  const h = ipcHarness({ session: s });
  assert.deepEqual(h.set(7, "haiku"), { ok: true, model: "haiku" });
  assert.equal(s.model, "haiku");
  assert.equal(h.emitted.length, 1);
});

// ── FIX L2: a running child the SDK cannot switch is DEFERRED, and says so ───
// The bare {ok:true} used to be indistinguishable from a real live switch, so nothing downstream
// could tell "the child is on it now" from "the child keeps the old model until the next resume".

test("(a) FIX L2: a RUNNING query with no setModel answers DEFERRED and echoes the PENDING shape", () => {
  const s = liveSession(7);
  s.query = {}; // a live child, on an SDK build that cannot switch one
  const h = ipcHarness({ session: s });
  assert.deepEqual(h.set(7, "opus"), { ok: true, deferred: true, model: "opus" });
  assert.equal(s.model, "opus", "the pick still lands, so buildSdkOptions spends it on the resume");
  assert.deepEqual(h.emitted.map((e) => e.payload), [{ type: "model", choice: "opus", pending: true }],
    "`choice` keeps the select on the ask; `pending` says no running child was switched");
  assert.deepEqual(h.setModelCalls, [], "and nothing was assembled for a call that cannot be made");
});

test("(a) FIX L2: a query that CAN switch is not deferred, and its echo carries no pending flag", () => {
  const s = liveSession(7);
  s.query = { setModel: () => Promise.resolve() };
  const h = ipcHarness({ session: s });
  const res = h.set(7, "opus");
  assert.deepEqual(res, { ok: true, model: "opus" });
  assert.equal("deferred" in res, false, "absent, never a `deferred: false` nobody reads");
  assert.deepEqual(h.emitted.map((e) => e.payload), [{ type: "model", choice: "opus" }]);
});

test("(a) FIX L2: a PARKED session is not deferred either — nothing is running to disagree", () => {
  const s = liveSession(7); // no s.query at all
  assert.deepEqual(ipcHarness({ session: s }).set(7, "haiku"), { ok: true, model: "haiku" });
});

test("FIX L2: the pending echo moves the SELECT and never touches what is RUNNING", () => {
  // The two facts the view-model keeps apart, driven: `modelChoice` is the operator's ask (the
  // only thing the picker shows) and `liveModel` is what really served a turn (the header).
  const vm = require(join(HERE, "..", "renderer", "session", "session-viewmodel.js"));
  let s = vm.reduceEvent(vm.initialState(), { type: "context", tokens: 10, window: 200000, model: "sonnet" });
  assert.equal(s.liveModel, "sonnet");
  s = vm.reduceEvent(s, { type: "model", choice: "opus", pending: true });
  assert.equal(s.modelChoice, "opus", "the picker keeps the value the operator asked for");
  assert.equal(s.liveModel, "sonnet", "and the header still names the model that is really running");
});

test("(a) a setModel that THROWS or REJECTS is never fatal — the session keeps running", async () => {
  const thrower = liveSession(7);
  thrower.query = { setModel: () => { throw new Error("transport gone"); } };
  assert.deepEqual(ipcHarness({ session: thrower }).set(7, "opus"), { ok: true, model: "opus" });
  const rejecter = liveSession(8);
  rejecter.query = { setModel: () => Promise.reject(new Error("refused")) };
  assert.deepEqual(ipcHarness({ session: rejecter }).set(8, "opus"), { ok: true, model: "opus" });
  await new Promise((r) => setImmediate(r)); // an unhandled rejection here would fail the run
});

test("(b) a CONSENT-only sender: the pick lands on that card's entry and is echoed back", () => {
  const consent = consentRegistry();
  const entry = consentEntry(consent, "ch:th", 42);
  const h = ipcHarness({ session: null, consent });
  assert.deepEqual(h.set(42, "sonnet"), { ok: true, model: "sonnet" });
  assert.equal(entry.model, "sonnet");
  assert.deepEqual(consent.echoed.map((x) => x.payload), [{ type: "model", choice: "sonnet" }]);
});

test("(b) the consent arm is SINGLE USE and scoped to the ENTRY, exactly like the posture pair", () => {
  const consent = consentRegistry();
  consentEntry(consent, "ch:th", 42);
  ipcHarness({ session: null, consent }).set(42, "opus");
  assert.equal(consent.takeStartModel("ch:th"), "opus");
  assert.equal(consent.takeStartModel("ch:th"), null, "consumed, not stored");
  consentEntry(consent, "ch:th", 42).model = "fable";
  assert.equal(consent.takeStartModel("ch:other"), null, "another key sees nothing");
});

test("(b) a DECIDED card refuses: {ok:false}, nothing stored, nothing echoed", () => {
  const consent = consentRegistry();
  const entry = consentEntry(consent, "ch:th", 42);
  entry.decided = true;
  const h = ipcHarness({ session: null, consent });
  assert.deepEqual(h.set(42, "opus"), { ok: false });
  assert.equal(entry.model, null);
  assert.deepEqual(consent.echoed, []);
});

test("(c) an UNKNOWN sender: {ok:false}, and neither registry is written", () => {
  const consent = consentRegistry();
  const entry = consentEntry(consent, "ch:th", 42);
  const s = liveSession(7);
  const h = ipcHarness({ session: s, consent });
  assert.deepEqual(h.set(99, "opus"), { ok: false });
  assert.equal(s.model, "default", "a stranger cannot move a session it does not own");
  assert.equal(entry.model, null, "nor a card it does not own");
});

test("a live session WINS over a consent entry sharing the window (the resolution order)", () => {
  const consent = consentRegistry();
  const entry = consentEntry(consent, "ch:th", 7);
  const s = liveSession(7);
  ipcHarness({ session: s, consent }).set(7, "opus");
  assert.equal(s.model, "opus");
  assert.equal(entry.model, null, "the adopted session is authoritative, not the stale card");
});

// ── 6. the diag line ─────────────────────────────────────────────────────────

test("every model change leaves ONE diag line: axis, coerced value, 8-char session prefix", () => {
  const s = liveSession(7);
  const h = ipcHarness({ session: s });
  h.set(7, "opus");
  assert.equal(h.logged.length, 1);
  assert.equal(h.logged[0], "session posture: model=opus session=abcdef01");
  assert.equal(h.logged[0].includes(s.sessionId), false, "a PREFIX, never the whole id");
});

test("the diag line is logged for a refused change too — the silence is what it exists to remove", () => {
  const h = ipcHarness({ session: null });
  assert.deepEqual(h.set(99, "bypass"), { ok: false });
  assert.deepEqual(h.logged, ["session posture: model=default session="],
    "an unknown sender logs with no prefix, which is itself the fact worth having");
});

test("the two POSTURE axes log the same shape (the stitch this wave was handed)", () => {
  const body = fnOf(IPC, "modeChange");
  assert.match(body, /diag\('session posture:', axis \+ '=' \+ mode, 'session=' \+ String\(\(s && s\.sessionId\) \|\| ''\)\.slice\(0, 8\)\)/);
  // It carries a value and an id prefix and NOTHING else — listener.log is plaintext.
  assert.ok(!/input|body|text|prompt/i.test(body.split("\n").find((l) => l.includes("session posture:"))),
    "no prompt text, no drafted body, no tool input");
});
