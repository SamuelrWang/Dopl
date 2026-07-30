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
// v2.9 — TWO AXES. One "Auto-approve" switch used to control two unrelated things,
// because an outbound message is technically a tool call (`dopl_channel op=post`) and
// rides the same canUseTool plumbing as Bash (HIGH-4). They are split now:
//   AXIS A (toolMode)    manual | accept_edits | auto | bypass — what MY agent may do
//                        on THIS machine.
//   AXIS B (messageMode) ask | auto_inbound | auto_outbound | auto_both — what crosses
//                        between machines.
// THE INVARIANT: Axis A can NEVER auto-approve a message operation and Axis B can NEVER
// auto-approve a work tool. `dopl_channel` branches to Axis B in grantDecision BEFORE any
// Axis A mode is consulted, and no other tool ever reads messageMode.
//
// The modes are resolved HERE, never via the SDK's `permissionMode`: bypassPermissions
// stops the SDK calling canUseTool at all, which would silently kill the outbound message
// card (the same fusion, a new mechanism) and drop the hard-deny enforcement path.
// buildSdkOptions keeps `permissionMode: 'default'` + `settingSources: []` pinned.
//
// PURE module: requires the (pure) tool-profiles constants + node's `crypto`, used ONLY
// to digest a grant key (no key material, no randomness). The extracted block references
// those constants + normalizeProfile + sha12, which test/session-profiles and
// test/sdk-grant inject as parameters when they evaluate the sliced block (the same
// source-extraction idiom as tool-profiles, kept electron/fs/path/SDK-free).

const crypto = require('crypto');
const {
  READ_BUILTINS,
  WEB_TOOLS,
  DOPL_SAFE_TOOLS,
  DENIED_BUILTINS,
  DOPL_ADMIN_TOOLS,
  DOPL_CHANNEL_TOOL,
  normalizeProfile,
} = require('./tool-profiles');

// The 12-hex-char SHA-256 prefix every scoped grant key carries (48 bits). A model
// cannot search for a collision at that width, and the key stays short enough to read
// in a diag line. Defined OUTSIDE the extracted block, like the tool-profiles constants.
function sha12(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex').slice(0, 12);
}

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
const ARGV_CAP = 24;
const SCOPE_CAP = 60;

// A bounded, collision-free token for a model-supplied string. Sanitizing alone would let
// 'post ' collapse onto POST_GRANT, which is why non-own-post keys carry OP_PREFIX.
function keyToken(value, cap) {
  const t = String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return t.slice(0, cap) || 'unknown';
}

// A key segment that VANISHES when the field is absent. This is what keeps the plain
// reply's key byte-identical to POST_GRANT while an addressed / lifecycle-kinded post
// gets its own (MEDIUM-2 below).
function optSegment(prefix, value, cap) {
  return value == null || value === '' ? '' : prefix + keyToken(value, cap);
}

// MEDIUM-2 — fold `to` and `kind` into the post key. `to` addresses ONE channel member
// and `kind` turns a chat message into a structured lifecycle event, so one approved
// reply must not also authorize a post aimed at a different member or a forged
// `task_finished`. `to` is digested (an email sanitizes down to a colliding token);
// `kind` is a closed enum, and its DEFAULT ('message', or absent) adds no segment at all,
// so today's plain reply keeps the exact POST_GRANT key.
function postScope(base, i) {
  const to = i.to == null || i.to === '' ? '' : '#to:' + sha12(String(i.to).trim().toLowerCase());
  const kind = i.kind == null || i.kind === '' || i.kind === 'message' ? '' : optSegment('#kind:', i.kind, OP_CAP);
  return base + to + kind;
}

// ── HIGH-1: EVERY tool is scoped, not just the channel ────────────────────────────
// `grantKeyFor` used to op-scope ONLY dopl_channel and record the BARE NAME for
// everything else, so one "Allow for this task" on `Bash("ls -la")` silently authorized
// every later Bash for the rest of the task — including one the counterparty's message
// text steered the agent into proposing. Each class now earns a key for the SHAPE the
// operator actually saw. Keys are in-memory, per-session, cleared on park, never persisted.
const WEB_SCOPED = WEB_TOOLS.slice(); // WebFetch / WebSearch -> scoped by ORIGIN
const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit']; // the accept_edits set (contract A2)

// `Bash#<argv0>#<sha12(command)>`: argv0 is the readable half (which program), the digest
// pins the exact command line, so `ls -la` never authorizes `rm -rf`.
function bashKey(name, i) {
  const cmd = i.command == null ? '' : String(i.command);
  return name + '#' + keyToken(cmd.trim().split(/\s+/)[0], ARGV_CAP) + '#' + sha12(cmd);
}

