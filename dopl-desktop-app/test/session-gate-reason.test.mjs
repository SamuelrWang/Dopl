// "BYPASS STILL ASKS" — the 2026-08-02 transparency + coverage round.
//
// Three defects, all of them the same shape: the gate was RIGHT and could not say so.
//   FIX 1  Every gate/deny verdict now carries a machine-readable REASON CODE, threaded onto the
//          permission payload and rendered as one short line on the card. An uncovered tool under
//          `bypass` used to read as a broken toggle; a slug-addressed post as a random refusal.
//   FIX 2  BashOutput / KillShell were HARD-DENIED under `full` (they sit in DENIED_BUILTINS with
//          Bash and hard-deny is checked first), so background Bash was unusable. They are the
//          READ HALF of an already-gated Bash and now follow it exactly on the tool axis.
//   FIX 3  A gate verdict logged NOTHING, so "the mode never landed" and "the mode landed but does
//          not cover this tool" were indistinguishable in the field. One diag line per verdict,
//          carrying codes and postures only — never a body, a prompt, or a full id.
//
// Layers: a direct require for the (electron-free) main modules, the render module under the same
// tiny DOM stub session-render-dom.test.mjs uses, and a source pin for the diag line's payload.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const profiles = require(M("session-profiles.js"));
const io = require(M("session-io.js"));
const { GATE_REASONS } = require(M("session-gate-reason.js"));
const { DOPL_CHANNEL_TOOL, DENIED_BUILTINS } = require(M("tool-profiles.js"));

const CH = "ch1";
const detail = (over) => profiles.grantDecisionDetail({ profile: "full", channelId: CH, ...over });
const SHELL_READS = ["BashOutput", "KillShell"];

// ── FIX 1: a REASON for every branch ──────────────────────────────────────────────

test("FIX 1: every gate/deny branch names WHY, with a code from the closed set", () => {
  const cases = [
    // [label, args, expected decision, expected reason]
    // F-177 (2026-08-08): this case used to drive `Task`, which `full` no longer hard-denies.
    // The BRANCH is unchanged; only the set it covers shrank to the universal floor.
    ["hard-deny is immovable and says so",
      { toolName: "mcp__dopl__dopl_kb_admin", input: {}, toolMode: "bypass" }, "deny", "hard-denied"],
    ["F-177: a RELEASED built-in gates instead, and says it is in no mode list",
      { toolName: "Task", input: {}, toolMode: "bypass" }, "gate", "unclassified-tool"],
    ["a CLASSIFIED tool the posture does not cover (the `auto` miss)",
      { toolName: "Bash", input: { command: "ls" }, toolMode: "auto" }, "gate", "not-covered-by-bypass"],
    ["a name in NO list gates in every mode, which is a different fact",
      { toolName: "SomeFutureTool", input: {}, toolMode: "bypass" }, "gate", "unclassified-tool"],
    ["manual is the posture asking, not a coverage hole",
      { toolName: "Bash", input: { command: "ls" }, toolMode: "manual" }, "gate", "awaiting-approval"],
    ["a SLUG-addressed post is classified cross-channel (the safe failure)",
      { toolName: DOPL_CHANNEL_TOOL, input: { op: "post", channel: "my-slug", body: "hi" } }, "gate", "cross-channel-post"],
    ["and so is a genuinely other-channel post",
      { toolName: DOPL_CHANNEL_TOOL, input: { op: "post", channel: "other-id", body: "hi" } }, "gate", "cross-channel-post"],
    ["a malformed `to` refuses to auto-allow (FIX F9) and says which field",
      { toolName: DOPL_CHANNEL_TOOL, input: { op: "post", to: { a: 1 }, body: "hi" } }, "gate", "malformed-post-fields"],
    ["a malformed `kind` the same way",
      { toolName: DOPL_CHANNEL_TOOL, input: { op: "post", kind: ["x"], body: "hi" } }, "gate", "malformed-post-fields"],
    ["an own-channel post held by AXIS B at `ask`",
      { toolName: DOPL_CHANNEL_TOOL, input: { op: "post", body: "hi" }, messageMode: "ask" }, "gate", "message-approval-required"],
    ["a NON-post, NON-read channel op is never auto-run, even at auto_both",
      { toolName: DOPL_CHANNEL_TOOL, input: { op: "open", direct: true }, messageMode: "auto_both" }, "gate", "channel-op-approval-required"],
    // M3 (2026-08-05): a READ has its own two facts, and they are not the post's two facts.
    ["an own-channel read held by AXIS B at `ask` says which half of the axis is asking",
      { toolName: DOPL_CHANNEL_TOOL, input: { op: "read" }, messageMode: "ask" }, "gate", "read-approval-required"],
    ["a slug-addressed read is classified cross-channel, and says READ, not POST",
      { toolName: DOPL_CHANNEL_TOOL, input: { op: "get_thread", channel: "my-slug" }, messageMode: "auto_both" }, "gate", "cross-channel-read"],
  ];
  for (const [label, args, decision, reason] of cases) {
    const d = detail(args);
    assert.equal(d.decision, decision, label);
    assert.equal(d.reason, reason, label);
  }
});

