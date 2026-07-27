// Tests for the Channels v1.2 tool-profile containment in session-spawner.js
// (Feature 6, hardened by the v1.2 adversarial review H-1/H-2).
//
// WHY SOURCE EXTRACTION: this reads the real source and evaluates the production
// tool-profile block verbatim, so the test stays honest to what ships. The block
// is fenced by BEGIN/END sentinel comments and contains no electron/fs/path
// references, so it evaluates standalone.
//
// SPLIT NOTE: the tool-profile table moved from session-spawner.js to
// tool-profiles.js in the §2 refactor; the source path below was repointed in
// the same change. session-spawner.js re-exports the build* helpers, so its
// public API is unchanged.
//
// `.mjs` (ESM) to stay clean under the repo's shared eslint config.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "tool-profiles.js"), "utf8");

// Match from the `//` so the slice starts on a comment, not mid-comment.
const BEGIN = "// ─── BEGIN TOOL-PROFILE TABLE";
const END = "// ─── END TOOL-PROFILE TABLE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN TOOL-PROFILE TABLE sentinel missing");
assert.notEqual(to, -1, "END TOOL-PROFILE TABLE sentinel missing");
assert.ok(to > from, "tool-profile sentinels out of order");
const BLOCK = SRC.slice(from, to);

const {
  buildAllowedTools,
  buildDeniedTools,
  buildBuiltinTools,
  buildRestrictionArgs,
  DOPL_ADMIN_TOOLS,
  DOPL_SAFE_TOOLS,
} = new Function(
  `${BLOCK}
   return { buildAllowedTools, buildDeniedTools, buildBuiltinTools,
            buildRestrictionArgs, DOPL_ADMIN_TOOLS, DOPL_SAFE_TOOLS };`
)();

const RESTRICTED = ["read_only", "dopl_only"];
const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Task"];
// Every tool that can move data off the machine without passing the approve-out
// gate, spawn an unbounded child session, or persist past the spawn.
const ESCAPE_TOOLS = [
  "WebFetch", "WebSearch", "Artifact", "SendMessage", "PushNotification",
  "RemoteTrigger", "Agent", "TaskCreate", "CronCreate", "ScheduleWakeup",
  "Skill", "ToolSearch", "EnterWorktree",
];

// ── full: unchanged v1.1 behavior ────────────────────────────────────────────

test("full -> unrestricted (no lists, no flags at all)", () => {
  assert.deepEqual(buildAllowedTools("full"), []);
  assert.deepEqual(buildDeniedTools("full"), []);
  assert.deepEqual(buildBuiltinTools("full"), []);
  assert.deepEqual(buildRestrictionArgs("full", "/tmp/settings.json"), []);
});

test("unknown / absent profile defaults to full", () => {
  for (const p of [undefined, null, "garbage", ""]) {
    assert.deepEqual(buildAllowedTools(p), [], `allow for ${String(p)}`);
    assert.deepEqual(buildRestrictionArgs(p, "/tmp/s.json"), [], `args for ${String(p)}`);
  }
});

// ── read_only ────────────────────────────────────────────────────────────────

test("read_only -> local read tools only, no web, no MCP", () => {
  const set = buildAllowedTools("read_only");
  for (const t of ["Read", "Grep", "Glob", "LS"]) {
    assert.ok(set.includes(t), `read_only should include ${t}`);
  }
  for (const t of WRITE_TOOLS) assert.ok(!set.includes(t), `read_only must NOT allow ${t}`);
  // H-1: WebFetch/WebSearch were in the v1.2 read_only allow list. They are an
  // outbound channel that bypasses the approve-out gate entirely.
  for (const t of ["WebFetch", "WebSearch"]) {
    assert.ok(!set.includes(t), `read_only must NOT allow ${t} (exfiltration channel)`);
  }
  assert.ok(
    !set.some((t) => t.startsWith("mcp__")),
    "read_only must not allow any MCP tool"
  );
});

test("read_only denies the whole dopl MCP server, admins included", () => {
  const denied = buildDeniedTools("read_only");
  assert.ok(denied.includes("mcp__dopl"), "read_only must deny the bare dopl server prefix");
  for (const t of DOPL_ADMIN_TOOLS) {
    assert.ok(denied.includes(t), `read_only must also deny ${t} by name`);
  }
});

