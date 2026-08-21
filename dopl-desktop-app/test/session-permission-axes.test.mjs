// v2.9 THE TWO PERMISSION AXES — the truth tables, the scoped grant keys, and THE INVARIANT.
//
// One "Auto-approve" checkbox used to control two unrelated things, because an outbound message
// is technically a tool call (`dopl_channel op=post`) and rides the same canUseTool plumbing as
// Bash. That fusion is HIGH-4: turning on hands-off messaging silently granted arbitrary Bash /
// Write / Edit AND `dopl_channel op=open direct:true` to any workspace member (the exfil path
// v1.9 FIX H1 closed). This file pins the split:
//
//   AXIS A  toolMode     manual | accept_edits | auto | bypass   (what MY agent may do here)
//   AXIS B  messageMode  ask | auto_inbound | auto_outbound | auto_both  (what crosses)
//
// THE INVARIANT, proven in BOTH directions below: Axis A can never auto-approve a message
// operation, and Axis B can never auto-approve a work tool. The v2.9 adversarial-review fixes
// F1-F9 are pinned in session-permission-hardening.test.mjs, except F1 (park clears the standing
// grants), which lives with the other park resets below because that is the test that missed it.
//
// ⚠ 2026-08-20 (F-228) — THIS FILE USED TO PIN FOUR COPIES OF THE MODE TABLES AND THE HEADER UI.
// The v1 session window is deleted: renderer/session/session-preload.js, session.html,
// session.js, session-modes-ui.js, session-labels.js and session-viewmodel.js are gone, and so is
// main/session-ipc.js. The §E four-way agreement is therefore a TWO-way one (main + the reducer),
// §F (the IPC surface) and the two §G UI tests are gone, and §H moved out with the view-model.
// Each is replaced in place by a ⚠ block. Nothing about the POLICY changed: §A, §B, §C, §D, THE
// INVARIANT and the SDK-options pin are the guards they always were, and the AXES THEMSELVES are
// still the only thing standing between `bypass` and an outbound message.
//
// Layers now: source extraction with injection for the electron-free-but-constant-fed session-
// profiles block (the established idiom), and a direct require for the reducer and session-io.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);

const profiles = require(M("session-profiles.js"));
const reducer = require(M("session-reducer.js"));
const io = require(M("session-io.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

const GATE = readFileSync(M("session-gate.js"), "utf8");
const REDUCER_SRC = readFileSync(M("session-reducer.js"), "utf8");
// §2 SPLIT (2026-07-31): the reducer's STATE SHAPE — its defaults, initialSessionState and the
// two mode tables it defends itself with — moved to session-state.js when session-reducer.js
// (a zero-headroom §2 file) had to grow the self-authored inbound conjunct.
const STATE_SRC = readFileSync(M("session-state.js"), "utf8");
const QUERY = readFileSync(M("session-query.js"), "utf8"); // §3 SPLIT: buildSdkOptions lives here

const { grantDecision, grantKeyFor, TOOL_MODES, MESSAGE_MODES } = profiles;
// Source pins run against CODE, not the prose above it: a comment may name the thing it replaced
// (these ones deliberately do). Drops whole-line comments AND trailing ` // ...` ones. (A url's
// `://` never matches the space-slash-slash-space form, so this cannot eat code.)
const stripComments = (src) => src
  .split("\n")
  .filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/\s.*$/, ""))
  .join("\n");
const CH = "ch1";
// FIX F4: the FULL digest. 48 bits is seconds of search for a counterparty who supplies the text.
const shaKey = (v) => createHash("sha256").update(String(v)).digest("hex");
const decide = (over) => grantDecision({ profile: "full", channelId: CH, ...over });
const keyOf = (input) => grantKeyFor(DOPL_CHANNEL_TOOL, input, CH);

// ── A. THE TOOL TRUTH TABLE (Axis A) ──────────────────────────────────────────────
// Every tool class x every mode. `full` is used throughout because it is the only profile that
// live-gates work tools at all; the restricted profiles are covered by the deny/preapproved rows
// in session-profiles.test.mjs.

