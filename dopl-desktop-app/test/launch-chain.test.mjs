// AGENT CHAINING — the one-generation launch bound, as a CHANNEL SETTING (Samuel's ruling,
// 2026-08-31; the post-1.23.0 field run).
//
// THE FIELD REPRO, verbatim as the launched agent received it five times: "agents launching
// agents is limited to ONE generation — this session is already the launched one." The operator
// wanted the shape that bound forbids — an orchestrator that staffs supervisors that staff
// workers — in the ONE room they run orchestrators in.
//
// THE RULING. The limit becomes a per-channel setting, DEFAULT OFF (= today's bound). With it ON
// the depth question is not asked, and because depth cannot cross the wire there is then no
// GENERATION bound left at all — so the ruling also demanded an honest backstop. There are two,
// and neither is described as a generation count: `MAX_CONCURRENT_SESSIONS` (already there,
// instantaneous) and `launch-budget.js` (new, a rolling per-channel budget, over time).
//
// THREE PINS, IN THE RULING'S OWN WORDS: toggle off -> the refusal stands; on -> a grandchild
// launch works; the backstop holds.
//
// SOURCE-OF-TRUTH IDIOM: the REAL modules, driven directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const read = (p) => readFileSync(M(p), "utf8");

const lane = require(M("session-own-launch.js"));
const profiles = require(M("session-profiles.js"));
const perms = require(M("session-permissions.js"));
const io = require(M("session-io.js"));
// ⚠ 2026-08-31 (runtime-adapter port, step 3): `makeCanUseTool` SPLIT. The verdict plumbing, the
// diag line, the card payloads and the resolver parking are platform-free and live in
// `main/session-gate-bridge.js`; what remains under this name is the HELD-CALLBACK WIRING and the
// platform's own reply vocabulary, which is the adapter's. The tests below drive the shipped
// callback, so they take it from there.
const axisB = require(M("runtime/claude/axis-b.js"));
const budget = require(M("launch-budget.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

const CH = "ch1";
const LAUNCH = { op: "launch_agent", goal: "staff this channel" };
const decide = (over) => profiles.grantDecision({ profile: "full", channelId: CH, ...over });
const args = (over) => ({ toolName: DOPL_CHANNEL_TOOL, input: LAUNCH, ...over });

// The shape F-320 was measured on: windowless, so a gate IS a deny.
function mkSession(over) {
  const o = over || {};
  return {
    profile: "full",
    channelId: CH,
    windowless: true,
    launchDepth: o.launchDepth,
    launchChain: o.launchChain,
    state: { allowForTask: [], toolMode: o.toolMode || "manual", messageMode: o.messageMode || "ask" },
    pendingPermissions: new Map(),
    pendingNames: new Map(),
  };
}

// ── PIN 1. TOGGLE OFF -> THE REFUSAL STANDS, BYTE FOR BYTE ────────────────────────

test("OFF: a launched session is still denied, in every posture, exactly as before", () => {
  // ⚠ EVERY SPELLING OF "NOT ON" IS OFF. The flag is read `=== true` at three points on the way
  // in (the funnel, the engine stamp, the gate arg) precisely so that a lane which forgets it,
  // a resume that cannot rebuild it, and a hostile-ish truthy value all land here.
  for (const launchChain of [undefined, null, false, 0, "", "true", 1, {}]) {
    for (const toolMode of profiles.TOOL_MODES) {
      for (const messageMode of profiles.MESSAGE_MODES) {
        assert.equal(decide(args({ launchDepth: 1, launchChain, toolMode, messageMode })), "deny",
          `chain=${String(launchChain)} ${toolMode}/${messageMode}: the bound is not posture-openable`);
      }
    }
  }
});

test("OFF: the deny still carries the BOUND's sentence and asks nobody", async () => {
  const s = mkSession({ toolMode: "bypass", messageMode: "auto_both" }); // no depth => the cap
  const events = [];
  const res = await axisB.makeCanUseTool(s, (_s, ev) => events.push(ev))(
    DOPL_CHANNEL_TOOL, LAUNCH, { requestId: "C1" });
  assert.equal(res.behavior, "deny");
  assert.equal(res.message, perms.LAUNCH_DEPTH_DENY_MESSAGE);
  assert.equal(events.length, 0, "a bound is not a question");
});

test("OFF: the refusal now NAMES its remedy, and still forbids re-issuing", () => {
  // ⚠ THE CLAUSE THAT HAD TO CHANGE. It said "no setting will widen this" and that is false as
  // of this ruling. ⚠ AND THE CLAUSE THAT MUST NOT: the flag is a SPAWN-TIME stamp, so flipping
  // it cannot unblock the session reading this sentence — an agent told to wait and retry would
  // spend its turns on a call that can never start succeeding.
  const m = perms.LAUNCH_DEPTH_DENY_MESSAGE;
  assert.match(m, /agent-chaining setting/);
  assert.match(m, /your operator/);
  assert.match(m, /re-issuing cannot succeed/);
  assert.ok(!/no setting will widen this/.test(m));
});

// ── PIN 2. TOGGLE ON -> THE GRANDCHILD LAUNCH WORKS ───────────────────────────────

test("ON: a launched session may launch — under the SAME two axes, never fewer", () => {
  // ⚠ THE SETTING SKIPS THE DEPTH QUESTION AND GRANTS NOTHING. A chained session clears exactly
  // the conjunction the first generation clears; if this ever allowed under a narrower pair, the
  // toggle would have become a posture, which is what `session-own-direct.js`'s neighbour and
  // this lane both refuse to let a setting be.
  for (const depth of [1, 2, undefined, null, "0", -1]) {
    assert.equal(decide(args({ launchDepth: depth, launchChain: true,
      toolMode: "bypass", messageMode: "auto_both" })), "allow", `depth=${String(depth)}`);
    assert.equal(decide(args({ launchDepth: depth, launchChain: true,
      toolMode: "auto", messageMode: "auto_both" })), "gate", "Axis A still required");
    assert.equal(decide(args({ launchDepth: depth, launchChain: true,
      toolMode: "bypass", messageMode: "ask" })), "gate", "Axis B still required");
  }
});

test("ON: the admitted call resolves inline — no dispatch, nothing to auto-deny", async () => {
  const s = mkSession({ toolMode: "bypass", messageMode: "auto_both", launchChain: true });
  const events = [];
  const res = await axisB.makeCanUseTool(s, (_s, ev) => events.push(ev))(
    DOPL_CHANNEL_TOOL, LAUNCH, { requestId: "C2" });
  assert.deepEqual(res, { behavior: "allow" });
  assert.equal(events.length, 0);
  assert.equal(s.pendingPermissions.size, 0);
});

test("ON: cross-channel is still refused — a room's setting arms that room only", () => {
  // ⚠ THE SCOPE RULE IS UNTOUCHED BY THE SETTING. A chained session in an armed channel must not
  // be able to staff a DIFFERENT room, or one flipped switch would arm the whole workspace.
  for (const channel of ["ch2", "my-slug"]) {
    assert.equal(decide(args({ input: { op: "launch_agent", channel }, launchChain: true,
      launchDepth: 1, toolMode: "bypass", messageMode: "auto_both" })), "gate");
  }
});

// ── PIN 3. THE CHAIN IS PLUMBED FROM THE ROOM, AND ONLY FROM ONE LANE ─────────────

test("exactly ONE lane in main/ reads the channel's chaining setting", () => {
  // ⚠ THE SILENCE IS LOAD-BEARING, exactly as it is for `launchDepth`. If the peer-triggered
  // responder, a resume or a recreate ever read this setting, a peer's message or a crash would
  // start a chain-capable agent — the re-arming shape `channel-prefs.js`'s H2 block refuses.
  const readers = ["launch-directives.js", "trigger.js", "session-park.js", "session-launch.js",
    "session-engine.js", "session-reopen.js", "session-ipc-ops.js", "session-launch-op.js"]
    // ⚠ A CALL, NOT A MENTION. `session-launch.js` NAMES this function in the comment that says
    // it must never read it here — a bare `/getAgentChain/` would fail on the very sentence
    // that documents the rule.
    .filter((f) => /channelPrefs\.getAgentChain\(/.test(read(f)));
  assert.deepEqual(readers, ["launch-directives.js"],
    "only the directive lane may stamp a chain — every other spawn shape keeps the bound");
});

test("the funnel FORWARDS the flag and never invents one", () => {
  const funnel = read("session-launch.js");
  assert.match(funnel, /launchChain: a\.launchChain === true,/);
  assert.ok(!/launchChain: a\.launchChain \|\|/.test(funnel), "no default, ever");
  // The engine stamps it on the session, and the gate reads it off there — the launchDepth path.
  assert.match(read("session-engine.js"), /launchChain: spec\.launchChain === true,/);
  assert.match(read("session-io.js"), /launchChain: s\.launchChain === true,/);
});

test("a RECREATE cannot resurrect a chain stamp, because nothing durable carries it", () => {
  // Same argument as the depth stamp's: the durable projection is a whitelist, so a crash
  // recreate comes back bounded. Neither half needs a rule; this pins that neither grew one.
  assert.ok(!/launchChain/.test(read("session-park.js")));
  const src = read("session-io.js");
  const record = src.slice(src.indexOf("function baseRecord(s) {"), src.indexOf("// The canUseTool bridge"));
  assert.ok(record.length > 0 && !/launchChain/.test(record));
});

test("the setting is LOCAL and machine-only — no route, no op, no column may write it", () => {
  // ⚠ THE SECURITY CONTENT, and it is the orchestrator toggle's argument verbatim: a spawned
  // session has `Bash` and the operator's device token on disk, so a server-reachable version of
  // this flag is one the agents it governs could flip for themselves, on every machine the
  // operator owns.
  const prefs = read("channel-prefs.js");
  assert.match(prefs, /const AGENT_CHAIN_KEY = 'channelAgentChain';/);
  const ipc = read("channel-dir-ipc.js");
  assert.match(ipc, /ipcMain\.handle\('channels:getAgentChain', appWindowOnly\(/);
  assert.match(ipc, /ipcMain\.handle\('channels:setAgentChain', appWindowOnly\(/);
  const writers = ["api.js", "launch-directives.js", "agent-directions.js", "realtime.js"]
    .filter((f) => /setAgentChain/.test(read(f)));
  assert.deepEqual(writers, [], "nothing that talks to the server may write this");
});

test("NO live fan-out — a containment flag is a spawn-time stamp, unlike the posture", () => {
  // ⚠ THE ASYMMETRY WITH `setLaunchPosture` IS THE RULE, NOT AN OMISSION. That op fans a changed
  // posture out to running sessions on an argument that names its own limit: it widens
  // SUPERVISION, never CONTAINMENT. This is containment.
  const ipc = read("channel-dir-ipc.js");
  const handler = ipc.slice(ipc.indexOf("'channels:setAgentChain'"), ipc.indexOf("ORCHESTRATOR LAUNCH TOGGLE"));
  assert.ok(handler.length > 0 && !/applyPostureToLive|setModeByTask|listLiveSessions/.test(handler),
    "flipping chaining must not reach a session that is already running");
});

// ── PIN 4. THE BACKSTOP HOLDS: ON ≠ FORK BOMB ────────────────────────────────────

test("the backstop is REAL and is spent only by the chained lane", () => {
  budget.resetForTests();
  const t0 = 1_000_000;
  // The operator's own button and every other lane pass no flag and are never counted.
  const funnel = read("session-launch.js");
  assert.match(funnel, /a\.launchChain === true && !launchBudget\.spend\(a\.channelId\)/);
  // …and the budget itself refuses past the ceiling, inside the window.
  for (let i = 0; i < budget.MAX_CHAINED_LAUNCHES; i += 1) {
    assert.equal(budget.spend(CH, t0 + i), true, `spend ${i} is within budget`);
  }
  assert.equal(budget.spend(CH, t0 + budget.MAX_CHAINED_LAUNCHES), false, "the ceiling holds");
  assert.equal(budget.spentIn(CH, t0), budget.MAX_CHAINED_LAUNCHES, "a refusal recorded nothing");
});

test("the backstop is HONEST about what it is not: there is no generation bound left", () => {
  // ⚠ THE ONE CLAIM THIS WAVE MUST NOT MAKE. `MAX_LAUNCH_DEPTH` is untouched and still 1 — the
  // setting SKIPS the question rather than raising the number — because a "cap at N generations"
  // needs a depth that survives the round trip and the directive row has no such column. The
  // wire change is FILED (F-378), not guessed at.
  assert.equal(lane.MAX_LAUNCH_DEPTH, 1, "the bound itself did not move");
  assert.equal(lane.launchDepthExhausted(undefined), true, "absent is still the cap");
  const src = read("session-own-launch.js");
  assert.match(src, /THERE IS NO GENERATION BOUND LEFT/,
    "the module says so in as many words — an implied bound is the failure this file exists to avoid");
});
