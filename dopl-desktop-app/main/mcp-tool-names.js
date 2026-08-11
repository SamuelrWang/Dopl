// WHAT IS THIS TOOL CALLED, UNDER ANY CLIENT (F-139, 2026-08-05).
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────────────
// `mcp__dopl__` is what OUR OWN registration produces: sdk-loader keys the in-memory MCP
// server `dopl`, so a session we spawn sees `mcp__dopl__dopl_channel`. It is NOT what every
// client produces. The claude.ai connector exposes the SAME server as `mcp__claude_ai_Dopl__`,
// and other clients use a UUID server segment (`mcp__6a12c8bd-4187-40eb-9b21-eb230264f726__`,
// observed live in a Claude Code session). The server segment is the CLIENT's to choose and
// has never been ours to assume.
//
// Every matcher in the session gate compared against the literal `mcp__dopl__` form, so on a
// machine where a Dopl tool arrived under any other server name the WHOLE table missed at once
// (two machines on 1.8.6, identical fully-permissive postures, opposite behaviour):
//   working  `session gate: dopl_channel op=read allow auto-inbound-read tool=bypass msg=auto_both`
//   broken   `session gate: mcp__claude_ai_Dopl__dopl_channel gate unclassified-tool tool=bypass msg=auto_both`
// Three consequences, one root:
//   1. the channel tool skipped AXIS B entirely, fell through to Axis A, was in no positive
//      allow-list, and gated as `unclassified-tool` in EVERY posture — `bypass` included, so
//      no setting the operator could reach would ever fix it;
//   2. the dopl read/write tools were covered by no mode either, so `auto` / `bypass` did not
//      reach them on that machine;
//   3. and the HARD-DENY set was ESCAPED in the opposite direction: `mcp__<other>__dopl_kb_admin`
//      resolved 'gate' rather than 'deny', i.e. one operator click away from running a tool the
//      table states can never be opened at all, by a grant or by `bypass`.
// Because it presents exactly like a posture that did not stick, it survived several rounds of
// "fix the permissions" — it has nothing to do with postures.
//
// THE DIAGNOSTIC HOLE HAD THE SAME ROOT, which is why the log above reads so differently on the
// two machines. session-io's gate line prints `op=` ONLY for a call that classifies as the
// channel tool, so on the broken machine the op was absent from every line; and its own label
// regex was `/^mcp__[a-z0-9-]+?__/i`, whose server class has no underscores, so a connector name
// stripped to nothing and the field printed the whole dotted name. Both read through
// `mcpShortName` / `isChannelTool` now, so fixing the matcher fixes the diagnosis with it.
//
// ── THE RULE ────────────────────────────────────────────────────────────────────────
// THE SHORT NAME IS THE SEGMENT AFTER THE LAST `__`. MCP tool names do not contain `__` (ours
// are `dopl_channel`, `current_workspace`); server names can. Stripping GREEDILY therefore
// yields the tool half for every real name, and for a pathological one it OVER-matches, which
// is the safe direction at both call sites (session-profiles' isChannelTool documents why: the
// hard-deny set is checked first, and Axis B is stricter than Axis A). A name carrying no
// `mcp__` prefix is already bare and comes back unchanged — our server registers tools bare and
// only clients add the prefix.
//
// PURE: the tool-profiles constants and nothing else. Electron/fs/SDK-free, like every module
// the gate is built from.

const {
  DOPL_CHANNEL_TOOL, DOPL_SAFE_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS,
  DOPL_SERVER_PREFIX,
} = require('./tool-profiles');

function mcpShortName(full) {
  return String(full == null ? '' : full).replace(/^mcp__.*__/i, '');
}

// CANONICALIZE a Dopl tool name onto the `mcp__dopl__<short>` form every list in the session
// gate is written in, so ONE normalization fixes hard-deny, pre-approval and both Axis-A
// allow-lists together instead of four near-copies of the same prefix assumption. Only the
// KNOWN Dopl vocabulary is rewritten; every other name is returned untouched, so a third-party
// server's unrelated tool stays unclassified and keeps gating in every mode.
//
// RESIDUAL RISK, STATED HONESTLY. A third-party MCP server that exposes a tool whose short name
// is literally one of ours — `dopl_channel`, `dopl_kb`, or the two generic-sounding workspace
// metas — inherits this table's classification for that name. The trade is right because it
// hands an attacker nothing they did not already have: registering an MCP server on this
// machine is a config write or code execution, and anyone with either can simply register their
// server UNDER THE NAME `dopl`, which the old literal matcher trusted just as completely. A
// server name was never a secret and never a bound; matching generically only stops PUNISHING
// the honest clients. Every tighter bound considered fails the case that caused this: an
// allow-list of known server names re-breaks on the next client, and requiring the server
// segment to look Dopl-ish re-breaks the UUID form already observed in the field.
//
// RETIRED NAMES BELONG IN THIS VOCABULARY TOO (2026-08-07). `dopl_workflow` /
// `dopl_cluster` and their admins were DELETED from the server on 2026-08-11, but they are
// still on the deny lists (RETIRED_DOPL_TOOLS), and a deny list is only reached through
// this normalizer — that is the entire F-139 finding. Leave them out and a retired admin
// arriving under a connector or UUID server segment stays unclassified, which resolves to
// `gate`: a button for the exact tool the table says can never be opened. The name being
// unregisterable does not make it unsendable — this list is derived, so it follows.
const DOPL_TOOL_PREFIX = DOPL_SERVER_PREFIX + '__';
const DOPL_SHORT_NAMES = [DOPL_CHANNEL_TOOL]
  .concat(DOPL_SAFE_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS)
  .map(function (t) { return mcpShortName(t); });

function canonicalDoplName(toolName) {
  const n = typeof toolName === 'string' ? toolName : '';
  if (n.indexOf(DOPL_TOOL_PREFIX) === 0) return n; // already the canonical form
  const short = mcpShortName(n);
  return DOPL_SHORT_NAMES.indexOf(short) === -1 ? n : DOPL_TOOL_PREFIX + short;
}

module.exports = { mcpShortName, canonicalDoplName, DOPL_SHORT_NAMES, DOPL_TOOL_PREFIX };