const INPUTS = {
  Bash: { command: "ls -la" },
  Write: { file_path: "/w/a.txt", content: "x" },
  Edit: { file_path: "/w/a.txt", old_string: "a", new_string: "b" },
  NotebookEdit: { notebook_path: "/w/n.ipynb", new_source: "x" },
  MultiEdit: { file_path: "/w/a.txt", edits: [] },
  WebFetch: { url: "https://api.example.com/x" },
  WebSearch: { query: "how to ship" },
  mcp__dopl__dopl_kb: { op: "list" },
  mcp__dopl__dopl_search: { query: "x" },
  Read: { file_path: "/w/a.txt" },
  Task: { description: "spawn a subagent" },
};

// expected verdict per tool per toolMode, with NOTHING granted.
const TOOL_TRUTH = {
  //                manual   accept_edits  auto     bypass
  Bash: /*         */["gate", "gate", "gate", "allow"], // A3 escalation: reaches the shell
  WebFetch: /*     */["gate", "gate", "gate", "allow"], // A3 escalation: reaches the network
  WebSearch: /*    */["gate", "gate", "gate", "allow"], // A3 escalation: reaches the network
  Write: /*        */["gate", "allow", "allow", "allow"], // A2 edit set
  Edit: /*         */["gate", "allow", "allow", "allow"], // A2 edit set
  NotebookEdit: /* */["gate", "allow", "allow", "allow"], // A2 edit set
  MultiEdit: /*    */["gate", "gate", "allow", "allow"], // A2 names three tools, not four
  // FIX F2: dopl_kb WRITES to the shared workspace (write_file / create_base / create_folder),
  // i.e. off THIS machine into rows every workspace member can read. `auto` gates it now.
  mcp__dopl__dopl_kb: ["gate", "gate", "gate", "allow"],
  mcp__dopl__dopl_search: ["gate", "gate", "allow", "allow"], // a read-only dopl lookup
  Read: /*         */["preapproved", "preapproved", "preapproved", "preapproved"], // shadowed
  // F-177 INVERTED this row (it was four denies): `full` released Task from SESSION_HARD_DENY,
  // and no released name is on AUTO_TOOLS/BYPASS_TOOLS, so it gates in every mode incl. bypass.
  Task: /*         */["gate", "gate", "gate", "gate"],
};

test("AXIS A truth table: every tool class x every tool mode", () => {
  for (const [tool, row] of Object.entries(TOOL_TRUTH)) {
    TOOL_MODES.forEach((toolMode, i) => {
      assert.equal(decide({ toolName: tool, input: INPUTS[tool], toolMode }), row[i], `${tool} @ toolMode=${toolMode}`);
    });
  }
});

test("AXIS A: hard-deny is immovable in EVERY mode, task grant or not (contract A/§H-2)", () => {
  for (const tool of ["mcp__dopl__dopl_kb_admin", "mcp__dopl__dopl_chats_admin", "mcp__dopl__dopl_cluster_admin"]) {
    for (const toolMode of TOOL_MODES) {
      assert.equal(decide({ toolName: tool, toolMode }), "deny", `${tool} @ ${toolMode}`);
      assert.equal(decide({ toolName: tool, toolMode, allowForTask: [grantKeyFor(tool, {}, CH)] }), "deny", `${tool} @ ${toolMode} + a task grant`);
    }
    // ...and no MESSAGE posture reaches it either.
    for (const messageMode of MESSAGE_MODES) {
      assert.equal(decide({ toolName: tool, messageMode }), "deny", `${tool} @ messageMode=${messageMode}`);
    }
  }
});

test("AXIS A: an unknown / absent mode falls back to `manual` (fail-closed)", () => {
  for (const junk of [undefined, null, "", "AUTO", "bypassPermissions", 1, {}, "auto "]) {
    assert.equal(decide({ toolName: "Bash", input: INPUTS.Bash, toolMode: junk }), "gate", String(junk));
  }
  assert.equal(profiles.normalizeToolMode("bypassPermissions"), "manual");
  assert.equal(profiles.normalizeMessageMode("auto"), "ask", "an Axis A value is not an Axis B value");
});

// ── B. THE MESSAGE TRUTH TABLE (Axis B) ───────────────────────────────────────────

const OWN_POST = { op: "post", body: "shipping tonight" };
const CROSS_POST = { op: "post", channel: "other", body: "the file contents" };
const DM_OPEN = { op: "open", direct: true, member: "evil@x" };