// scheme://host, lowercased. No url (a WebSearch, or a malformed one) -> '' and the caller
// falls back to the input hash, which is STRICTER than granting every search at once.
function originOf(url) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(String(url == null ? '' : url).trim());
  return m ? (m[1] + '://' + m[2]).toLowerCase() : '';
}

// The resolved directory of a write. Both tools take an ABSOLUTE path (the SDK's own
// contract), so the parent of the last '/' is the resolved dir; a relative or bare path
// yields '' and falls back to the input hash.
function dirOf(p) {
  const s = String(p == null ? '' : p).trim().replace(/\/+$/, '');
  const cut = s.lastIndexOf('/');
  if (cut < 0) return '';
  return cut === 0 ? '/' : s.slice(0, cut);
}

// A stable stringify (sorted keys, depth-bounded) so the same input always digests to the
// same key regardless of property order, and a pathological input cannot recurse forever.
function stableStringify(value, depth) {
  const d = depth || 0;
  if (d > 6 || value === undefined || typeof value === 'function') return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(function (v) { return stableStringify(v, d + 1); }).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + stableStringify(value[k], d + 1); }).join(',') + '}';
}

// The allowForTask KEY a call belongs to. Own-channel posts get POST_GRANT (+ the MEDIUM-2
// to/kind segments); every other dopl_channel call gets `#op:<op>`, and a CROSS-channel post
// additionally carries its target, so a grant to post into one other channel cannot post
// into a different one. Every OTHER tool is scoped by the shape that was shown: Bash by
// argv0 + command digest, WebFetch/WebSearch by origin, Write/Edit/NotebookEdit by resolved
// directory, anything else by a digest of its whole input. The engine stores exactly this
// string when the operator picks "Allow for this task" (session-io -> reducer allowForTask).
function grantKeyFor(toolName, input, channelId) {
  const i = input || {};
  if (toolName === DOPL_CHANNEL_TOOL) {
    if (isOwnChannelPost(input, channelId)) return postScope(POST_GRANT, i);
    const op = keyToken(i.op, OP_CAP);
    if (op === 'post') return postScope(DOPL_CHANNEL_TOOL + OP_PREFIX + 'post:' + keyToken(i.channel, TARGET_CAP), i);
    return DOPL_CHANNEL_TOOL + OP_PREFIX + op;
  }
  if (toolName === 'Bash') return bashKey(toolName, i);
  if (WEB_SCOPED.indexOf(toolName) !== -1) {
    const origin = originOf(i.url);
    if (origin) return toolName + '#' + keyToken(origin, SCOPE_CAP) + '#' + sha12(origin);
  }
  if (EDIT_TOOLS.indexOf(toolName) !== -1) {
    const dir = dirOf(i.file_path != null ? i.file_path : i.notebook_path);
    if (dir) return toolName + '#' + keyToken(dir.split('/').slice(-2).join('/'), SCOPE_CAP) + '#' + sha12(dir);
  }
  return String(toolName) + '#' + sha12(stableStringify(input));
}

// ── AXIS A: TOOL PERMISSIONS (what MY agent may do on THIS machine) ───────────────
// Per-session, never persisted, always starts `manual`, RESET to `manual` on park (the
// v2.3 FIX #3 rule extended: an abandoned session must never resume pre-authorized).
const TOOL_MODES = ['manual', 'accept_edits', 'auto', 'bypass'];
// ESCALATION-SHAPED ops that `auto` still asks about, and the reason `auto` is not
// `bypass`: these reach the SHELL or the NETWORK, and the counterparty's message text
// steers what the agent proposes, so a hands-off tool posture must still stop here.
// `bypass` covers them; NOTHING covers the hard-deny set.
const ESCALATION_TOOLS = ['Bash', 'WebFetch', 'WebSearch'];

function normalizeToolMode(mode) {
  return TOOL_MODES.indexOf(mode) === -1 ? 'manual' : mode; // fail-closed
}

// Does Axis A auto-allow this tool? MultiEdit is deliberately NOT in the accept_edits set
// (contract A2 names exactly Write / Edit / NotebookEdit) — the restrictive reading.
function toolModeAllows(mode, toolName) {
  const m = normalizeToolMode(mode);
  if (m === 'manual') return false;
  if (m === 'accept_edits') return EDIT_TOOLS.indexOf(toolName) !== -1;
  if (m === 'auto') return ESCALATION_TOOLS.indexOf(toolName) === -1;
  return true; // bypass — every work tool, but never the hard-deny set (checked first)
}

