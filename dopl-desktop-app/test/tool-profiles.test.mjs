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
import { readFileSync, readdirSync } from "node:fs";
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
  DOPL_CHANNEL_TOOL,
  DOPL_SAFE_TOOLS,
  RETIRED_DOPL_TOOLS,
  UNIVERSAL_HARD_DENY,
  WEB_TOOLS,
} = new Function(
  `${BLOCK}
   return { buildAllowedTools, buildDeniedTools, buildBuiltinTools,
            buildRestrictionArgs, DOPL_ADMIN_TOOLS, DOPL_CHANNEL_TOOL,
            DOPL_SAFE_TOOLS, RETIRED_DOPL_TOOLS, UNIVERSAL_HARD_DENY, WEB_TOOLS };`
)();

const RESTRICTED = ["read_only", "dopl_only"];
const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Task"];
// Web reads are governed PER-PROFILE now (denied for read_only, ALLOWED for
// dopl_only so it is functional headless), so they are NOT in the shared
// ESCAPE_TOOLS list below — they get their own per-profile assertions.
const ESCAPE_TOOLS = [
  "Artifact", "SendMessage", "PushNotification",
  "RemoteTrigger", "Agent", "TaskCreate", "CronCreate", "ScheduleWakeup",
  "Skill", "ToolSearch", "EnterWorktree",
];