// M3 (2026-08-05) — the `read` row MOVED: an own-channel read now follows the INBOUND half of
// this axis. The whole read half (every op, both directions, the classifier) is proved in
// test/session-channel-read.test.mjs; this row is the pointer that keeps the table honest.
test("AXIS B truth table: only an OWN-channel post is ever auto-sent", () => {
  const rows = [
    ["own post", OWN_POST, { ask: "gate", auto_inbound: "gate", auto_outbound: "allow", auto_both: "allow" }],
    // Everything else here is the cross-user exfil surface FIX H1 closed: "send my replies for
    // me" is not consent to open a DM with another workspace member.
    ["cross-channel post", CROSS_POST, { ask: "gate", auto_inbound: "gate", auto_outbound: "gate", auto_both: "gate" }],
    ["DM open", DM_OPEN, { ask: "gate", auto_inbound: "gate", auto_outbound: "gate", auto_both: "gate" }],
    ["read (M3: the INBOUND half, not the outbound one)", { op: "read" },
      { ask: "gate", auto_inbound: "allow", auto_outbound: "gate", auto_both: "allow" }],
    ["create_task", { op: "create_task" }, { ask: "gate", auto_inbound: "gate", auto_outbound: "gate", auto_both: "gate" }],
  ];
  for (const [name, input, expected] of rows) {
    for (const messageMode of MESSAGE_MODES) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode }), expected[messageMode],
        `${name} @ messageMode=${messageMode}`);
    }
  }
});

// ── THE INVARIANT ─────────────────────────────────────────────────────────────────

test("INVARIANT (1): AXIS A can NEVER auto-approve a dopl_channel op, bypass included", () => {
  for (const toolMode of TOOL_MODES) {
    for (const input of [OWN_POST, CROSS_POST, DM_OPEN, { op: "read" }, { op: "invite" }, undefined]) {
      assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, toolMode }), "gate", `toolMode=${toolMode} must not decide ${JSON.stringify(input)}`);
    }
  }
});

test("INVARIANT (2): AXIS B can NEVER auto-approve a work tool, auto_both included", () => {
  for (const messageMode of MESSAGE_MODES) {
    for (const tool of ["Bash", "Write", "Edit", "NotebookEdit", "MultiEdit", "WebFetch", "WebSearch", "mcp__dopl__dopl_kb"]) {
      assert.equal(decide({ toolName: tool, input: INPUTS[tool], messageMode }), "gate", `messageMode=${messageMode} must not decide ${tool}`);
    }
  }
});

test("INVARIANT: the channel branch returns BEFORE Axis A is consulted (source pin)", () => {
  const src = readFileSync(M("session-profiles.js"), "utf8");
  const fn = src.slice(src.indexOf("function grantDecision(args) {"), src.indexOf("// ─── END SESSION-PROFILE TABLE"));
  const channelBranch = fn.indexOf("isChannelTool(a.toolName)");
  const axisA = fn.indexOf("toolModeAllows(a.toolMode");
  // F-139 (2026-08-05): the lookup is on the CANONICAL name now (`canonicalDoplName(a.toolName)`
  // one line above), because a deny list a different server prefix walks past is not a deny
  // list. The ORDER this test exists to pin is untouched.
  const hardDeny = fn.indexOf("cfg.disallowedTools.indexOf(name)");
  assert.ok(hardDeny !== -1 && hardDeny < channelBranch, "hard-deny is decided FIRST of all");
  assert.ok(channelBranch !== -1 && channelBranch < axisA, "channel ops branch out before the tool mode");
  assert.ok(!/messageMode/.test(fn.slice(axisA)), "no message posture is read after the channel branch");
});

// ── C. THE SCOPED GRANT KEYS (HIGH-1 + MEDIUM-2) ──────────────────────────────────

test("HIGH-1: Bash keys on argv0 + a digest of the exact command", () => {
  assert.equal(grantKeyFor("Bash", { command: "ls -la" }), "Bash#ls#" + shaKey("ls -la"));
  // The whole point: one approved command does not authorize the next one.
  const granted = [grantKeyFor("Bash", { command: "ls -la" })];
  assert.equal(decide({ toolName: "Bash", input: { command: "ls -la" }, allowForTask: granted }), "allow");
  assert.equal(decide({ toolName: "Bash", input: { command: "rm -rf ~" }, allowForTask: granted }), "gate");
  assert.equal(decide({ toolName: "Bash", input: { command: "ls -la /etc" }, allowForTask: granted }), "gate");
  // ...and the bare tool name authorizes nothing at all any more.
  assert.equal(decide({ toolName: "Bash", input: { command: "ls -la" }, allowForTask: ["Bash"] }), "gate");
});