test("FIX 1: an ALLOW is explained too, so the diag can tell WHICH rule let it through", () => {
  assert.deepEqual(detail({ toolName: "Read", input: { file_path: "/a" } }),
    { decision: "preapproved", reason: "profile-preapproved" });
  assert.deepEqual(detail({ toolName: "Bash", input: { command: "ls" }, toolMode: "bypass" }),
    { decision: "allow", reason: "tool-mode" });
  const key = profiles.grantKeyFor("Bash", { command: "ls" }, CH);
  assert.deepEqual(detail({ toolName: "Bash", input: { command: "ls" }, allowForTask: [key] }),
    { decision: "allow", reason: "granted-for-session" });
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "post", body: "hi" }, messageMode: "auto_outbound" }),
    { decision: "allow", reason: "auto-outbound" });
  // M3: the two Axis-B allows are DIFFERENT rules, so the diag can tell "your outbound setting
  // sent this" from "your inbound setting read this" without a source read.
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "read" }, messageMode: "auto_inbound" }),
    { decision: "allow", reason: "auto-inbound-read" });
});

test("FIX 1: the reason NEVER moves the verdict — grantDecision is byte-identical", () => {
  const shapes = [
    { toolName: "Bash", input: { command: "rm -rf /" } },
    { toolName: "Task", input: {} },
    { toolName: "Read", input: { file_path: "/a" } },
    { toolName: DOPL_CHANNEL_TOOL, input: { op: "post", body: "hi" } },
    { toolName: DOPL_CHANNEL_TOOL, input: { op: "post", channel: "x", to: 7 } },
    { toolName: "", input: {} },
    { toolName: null, input: undefined },
  ];
  for (const profile of ["read_only", "dopl_only", "full"]) {
    for (const toolMode of profiles.TOOL_MODES) {
      for (const messageMode of profiles.MESSAGE_MODES) {
        for (const shape of shapes) {
          const args = { profile, channelId: CH, toolMode, messageMode, ...shape };
          assert.equal(profiles.grantDecisionDetail(args).decision, profiles.grantDecision(args),
            `${profile}/${toolMode}/${messageMode}/${String(shape.toolName)}`);
        }
      }
    }
  }
});