// ── dopl_only (H-2) ──────────────────────────────────────────────────────────

test("H-2: dopl_only must NEVER grant the bare mcp__dopl server prefix", () => {
  // INVERTED from v1.2, which asserted the opposite. `mcp__dopl` matches every
  // tool on the server INCLUDING the six destructive *_admin tools, which made
  // dopl_only strictly more dangerous than full.
  const set = buildAllowedTools("dopl_only");
  assert.ok(
    !set.includes("mcp__dopl"),
    "dopl_only must not use the bare server prefix — it matches the admin tools"
  );
});

test("H-2: no admin MCP tool is grantable under any restricted profile", () => {
  assert.ok(DOPL_ADMIN_TOOLS.length === 6, "expected exactly six admin tools");
  for (const profile of RESTRICTED) {
    const allowed = buildAllowedTools(profile);
    const denied = buildDeniedTools(profile);
    const args = buildRestrictionArgs(profile, "/tmp/s.json").join(" ");
    for (const admin of DOPL_ADMIN_TOOLS) {
      assert.ok(!allowed.includes(admin), `${profile} must not allow ${admin}`);
      assert.ok(denied.includes(admin), `${profile} must deny ${admin}`);
      // The emitted --allowedTools flag must not name an admin, and must not
      // use the bare server prefix. VERIFIED against the CLI: an MCP allow entry
      // matches either the exact tool name or the whole server (`mcp__<server>`)
      // — it is NOT a string prefix, so `mcp__dopl__dopl_kb` does not grant
      // `mcp__dopl__dopl_kb_admin`. The server prefix is the only dangerous form.
      const allowFlag = args.split("--allowedTools ")[1] || "";
      const allowList = (allowFlag.split(" ")[0] || "").split(",");
      assert.ok(!allowList.includes(admin), `${profile} allow list names ${admin}`);
      assert.ok(
        !allowList.includes("mcp__dopl"),
        `${profile} allow list uses the bare server prefix, which covers ${admin}`
      );
    }
  }
});

test("dopl_only -> read tools + explicitly named non-admin dopl tools", () => {
  const set = buildAllowedTools("dopl_only");
  for (const t of ["Read", "Grep", "Glob", "LS"]) {
    assert.ok(set.includes(t), `dopl_only should include ${t}`);
  }
  // Verified against packages/mcp-server/src/server.ts registration sites.
  // NOTE: dopl_channel is intentionally NOT here (see the exfiltration test
  // below) — it is the one non-admin tool a dopl_only spawn must not reach.
  for (const t of [
    "mcp__dopl__dopl_kb",
    "mcp__dopl__dopl_search",
    "mcp__dopl__dopl_map",
    "mcp__dopl__dopl_members",
    "mcp__dopl__dopl_skill",
    "mcp__dopl__dopl_workflow",
    "mcp__dopl__dopl_ontology",
    "mcp__dopl__dopl_chats",
    "mcp__dopl__dopl_cluster",
    "mcp__dopl__current_workspace",
    "mcp__dopl__list_workspaces",
  ]) {
    assert.ok(set.includes(t), `dopl_only should include ${t}`);
  }
  for (const t of WRITE_TOOLS) assert.ok(!set.includes(t), `dopl_only must NOT allow ${t}`);
  for (const t of ["WebFetch", "WebSearch"]) {
    assert.ok(!set.includes(t), `dopl_only must NOT allow ${t}`);
  }
});

// D1: dopl_only could otherwise post/exfiltrate directly via dopl_channel,
// bypassing the desktop's approve-out review. It is now excluded from the allow
// set AND denied by name, so a dopl_only reply routes through stdout +
// approve-out exactly like read_only.
test("dopl_only must NOT grant dopl_channel, and must deny it by name", () => {
  const allowed = buildAllowedTools("dopl_only");
  assert.ok(
    !allowed.includes("mcp__dopl__dopl_channel"),
    "dopl_only must not allow dopl_channel (direct-post exfiltration channel)"
  );
  const denied = buildDeniedTools("dopl_only");
  assert.ok(
    denied.includes("mcp__dopl__dopl_channel"),
    "dopl_only must deny dopl_channel by name"
  );
  // And the emitted flag set must carry it in --disallowedTools.
  const args = buildRestrictionArgs("dopl_only", "/tmp/s.json").join(" ");
  const denyFlag = args.split("--disallowedTools ")[1] || "";
  const denyList = (denyFlag.split(" ")[0] || "").split(",");
  assert.ok(
    denyList.includes("mcp__dopl__dopl_channel"),
    "dopl_only --disallowedTools must name dopl_channel"
  );
});

