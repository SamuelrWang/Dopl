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
// Layers: source extraction with injection for the electron-free-but-constant-fed session-
// profiles block (the established idiom), a direct require for the reducer + the renderer's pure
// modules, and regex pins for the preload / IPC / HTML surfaces.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));

const profiles = require(M("session-profiles.js"));
const reducer = require(M("session-reducer.js"));
const io = require(M("session-io.js"));
const labels = require(R("session-labels.js"));
const vm = require(R("session-viewmodel.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

const PRELOAD = readFileSync(R("session-preload.js"), "utf8");
const HTML = readFileSync(R("session.html"), "utf8");
const IPC = readFileSync(M("session-ipc.js"), "utf8");
const GATE = readFileSync(M("session-gate.js"), "utf8");
const REDUCER_SRC = readFileSync(M("session-reducer.js"), "utf8");
// §2 SPLIT (2026-07-31): the reducer's STATE SHAPE — its defaults, initialSessionState and the
// two mode tables it defends itself with — moved to session-state.js when session-reducer.js
// (a zero-headroom §2 file) had to grow the self-authored inbound conjunct.
const STATE_SRC = readFileSync(M("session-state.js"), "utf8");
const ENGINE = readFileSync(M("session-engine.js"), "utf8");
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
  Task: /*         */["deny", "deny", "deny", "deny"], // SESSION_HARD_DENY, immovable
};

test("AXIS A truth table: every tool class x every tool mode", () => {
  for (const [tool, row] of Object.entries(TOOL_TRUTH)) {
    TOOL_MODES.forEach((toolMode, i) => {
      assert.equal(decide({ toolName: tool, input: INPUTS[tool], toolMode }), row[i], `${tool} @ toolMode=${toolMode}`);
    });
  }
});

test("AXIS A: hard-deny is immovable in EVERY mode, task grant or not (contract A/§H-2)", () => {
  for (const tool of ["Task", "Agent", "CronCreate", "SendMessage", "mcp__dopl__dopl_kb_admin"]) {
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

test("MEDIUM-2: the card is painted with the call's REAL to/kind, not the session peer", () => {
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
  // Addressed + lifecycle-kinded: the REAL recipient and the claimed kind ride the payload.
  canUse(DOPL_CHANNEL_TOOL, { op: "post", body: "done", to: "evil@x.com", kind: "task_finished" },
    { requestId: "r2", toolUseID: "t2" });
  assert.equal(evs[1].payload.to, "evil@x.com", "not the session's counterparty");
  assert.equal(evs[1].payload.addressed, true);
  assert.equal(evs[1].payload.postKind, "task_finished");
  for (const id of ["r1", "r2"]) s.pendingPermissions.get(id)({ behavior: "deny" });
  // ...and the renderer says both out loud on the decision surface.
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "David" }), "To: this channel, no recipient named", "N-PARTY: an unaddressed `to` is main's bound-counterparty FILL, not an addressee (session-addressee-truth.test.mjs)");
  assert.equal(labels.postDestinationText({ ownChannel: true, to: "evil@x.com", addressed: true, postKind: "task_finished" }), "To: evil@x.com, marked task_finished");
  assert.equal(labels.postDestinationText({ ownChannel: false, postKind: "task_finished" }), "To: another channel, marked task_finished");
  // The item carries them through the view-model to that surface.
  const item = vm.reduceEvent(vm.initialState(), { type: "outbound_post", toolUseId: "t2", to: "evil@x.com", text: "done", addressed: true, postKind: "task_finished" }).items[0];
  assert.equal(item.addressed, true);
  assert.equal(item.postKind, "task_finished");
  // An ordinary post's item is untouched (no stray fields on the common path).
  const plain = vm.reduceEvent(vm.initialState(), { type: "outbound_post", toolUseId: "t1", to: "David", text: "hi" }).items[0];
  assert.deepEqual(plain, { kind: "outbound", toolUseId: "t1", to: "David", text: "hi", avatarKey: "self" });
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
  // THE BOUNDARY THAT DID NOT MOVE: the hard-deny set is immovable across a park, in every mode.
  for (const tool of ["Task", "Agent", "CronCreate", "SendMessage", "mcp__dopl__dopl_kb_admin"]) {
    assert.equal(grantDecision({ ...woken, toolName: tool, input: {} }), "deny", `${tool} after a park`);
  }
});

// ── E. THE FOUR COPIES OF THE MODE TABLES AGREE ───────────────────────────────────
// session-profiles is canonical, but the reducer defends its own state, the preload coerces
// at the bridge and session.html offers the options. A sandboxed renderer cannot require
// main, so the lists are duplicated by necessity — this is what stops them drifting.

test("the mode tables agree across main, the reducer, the preload and the HTML", () => {
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
  // The preload coerces to exactly these members, and to the FIRST one otherwise.
  for (const mode of TOOL_MODES.slice(1)) assert.ok(PRELOAD.includes(`'${mode}'`), `preload knows ${mode}`);
  for (const mode of MESSAGE_MODES.slice(1)) assert.ok(PRELOAD.includes(`'${mode}'`), `preload knows ${mode}`);
  assert.match(PRELOAD, /: 'manual';/, "unknown tool mode -> manual");
  assert.match(PRELOAD, /: 'ask';/, "unknown message mode -> ask");
  // The HTML offers exactly these values, in this order, on the two selects.
  const optionValues = (id) => {
    const sel = HTML.slice(HTML.indexOf(`id="${id}"`), HTML.indexOf("</select>", HTML.indexOf(`id="${id}"`)));
    return [...sel.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(optionValues("toolMode"), TOOL_MODES);
  assert.deepEqual(optionValues("messageMode"), MESSAGE_MODES);
  // The view-model's fail-closed copy answers the same way.
  for (const junk of ["bypassPermissions", "auto ", ""]) {
    const st = vm.reduceEvent(vm.initialState(), { type: "modes", tool: junk, message: junk });
    assert.equal(st.toolMode, "manual");
    assert.equal(st.messageMode, "ask");
  }
});

test("the two inbound-auto predicates (gate + reducer) agree on all four message modes", () => {
  // session-gate.autoInbound and the reducer's inboundAutoAccepted answer the same question
  // on two paths; if they ever disagreed, a message would be held by one and fed by the other.
  const gateSrc = GATE.slice(GATE.indexOf("function autoInbound(s)"), GATE.indexOf("function windowHasFocus"));
  const redSrc = REDUCER_SRC.slice(REDUCER_SRC.indexOf("function inboundAutoAccepted(state)"),
    REDUCER_SRC.indexOf("function feedInboundEffects"));
  const gateFn = new Function("s", gateSrc + "\n return autoInbound(s);");
  const redFn = new Function("state", redSrc + "\n return inboundAutoAccepted(state);");
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

test("IPC: the fused channel is REPLACED by two, and the inbound drain moved to AXIS B", () => {
  assert.match(IPC, /ipcMain\.handle\('session:set-tool-mode'/);
  assert.match(IPC, /ipcMain\.handle\('session:set-message-mode'/);
  assert.ok(!/set-auto-approve|set_auto_approve/.test(stripComments(IPC)), "the old channel is removed, not aliased");
  // Main re-coerces against the canonical tables (the preload is the first gate, not the only).
  // FIX 1 (2026-08-02) moved the shared resolution into `modeChange`, so the coercion is an
  // ARGUMENT to it rather than a property in the dispatch literal; it is still main's own.
  assert.match(IPC, /normalizeToolMode\(p && p\.mode\)/);
  assert.match(IPC, /normalizeMessageMode\(p && p\.mode\)/);
  // v2.5 D4's drain lives on the MESSAGE handler only — the tool handler touches no messages.
  const code = stripComments(IPC);
  const toolHandler = code.slice(code.indexOf("'session:set-tool-mode'"), code.indexOf("'session:set-message-mode'"));
  assert.ok(!/drainInbound/.test(toolHandler), "AXIS A must not touch the inbound queue");
  const msgHandler = code.slice(code.indexOf("'session:set-message-mode'"), code.indexOf("'session:consent-decision'"));
  assert.match(msgHandler, /gate\.drainInbound\(s\)/, "AXIS B keeps it");
  // Both are bound from event.sender like every other handler (no sessionId in the payload).
  assert.ok(!/p && p\.sessionId/.test(IPC));
});

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

test("UI: two labeled selects, token classes only, no copy in CSS `content`", () => {
  assert.match(HTML, /<span class="mode-select__lbl text-label">Tools<\/span>/);
  assert.match(HTML, /<span class="mode-select__lbl text-label">Messages<\/span>/);
  const OPTIONS = ["Manual", "Accept edits", "Auto", "Bypass",
    "Ask every time", "Auto accept incoming", "Auto send outgoing", "Both automatic"];
  for (const label of OPTIONS) {
    assert.ok(HTML.includes(">" + label + "<"), `the option "${label}" is static markup`);
    assert.ok(!label.includes("—"), "no em dash in the option labels");
  }
  const CSS = readFileSync(R("session.css"), "utf8");
  const block = CSS.slice(CSS.indexOf(".mode-select {"), CSS.indexOf(".folder-pill {"));
  assert.ok(!/content:/.test(block), "no copy is smuggled in through CSS content");
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(block), "token colours only, no raw hex");
  // Bypass gets the danger token, on the control itself.
  assert.match(CSS, /\.mode-select__input\.is-bypass \{[\s\S]*?color: var\(--danger\)/);
  assert.match(CSS, /\.perm-warn \{ color: var\(--danger\)/);
});

test("UI: the controller paints both axes from MAIN's echo, never from the click", () => {
  const JS = readFileSync(R("session.js"), "utf8");
  const MODES_UI = readFileSync(R("session-modes-ui.js"), "utf8");
  // 2026-08-02: the unconditional `.value` repaint moved from renderStatus into the same module
  // that owns the change listeners (session.js hit the §2 cap when the model picker landed). The
  // RULE is unchanged and is what this pins: the only writer of `.value` reads the view-model,
  // which moves only on main's echo. Driven end to end in test/session-modes-dom.test.mjs.
  assert.match(MODES_UI, /e\.toolMode\.value = s\.toolMode;/);
  assert.match(MODES_UI, /e\.messageMode\.value = s\.messageMode;/);
  assert.match(JS, /modesUi\.sync\(els, state\)/, "and renderStatus is what calls it, every render");
  assert.ok(!/\.value = /.test(JS.slice(JS.indexOf("function renderStatus("), JS.indexOf("function renderFolder("))),
    "renderStatus itself writes no control value");
  assert.match(JS, /vm\.permissionPostureText\(state\.toolMode, state\.messageMode,/);
  // FIX 2 (2026-08-02): the two `change` listeners live in session-modes-ui.js, because the
  // control has to revert itself when main refuses. The bridge calls still carry the select's
  // own value, and still nothing paints from the click.
  assert.match(JS, /modesUi\.mount\(\{ els, bridge,/, "the controller hands the module the real bridge");
  assert.match(MODES_UI, /send: bridge\.setToolMode/);
  assert.match(MODES_UI, /send: bridge\.setMessageMode/);
  assert.match(MODES_UI, /entry\.send\.call\(bridge, entry\.node\.value\)/, "the select's OWN value crosses");
  assert.ok(!/setAutoApprove|autoApprove/.test(JS + MODES_UI), "no trace of the fused switch");
  // textContent only, everywhere (the §A.4 rule this window is built on).
  assert.ok(!/\.innerHTML|insertAdjacentHTML|outerHTML/.test(JS + MODES_UI));
});

// ── H. C8 (MEDIUM-6): the counterparty name is bounded at BOTH decision surfaces ───

test("C8: reduceEvent caps the counterparty name at 60 on both decision surfaces", () => {
  const long = "D".repeat(400);
  const multi = "David\n\n<script>\tOps";
  for (const [type, key] of [["counterparty", "from"], ["inbound_pending", "from"]]) {
    const s = vm.reduceEvent(vm.initialState(), { type, pendingId: "p1", from: long, text: "hi" });
    const item = s.items[0];
    assert.ok(item[key].length <= 60, `${type}: capped (${item[key].length})`);
    // ...and one-lined, so a multi-line name cannot push the body and the buttons off screen.
    const wrapped = vm.reduceEvent(vm.initialState(), { type, pendingId: "p1", from: multi, text: "hi" });
    assert.ok(!/[\n\r\t]/.test(wrapped.items[0][key]), `${type}: single line`);
  }
});