test("HIGH-1: WebFetch / WebSearch key on ORIGIN (path and query do not widen it)", () => {
  const a = grantKeyFor("WebFetch", { url: "https://docs.example.com/a?x=1" });
  const b = grantKeyFor("WebFetch", { url: "HTTPS://Docs.Example.com/b" });
  assert.equal(a, b, "same origin, same key — case and path are not part of the scope");
  assert.notEqual(a, grantKeyFor("WebFetch", { url: "https://evil.test/a" }), "a different host is a different key");
  assert.notEqual(a, grantKeyFor("WebFetch", { url: "http://docs.example.com/a" }), "so is a different scheme");
  const granted = [a];
  assert.equal(decide({ toolName: "WebFetch", input: { url: "https://docs.example.com/z" }, allowForTask: granted }), "allow");
  assert.equal(decide({ toolName: "WebFetch", input: { url: "https://evil.test/z" }, allowForTask: granted }), "gate");
  // A url-less call (a plain WebSearch) has no origin to scope by, so it falls back to the
  // INPUT hash — stricter than granting every later search at once.
  assert.equal(grantKeyFor("WebSearch", { query: "a" }), "WebSearch#" + shaKey('{"query":"a"}'));
  assert.notEqual(grantKeyFor("WebSearch", { query: "a" }), grantKeyFor("WebSearch", { query: "b" }));
});

test("HIGH-1: Write / Edit / NotebookEdit key on the RESOLVED DIRECTORY", () => {
  const a = grantKeyFor("Write", { file_path: "/repo/src/a.js" });
  assert.equal(a, grantKeyFor("Write", { file_path: "/repo/src/b.js" }), "same dir, same key");
  assert.notEqual(a, grantKeyFor("Write", { file_path: "/repo/secrets/b.js" }), "another dir needs its own");
  assert.notEqual(a, grantKeyFor("Edit", { file_path: "/repo/src/a.js" }), "and another TOOL its own again");
  assert.equal(grantKeyFor("NotebookEdit", { notebook_path: "/repo/nb/x.ipynb" }), grantKeyFor("NotebookEdit", { notebook_path: "/repo/nb/y.ipynb" }));
  const granted = [a];
  assert.equal(decide({ toolName: "Write", input: { file_path: "/repo/src/c.js" }, allowForTask: granted }), "allow");
  assert.equal(decide({ toolName: "Write", input: { file_path: "/repo/.ssh/id_rsa" }, allowForTask: granted }), "gate");
});

test("HIGH-1: everything else keys on a STABLE hash of the whole input", () => {
  // Property order must not change the key, or a grant would evaporate at random.
  assert.equal(grantKeyFor("mcp__dopl__dopl_kb", { op: "get", id: "k1" }), grantKeyFor("mcp__dopl__dopl_kb", { id: "k1", op: "get" }));
  assert.notEqual(grantKeyFor("mcp__dopl__dopl_kb", { op: "get", id: "k1" }), grantKeyFor("mcp__dopl__dopl_kb", { op: "get", id: "k2" }));
  // Bounded: a hostile input can never grow the key into a blob (tool name + one digest).
  const KEY_MAX = "mcp__dopl__dopl_kb".length + 1 + 64;
  const huge = grantKeyFor("mcp__dopl__dopl_kb", { op: "x".repeat(9000) });
  assert.equal(huge.length, KEY_MAX, "the key stays fixed-width whatever the input");
  // Deeply nested / self-referential input terminates (depth bound) instead of hanging.
  const deep = {}; let cur = deep;
  for (let i = 0; i < 500; i++) { cur.next = {}; cur = cur.next; }
  assert.equal(grantKeyFor("mcp__dopl__dopl_kb", deep).length, KEY_MAX);
  const cyclic = { op: "x" }; cyclic.self = cyclic;
  assert.equal(grantKeyFor("mcp__dopl__dopl_kb", cyclic).length, KEY_MAX);
});

