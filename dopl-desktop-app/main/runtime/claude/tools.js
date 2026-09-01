// THE CLAUDE ADAPTER'S TOOL VOCABULARY — Axis A's tail, and the per-profile containment table.
//
// ⚠ MOVED HERE FROM `main/session-profiles.js` + `main/tool-profiles.js` ON 2026-08-31
// (runtime-adapter port, step 3 / §0.1b). What changed is that core now ASKS for these instead of
// holding them. `main/session-profiles.js › grantDecision` — its order, its four verdicts, its
// reason codes, every Axis-B lane, the universal hard-deny and both windowless floors' arguments —
// did not move and must not.
//
// ⚠ THE LISTS AND TRANSFORMS BELOW ARE WHAT MOVED UNCHANGED — three profile branches verified
// byte-for-byte against `git show HEAD:` — BUT THIS HEADER SAID "byte-identical" OF THE WHOLE FILE
// AND THAT IS NO LONGER TRUE (2026-09-01): each profile's `preApproved` now DECLARES the two
// agent-ops verbs that were being appended downstream in `launch-spec.js`. The port's honest claim
// is behaviour-preserving with SEVEN declared observable differences; `docs/INVARIANTS.md` §11.0g
// enumerates them and carries the argument for this one.
//
// ⚠ WHY THE AXIS-A TAIL COULD NOT STAY IN CORE. `toolModeAllows` resolves against `AUTO_TOOLS` /
// `BYPASS_TOOLS`, both built from Claude BUILT-IN names, and `normalizeToolMode` fail-closes any
// value outside `['manual','accept_edits','auto','bypass']` to `manual`. A runtime storing Axis A
// as its own vocabulary would resolve EVERY call to `manual` -> false -> gate -> and, on a
// windowless session, DENY. `floorWindowlessTool` cannot rescue it: it floors an unrecognised
// mode to `manual` first and then to `auto`, and `AUTO_TOOLS` still holds no names that runtime
// speaks. So the modes, the lists and both transforms are the ADAPTER's.
//
// ⚠ AND WHY ONLY HALF OF IT IS RE-DERIVED PER RUNTIME. `AUTO_TOOLS` and `BYPASS_TOOLS` are
// composed from two kinds of name: Claude built-ins (`READ_BUILTINS`, `EDIT_TOOLS`,
// `ESCALATION_TOOLS`, `BYPASS_READS` — this file's own), and `mcp__dopl__*` names
// (`DOPL_READ_TOOLS` / `DOPL_WRITE_TOOLS`), which are DOPL'S OWN SURFACE and identical on every
// runtime. Those stay in core (`session-profiles.js`) and are IMPORTED here, never restated: a
// second copy of "which dopl tool writes" is how one adapter comes to gate a read another allows.

const {
  READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS,
  UNIVERSAL_HARD_DENY, RETIRED_DOPL_TOOLS, DOPL_CHANNEL_TOOL, normalizeProfile,
} = require('../../tool-profiles');
// ⚠ DOPL'S OWN SURFACE, IMPORTED — see the header. `mcp__dopl__*` names are runtime-independent.
const doplTools = require('../../session-dopl-tools');
const { canonicalDoplName } = require('../../mcp-tool-names');
// ⚠ THE TWO AGENT-OPS VERBS, READ HERE BECAUSE THIS IS WHERE THE SHADOW HAS TO BE DECLARED — see
// AGENT-OPS, BELOW THE PROFILE TABLE. Names only: the module is electron-free at load (its own
// electron-bound halves are lazy, and the SERVER builder is `./axis-b.js`'s), so requiring it here
// does not pull a window into the module `session-profiles.js` asks for every gate decision.
const { AGENT_OPS_TOOL_NAMES } = require('../../agent-self-ops');

// ─── BEGIN CLAUDE TOOL TABLE (extracted by session-profiles/sdk-grant tests) ───