// ── AXIS B: MESSAGE FLOW (what crosses between machines) ──────────────────────────
// Per-session, starts `ask`, resets to `ask` on park. The INBOUND half is enforced at the
// inbound gate (session-gate.autoInbound / the reducer's inboundAutoAccepted); the OUTBOUND
// half is enforced here, and ONLY for a post into the session's OWN channel. A
// cross-channel post, `op=open direct:true`, invite, create_task and friends always gate:
// they are the cross-user exfil surface v1.9 FIX H1 closed, and "send my replies for me"
// is not consent to open a DM with another workspace member.
const MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

function normalizeMessageMode(mode) {
  return MESSAGE_MODES.indexOf(mode) === -1 ? 'ask' : mode; // fail-closed
}
function autoInboundMode(mode) {
  const m = normalizeMessageMode(mode);
  return m === 'auto_inbound' || m === 'auto_both';
}
function autoOutboundMode(mode) {
  const m = normalizeMessageMode(mode);
  return m === 'auto_outbound' || m === 'auto_both';
}

// The per-call decision the engine's canUseTool bridge makes. Returns one of:
//   'preapproved' — auto-allow with NO button (a profile pre-approved tool that is
//                   ALSO shadowed via allowedTools). NEVER dopl_channel (FIX H1 kept
//                   it out of allowedTools; D2 removed its own-channel post case).
//   'deny'        — hard-denied by the profile (checked FIRST so a denied tool can
//                   never be opened, not even via allowForTask).
//   'allow'       — the operator granted this tool for the whole task (engine Set).
//   'gate'        — surface Allow-once / Allow-for-task / Deny buttons and await.
// `input` + `channelId` are threaded in so the channel tool can be op-scoped; `toolMode`
// (Axis A) and `messageMode` (Axis B) are the per-session postures, absent => the most
// restrictive member of each axis.
//
// ORDER (v2.9, unchanged at the top): hard-deny FIRST and immovable in EVERY mode,
// bypass included -> the Axis-B branch for the channel tool -> preapproved -> the scoped
// standing grant -> the Axis-A mode -> gate.
function grantDecision(args) {
  const a = args || {};
  const allowForTask = a.allowForTask || [];
  const cfg = buildSessionToolConfig(a.profile);
  // 1. HARD DENY. Checked first so a denied tool can never be opened — not by a task
  //    grant, and not by `bypass` (which is why `bypass` is not permissionMode:bypass).
  if (cfg.disallowedTools.indexOf(a.toolName) !== -1) return 'deny';
  // 2. THE INVARIANT — a message operation branches to AXIS B here and NEVER reaches the
  //    Axis A mode below. No tool posture, `bypass` included, can send a message.
  if (a.toolName === DOPL_CHANNEL_TOOL) {
    // ONLY a standing grant for THIS EXACT shape allows without a button. FIX F2 deleted
    // the bare-tool-name fallback that used to sit here: it turned any one channel grant
    // (even one taken on op=read) into a grant for every op, op=open included. Grants are
    // never persisted, so there is nothing to migrate.
    if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1) return 'allow';
    // auto_outbound / auto_both send the agent's own replies with no click. ONLY an
    // own-channel post: everything else on this tool is the exfil surface, so it gates.
    if (autoOutboundMode(a.messageMode) && isOwnChannelPost(a.input, a.channelId)) return 'allow';
    return 'gate';
  }
  if (cfg.preApproved.indexOf(a.toolName) !== -1) return 'preapproved';
  // 3. THE SCOPED standing grant (HIGH-1): the key covers the SHAPE the operator saw.
  if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1) return 'allow';
  // 4. AXIS A. Message flow is never consulted here, so no message posture can run a
  //    work tool — the other half of the invariant.
  if (toolModeAllows(a.toolMode, a.toolName)) return 'allow';
  return 'gate';
}

// ─── END SESSION-PROFILE TABLE ───

module.exports = {
  buildSessionToolConfig,
  grantDecision,
  grantKeyFor, // v2.9 HIGH-1: the scoped allowForTask key for EVERY tool class
  POST_GRANT,
  isOwnChannelPost,
  shortDoplName,
  // v2.9 the two axes (the renderer/preload hold their own copies of these lists —
  // a sandboxed renderer cannot require main — and test/session-permission-axes pins
  // all four surfaces against each other).
  TOOL_MODES,
  MESSAGE_MODES,
  EDIT_TOOLS,
  ESCALATION_TOOLS,
  normalizeToolMode,
  normalizeMessageMode,
  toolModeAllows,
  autoInboundMode,
  autoOutboundMode,
};