test("MEDIUM-2: `to` and `kind` are folded into the post key", () => {
  const plain = keyOf({ op: "post", body: "hi" });
  assert.ok(plain.startsWith(profiles.POST_GRANT + "#body:"), "still the v2.5 own-post namespace");
  assert.equal(keyOf({ op: "post", body: "hi", kind: "message" }), plain,
    "`message` is the default kind, so it adds no segment");
  // An ADDRESSED post and a LIFECYCLE post each earn their own key.
  const addressed = keyOf({ op: "post", body: "hi", to: "evil@x.com" });
  const finished = keyOf({ op: "post", body: "hi", kind: "task_finished" });
  assert.notEqual(addressed, plain);
  assert.notEqual(finished, plain);
  assert.notEqual(addressed, keyOf({ op: "post", body: "hi", to: "someone@else.com" }));
  // So one approved reply cannot post to a different member, or forge a completion.
  const granted = [plain];
  assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "post", body: "hi" }, allowForTask: granted }), "allow");
  assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "post", body: "hi", to: "evil@x.com" }, allowForTask: granted }), "gate");
  assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "post", body: "hi", kind: "task_finished" }, allowForTask: granted }), "gate");
  // The cross-channel key carries them too, on top of its target.
  assert.notEqual(keyOf({ op: "post", channel: "other", kind: "task_failed" }), keyOf({ op: "post", channel: "other" }));
});

// ⚠ REWRITTEN 2026-08-20 (F-228), not deleted. This test used to end with four assertions on the
// RENDERER end of the same rule — labels.postDestinationText's three copy cases and the two
// view-model items that carried `addressed` / `postKind` to it. renderer/session/session-labels.js
// and session-viewmodel.js are deleted, so those lines are gone. What they were downstream OF is
// the security half and it is untouched: MAIN must stamp the decision payload with the CALL's own
// recipient and lifecycle kind, never the session's assumed counterparty — an agent that posts
// `to: evil@x.com` must not be able to have the operator approve a card that says "David".
test("MEDIUM-2: the gate payload carries the call's REAL to/kind, not the session peer", () => {
  const s = { profile: "full", channelId: CH, counterpartyName: "David", state: { allowForTask: [], messageMode: "ask" },
    pendingPermissions: new Map(), pendingNames: new Map() };
  const evs = [];
  const canUse = io.makeCanUseTool(s, (_s, ev) => evs.push(ev));
  // Unaddressed: the bound counterparty, and NO extra fields (the v2.8 payload exactly).
  canUse(DOPL_CHANNEL_TOOL, { op: "post", body: "hi" }, { requestId: "r1", toolUseID: "t1" });
  assert.deepEqual(evs[0].payload, {
    type: "outbound_gate", requestId: "r1", toolUseId: "t1", ownChannel: true, text: "hi", to: "David",
    // 2026-08-02: plus the reason code that explains the gate — AXIS B is at `ask` here.
    gateReason: "message-approval-required",
  });
  // N-PARTY: `to` alone is main's bound-counterparty FILL, so the payload does NOT claim the call
  // addressed anyone — the absence of `addressed` above is that claim, and where the fill (and the
  // `directChannel` flag that qualifies it) comes from is pinned in
  // test/session-dm-addressee-truth.test.mjs.
  assert.equal(evs[0].payload.addressed, undefined);
  // Addressed + lifecycle-kinded: the REAL recipient and the claimed kind ride the payload.
  canUse(DOPL_CHANNEL_TOOL, { op: "post", body: "done", to: "evil@x.com", kind: "task_finished" },
    { requestId: "r2", toolUseID: "t2" });
  assert.equal(evs[1].payload.to, "evil@x.com", "not the session's counterparty");
  assert.equal(evs[1].payload.addressed, true);
  assert.equal(evs[1].payload.postKind, "task_finished");
  for (const id of ["r1", "r2"]) s.pendingPermissions.get(id)({ behavior: "deny" });
});