// The dopl server registers tools bare (`dopl_channel`); the CLI exposes them as
// `mcp__dopl__<tool>`. Per-server MCP `tools` policy uses the bare server-local name.
function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// `full`'s hard-deny IS the universal floor and nothing else. `full` means full; the SUPERVISION
// is Axis A (manual / accept_edits / auto / bypass), not this constant. Safe because every name
// here is in NEITHER AUTO_TOOLS NOR BYPASS_TOOLS — both POSITIVE allow-lists — so all gate in
// EVERY mode incl. `bypass`, and none is pre-approved, so none is shadowed past canUseTool.
// read_only / dopl_only keep the whole of DENIED_BUILTINS and gain nothing.
const SESSION_HARD_DENY = UNIVERSAL_HARD_DENY.slice();

const DOPL_WRITE_TOOLS = doplTools.DOPL_WRITE_TOOLS;
const DOPL_READ_TOOLS = doplTools.DOPL_READ_TOOLS;

// SESSION grant config for a profile. `preApproved` -> SDK allowedTools (shadowed, no button).
// `builtinTools` -> SDK tools (POSITIVE bound; [] = no bound). `disallowedTools` -> SDK
// disallowedTools (hard-denied, never offered). `doplToolsPolicy` -> dopl MCP server's
// per-server `tools` allowlist (null => all dopl tools reachable).
//
// ⚠ `dopl_channel` is in NEITHER preApproved NOR disallowedTools on ANY profile, so it REACHES
// the gate where grantDecision op-scopes it. It stays in each restricted profile's
// `doplToolsPolicy` (defense in depth).
//
// ⚠ AND `disallowedTools` IS NOT MERELY A LAUNCH FLAG. `grantDecision` step 1 reads it as the
// GATE's own first check — the one verdict no task grant and no `bypass` can open — which is why
// `descriptor.containment.profiles.<p>.denyList` is LAUNCH-BLOCKING when null rather than a
// hidden control: a restricted profile with no list in this runtime's vocabulary is a restricted
// profile with no enforcement at all.
//
// ⚠ AGENT-OPS: THE TWO SELF-OPS VERBS ARE PRE-APPROVED ON ALL THREE PROFILES, DECLARED HERE, AND
// THAT PLACEMENT IS THE FIX (2026-09-01, D7.2). They shipped inside the port as
// `allowedTools: cfg.preApproved.concat(AGENT_OPS_TOOL_NAMES)` in `launch-spec.js` — DOWNSTREAM of
// this table. That is a shadow no profile declares and no profile could refuse: it rode
// `read_only` identically to `full`, it never appeared in `descriptor.containment.profiles.<p>
// .allowList` (which mirrors THIS function), it was invisible to the deepEqual pins in
// `session-profiles.test.mjs`, and `grantDecision` — which reads `cfg.preApproved` at step 2 —
// could not see it either. Whatever one concludes about the two verbs, "the containment table does
// not know what the launch pre-approves" is the wrong shape, because the table is the thing the
// descriptor, the pins and the gate all read.
//
// ⚠ WHY PRE-APPROVED AND NOT GATED, RESTATED HERE RATHER THAN LEFT IN THE OTHER FILE. An
// unclassified name is in NEITHER positive allow-list, so it gates in EVERY Axis-A mode, and a
// WINDOWLESS session's gate DENIES (`session-windowless.js › claimGate`). Routing these two
// through the gate therefore does not contain them — it deletes them, for exactly the
// channel-launched sessions the 2026-08-31 ruling is about. The shadow is the only shape that
// ships the feature at all; what was missing was that it be DECLARED.
//
// ⚠ WHY ALL THREE PROFILES, INCLUDING `read_only`, AND WHAT WOULD CHANGE THE ANSWER. A profile
// bounds REACH — the filesystem, the network, the workspace, the channel. Neither verb touches
// any of them: `rename_agent` is display-only against the LOCAL electron-store (`agent-names.js`;
// nothing resolves an agent BY that string, so a rename cannot re-point a running instruction),
// and `end_agent` is a stop verb that widens nothing — it cannot start a query, wake a shell,
// grant a tool or post, and self-end is refused. So `read_only` gains no reach it did not have,
// and narrowing it here would buy containment nothing while breaking the one profile most likely
// to be running unattended. ⚠ THAT ARGUMENT IS ABOUT THESE TWO VERBS AND DOES NOT GENERALISE: a
// third verb on this server that WRITES, ADDRESSES or SENDS belongs on the gate, not on this
// line, and `agent-self-ops.js`'s header says the same to a future in-process Axis B.
//
// ⚠ AND THE ORDER IS THE APPEND. Each profile's own composition stays a literal PREFIX of its
// list, so a diff shows the two names arriving rather than a re-derived set.
function buildSessionToolConfig(profile) {
  const p = normalizeProfile(profile);
  const channelShort = shortDoplName(DOPL_CHANNEL_TOOL);

  if (p === 'read_only') {
    // Local reads pre-approved; delivery via the OP-SCOPED channel tool (gated).
    // Web + every dopl tool except the channel + the admins + all write/exec/escape
    // built-ins are hard-denied.
    return {
      builtinTools: READ_BUILTINS.slice(),
      preApproved: READ_BUILTINS.concat(AGENT_OPS_TOOL_NAMES), // + AGENT-OPS, declared above
      disallowedTools: DENIED_BUILTINS.concat(WEB_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, DOPL_SAFE_TOOLS),
      doplToolsPolicy: [channelShort],
    };
  }

  if (p === 'dopl_only') {
    // Local reads + web reads + READ-ONLY dopl tools pre-approved; channel delivery AND the
    // workspace-WRITE dopl tools via the gate. Admins + write/exec/escape denied.
    // ⚠ DOPL_WRITE_TOOLS must stay out of preApproved (== allowedTools == SHADOWED): they
    // reach the gate like dopl_channel, and stay in doplToolsPolicy.
    return {
      builtinTools: READ_BUILTINS.concat(WEB_TOOLS),
      preApproved: READ_BUILTINS.concat(WEB_TOOLS, DOPL_READ_TOOLS, AGENT_OPS_TOOL_NAMES), // + AGENT-OPS
      disallowedTools: DENIED_BUILTINS.concat(DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS),
      doplToolsPolicy: DOPL_SAFE_TOOLS.map(shortDoplName).concat([channelShort]),
    };
  }

  // full: pre-approve local reads only; hard-deny ONLY the universal floor. Everything else —
  // work tools, delegation, outbound, persistence, escalation, op-scoped dopl_channel —
  // reaches canUseTool.
  //
  // ⚠ YES, `dopl_only` PRE-APPROVES MORE THAN `full` DOES. IT WAS MEASURED, THEN LEFT ALONE
  // (2026-08-22, ruling 4). `dopl_only.preApproved` carries WEB_TOOLS + DOPL_READ_TOOLS on top
  // of READ_BUILTINS while `full`'s is READ_BUILTINS alone, so on paper the RESTRICTED profile
  // reaches more WITHOUT A GATE than the permissive one. Measured across every profile × every
  // toolMode × the whole tool universe, the inversion splits in two:
  //   DOPL_READ_TOOLS — CLOSED at every mode a windowless session can be in. The tool floor
  //     (`floorWindowlessTool`) puts Axis A at `auto` or `bypass`, and AUTO_TOOLS and
  //     BYPASS_TOOLS both carry DOPL_READ_TOOLS, so `full` answers `allow` where `dopl_only`
  //     answers `preapproved` — ungated either way. It survives only at `manual` /
  //     `accept_edits`, which the floor makes unreachable and which nothing else mints (this
  //     tree has no windowed session). Widening `full` here would buy no reach and would
  //     SHADOW five tools past canUseTool, costing the gate diag line for nothing.
  //   WEB_TOOLS — REAL, AND IT SURVIVES THE FLOOR: at `auto`, `full` GATES WebFetch / WebSearch
  //     because they are ESCALATION_TOOLS, while `dopl_only` pre-approves them outright. ⚠ The
  //     safe direction is NOT to widen `full`: pre-approving an escalation tool on the widest
  //     profile shadows the NETWORK past the gate and empties ESCALATION_TOOLS of meaning.
  //     Narrowing `dopl_only` instead is a posture decision (its whole point is "look things
  //     up" with no shell), so it is recorded here rather than silently resolved either way.
  return {
    builtinTools: [],
    preApproved: READ_BUILTINS.concat(AGENT_OPS_TOOL_NAMES), // + AGENT-OPS, declared above
    disallowedTools: SESSION_HARD_DENY.slice(),
    doplToolsPolicy: null,
  };
}

