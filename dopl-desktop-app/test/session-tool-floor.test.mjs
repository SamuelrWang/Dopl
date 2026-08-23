// AXIS A's WINDOWLESS FLOOR — the tool half (2026-08-22, Samuel's ruling 4).
//
// ── THE BUG THIS FILE EXISTS FOR ─────────────────────────────────────────────────────
// A WINDOWLESS session has NO GATE SURFACE. `session-windowless.js › claimGate` answers a
// `permission_request` with `setImmediate(() => decide(rid, 'deny'))` — so on that shape a GATE
// IS A DENY, silently. Axis A starts at `manual` and is RESET to `manual` on park, and
// `toolModeAllows('manual', …)` is false for every name, so a windowless session under the
// default posture had EVERY work tool refused — including the read tools `prompt-framing.js`
// ORDERS the agent to use. The operator saw an agent that quietly failed at everything.
//
// ── WHAT THE FIX IS ──────────────────────────────────────────────────────────────────
// `session-profiles.js › floorWindowlessTool` is the ONE statement of the floor, and it is
// WIDEN-ONLY, exactly mirroring `floorWindowlessMessage`'s shape:
//     manual / accept_edits / auto  -> auto        (AUTO_TOOLS reachable with no gate)
//     bypass                        -> bypass      (never narrowed)
//
// ⚠ IT IS APPLIED TO THE READ, NOT TO STATE. Axis B's floor writes STATE at two lanes
// (`channel-prefs.js › windowlessMessageMode` at launch, `session-reopen.js › setModeByTask`
// live); this one is applied once in `session-io.js › grantArgs`, the single read of both axes
// at decision time, which is the one point covering every spawn shape. The reducer's stored
// `toolMode` is deliberately NOT rewritten, so the agent view's Tools select keeps reporting
// what the operator actually set — see the docblock at `grantArgs`, and the pin below.
//
// ⚠ AND IT WIDENS SUPERVISION, NEVER CONTAINMENT. The hard-deny set, the profile's
// `disallowedTools` and the Axis-A/Axis-B invariant are all checked before Axis A and are
// unreachable from here. Pinned in section 3.
//
// The twin file is `session-mode-floor.test.mjs` (Axis B). Neither floor may be re-spelled at a
// call site — two spellings of one floor is how the lanes start disagreeing.
//
// Run: `node --test dopl-desktop-app/test/session-tool-floor.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => join(HERE, "..", "main", p);
const read = (p) => readFileSync(M(p), "utf8");