test("FIX 1: the code set is CLOSED — nothing produces a reason the renderer has never seen", () => {
  const seen = new Set();
  for (const profile of ["read_only", "dopl_only", "full"]) {
    for (const toolMode of profiles.TOOL_MODES) {
      for (const messageMode of profiles.MESSAGE_MODES) {
        for (const toolName of ["Bash", "BashOutput", "Read", "Task", "Nope", DOPL_CHANNEL_TOOL,
          "mcp__dopl__dopl_kb", "NotebookRead", "WebFetch"]) {
          for (const input of [{}, { command: "ls" }, { op: "post", body: "b" },
            { op: "post", channel: "z" }, { op: "read" }, { op: "read", channel: "z" },
            { op: "open" }, { to: 1 }]) {
            const r = profiles.grantDecisionDetail({ profile, channelId: CH, toolMode, messageMode, toolName, input }).reason;
            if (r) seen.add(r);
          }
        }
      }
    }
  }
  assert.ok(seen.size >= 8, `expected the real branches to be exercised, saw ${seen.size}`);
  for (const r of seen) assert.ok(GATE_REASONS.includes(r), `${r} is not in GATE_REASONS`);
});

// ── FIX 2: BashOutput / KillShell are the read half of a gated Bash ───────────────

test("FIX 2: under `full`, BashOutput / KillShell answer EXACTLY as Bash does per tool mode", () => {
  const cfg = profiles.buildSessionToolConfig("full");
  for (const tool of SHELL_READS) {
    assert.ok(!cfg.disallowedTools.includes(tool), `${tool} must no longer be hard-denied under full`);
    assert.ok(!cfg.preApproved.includes(tool), `${tool} must not be shadowed either, or no button shows`);
    for (const toolMode of profiles.TOOL_MODES) {
      const bash = profiles.grantDecision({ profile: "full", channelId: CH, toolName: "Bash", input: { command: "ls" }, toolMode });
      const read = profiles.grantDecision({ profile: "full", channelId: CH, toolName: tool, input: { bash_id: "b1" }, toolMode });
      assert.equal(read, bash, `${tool} @ ${toolMode} must follow Bash`);
    }
  }
  // The shape of that agreement, stated: gate everywhere but bypass (they reach the shell).
  for (const tool of SHELL_READS) {
    assert.equal(profiles.toolModeAllows("auto", tool), false, `${tool} is escalation-shaped (A3)`);
    assert.equal(profiles.toolModeAllows("bypass", tool), true, tool);
  }
});

test("FIX 2: NO other profile widens — read_only and dopl_only still hard-deny both", () => {
  for (const profile of ["read_only", "dopl_only"]) {
    const cfg = profiles.buildSessionToolConfig(profile);
    for (const tool of SHELL_READS) {
      assert.ok(cfg.disallowedTools.includes(tool), `${profile} must still deny ${tool}`);
      assert.ok(!cfg.builtinTools.includes(tool), `${profile} must not even OFFER ${tool}`);
      for (const toolMode of profiles.TOOL_MODES) {
        assert.deepEqual(profiles.grantDecisionDetail({ profile, channelId: CH, toolName: tool, input: {}, toolMode }),
          { decision: "deny", reason: "hard-denied" }, `${profile}/${tool}@${toolMode}`);
      }
    }
    // read_only offers no Bash at all, so it gains no shell surface from this change.
    assert.ok(cfg.disallowedTools.includes("Bash"), `${profile} must still deny Bash`);
  }
  // The headless containment table is untouched: both names stay in the shared blacklist.
  for (const tool of SHELL_READS) assert.ok(DENIED_BUILTINS.includes(tool), `${tool} stays in DENIED_BUILTINS`);
});

// THE v2.9 INVARIANT, extended to the two new names in BOTH directions.
test("INVARIANT: no tool mode answers a channel op, and no message mode answers BashOutput/KillShell", () => {
  for (const toolMode of profiles.TOOL_MODES) {
    for (const input of [{ op: "post", body: "hi" }, { op: "open", direct: true }, { op: "read" }]) {
      assert.equal(profiles.grantDecision({ profile: "full", channelId: CH, toolName: DOPL_CHANNEL_TOOL, input, toolMode }),
        "gate", `toolMode=${toolMode} must not decide ${input.op}`);
    }
  }
  for (const messageMode of profiles.MESSAGE_MODES) {
    for (const tool of SHELL_READS) {
      assert.deepEqual(profiles.grantDecisionDetail({ profile: "full", channelId: CH, toolName: tool, input: { bash_id: "b1" }, messageMode }),
        { decision: "gate", reason: "awaiting-approval" }, `messageMode=${messageMode} must not decide ${tool}`);
    }
  }
});

