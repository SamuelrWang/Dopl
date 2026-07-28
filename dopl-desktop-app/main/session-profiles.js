// SESSION-mode tool grant table (v1.9 Session Window, Track T1).
//
// Maps a tool profile -> the SDK-option pieces a live session needs:
//   { builtinTools, disallowedTools, preApproved, doplToolsPolicy }
// This is the SESSION analog of tool-profiles.js's HEADLESS containment. The two
// differ deliberately (§G-Q3): headless has no TTY so it can only PRE-APPROVE a
// fixed safe set; a session has a visible window + live canUseTool buttons, so
// dangerous tools can be LIVE-GATED per call instead of hard-denied.
//
// THE SHADOW GOTCHA (research §3, contract §A.5 / §H-1). A tool named in the SDK's
// `allowedTools` SHADOWS the `canUseTool` callback — it auto-approves before the
// button can appear. So `preApproved` (== allowedTools) must contain ONLY tools we
// intend to grant silently at launch; a live-gated tool must NEVER appear there.
//
// SECURITY (adversarial review):
//   FIX H1 — `dopl_channel` is NO LONGER blanket pre-approved. Blanket approval let
//     a read_only session Read a file then dopl_channel op=open a DM to any member +
//     op=post the contents with ZERO clicks (silent cross-user exfiltration). It now
//     reaches the gate and is OP-SCOPED in grantDecision: auto-allowed ONLY for a
//     plain post into the session's OWN channel; every other op gates on a button.
//   FIX H2 — under `full`, the delegation / persistence / exfil / escalation subset
//     is HARD-DENIED (SESSION_HARD_DENY), not merely gated, so a one-click
//     "Allow for this task" can never grant a tool that outlives the watched window.
//   FIX H3 — Task/Agent are hard-denied under EVERY profile (see SESSION_HARD_DENY).
//
// PURE module: requires ONLY the (pure) tool-profiles constants. The extracted
// block references those constants + normalizeProfile, which test/session-profiles
// and test/sdk-grant inject as parameters when they evaluate the sliced block (the
// same source-extraction idiom as tool-profiles, kept electron/fs/path/SDK-free).

const {
  READ_BUILTINS,
  WEB_TOOLS,
  DOPL_SAFE_TOOLS,
  DENIED_BUILTINS,
  DOPL_ADMIN_TOOLS,
  DOPL_CHANNEL_TOOL,
  normalizeProfile,
} = require('./tool-profiles');

// ─── BEGIN SESSION-PROFILE TABLE (extracted by session-profiles/sdk-grant tests) ───

// The dopl server registers tools under bare names (`dopl_channel`); the CLI
// exposes them as `mcp__dopl__<tool>`. The per-server MCP `tools` policy uses the
// bare server-local name, so strip our `mcp__dopl__` prefix for doplToolsPolicy.
function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// FIX H2 / H3 — the SESSION HARD-DENY set for the `full` profile. A live session
// gives the operator a visible window + per-call Allow/Deny buttons, so the VISIBLE
// + REVERSIBLE work tools (Bash / Write / Edit / MultiEdit / NotebookEdit, plus
// WebFetch and the non-admin dopl reads, none of which are denied under full) can
// be LIVE-GATED. But the delegation / persistence / exfil / escalation tools must
// NOT be live-gated: a single "Allow for this task" on one of them OUTLIVES the
// watched window — Task/Agent spawn a FRESH session that does NOT inherit this
// session's canUseTool bound (tool-profiles.js warns the same; hence H3 denies them
// under every profile), Cron*/ScheduleWakeup/Monitor persist and re-run unattended,
// SendMessage/RemoteTrigger/Artifact/… exfiltrate off-machine without the visible
// dopl_channel post. So `full` HARD-DENIES them. Derived from tool-profiles'
// DENIED_BUILTINS (the full blacklist) MINUS the work tools we keep live-gated, PLUS
// the six dopl_*_admin tools — reusing the shared constants so the two never drift.
const SESSION_GATED_WORK_TOOLS = ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const SESSION_HARD_DENY = DENIED_BUILTINS
  .filter(function (t) { return SESSION_GATED_WORK_TOOLS.indexOf(t) === -1; })
  .concat(DOPL_ADMIN_TOOLS);

