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
  DENIED_BUILTINS,
  DOPL_ADMIN_TOOLS,
  DOPL_CHANNEL_TOOL,
  DOPL_SAFE_TOOLS,
  RETIRED_DOPL_TOOLS,
  UNIVERSAL_HARD_DENY,
  WEB_TOOLS,
} = new Function(
  `${BLOCK}
   return { DENIED_BUILTINS, DOPL_ADMIN_TOOLS, DOPL_CHANNEL_TOOL,
            DOPL_SAFE_TOOLS, RETIRED_DOPL_TOOLS, UNIVERSAL_HARD_DENY, WEB_TOOLS };`
)();

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

// ── dopl_only (H-2) ──────────────────────────────────────────────────────────

test("the safe list names each tool in full, never the bare server prefix or the posting tool", () => {
  for (const t of DOPL_SAFE_TOOLS) assert.match(t, /^mcp__dopl__dopl_[a-z_]+$/, t);
  assert.ok(!DOPL_SAFE_TOOLS.includes("mcp__dopl"));
  assert.ok(!DOPL_SAFE_TOOLS.includes(DOPL_CHANNEL_TOOL), "posting is the exfil surface");
});

test("the universal floor denies every retired and admin tool", () => {
  for (const t of [...RETIRED_DOPL_TOOLS, ...DOPL_ADMIN_TOOLS]) assert.ok(UNIVERSAL_HARD_DENY.includes(t), t);
});

test("DENIED_BUILTINS covers write, exec, delegation and escape tools, never the web reads", () => {
  for (const t of [...WRITE_TOOLS, ...ESCAPE_TOOLS]) assert.ok(DENIED_BUILTINS.includes(t), t);
  for (const t of WEB_TOOLS) assert.ok(!DENIED_BUILTINS.includes(t), `${t} is governed per profile`);
});

test("the safe-tool list and the admin list are disjoint", () => {
  for (const safe of DOPL_SAFE_TOOLS) {
    assert.ok(!safe.endsWith("_admin"), `${safe} is an admin tool in the safe list`);
    assert.ok(!DOPL_ADMIN_TOOLS.includes(safe), `${safe} appears in both lists`);
  }
});

// ── H-1: the deny list is what actually bounds a spawn ───────────────────────

// ── The emitted flag set ─────────────────────────────────────────────────────

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
