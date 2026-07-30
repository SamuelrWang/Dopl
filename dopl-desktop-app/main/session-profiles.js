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
//     op=post the contents with ZERO clicks (silent cross-user exfiltration). It
//     reaches the gate instead, and grantDecision is op-scoped there.
//   v2.5 D2 — the last silent case is gone: an own-channel op=post no longer resolves
//     'preapproved' either. EVERY dopl_channel call now gates, so no message leaves
//     this machine without an operator click (or the explicit per-session auto-approve
//     toggle). The task grant a post can earn is narrowed to POST_GRANT below.
//   FIX F2 — and EVERY dopl_channel grant is now op-scoped, with no bare-tool-name
//     fallback: a grant taken on op=read / op=list can no longer authorize op=post or
//     op=open for the rest of the task (see grantKeyFor / grantDecision).
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
// channel? `op==='post'` AND the target channel is either unset or exactly the
// session's channelId. Any other op — open, invite, a cross-channel post,
// create_task, close_task, set_task_mode — is NOT an own-channel post. (`channel`
// may be a slug or id; we compare against the id only, so a slug-addressed post is
// classified as cross-channel rather than as an own-channel post — the safe failure.)
// v2.5 D2: this no longer AUTO-ALLOWS. It now only decides which grant KEY a post
// belongs to (below); every post still reaches the operator's dock.
function isOwnChannelPost(input, sessionChannelId) {
  const i = input || {};
  if (i.op !== 'post') return false;
  const target = i.channel;
  if (target == null || target === '') return true; // no explicit target -> own channel
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// v2.5 D2 — THE OUTBOUND GATE (a deliberate reversal of the v1.9 shadow rule for
// posts). An own-channel op=post used to resolve 'preapproved' — the agent's message
// left this machine with no operator click. It is the most consequential thing a
// session does, so it now GATES like every other write: the dock shows the drafted
// body and the operator picks Allow once / Allow for this task / Deny.
//
// EVERY dopl_channel grant is OP-SCOPED (FIX F2). The narrow POST_GRANT existed, but a
// grant taken on any other op recorded the BARE tool name and grantDecision honored the
// bare name for ANY op — so an agent whose first channel call was op=read (or a
// slug-addressed post, classified cross-channel) produced a dock entry with no drafted
// body, and one "Allow for this task" click silently authorized every channel op for the
// rest of the task, op=open direct:true included. That is exactly the cross-user exfil
// path FIX H1 closed. Now each op earns its own key and nothing honors the bare name.
const POST_GRANT = DOPL_CHANNEL_TOOL + '#post'; // op=post into the session's OWN channel
const OP_PREFIX = '#op:'; // every other shape lives in a DISJOINT namespace
const OP_CAP = 32;
const TARGET_CAP = 40;

// A bounded, collision-free token for a model-supplied string. Sanitizing alone would let
// 'post ' collapse onto POST_GRANT, which is why non-own-post keys carry OP_PREFIX.
function keyToken(value, cap) {
  const t = String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return t.slice(0, cap) || 'unknown';
}

// The allowForTask KEY a call belongs to. Own-channel posts get POST_GRANT; every other
// dopl_channel call gets `#op:<op>`, and a CROSS-channel post additionally carries its
// target, so a grant to post into one other channel cannot post into a different one.
// Anything that is not the channel tool keeps its own tool name (unchanged). The engine
// stores exactly this string when the operator picks "Allow for this task"
// (session-io -> the reducer's allowForTask).
function grantKeyFor(toolName, input, channelId) {
  if (toolName !== DOPL_CHANNEL_TOOL) return toolName;
  if (isOwnChannelPost(input, channelId)) return POST_GRANT;
  const i = input || {};
  const op = keyToken(i.op, OP_CAP);
  if (op === 'post') return DOPL_CHANNEL_TOOL + OP_PREFIX + 'post:' + keyToken(i.channel, TARGET_CAP);
  return DOPL_CHANNEL_TOOL + OP_PREFIX + op;
}

// The per-call decision the engine's canUseTool bridge makes. Returns one of:
//   'preapproved' — auto-allow with NO button (a profile pre-approved tool that is
//                   ALSO shadowed via allowedTools). NEVER dopl_channel (FIX H1 kept
//                   it out of allowedTools; D2 removed its own-channel post case).
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
    // ONLY a standing grant for THIS EXACT shape allows without a button. FIX F2 deleted
    // the bare-tool-name fallback that used to sit here: it turned any one channel grant
    // (even one taken on op=read) into a grant for every op, op=open included. Grants are
    // never persisted, so there is nothing to migrate.
    return allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1 ? 'allow' : 'gate';
  }
  if (cfg.preApproved.indexOf(a.toolName) !== -1) return 'preapproved';
  if (allowForTask.indexOf(a.toolName) !== -1) return 'allow';
  return 'gate';
}

// ─── END SESSION-PROFILE TABLE ───

module.exports = {
  buildSessionToolConfig,
  grantDecision,
  grantKeyFor, // v2.5 D2: the scoped allowForTask key (own-channel posts vs the tool)
  POST_GRANT,
  isOwnChannelPost,
  shortDoplName,
};