// ── the NAMED read-only additions to `bypass` (the judgment call) ─────────────────

test("bypass covers the named read-only tools, and NOTHING interactive or plan-shaped", () => {
  for (const tool of profiles.BYPASS_READS) {
    assert.equal(profiles.toolModeAllows("bypass", tool), true, tool);
    assert.equal(profiles.toolModeAllows("auto", tool), false, `${tool} is a bypass-only widening`);
    assert.ok(!profiles.buildSessionToolConfig("full").disallowedTools.includes(tool), `${tool} must be reachable`);
  }
  // The ones deliberately LEFT gating: each changes what the session IS, not what it reads.
  for (const tool of ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode", "RefreshMcpTools"]) {
    for (const toolMode of profiles.TOOL_MODES) {
      assert.deepEqual(profiles.grantDecisionDetail({ profile: "full", channelId: CH, toolName: tool, input: {}, toolMode }),
        { decision: "gate", reason: "unclassified-tool" }, `${tool} @ ${toolMode}`);
    }
  }
});

// ── FIX 1 (the wire): the reason rides the permission payload ─────────────────────

function gateOnce(sessionOver, toolName, input) {
  const s = {
    profile: "full", channelId: CH, sessionId: "sess-1234-abcd-ef00", counterpartyName: "David",
    state: { allowForTask: [], toolMode: "manual", messageMode: "ask" },
    pendingPermissions: new Map(), pendingNames: new Map(), ...sessionOver,
  };
  const evs = [];
  const logged = [];
  io.makeCanUseTool(s, (_s, ev) => evs.push(ev), (...parts) => logged.push(parts.join(" ")))(
    toolName, input, { requestId: "r1", toolUseID: "t1" });
  for (const id of [...s.pendingPermissions.keys()]) s.pendingPermissions.get(id)({ behavior: "deny" });
  return { payload: evs[0] && evs[0].payload, logged };
}

test("FIX 1: BOTH gate surfaces carry the code — the dock card and the inline post card", () => {
  const dock = gateOnce({}, "Bash", { command: "ls" });
  assert.equal(dock.payload.type, "permission_request");
  assert.equal(dock.payload.gateReason, "awaiting-approval");
  const bypassMiss = gateOnce({ state: { allowForTask: [], toolMode: "auto", messageMode: "ask" } },
    "Bash", { command: "ls" });
  assert.equal(bypassMiss.payload.gateReason, "not-covered-by-bypass",
    "the one the operator reads as a broken toggle");
  const cross = gateOnce({}, DOPL_CHANNEL_TOOL, { op: "post", channel: "my-slug", body: "hi" });
  assert.equal(cross.payload.type, "permission_request", "a cross-channel post keeps the dock payload");
  assert.equal(cross.payload.gateReason, "cross-channel-post");
  const own = gateOnce({}, DOPL_CHANNEL_TOOL, { op: "post", body: "hi" });
  assert.equal(own.payload.type, "outbound_gate", "an own-channel post decides on its own card");
  assert.equal(own.payload.gateReason, "message-approval-required");
});

// ── FIX 3: the diag line ──────────────────────────────────────────────────────────

test("FIX 3: ONE line per verdict, carrying the name, the verdict, the reason and both postures", () => {
  const { logged } = gateOnce({ state: { allowForTask: [], toolMode: "auto", messageMode: "auto_both" } },
    "Bash", { command: "ls -la /etc/shadow" });
  assert.equal(logged.length, 1, "exactly one line per verdict");
  const line = logged[0];
  assert.match(line, /^session gate: Bash gate not-covered-by-bypass tool=auto msg=auto_both session=sess-123$/);
});