test("B3: grants are in-memory only — nothing about a key is ever persisted", () => {
  const rec = io.baseRecord({ key: "k", sessionId: "s", channelId: CH, taskId: "t", state: {
    ...reducer.initialSessionState(), allowForTask: ["Bash#ls#deadbeefcafe"], toolMode: "bypass" } });
  assert.equal(rec.allowForTask, undefined);
  assert.equal(rec.toolMode, undefined);
  assert.equal(rec.messageMode, undefined);
});

// ── D. M2 (2026-08-05): THE PARK PRESERVES BOTH AXES, inboundForTask AND THE GRANTS ──
//
// THE REQUIREMENT CHANGE, and it inverts this test. It used to prove A4/A5 (both axes), C9
// (inboundForTask) and FIX F1 (allowForTask) were all cleared on park. Samuel's contract is that
// a posture he set holds for the whole session, the for-task grants included, and he named the
// grants explicitly. F1's real defect was that the header and the state DISAGREED — a reset
// posture beside a surviving grant — and consistency, not clearing, is what fixes that: the axes
// and the grants now survive together, and the header goes on telling the truth about both.
// The AWAY threat all three fixes named is answered by session-state.ABANDONED_MS (an abandoned
// session ENDS, which is terminal and therefore stronger than a downgrade that stayed wakeable)
// and by the PROFILE hard-deny, which no posture and no grant has ever been able to widen — the
// last assertion below is that half, unchanged.
test("M2: a park preserves both axes, inboundForTask AND every standing grant", () => {
  const postGrant = keyOf(OWN_POST);
  const bashGrant = grantKeyFor("Bash", { command: "ls -la" });
  const armed = {
    ...reducer.initialSessionState(), phase: "running",
    toolMode: "bypass", messageMode: "auto_both", inboundForTask: true,
    allowForTask: [postGrant, bashGrant],
  };
  const r = reducer.sessionReducer(armed, { type: "idle_timeout" });
  assert.equal(r.state.parked, true, "it still parks: the query is still torn down");
  assert.equal(r.state.toolMode, "bypass");
  assert.equal(r.state.messageMode, "auto_both");
  assert.equal(r.state.inboundForTask, true);
  assert.deepEqual(r.state.allowForTask, [postGrant, bashGrant], "the grants outlive the park");
  assert.ok(!r.effects.some((e) => e.type === "emit" && e.payload.type === "modes"),
    "and the header is not dragged back to a posture the woken session would not honor");
  // The WOKEN session behaves as the operator set it — asked with the woken state, as before.
  const s = { profile: "full", channelId: CH, state: r.state };
  const woken = { ...s, allowForTask: r.state.allowForTask, toolMode: r.state.toolMode, messageMode: r.state.messageMode };
  assert.equal(grantDecision({ ...woken, toolName: "Bash", input: { command: "ls -la" } }), "allow");
  assert.equal(grantDecision({ ...woken, toolName: DOPL_CHANNEL_TOOL, input: OWN_POST }), "allow");
  assert.equal(io.postWillGate({ ...s, state: r.state }, OWN_POST), false);
  // THE BOUNDARY THAT DID NOT MOVE: hard-deny survives a park, and (F-177) so does gated-ness.
  for (const [t, want] of [["mcp__dopl__dopl_kb_admin", "deny"], ["mcp__dopl__dopl_cluster_admin", "deny"], ["Task", "gate"], ["SendMessage", "gate"]]) {
    assert.equal(grantDecision({ ...woken, toolName: t, input: {} }), want, `${t} after a park`);
  }
});

// ── E. THE COPIES OF THE MODE TABLES AGREE ────────────────────────────────────────
// session-profiles is canonical and the reducer defends its own state against it.
//
// ⚠ SHRUNK 2026-08-20 (F-228) — this was "the FOUR copies", and the other two were the sandboxed
// renderer's: session-preload.js coerced at the bridge (unknown tool mode -> manual, unknown
// message mode -> ask) and session.html offered exactly these values, in this order, on the two
// selects. Both files are deleted, so there is no third or fourth copy left to drift. The last
// paragraph of the old test — the VIEW-MODEL's own fail-closed copy, `vm.reduceEvent({type:
// "modes"})` — went with session-viewmodel.js. The duplication that remains (main vs the state
// machine) is the one that was always structural, and it is still checked.