test("WEB_TOOLS is exactly WebFetch + WebSearch", () => {
  assert.deepEqual([...WEB_TOOLS].sort(), ["WebFetch", "WebSearch"]);
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

test("read_only denies the whole dopl MCP server, the hard-deny floor, and web", () => {
  const denied = buildDeniedTools("read_only");
  assert.ok(denied.includes("mcp__dopl"), "read_only must deny the bare dopl server prefix");
  for (const t of UNIVERSAL_HARD_DENY) {
    assert.ok(denied.includes(t), `read_only must also deny ${t} by name`);
  }
  // read_only is the zero-outbound profile: web is an exfil channel and must be
  // explicitly denied (and it is not in the allow list — asserted above).
  for (const t of WEB_TOOLS) {
    assert.ok(denied.includes(t), `read_only must deny ${t} (zero-outbound profile)`);
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
  // ⚠ DRIVEN OVER THE HARD-DENY FLOOR, NOT `DOPL_ADMIN_TOOLS`, SINCE 2026-09-02, when the
  // last five `*_admin` tools were deleted server-side and their names moved to
  // RETIRED_DOPL_TOOLS. Iterating the now-empty admin list would make every assertion below
  // a vacuous pass on the very names this test exists to keep denied. The floor is 9: five
  // deleted admins + the four from the 2026-08-07 retirement. "The admin list is exactly the
  // live *_admin tools" (below) is what stops a NEW one landing in the safe list instead.
  assert.equal(UNIVERSAL_HARD_DENY.length, 9, "the universal hard-deny floor is 9 names");
  for (const profile of RESTRICTED) {
    const allowed = buildAllowedTools(profile);
    const denied = buildDeniedTools(profile);
    const args = buildRestrictionArgs(profile, "/tmp/s.json").join(" ");
    for (const admin of UNIVERSAL_HARD_DENY) {
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
  // These eight names are pinned against the server's real registration sites
  // by the drift alarm at the bottom of this file — this list is the readable
  // copy, that one is the check. NOTE: dopl_channel is intentionally NOT here
  // (see the exfiltration test below) — it is the one non-admin tool a
  // dopl_only spawn must not reach.
  for (const t of [
    "mcp__dopl__dopl_kb",
    "mcp__dopl__dopl_search",
    "mcp__dopl__dopl_map",
    "mcp__dopl__dopl_members",
    "mcp__dopl__dopl_skill",
    "mcp__dopl__dopl_ontology",
    "mcp__dopl__dopl_chats",
    "mcp__dopl__dopl_workspaces",
  ]) {
    assert.ok(set.includes(t), `dopl_only should include ${t}`);
  }
  for (const t of WRITE_TOOLS) assert.ok(!set.includes(t), `dopl_only must NOT allow ${t}`);
  // dopl_only IS granted web reads — this is the "read your files + Dopl + web"
  // profile — pre-approved via --allowedTools so they work headless with no prompt.
  for (const t of WEB_TOOLS) {
    assert.ok(set.includes(t), `dopl_only should include ${t} (web reads)`);
  }
});

// dopl_only must be FUNCTIONAL headless for web reads: allowed, offered by --tools,
// pre-approved in the emitted --allowedTools flag, and NOT denied anywhere.
test("dopl_only grants web reads across every layer and denies them nowhere", () => {
  const allowed = buildAllowedTools("dopl_only");
  const denied = buildDeniedTools("dopl_only");
  const builtins = buildBuiltinTools("dopl_only");
  for (const t of WEB_TOOLS) {
    assert.ok(allowed.includes(t), `dopl_only must allow ${t}`);
    assert.ok(builtins.includes(t), `dopl_only --tools must offer ${t}`);
    assert.ok(!denied.includes(t), `dopl_only must NOT deny ${t}`);
  }
  const args = buildRestrictionArgs("dopl_only", "/tmp/s.json").join(" ");
  const allowFlag = args.split("--allowedTools ")[1] || "";
  const allowList = (allowFlag.split(" ")[0] || "").split(",");
  for (const t of WEB_TOOLS) {
    assert.ok(allowList.includes(t), `dopl_only --allowedTools must name ${t}`);
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

// RETIREMENT (2026-08-07). Unregistering a tool must TIGHTEN what a spawn can do, never
// loosen it. Dropping dopl_cluster_admin / dopl_workflow_admin from DOPL_ADMIN_TOOLS alone
// would have left them UNCLASSIFIED, which resolves to `gate` — a button, in the profiles
// that have one, for tools the table says can never be opened. They are denied by their own
// list instead, so the hard-deny outlives the tool.
//
// WIDENED TO EVERY PROFILE (2026-08-08, C-10). It was scoped to RESTRICTED, and that scoping
// is precisely why the `full` gap survived an audit: the SDK lane denied these under `full`
// and this lane did not, and no assertion crossed the two. `full` is in the loop now.
test("retired dopl tools stay denied under EVERY profile, full included", () => {
  assert.ok(RETIRED_DOPL_TOOLS.length > 0, "the retired list must not be empty");
  for (const t of RETIRED_DOPL_TOOLS) {
    assert.ok(!DOPL_SAFE_TOOLS.includes(t), `${t} is retired but still in the safe list`);
    assert.ok(!DOPL_ADMIN_TOOLS.includes(t), `${t} is retired but still in the admin list`);
    for (const profile of [...RESTRICTED, "full"]) {
      assert.ok(!buildAllowedTools(profile).includes(t), `${profile} must not allow ${t}`);
      assert.ok(buildDeniedTools(profile).includes(t), `${profile} must deny ${t}`);
      const args = buildRestrictionArgs(profile, "/tmp/s.json").join(" ");
      const denyFlag = args.split("--disallowedTools ")[1] || "";
      assert.ok((denyFlag.split(" ")[0] || "").split(",").includes(t),
        `${profile} --disallowedTools must name ${t}`);
    }
  }
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
  // Web is the ONE outbound tool that diverges by profile: read_only denies it
  // (zero-outbound), dopl_only allows it (read files + Dopl + web).
  for (const t of WEB_TOOLS) {
    assert.ok(buildDeniedTools("read_only").includes(t), `read_only must deny ${t}`);
    assert.ok(!buildDeniedTools("dopl_only").includes(t), `dopl_only must NOT deny ${t}`);
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

test("--tools bounds built-ins to the read set (+ web for dopl_only) only", () => {
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
  // read_only --tools must NOT offer web; dopl_only --tools MUST (so it is offered
  // to the model at all — L0 is a positive bound).
  for (const t of WEB_TOOLS) {
    assert.ok(!buildBuiltinTools("read_only").includes(t), `read_only --tools must not offer ${t}`);
    assert.ok(buildBuiltinTools("dopl_only").includes(t), `dopl_only --tools must offer ${t}`);
  }
});

test("restricted profiles return a non-empty allow list (a flag IS emitted)", () => {
  assert.ok(buildAllowedTools("read_only").length > 0);
  assert.ok(buildAllowedTools("dopl_only").length > 0);
});

// ── THE 14-TOOL AGREEMENT, AS A DRIFT ALARM ──────────────────────────────────
//
// Everything above is a HAND COPY of what packages/mcp-server registers, and
// the only thing that used to link the two was a comment. Matching name-for-name
// is a CONTAINMENT property, not a coincidence: a tool the server gains that
// this file never hears about is UNCLASSIFIED in the session gate, and
// unclassified resolves to `gate` — one operator click from running
// (main/mcp-tool-names.js documents the same failure from the other direction).
// Drift the other way makes the desktop's written record of the agent surface
// lie about what a spawn can reach.
//
// Same shape as deep-link-target.test.mjs's route-table alarm: read the real
// source, parse it, compare. EXECUTING the server instead is not available —
// the desktop is a separate npm project, CI installs it with `--ignore-scripts`
// and no root node_modules, so its dist/ has nothing to resolve imports against.

const MCP_SRC = join(HERE, "..", "..", "packages", "mcp-server", "src");

/** Every non-test `.ts` under packages/mcp-server/src, recursively. */
function mcpSources(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...mcpSources(p));
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

// A registration site names its tool as a STRING LITERAL first argument:
// `register("dopl_map", …)` in the domain registrars (the injected registrar is
// named `register` there) and `registerMetaTool("dopl_workspaces", …)` in
// meta-tools.ts. The SDK call underneath — `server.registerTool(name, …)` — passes a
// variable, so there is no literal to match; the lookbehind drops it regardless.
const REGISTER_SITE = /(?<![.\w$])register(?:Tool|MetaTool)?\s*\(\s*"([a-z][a-z0-9_]*)"/g;

/**
 * The bracketed name list of a `<symbol> … = … [ … ]` DECLARATION. Depth-matched
 * brackets, not a lazy `]`, so a nested array cannot truncate the read.
 * Tolerates `new Set([…])`, `new Set<string>([…])`, a plain array, and a type
 * annotation before the `=`. An `import { <symbol> }` line carries no `=` and
 * `[^=\n]` cannot cross a line, so a re-export never matches — which is what
 * lets HIDDEN_TOOLS move out of server.ts into its own module without breaking
 * this test.
 */
function declaredNames(src, symbol) {
  const decl = new RegExp(`\\b${symbol}\\b[^=\\n]*=[^\\[\\n]*\\[`).exec(src);
  if (!decl) return null;
  const open = src.indexOf("[", decl.index);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) {
      return [...src.slice(open, i).matchAll(/"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]);
    }
  }
  return null;
}

const registeredTools = [];
const hiddenDecls = [];
for (const file of mcpSources(MCP_SRC)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(REGISTER_SITE)) registeredTools.push(m[1]);
  const names = declaredNames(src, "HIDDEN_TOOLS");
  if (names) hiddenDecls.push({ file, names });
}

// EXACTLY ONE declaration, never "the last one found" — tools/parity-harness.ts
// re-derives HIDDEN_TOOLS by parsing server.ts, so the name legitimately appears
// in more than one file and a last-wins read could silently pick a derived copy.
function hiddenNames() {
  assert.equal(hiddenDecls.length, 1,
    `expected 1 HIDDEN_TOOLS declaration under packages/mcp-server/src, found `
    + `${hiddenDecls.length} [${hiddenDecls.map((d) => d.file).join(", ")}] — it moved, `
    + "was duplicated, or changed shape; repoint declaredNames()");
  return hiddenDecls[0].names;
}

/** `mcp__dopl__dopl_kb` → `dopl_kb`. The server registers tools bare. */
const shortName = (t) => t.replace(/^mcp__dopl__/, "");
const ALL_DOPL = [
  ...DOPL_SAFE_TOOLS, ...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS, DOPL_CHANNEL_TOOL,
];

// Parser sanity comes FIRST and on its own: a regex that silently stopped
// matching would make every comparison below vacuous, and a vacuous pass reads
// exactly like "no drift". Fail here instead, naming what to repoint.
test("the mcp-server source parser still finds what it is looking for", () => {
  const hiddenTools = hiddenNames();
  assert.ok(registeredTools.length >= 11,
    `only ${registeredTools.length} registration sites parsed — the register(...) call shape changed; repoint REGISTER_SITE`);
  assert.equal(new Set(registeredTools).size, registeredTools.length,
    "the same tool name is registered twice");
  for (const a of ["dopl_kb", "dopl_map", "dopl_channel", "dopl_workspaces"]) {
    assert.ok(registeredTools.includes(a), `parser missed a known tool: ${a}`);
  }
  for (const h of hiddenTools) {
    assert.ok(registeredTools.includes(h), `HIDDEN_TOOLS names ${h}, which no registrar registers`);
  }
  // shortName() is only meaningful while every entry carries the prefix, and a
  // prefix-less one matches nothing at the CLI while still reading as covered.
  for (const t of ALL_DOPL) {
    assert.ok(t.startsWith("mcp__dopl__"), `${t} is missing the server prefix`);
  }
});

test("the desktop's Dopl tool lists match the MCP server's live surface", () => {
  const hiddenTools = hiddenNames();
  const live = registeredTools.filter((t) => !hiddenTools.includes(t)).sort();
  const desktop = [...DOPL_SAFE_TOOLS, ...DOPL_ADMIN_TOOLS, DOPL_CHANNEL_TOOL]
    .map(shortName).sort();
  assert.deepEqual(desktop, live,
    `main/tool-profiles.js has drifted from packages/mcp-server/src (HIDDEN_TOOLS read from ${hiddenDecls[0].file})`);
  // The number INVARIANTS §10 states in prose, asserted once. 14 → 16 → 17 on
  // 2026-08-28 (waves A and B), 17 → 18 on 2026-09-01 (`dopl_status`, T20),
  // 18 → 13 on 2026-09-02 (MCP v2 wave A: the five `*_admin` tools deleted),
  // 13 → 11 the same day (wave B B13: `current_workspace`, `list_workspaces`
  // and `dopl_home` became the one `dopl_workspaces`).
  // ⚠ The assertion ABOVE is the one that catches a new tool, by construction;
  // this one exists so adding one costs a doc edit too.
  assert.equal(live.length, 11, "the agent surface is documented as 11 tools");
});

// RETIRED_DOPL_TOOLS is a SUPERSET of HIDDEN_TOOLS, never an equality.
//
// It was an equality until 2026-08-11, when the four names it held
// (`dopl_workflow`/`_admin`, `dopl_cluster`/`_admin`) stopped being HIDDEN and
// started being DELETED — server-side there is no registrar, no route and no
// table left, so HIDDEN_TOOLS is now empty while these four stay denied. That
// asymmetry is the containment rule, not drift: a deny may outlive its tool,
// but a hidden tool may never be missing from the deny list, because dropping
// it makes the name UNCLASSIFIED, which resolves to `gate` rather than to deny.
// The direction that must never break is therefore HIDDEN ⊆ RETIRED, plus the
// separate rule that nothing denied here is also live.
test("every HIDDEN tool is denied, and nothing denied is live", () => {
  const retired = RETIRED_DOPL_TOOLS.map(shortName);
  for (const h of hiddenNames()) {
    assert.ok(retired.includes(h),
      `HIDDEN_TOOLS names ${h}, which is missing from RETIRED_DOPL_TOOLS — that makes it `
      + "UNCLASSIFIED, which resolves to `gate`, not deny");
  }
  const live = [...DOPL_SAFE_TOOLS, ...DOPL_ADMIN_TOOLS, DOPL_CHANNEL_TOOL].map(shortName);
  for (const r of retired) {
    assert.ok(!live.includes(r), `${r} is denied AND offered — the lists contradict each other`);
  }
});

test("the admin list is exactly the live *_admin tools", () => {
  // The split IS the containment boundary — an admin tool that lands in
  // DOPL_SAFE_TOOLS is one dopl_only spawns get pre-approved.
  const hiddenTools = hiddenNames();
  const liveAdmins = registeredTools
    .filter((t) => !hiddenTools.includes(t) && t.endsWith("_admin")).sort();
  assert.deepEqual(DOPL_ADMIN_TOOLS.map(shortName).sort(), liveAdmins);
});