test("FIX 3: the line carries NO body, NO prompt text, NO tool input and NO full id", () => {
  const SECRET = "ssh-rsa AAAAB3NzaC1yc2E-not-for-the-log";
  const runs = [
    gateOnce({}, "Bash", { command: SECRET }),
    gateOnce({}, DOPL_CHANNEL_TOOL, { op: "post", body: SECRET }),
    gateOnce({}, DOPL_CHANNEL_TOOL, { op: "post", channel: SECRET, body: SECRET }),
    gateOnce({}, "mcp__dopl__dopl_kb", { op: "write_file", content: SECRET }),
  ];
  for (const { logged } of runs) {
    assert.equal(logged.length, 1);
    assert.ok(!logged[0].includes(SECRET), `the line leaked the input: ${logged[0]}`);
    assert.ok(!logged[0].includes("sess-1234-abcd-ef00"), "and it must never carry a full id");
    assert.ok(logged[0].includes("session=sess-123"), "an 8-char prefix is what joins the logs");
    assert.ok(logged[0].length < 160, "one SHORT line");
  }
  // The MCP server prefix is stripped so the name reads as the operator sees it.
  assert.match(runs[3].logged[0], /^session gate: dopl_kb /);
  // ...and a hostile tool name cannot blow the line open.
  const long = gateOnce({}, "X".repeat(4000), {});
  assert.ok(long.logged[0].length < 160, "a 4000-char tool name is capped");
});

// ── M3 (2026-08-05): the line NAMES THE CHANNEL OP ────────────────────────────────
// The line carried the tool and the reason but not the operation, so `dopl_channel gate
// channel-op-approval-required` read identically for a read, an invite and a DM open — which is
// why diagnosing the read/post incoherence took code archaeology instead of ten seconds of log.

test("M3: a channel verdict names the op; nothing else on the line moves", () => {
  const modes = { allowForTask: [], toolMode: "bypass", messageMode: "auto_both" };
  const read = gateOnce({ state: modes }, DOPL_CHANNEL_TOOL, { op: "read" });
  assert.match(read.logged[0], /^session gate: dopl_channel op=read allow auto-inbound-read tool=bypass msg=auto_both session=sess-123$/);
  const open = gateOnce({ state: modes }, DOPL_CHANNEL_TOOL, { op: "open", direct: true, member: "evil@x" });
  assert.match(open.logged[0], /^session gate: dopl_channel op=open gate channel-op-approval-required tool=bypass msg=auto_both session=sess-123$/);
  // THE PRODUCTION LINE FROM THE DIAG LOG, now diagnosable: it says WHICH op stopped.
  assert.ok(open.logged[0].includes("op=open"), "the field that turns archaeology into reading");
});

// ── F-139: the diagnostic hole and the defect had ONE root ────────────────────────
// The line only prints `op=` for a tool that CLASSIFIES as the channel tool, so on the broken
// machine the op was absent from every line — the bug hid its own diagnosis. These pin that
// fixing the matcher resolves the diag by itself, and that the name is stripped for a server
// segment carrying underscores (the old label regex was `[a-z0-9-]+?`, so it stripped nothing
// and the field printed the whole dotted name).