const profiles = require(M("session-profiles.js"));
const io = require(M("session-io.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));
const {
  floorWindowlessTool, TOOL_MODES, AUTO_TOOLS, BYPASS_TOOLS, toolModeAllows, grantDecision,
} = profiles;

// ── 1. THE RULE ──────────────────────────────────────────────────────────────────────

test("the floor raises everything below `auto` to `auto`, and never narrows `bypass`", () => {
  assert.equal(floorWindowlessTool("manual"), "auto");
  assert.equal(floorWindowlessTool("accept_edits"), "auto");
  assert.equal(floorWindowlessTool("auto"), "auto");
  assert.equal(floorWindowlessTool("bypass"), "bypass");
});

test("EVERY tool mode floors to one that reaches AUTO_TOOLS — the property, not the table", () => {
  // ⚠ THE ASSERTION THAT ACTUALLY MATTERS, stated over the axis rather than four literals: the
  // read tools the framing orders the agent to use must be reachable WITHOUT A GATE whatever the
  // operator picked, because on this shape a gate is a deny. A fifth tool mode added to the axis
  // fails here rather than silently reintroducing the silent-denial bug.
  for (const mode of TOOL_MODES) {
    const floored = floorWindowlessTool(mode);
    for (const tool of AUTO_TOOLS) {
      assert.equal(toolModeAllows(floored, tool), true, `${mode} -> ${floored} must reach ${tool}`);
    }
  }
});

test("the floor is fail-closed on junk, like every other mode read", () => {
  // `normalizeToolMode` resolves an unknown value to `manual`, which then floors — so junk lands
  // on the most restrictive mode that is still USABLE on a surface-less session.
  for (const junk of [undefined, null, "", "nonsense", 7, {}, [], "Bypass", "AUTO"]) {
    assert.equal(floorWindowlessTool(junk), "auto", JSON.stringify(junk));
  }
});

test("WIDEN-ONLY: flooring never removes a tool the raw mode already allowed", () => {
  // The direction that makes this safe to apply at the read: whatever the operator's mode could
  // run, the floored mode can still run. Nothing is taken away by having no window.
  const universe = [...new Set(BYPASS_TOOLS.concat(["Task", "AskUserQuestion", "UnknownFuture"]))];
  for (const mode of TOOL_MODES) {
    const floored = floorWindowlessTool(mode);
    for (const tool of universe) {
      if (toolModeAllows(mode, tool)) {
        assert.equal(toolModeAllows(floored, tool), true, `${mode} -> ${floored} lost ${tool}`);
      }
    }
  }
});

test("`bypass` is passed through IDENTICALLY — the floor is not a ceiling", () => {
  // Flooring bypass down to auto would silently remove Bash/WebFetch/the dopl WRITE tools from an
  // operator who deliberately chose the widest posture.
  for (const tool of BYPASS_TOOLS) {
    assert.equal(toolModeAllows(floorWindowlessTool("bypass"), tool), true, tool);
  }
});

// ── 2. THE LIVE LANE APPLIES IT (session-io.js › grantArgs) ──────────────────────────

/** A session as the engine holds it. `windowless` is what `attachSurface` stamps. */
function session({ windowless = true, toolMode = "manual", messageMode = "ask" } = {}) {
  return {
    profile: "full",
    channelId: "chan-1",
    taskId: "task-1",
    windowless,
    state: { toolMode, messageMode, allowForTask: [] },
  };
}

test("LIVE: a windowless session's grant args carry the FLOORED tool mode", () => {
  // ⚠ THE REGRESSION CASE. Before the floor this handed grantDecision `manual`, and every work
  // tool came back `gate` — which claimGate turns straight into a deny with nobody to ask.
  for (const toolMode of ["manual", "accept_edits", "auto"]) {
    assert.equal(io.grantArgs(session({ toolMode }), "Read", {}).toolMode, "auto", toolMode);
  }
  assert.equal(io.grantArgs(session({ toolMode: "bypass" }), "Read", {}).toolMode, "bypass");
});

test("LIVE: the read tools the framing ORDERS the agent to use now RESOLVE, they do not gate", () => {
  // The whole point, measured through the real decision rather than the mode string.
  const s = session({ toolMode: "manual" });
  for (const tool of ["Read", "Grep", "Glob", "Edit", "Write", "MultiEdit",
    "mcp__dopl__dopl_search", "mcp__dopl__dopl_map"]) {
    const d = grantDecision(io.grantArgs(s, tool, {}));
    assert.notEqual(d, "gate", `${tool} must not gate — on this shape a gate is a silent deny`);
    assert.ok(d === "allow" || d === "preapproved", `${tool} -> ${d}`);
  }
});

test("LIVE: a session that is NOT windowless is left alone", () => {
  // The floor is a fact about having no GATE SURFACE, not about the axis. Writing it as
  // unconditional would hard-code the current shape into a rule about a CAPABILITY.
  for (const toolMode of TOOL_MODES) {
    assert.equal(io.grantArgs(session({ windowless: false, toolMode }), "Read", {}).toolMode,
      toolMode, toolMode);
  }
  assert.equal(grantDecision(io.grantArgs(session({ windowless: false, toolMode: "manual" }), "Bash", {})),
    "gate", "a windowed session still asks — it has a surface to ask on");
});

test("LIVE: `windowless` is read STRICTLY — a truthy near-miss does not float the floor", () => {
  for (const flag of [undefined, null, false, 0, "", "true", 1, {}]) {
    const s = session({ toolMode: "manual" });
    s.windowless = flag;
    const expected = flag === true ? "auto" : "manual";
    assert.equal(io.grantArgs(s, "Read", {}).toolMode, expected, JSON.stringify(flag));
  }
});

test("LIVE: the STORED toolMode is NOT rewritten — the Tools select keeps the operator's truth", () => {
  // ⚠ THE DELIBERATE DIFFERENCE FROM THE MESSAGE FLOOR, which DOES write state. That one clamps a
  // value the operator PICKED; this one widens one they may never have touched (`manual` is the
  // start value and the park reset), so writing it back would make the agent view report a
  // posture nobody chose. If this ever starts failing, the reducer state is being mutated by a
  // READ — and the select has begun lying in the other direction.
  const s = session({ toolMode: "manual" });
  io.grantArgs(s, "Read", {});
  grantDecision(io.grantArgs(s, "Bash", { command: "ls" }));
  assert.equal(s.state.toolMode, "manual", "grantArgs must not mutate reducer state");
});

// ── 3. IT WIDENS SUPERVISION, NEVER CONTAINMENT ──────────────────────────────────────

test("the floor cannot open the HARD-DENY set on any profile", () => {
  for (const profile of ["read_only", "dopl_only", "full"]) {
    for (const tool of ["mcp__dopl__dopl_kb_admin", "mcp__dopl__dopl_skill_admin",
      "mcp__dopl__dopl_ontology_admin", "mcp__dopl__dopl_chats_admin"]) {
      const s = session({ toolMode: "manual" });
      s.profile = profile;
      assert.equal(grantDecision(io.grantArgs(s, tool, { op: "read" })), "deny", `${profile}/${tool}`);
    }
  }
});

test("the floor cannot open a PROFILE's own disallowedTools", () => {
  // `read_only` and `dopl_only` hard-deny the write/exec/escape built-ins. `auto` is a positive
  // allow-list carrying EDIT_TOOLS, so this is the case where a careless floor would have
  // reached past a profile bound — hard-deny is checked FIRST, and stays first.
  for (const profile of ["read_only", "dopl_only"]) {
    for (const tool of ["Bash", "Write", "Edit", "Task"]) {
      const s = session({ toolMode: "manual" });
      s.profile = profile;
      assert.equal(grantDecision(io.grantArgs(s, tool, {})), "deny", `${profile}/${tool}`);
    }
  }
});

test("the floor never answers a MESSAGE op — the Axis-A/Axis-B invariant is untouched", () => {
  // ⚠ `grantDecision` branches a channel tool to Axis B BEFORE Axis A is consulted, so a floored
  // TOOL posture can never post, invite or open a DM. A floor leaking across the axes would be
  // the exact inversion the split exists to prevent.
  const s = session({ toolMode: "bypass", messageMode: "ask" });
  for (const op of ["post", "open", "invite", "create_thread", "milestone", "list"]) {
    assert.equal(grantDecision(io.grantArgs(s, DOPL_CHANNEL_TOOL, { op, body: "x", to: "d", kind: "message" })),
      "gate", `toolMode=bypass must not answer op=${op}`);
  }
});

test("the floor does not pre-approve anything — it only widens Axis A", () => {
  // `preApproved` == the SDK's `allowedTools` == SHADOWED past canUseTool. A floor that changed
  // that set would remove the gate diag line and the hard-deny belt for those tools at once.
  const before = profiles.buildSessionToolConfig("full").preApproved.slice();
  io.grantArgs(session({ toolMode: "manual" }), "Read", {});
  assert.deepEqual(profiles.buildSessionToolConfig("full").preApproved, before);
});

// ── 4. ONE STATEMENT OF THE RULE ─────────────────────────────────────────────────────

test("session-io takes the SHARED floor, and does not re-declare it", () => {
  // A second spelling here would pass every case above and drift on the next change to the axis
  // — the F-221 shape, applied to a rule instead of a predicate.
  const src = read("session-io.js");
  assert.match(src, /floorWindowlessTool/, "the shared rule, imported and called");
  assert.equal(/function floorWindowlessTool\s*\(/.test(src), false,
    "session-io.js must not re-declare the floor");
  assert.match(src, /s\.windowless === true/, "conditioned on the surface, not on the axis");
});

test("the floor sits BESIDE its Axis-B twin, in the one file that states both", () => {
  const src = read("session-profiles.js");
  const message = src.indexOf("function floorWindowlessMessage(");
  const tool = src.indexOf("function floorWindowlessTool(");
  assert.ok(message !== -1 && tool !== -1, "both floors live in session-profiles.js");
  assert.ok(tool > message && tool - message < 2600,
    "they are adjacent — one fact about one shape, stated in one place");
});

test("the reason the floor is not optional: a windowless gate is STILL a deny", () => {
  // ⚠ THE STANDING CONDITION. If a gate surface ever returns to this shape, the floor becomes a
  // product choice rather than a correctness one. While it does not exist, `claimGate` denies
  // every `permission_request` outright — pinned so whoever builds the surface reads this first.
  const src = read("session-windowless.js");
  assert.match(src, /payload\.type === 'permission_request'/);
  assert.match(src, /setImmediate\(\(\) => decide\(rid, 'deny'\)\)/,
    "a gated tool on a windowless session is denied, not queued");
});