test("the mode tables agree across main and the reducer's own state module", () => {
  assert.deepEqual(TOOL_MODES, ["manual", "accept_edits", "auto", "bypass"]);
  assert.deepEqual(MESSAGE_MODES, ["ask", "auto_inbound", "auto_outbound", "auto_both"]);
  // The state machine's own copy (source-extracted, since the block is evaluated standalone).
  const red = (name) => {
    const at = STATE_SRC.indexOf("const " + name + " = [");
    assert.notEqual(at, -1, name + " missing from session-state.js");
    const list = STATE_SRC.slice(STATE_SRC.indexOf("[", at) + 1, STATE_SRC.indexOf("]", at));
    return list.split(",").map((x) => x.trim().replace(/['"]/g, ""));
  };
  assert.deepEqual(red("TOOL_MODES"), TOOL_MODES);
  assert.deepEqual(red("MESSAGE_MODES"), MESSAGE_MODES);
});

test("the THIRD copy — channel-prefs' WRITE validator — agrees with the canonical tables", () => {
  // ⚠ FOUND UNPINNED 2026-08-20 (F-236's audit). `main/channel-prefs.js` carries its own frozen
  // enums and its own suite asserted them against LITERALS, never against session-profiles — so
  // the two were only ever kept in step by a reviewer's memory. It is not a harmless copy:
  // `normalizePreset` REJECTS a pair outside its lists (`{ok:false}`, nothing written), so a
  // fifth mode added to the canonical axis would make the durable launch posture silently
  // unwritable for that value, with every suite green.
  //
  // Read as SOURCE because channel-prefs.js requires electron-store, and the enums sit inside
  // its own extraction block.
  const PREFS = readFileSync(M("channel-prefs.js"), "utf8");
  const prefsList = (name) => {
    const at = PREFS.indexOf("const " + name + " = [");
    assert.notEqual(at, -1, name + " missing from channel-prefs.js");
    return PREFS.slice(PREFS.indexOf("[", at) + 1, PREFS.indexOf("]", at))
      .split(",").map((x) => x.trim().replace(/['"]/g, ""));
  };
  assert.deepEqual(prefsList("TOOL_MODES"), TOOL_MODES);
  assert.deepEqual(prefsList("MESSAGE_MODES"), MESSAGE_MODES);
});

test("the SPA holds a FOURTH copy, and it is out of this tree's reach — stated, not asserted", () => {
  // ⚠ `src/features/channels/lib/permission-modes.ts` declares both axes again, for the
  // renderer that offers them. This suite cannot read it (different package, different lint
  // and test tiers), so this case exists to make the fourth copy VISIBLE from the desktop side
  // rather than to check it — a count nobody states is a count nobody re-measures.
  //
  // ⚠ THE DESKTOP IS THE FENCE EITHER WAY, and that is why the gap is tolerable: every mode
  // crossing the bridge is re-validated here (`normalizeToolMode` / `normalizeMessageMode`,
  // fail-closed) and the reducer coerces AGAIN. A drifted SPA copy can offer a value main
  // refuses; it can never make main accept one.
  assert.deepEqual(MESSAGE_MODES.length, 4, "a fifth mode is a change in FOUR places — see above");
  assert.deepEqual(TOOL_MODES.length, 4);
});

test("the two inbound-auto predicates (gate + reducer) agree on all four message modes", () => {
  // session-gate.autoInbound and the reducer's inboundAutoAccepted answer the same question
  // on two paths; if they ever disagreed, a message would be held by one and fed by the other.
  // ⚠ 2026-08-20 (F-228): both halves used to be `src.slice(indexOf(A), indexOf(B))`, and the
  // gate's END MARKER was `function windowHasFocus` — which F-228 deleted along with the rest of
  // the surfacing half. That slice would now throw (or, with a marker that merely MOVED, silently
  // yield "" and pass vacuously — the audit R3(a) shape). fnOf() brace-matches each function's
  // REAL body, so there is no neighbouring symbol left for this extraction to depend on at all.
  const gateFn = new Function("s", fnOf(GATE, "autoInbound") + "\n return autoInbound(s);");
  const redFn = new Function("state", fnOf(REDUCER_SRC, "inboundAutoAccepted") + "\n return inboundAutoAccepted(state);");
  for (const messageMode of MESSAGE_MODES) {
    for (const inboundForTask of [false, true]) {
      const state = { messageMode, inboundForTask };
      assert.equal(gateFn({ state }), redFn(state), `${messageMode}/${inboundForTask}`);
    }
  }
  // And a TOOL posture opens neither of them.
  for (const toolMode of TOOL_MODES) {
    assert.equal(gateFn({ state: { toolMode } }), false, toolMode);
    assert.equal(redFn({ toolMode }), false, toolMode);
  }
});

// ── F. THE IPC SURFACE ────────────────────────────────────────────────────────────
//
// ⚠ DELETED 2026-08-20 (F-228) — "IPC: the fused channel is REPLACED by two, and the inbound
// drain moved to AXIS B" read main/session-ipc.js, which is deleted with the session window it
// served. It pinned: two handlers (`session:set-tool-mode` / `session:set-message-mode`) where
// the fused `set-auto-approve` used to be, with no alias left behind; main RE-coercing through
// normalizeToolMode / normalizeMessageMode rather than trusting the preload; v2.5 D4's
// `gate.drainInbound(s)` living on the MESSAGE handler ONLY, so AXIS A never touched the inbound
// queue; and both handlers binding from `event.sender`, never a sessionId in the payload.
// `grep -rn "set-tool-mode\|set-message-mode\|drainInbound" main/ renderer/` finds no handler and
// no drain anywhere in the tree (2026-08-20) — gate.drainInbound is itself one of the functions
// F-228 removed from session-gate.js. There is no live surface left for this test to describe;
// the POLICY it protected (a tool posture cannot move messages) is proved directly by
// INVARIANT (1) and (2) above, which do not need an IPC channel to hold.

test("A: the SDK is still driven at permissionMode 'default' with settingSources []", () => {
  // The load-bearing pin: `bypassPermissions` would stop the SDK calling canUseTool at all,
  // which would kill the outbound message card AND the hard-deny path. All four tool modes
  // resolve in OUR gate, so the SDK options must never learn about them.
  const opts = QUERY.slice(QUERY.indexOf("function buildSdkOptions(s) {"), QUERY.indexOf("// H1 — SUPERSEDE"));
  assert.match(opts, /permissionMode: 'default'/);
  assert.match(opts, /settingSources: \[\]/);
  assert.ok(!/acceptEdits|bypassPermissions|toolMode|messageMode/.test(stripComments(opts)),
    "no mode may ever be handed to the SDK");
});

// ── G. THE HEADER (contract D) ────────────────────────────────────────────────────
//
// ⚠ DELETED 2026-08-20 (F-228) — two UI tests, both over deleted renderer files:
//   - "UI: two labeled selects, token classes only, no copy in CSS `content`" read session.html
//     and session.css. It pinned the eight option labels as STATIC markup (no copy smuggled in
//     through CSS `content:`), token colours only in the .mode-select block, and the --danger
//     token on `.mode-select__input.is-bypass` so `bypass` never looked routine.
//   - "UI: the controller paints both axes from MAIN's echo, never from the click" read
//     session.js and session-modes-ui.js. It pinned the ONE writer of `.value` reading the
//     view-model (which moves only on main's echo), the two change listeners carrying the
//     select's own value, no trace of the fused `setAutoApprove`, and textContent-only.
// session.html, session.css, session.js and session-modes-ui.js are all deleted, and so is
// test/session-modes-dom.test.mjs, which drove the same pair end to end.
//
// ⚠ There is NO surviving posture control. Nothing in the tree writes toolMode or messageMode
// from an operator gesture any more — the axes are set by the channel-prefs derivation and read
// by the gate, which is why §A-§D above are now the whole of this contract's coverage.

// ── H. C8 (MEDIUM-6): the counterparty name was bounded at both decision surfaces ──
//
// ⚠ DELETED 2026-08-20 (F-228) — "C8: reduceEvent caps the counterparty name at 60 on both
// decision surfaces" was entirely a renderer/session/session-viewmodel.js property: a 400-char or
// multi-line `from` on a `counterparty` / `inbound_pending` item was capped at 60 and one-lined,
// so a hostile display name could not push the body and the buttons off screen. There is no
// screen and no view-model. main/session-gate.js keeps its OWN `oneLine(value, cap)` for the
// notice copy it still hands trigger.js, and that half is pinned in test/inbound-gate-notify.test.mjs.