test("F-139: a connector-named channel tool logs the SAME line as our own registration", () => {
  const modes = { allowForTask: [], toolMode: "bypass", messageMode: "auto_both" };
  const SERVERS = ["mcp__dopl__", "mcp__claude_ai_Dopl__", "mcp__6a12c8bd-4187-40eb-9b21-eb230264f726__"];
  for (const server of SERVERS) {
    const read = gateOnce({ state: modes }, server + "dopl_channel", { op: "read" });
    // THE WORKING MACHINE'S LINE, now produced under every server name.
    assert.match(read.logged[0],
      /^session gate: dopl_channel op=read allow auto-inbound-read tool=bypass msg=auto_both session=sess-123$/,
      server);
    // ...and the BROKEN machine's line — `gate unclassified-tool`, with no `op=` at all — is gone.
    assert.ok(!read.logged[0].includes("unclassified-tool"), server);
    assert.ok(read.logged[0].includes("op=read"), `${server} must name the op`);
    const open = gateOnce({ state: modes }, server + "dopl_channel", { op: "open", direct: true });
    assert.match(open.logged[0], /^session gate: dopl_channel op=open gate channel-op-approval-required /, server);
  }
});

test("F-139: a Dopl tool's name is stripped for a server segment with underscores", () => {
  const modes = { allowForTask: [], toolMode: "bypass", messageMode: "ask" };
  const { logged } = gateOnce({ state: modes }, "mcp__claude_ai_Dopl__dopl_kb", { op: "write_file" });
  assert.match(logged[0], /^session gate: dopl_kb allow tool-mode /,
    "the label prints the tool, not the client's server name");
});

test("M4: the diag distinguishes a marker allow from a message allow", () => {
  const modes = { allowForTask: [], toolMode: "bypass", messageMode: "auto_both" };
  const milestone = gateOnce({ state: modes }, DOPL_CHANNEL_TOOL, { op: "milestone", thread: "T1", body: "step" });
  assert.match(milestone.logged[0], /^session gate: dopl_channel op=milestone allow auto-outbound-marker /);
  // A post keeps its OWN code: "did my agent send a message?" is a different audit question.
  const post = gateOnce({ state: modes }, DOPL_CHANNEL_TOOL, { op: "post", body: "hi" });
  assert.match(post.logged[0], /^session gate: dopl_channel op=post allow auto-outbound /);
  // ⚠ `propose_close` was the marker set's other member and `close_thread` was pinned here as
  // the op that STILL gated in the very posture that auto-allowed its proposal. Both left the
  // tool's enum with thread closing (wiring plan Phase 4, 2026-08-18). An unclassified op
  // resolves to `gate`, which is the safe direction, so this is the pin that they do:
  for (const op of ["propose_close", "close_thread"]) {
    const gated = gateOnce({ state: modes }, DOPL_CHANNEL_TOOL, { op, thread: "T1" });
    assert.match(gated.logged[0], new RegExp(`^session gate: dopl_channel op=${op} gate `),
      `${op} must never resolve to an allow`);
  }
});

test("M4: an own-channel marker that GATES says message approval, not 'this operation'", () => {
  // The old code claimed "message approval covers this channel's messages, not this operation",
  // which stopped being true for a marker the moment the axis started covering it.
  const ask = gateOnce({ state: { allowForTask: [], toolMode: "bypass", messageMode: "ask" } },
    DOPL_CHANNEL_TOOL, { op: "milestone", thread: "T1", body: "one line" });
  assert.match(ask.logged[0], /op=milestone gate message-approval-required /);
  // A marker aimed elsewhere (a SLUG is the common case) gets the code that names the fix.
  const away = gateOnce({ state: { allowForTask: [], toolMode: "bypass", messageMode: "auto_both" } },
    DOPL_CHANNEL_TOOL, { op: "milestone", channel: "team-alpha", thread: "T1", body: "x" });
  assert.match(away.logged[0], /op=milestone gate cross-channel-post /);
});

test("M3: a NON-channel tool's line is byte-unchanged (no `op=` segment at all)", () => {
  const { logged } = gateOnce({ state: { allowForTask: [], toolMode: "auto", messageMode: "auto_both" } },
    "Bash", { command: "ls" });
  assert.match(logged[0], /^session gate: Bash gate not-covered-by-bypass tool=auto msg=auto_both session=sess-123$/);
  assert.ok(!logged[0].includes("op="), "a work tool has no channel op to name");
});