// The accept_edits set (contract A2). ⚠ Named here AND read by core's grant key: `grantKeyFor`
// is bound with it in `session-profiles.js`, so an edit grant and Axis A's accept_edits branch
// can never disagree about which names are edits.
const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

// ── AXIS A: TOOL PERMISSIONS (what MY agent may do on THIS machine) ───────────────
// Per-session, never persisted, starts `manual`, RESET to `manual` on park — an abandoned
// session must never resume pre-authorized.
const TOOL_MODES = ['manual', 'accept_edits', 'auto', 'bypass'];
// Escalation-shaped ops `auto` still asks about: they reach the SHELL or the NETWORK, and the
// counterparty's message text steers what the agent proposes. `bypass` covers them; NOTHING
// covers the hard-deny set. BashOutput/KillShell sit here with Bash — the read half of a shell
// is still the shell.
const ESCALATION_TOOLS = ['Bash', 'BashOutput', 'KillShell', 'WebFetch', 'WebSearch'];

// ⚠ `auto` and `bypass` are POSITIVE ALLOW-LISTS, never negative. A negative mode auto-allows
// every UNRECOGNIZED name ('', null, undefined, a renamed channel tool, a delegation/exfil
// built-in a future CLI ships), and hard-deny is a build-time blacklist that cannot cover them.
// Unknown therefore GATES IN EVERY MODE, `bypass` included.
// Widen BYPASS_READS only with names that have no side effect and no new reach —
// AskUserQuestion / EnterPlanMode / ExitPlanMode / RefreshMcpTools keep gating because each
// changes what the SESSION is rather than reading something already in reach.
const BYPASS_READS = [
  'NotebookRead', // Read for .ipynb: opens a local file, writes nothing (Read is pre-approved)
  'ListMcpResources', // enumerates what an ALREADY-loaded server offers; no server is added
  'ReadMcpResource', // reads one of those resources; a read on a server this profile allowed
];
const AUTO_TOOLS = READ_BUILTINS.concat(EDIT_TOOLS, ['MultiEdit'], DOPL_READ_TOOLS);
const BYPASS_TOOLS = AUTO_TOOLS.concat(ESCALATION_TOOLS, DOPL_WRITE_TOOLS, BYPASS_READS);