test("the safe-tool list and the admin list are disjoint", () => {
  for (const safe of DOPL_SAFE_TOOLS) {
    assert.ok(!safe.endsWith("_admin"), `${safe} is an admin tool in the safe list`);
    assert.ok(!DOPL_ADMIN_TOOLS.includes(safe), `${safe} appears in both lists`);
  }
});

// ── H-1: the deny list is what actually bounds a spawn ───────────────────────

test("both restricted profiles deny write, exec, delegation, and escape tools", () => {
  for (const profile of RESTRICTED) {
    const denied = buildDeniedTools(profile);
    for (const t of [...WRITE_TOOLS, ...ESCAPE_TOOLS]) {
      assert.ok(denied.includes(t), `${profile} must deny ${t}`);
    }
  }
});

test("no tool is both allowed and denied under a restricted profile", () => {
  for (const profile of RESTRICTED) {
    const allowed = new Set(buildAllowedTools(profile));
    for (const t of buildDeniedTools(profile)) {
      assert.ok(!allowed.has(t), `${profile} both allows and denies ${t}`);
    }
  }
});

// ── The emitted flag set ─────────────────────────────────────────────────────

test("restricted profiles emit all four containment layers", () => {
  for (const profile of RESTRICTED) {
    const args = buildRestrictionArgs(profile, "/tmp/spawn-settings.json");
    assert.ok(args.includes("--tools"), `${profile} must bound built-ins with --tools`);
    assert.ok(args.includes("--allowedTools"), `${profile} must pre-approve its tools`);
    assert.ok(args.includes("--disallowedTools"), `${profile} must pass a CLI deny list`);
    assert.ok(args.includes("--settings"), `${profile} must load scoped settings`);
    assert.ok(args.includes("/tmp/spawn-settings.json"), `${profile} must pass the settings path`);
    assert.ok(
      args.includes("--strict-mcp-config"),
      `${profile} must not inherit the operator's other MCP servers`
    );
  }
});

test("a failed settings write still emits the other three layers", () => {
  for (const profile of RESTRICTED) {
    const args = buildRestrictionArgs(profile, null);
    assert.ok(!args.includes("--settings"), "no --settings without a path");
    assert.ok(args.includes("--tools"));
    assert.ok(args.includes("--disallowedTools"));
    assert.ok(args.includes("--strict-mcp-config"));
  }
});

test("every flag value is a single comma-joined argv element", () => {
  // The CLI declares --tools/--allowedTools/--disallowedTools/--mcp-config as
  // variadic, so a value must never be split across argv elements or it would
  // swallow the following flag's value.
  for (const profile of RESTRICTED) {
    const args = buildRestrictionArgs(profile, "/tmp/s.json");
    for (let i = 0; i < args.length; i++) {
      if (!args[i].startsWith("--")) continue;
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) continue;
      assert.ok(!/\s/.test(next), `${args[i]} value must not contain whitespace`);
      assert.equal(args[i + 2] === undefined || args[i + 2].startsWith("--"), true,
        `${args[i]} must take exactly one argv element`);
      i++;
    }
  }
});

test("--tools bounds built-ins to the read set only", () => {
  for (const profile of RESTRICTED) {
    const builtins = buildBuiltinTools(profile);
    assert.ok(builtins.includes("Read") && builtins.includes("Grep") && builtins.includes("Glob"));
    for (const t of [...WRITE_TOOLS, ...ESCAPE_TOOLS]) {
      assert.ok(!builtins.includes(t), `${profile} --tools must not offer ${t}`);
    }
    assert.ok(
      !builtins.some((t) => t.startsWith("mcp__")),
      "--tools only names built-ins; MCP tools are governed separately"
    );
  }
});

test("restricted profiles return a non-empty allow list (a flag IS emitted)", () => {
  assert.ok(buildAllowedTools("read_only").length > 0);
  assert.ok(buildAllowedTools("dopl_only").length > 0);
});