test("M3: the op is a NAME, never a value — hostile input cannot open the line", () => {
  const SECRET = "ssh-rsa AAAAB3-not-for-the-log";
  const runs = [
    [{ op: "post ssh-rsa AAAAB3-not-for-the-log", body: SECRET }, "op=postssh-rsaAAAAB3-not-f"],
    [{ op: "r".repeat(4000) }, "op=" + "r".repeat(24)],
    [{ op: { evil: SECRET } }, "op=invalid"],
    [{ op: ["read"] }, "op=invalid"],
    [{ body: SECRET }, "op=none"],
  ];
  for (const [input, expected] of runs) {
    const { logged } = gateOnce({}, DOPL_CHANNEL_TOOL, input);
    assert.equal(logged.length, 1);
    assert.ok(logged[0].includes(expected), `${JSON.stringify(input)} -> ${logged[0]}`);
    assert.ok(!logged[0].includes("ssh-rsa AAAAB3"), `the line leaked input: ${logged[0]}`);
    assert.ok(logged[0].length < 160, "one SHORT line, whatever the model sent");
  }
});

test("FIX 3: an ALLOW and a DENY are logged too, or the log answers only half the question", () => {
  const allowed = gateOnce({ state: { allowForTask: [], toolMode: "bypass", messageMode: "ask" } },
    "BashOutput", { bash_id: "b1" });
  assert.match(allowed.logged[0], /^session gate: BashOutput allow tool-mode tool=bypass msg=ask /);
  // F-177: driven on a UNIVERSAL-FLOOR tool now — `Task` gates under `full` rather than denying,
  // and the line this test is about is the one a HARD-DENY writes.
  const denied = gateOnce({ state: { allowForTask: [], toolMode: "bypass", messageMode: "ask" } },
    "mcp__dopl__dopl_kb_admin", { op: "delete_base" });
  assert.match(denied.logged[0], /^session gate: dopl_kb_admin deny hard-denied tool=bypass msg=ask /);
});

test("FIX 3: no log function, no throw — the diag is a diagnostic, never a dependency", () => {
  const s = {
    profile: "full", channelId: CH, sessionId: "s1",
    state: { allowForTask: [], toolMode: "manual", messageMode: "ask" },
    pendingPermissions: new Map(), pendingNames: new Map(),
  };
  const evs = [];
  io.makeCanUseTool(s, (_s, ev) => evs.push(ev))("Bash", { command: "ls" }, { requestId: "r1" });
  assert.equal(evs[0].payload.gateReason, "awaiting-approval");
  for (const id of [...s.pendingPermissions.keys()]) s.pendingPermissions.get(id)({ behavior: "deny" });
});

test("FIX 3 (source pin): the diag call passes CODES and postures, never an input or a body", () => {
  const src = readFileSync(M("session-io.js"), "utf8");
  // BRACE-MATCHED, NOT BOUNDED BY THE NEXT COMMENT (2026-08-06). This used to slice from
  // `function logGateVerdict(` up to the `BEGIN SESSION-IO-POST-SURFACE` sentinel that
  // happened to follow it. That block moved to session-post-surface.js in the §2 split, so
  // the end bound became `indexOf(...) === -1` and the slice silently ran to the END OF THE
  // FILE — every assertion below would then be scanning the whole module. The `< 900` guard
  // caught it, but only by luck of ordering; a slice whose end bound is a DIFFERENT feature's
  // sentinel is one refactor away from being wrong again.
  const fn = fnOf(src, "logGateVerdict");
  assert.ok(fn.length > 0 && fn.length < 900, "the diag builder stays small enough to read");
  for (const f of ["input", "body", "command", "inputFull", "inputSummary"]) {
    assert.ok(!new RegExp("\\b" + f + "\\b").test(fn), `the diag line must not reach for \`${f}\``);
  }
  assert.match(fn, /slice\(0, 8\)/, "ids are narrowed to an 8-char prefix");
});