function normalizeToolMode(mode) {
  return TOOL_MODES.indexOf(mode) === -1 ? 'manual' : mode; // fail-closed
}

// Does Axis A auto-allow this tool? MultiEdit is deliberately NOT in accept_edits (contract A2
// names exactly Write / Edit / NotebookEdit). Never sees a dopl_channel call — grantDecision
// branches to Axis B first. Name CANONICALIZED first so `mcp__dopl__…` entries match the same
// tool under any server prefix; non-Dopl names pass through untouched.
function toolModeAllows(mode, toolName) {
  const m = normalizeToolMode(mode);
  const name = canonicalDoplName(toolName);
  if (m === 'manual') return false;
  if (m === 'accept_edits') return EDIT_TOOLS.indexOf(name) !== -1;
  if (m === 'auto') return AUTO_TOOLS.indexOf(name) !== -1;
  return BYPASS_TOOLS.indexOf(name) !== -1; // bypass — every KNOWN work tool, nothing else
}

// ⚠ AXIS A'S WINDOWLESS FLOOR — THE ONE STATEMENT OF IT (2026-08-22, Samuel's ruling 4).
//
// ⚠ IT IS THE ADAPTER'S SINCE 2026-08-31, AND ITS TWIN — Axis B's `floorWindowlessMessage` — IS
// NOT. That asymmetry is the point: Axis B's floor moves between members of a DOPL enum
// (`ask` / `auto_inbound` / …) that every runtime shares, while this one names `auto`, a member
// of a vocabulary only this runtime speaks. The two floors were written side by side in
// `session-profiles.js` and their arguments still belong together — read that file's
// `floorWindowlessMessage` for the half that stayed.
//
// A windowless session has NO GATE SURFACE: `session-windowless.js › claimGate` answers a
// `permission_request` with `setImmediate(() => decide(rid, 'deny'))`. Axis B's floor exists
// because a HELD INBOUND is held forever there; this one exists because a GATED TOOL is DENIED
// there. Under `manual` — Axis A's start value AND its park reset, so the common case, not an odd
// one — `toolModeAllows` returns false for every name, so EVERY work tool is silently denied,
// including the read tools `prompt-framing.js` ORDERS the agent to use. Flooring at `auto` makes
// AUTO_TOOLS (READ_BUILTINS + EDIT_TOOLS + MultiEdit + DOPL_READ_TOOLS) reachable with no gate to
// answer — ⚠ ONLY AS FAR AS THE PROFILE ALREADY REACHES (clause missing here until 2026-08-22,
// F-267). `buildSessionToolConfig` bounds `builtinTools` and fills `disallowedTools` BEFORE Axis
// A, so a hard-denied name is absent from context and no floor reopens it: DOPL_READ_TOOLS reach
// only `full`, and `read_only` offers neither them nor EDIT_TOOLS. The floor widens what the
// PROFILE permits; it never makes the Dopl reads reachable.
//
//     manual        -> auto
//     accept_edits  -> auto
//     auto          -> auto
//     bypass        -> bypass     (NEVER NARROWED — widen-only, exactly like the message floor)
//
// ⚠ WHAT IT DOES NOT TOUCH, AND MUST NOT. `SESSION_HARD_DENY`, the secret-path deny rules, and
// each profile's `disallowedTools` are all checked BEFORE Axis A and are unreachable from here;
// so is the Axis-A/Axis-B invariant, because `grantDecision` branches a channel tool to Axis B
// before Axis A is ever consulted. This widens what MY agent may do on THIS machine, inside the
// profile it was launched with, and nothing else — no tool posture can send a message.
//
// ⚠ AND IT IS APPLIED TO THE READ, NOT TO STATE. The message floor has two state-writing lanes
// (`channel-prefs.js › windowlessMessageMode`, `session-reopen.js › setModeByTask`); this one is
// applied once at decision time in `session-io.js › grantArgs`, which is the single read of both
// axes. The trade is written out there.
function floorWindowlessTool(mode) {
  const m = normalizeToolMode(mode); // fail-closed to `manual`, which then floors to `auto`
  return m === 'bypass' ? 'bypass' : 'auto';
}

// ─── END CLAUDE TOOL TABLE ───

module.exports = {
  shortDoplName,
  buildSessionToolConfig,
  TOOL_MODES, EDIT_TOOLS, ESCALATION_TOOLS, BYPASS_READS, AUTO_TOOLS, BYPASS_TOOLS,
  normalizeToolMode, toolModeAllows, floorWindowlessTool,
  SESSION_HARD_DENY,
};