// The SESSION grant config for a profile. `preApproved` -> SDK allowedTools
// (shadowed, no button). `builtinTools` -> SDK tools (a POSITIVE bound; [] means
// no bound, i.e. all built-ins offered, only some gated). `disallowedTools` -> SDK
// disallowedTools (hard-denied, never offered). `doplToolsPolicy` -> the dopl MCP
// server's per-server `tools` allowlist (null => all dopl tools reachable).
//
// `dopl_channel` is NOT in `preApproved` on ANY profile (FIX H1) — it is left out of
// both preApproved and disallowedTools so it REACHES the gate, where grantDecision
// op-scopes it. It stays in each restricted profile's `doplToolsPolicy` (defense in
// depth: the MCP server still only offers the scoped dopl tools).
function buildSessionToolConfig(profile) {
  const p = normalizeProfile(profile);
  const channelShort = shortDoplName(DOPL_CHANNEL_TOOL);

  if (p === 'read_only') {
    // Local reads pre-approved; delivery via the OP-SCOPED channel tool (gated).
    // Web + every dopl tool except the channel + the admins + all write/exec/escape
    // built-ins are hard-denied.
    return {
      builtinTools: READ_BUILTINS.slice(),
      preApproved: READ_BUILTINS.slice(),
      disallowedTools: DENIED_BUILTINS.concat(WEB_TOOLS, DOPL_ADMIN_TOOLS, DOPL_SAFE_TOOLS),
      doplToolsPolicy: [channelShort],
    };
  }

  if (p === 'dopl_only') {
    // Local reads + web reads + the non-admin dopl tools pre-approved; channel
    // delivery via the OP-SCOPED gate. Admins + write/exec/escape hard-denied.
    return {
      builtinTools: READ_BUILTINS.concat(WEB_TOOLS),
      preApproved: READ_BUILTINS.concat(WEB_TOOLS, DOPL_SAFE_TOOLS),
      disallowedTools: DENIED_BUILTINS.concat(DOPL_ADMIN_TOOLS),
      doplToolsPolicy: DOPL_SAFE_TOOLS.map(shortDoplName).concat([channelShort]),
    };
  }

  // full: pre-approve only local reads; the dangerous subset is HARD-DENIED
  // (SESSION_HARD_DENY), and only the visible + reversible work tools (Bash / Write /
  // Edit / NotebookEdit / MultiEdit / WebFetch / non-admin dopl reads) plus the
  // op-scoped dopl_channel reach canUseTool and await an operator button.
  return {
    builtinTools: [],
    preApproved: READ_BUILTINS.slice(),
    disallowedTools: SESSION_HARD_DENY.slice(),
    doplToolsPolicy: null,
  };
}

// FIX H1 — is this dopl_channel call a plain delivery post into the session's OWN
// channel? Only that is auto-allowed without a button. `op==='post'` AND the target
// channel is either unset or exactly the session's channelId. Any other op — open,
// invite, a cross-channel post, create_task, close_task, set_task_mode — is NOT an
// own-channel post and therefore gates. (`channel` may be a slug or id; we compare
// against the id only, so a slug-addressed post safely gates rather than silently
// auto-allowing — gating is the safe failure.)
function isOwnChannelPost(input, sessionChannelId) {
  const i = input || {};
  if (i.op !== 'post') return false;
  const target = i.channel;
  if (target == null || target === '') return true; // no explicit target -> own channel
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// The per-call decision the engine's canUseTool bridge makes. Returns one of:
//   'preapproved' — auto-allow with NO button (a profile pre-approved tool that is
//                   ALSO shadowed via allowedTools, OR an own-channel dopl_channel
//                   post that is op-scoped here, FIX H1).
//   'deny'        — hard-denied by the profile (checked FIRST so a denied tool can
//                   never be opened, not even via allowForTask).
//   'allow'       — the operator granted this tool for the whole task (engine Set).
//   'gate'        — surface Allow-once / Allow-for-task / Deny buttons and await.
// `input` + `channelId` are threaded in so the channel tool can be op-scoped.
function grantDecision(args) {
  const a = args || {};
  const allowForTask = a.allowForTask || [];
  const cfg = buildSessionToolConfig(a.profile);
  if (cfg.disallowedTools.indexOf(a.toolName) !== -1) return 'deny';
  if (a.toolName === DOPL_CHANNEL_TOOL) {
    if (isOwnChannelPost(a.input, a.channelId)) return 'preapproved';
    if (allowForTask.indexOf(a.toolName) !== -1) return 'allow';
    return 'gate';
  }
  if (cfg.preApproved.indexOf(a.toolName) !== -1) return 'preapproved';
  if (allowForTask.indexOf(a.toolName) !== -1) return 'allow';
  return 'gate';
}

// ─── END SESSION-PROFILE TABLE ───

module.exports = {
  buildSessionToolConfig,
  grantDecision,
  isOwnChannelPost,
  shortDoplName,
};
