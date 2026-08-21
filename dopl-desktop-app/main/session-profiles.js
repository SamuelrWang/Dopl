// SESSION-mode tool grant table. Profile -> SDK-option pieces:
//   { builtinTools, disallowedTools, preApproved, doplToolsPolicy }
// Session analog of tool-profiles.js HEADLESS containment. Headless has no TTY (pre-approve a
// fixed safe set only); a session has live canUseTool buttons, so dangerous tools LIVE-GATE.
//
// ⚠ SHADOW GOTCHA: a tool in the SDK's `allowedTools` SHADOWS canUseTool — auto-approved before
// any button appears. `preApproved` (== allowedTools) may hold ONLY silent-grant tools; a
// live-gated tool must NEVER appear there.
//
// TWO AXES, because an outbound message is technically a tool call (`dopl_channel op=post`) on
// the same canUseTool plumbing as Bash:
//   AXIS A (toolMode)    manual | accept_edits | auto | bypass — what MY agent may do here.
//   AXIS B (messageMode) ask | auto_inbound | auto_outbound | auto_both — what crosses.
// ⚠ INVARIANT: Axis A can NEVER auto-approve a message op; Axis B can NEVER auto-approve a work
// tool. grantDecision branches the channel tool to Axis B BEFORE any Axis A mode is consulted,
// and no other tool reads messageMode.
//
// ⚠ Modes resolved HERE, never via the SDK's `permissionMode`: bypassPermissions stops the SDK
// calling canUseTool at all, killing the outbound message card and the hard-deny path.
// buildSdkOptions keeps `permissionMode: 'default'` + `settingSources: []` pinned.
//
// PURE module (no electron/fs/path/SDK). test/session-profiles + test/sdk-grant slice the block
// below and inject the tool-profiles constants, normalizeProfile, shaKey and the two
// mcp-tool-names normalizers as parameters.

const { makeGateReason, GATE_REASONS } = require('./session-gate-reason');
const { makeGrantKeyFor, POST_GRANT, postFieldsOk } = require('./session-grant-keys');
// Client-agnostic tool-name normalizer the whole table matches through.
const { mcpShortName, canonicalDoplName } = require('./mcp-tool-names');
const {
  READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS, UNIVERSAL_HARD_DENY,
  // Retired tools: denied everywhere, so unregistering cannot loosen a hard-deny.
  RETIRED_DOPL_TOOLS,
  // ⚠ DOPL_SERVER_PREFIX deliberately NOT read here — it names ONE server (ours), and this
  // table must not compare a client-supplied tool name against it. mcp-tool-names.js consumes
  // it, as the canonical form to normalize ONTO.
  DOPL_CHANNEL_TOOL, normalizeProfile,
} = require('./tool-profiles');

// ─── BEGIN SESSION-PROFILE TABLE (extracted by session-profiles/sdk-grant tests) ───

// The dopl server registers tools bare (`dopl_channel`); the CLI exposes them as
// `mcp__dopl__<tool>`. Per-server MCP `tools` policy uses the bare server-local name.
function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// ⚠ THE SERVER PREFIX IS THE CLIENT'S, NOT OURS. Match through `mcpShortName` /
// `canonicalDoplName` (mcp-tool-names.js), never the literal `mcp__dopl__` our own registration
// produces: the same tool arrives as `mcp__claude_ai_Dopl__…` or `mcp__<uuid>__…` and would miss
// EVERY list at once — Axis B, pre-approvals, both Axis-A modes, hard-deny. Injected by the
// extraction tests.

// `full`'s hard-deny IS the universal floor and nothing else. `full` means full; the SUPERVISION
// is Axis A (manual / accept_edits / auto / bypass), not this constant. Safe because every name
// here is in NEITHER AUTO_TOOLS NOR BYPASS_TOOLS — both POSITIVE allow-lists — so all gate in
// EVERY mode incl. `bypass`, and none is pre-approved, so none is shadowed past canUseTool.
// read_only / dopl_only keep the whole of DENIED_BUILTINS and gain nothing.
const SESSION_HARD_DENY = UNIVERSAL_HARD_DENY.slice();

// ⚠ DOPL_SAFE_TOOLS is "non-admin", NOT "read-only". These four WRITE to the shared workspace
// (dopl_kb registers write_file / create_base / create_folder / move_file — packages/mcp-server
// knowledge.ts; dopl_skill / dopl_ontology / dopl_chats carry the same create+update shape). A
// write lands OFF this machine in rows every member reads — exfil, same class as an outbound
// post, so never silent. Split out so `auto` GATES them (only `bypass` covers them) and
// `dopl_only` stops SHADOWING them via allowedTools. Read half derived by subtraction; this list
// must stay a SUBSET of DOPL_SAFE_TOOLS — session-permission-hardening.test.mjs partition test.
const DOPL_WRITE_TOOLS = ['mcp__dopl__dopl_kb', 'mcp__dopl__dopl_skill',
  'mcp__dopl__dopl_ontology', 'mcp__dopl__dopl_chats'];
const DOPL_READ_TOOLS = DOPL_SAFE_TOOLS
  .filter(function (t) { return DOPL_WRITE_TOOLS.indexOf(t) === -1; });

// SESSION grant config for a profile. `preApproved` -> SDK allowedTools (shadowed, no button).
// `builtinTools` -> SDK tools (POSITIVE bound; [] = no bound). `disallowedTools` -> SDK
// disallowedTools (hard-denied, never offered). `doplToolsPolicy` -> dopl MCP server's
// per-server `tools` allowlist (null => all dopl tools reachable).
//
// ⚠ `dopl_channel` is in NEITHER preApproved NOR disallowedTools on ANY profile, so it REACHES
// the gate where grantDecision op-scopes it. It stays in each restricted profile's
// `doplToolsPolicy` (defense in depth).
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
      preApproved: READ_BUILTINS.concat(WEB_TOOLS, DOPL_READ_TOOLS),
      disallowedTools: DENIED_BUILTINS.concat(DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS),
      doplToolsPolicy: DOPL_SAFE_TOOLS.map(shortDoplName).concat([channelShort]),
    };
  }

  // full: pre-approve local reads only; hard-deny ONLY the universal floor. Everything else —
  // work tools, delegation, outbound, persistence, escalation, op-scoped dopl_channel —
  // reaches canUseTool.
  return {
    builtinTools: [],
    preApproved: READ_BUILTINS.slice(),
    disallowedTools: SESSION_HARD_DENY.slice(),
    doplToolsPolicy: null,
  };
}

// ⚠ Match the channel tool by SHORT NAME UNDER ANY SERVER, never one literal: `dopl_channel`
// or a `dopl_channel_` version/variant prefix, bare form accepted too. A miss here drops a
// message op into AXIS A, and a TOOL posture answering a MESSAGE op is the one inversion the
// contract forbids. Over-matching is the SAFE direction: Axis B gates everything but an
// own-channel post/read/marker, and hard-deny is checked BEFORE this branch, so a
// mis-classified tool asks rather than runs.
const CHANNEL_SHORT_NAME = shortDoplName(DOPL_CHANNEL_TOOL);
function isChannelTool(toolName) {
  const short = mcpShortName(typeof toolName === 'string' ? toolName : '');
  return short === CHANNEL_SHORT_NAME || short.indexOf(CHANNEL_SHORT_NAME + '_') === 0;
}

// Plain delivery post into the session's OWN channel? `op==='post'` AND target channel unset or
// exactly the session's channelId. (`channel` may be a slug or id; compared against the id
// only, so a slug-addressed post classifies as cross-channel — the safe failure.) Does NOT
// auto-allow: it only decides which grant KEY a post belongs to.
function isOwnChannelPost(input, sessionChannelId) {
  const i = input || {};
  if (i.op !== 'post') return false;
  const target = i.channel;
  if (target == null || target === '') return true; // no explicit target -> own channel
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// READ HALF OF THE OWN CHANNEL (Axis B inbound). Read-only ops scoped to the channel this
// session is already bound to: nothing writes, addresses anyone, or reaches an unopened channel.
// `await` is the same read long-polled — gating it gates waiting itself. `members` is a roster
// the session's prompt framing already carries.
// ⚠ `list` is read-only but is NOT here: it enumerates EVERY channel and DM this account can
// reach, so it is not own-channel-scoped. `open`, `invite`, `create_thread`, `set_thread_mode`
// and every post stay gated in every posture. (`close_thread` was named here too and left the
// tool's enum with thread closing — wiring plan Phase 4, 2026-08-18.)
const OWN_CHANNEL_READ_OPS = ['read', 'await', 'list_threads', 'get_thread', 'members'];

// Read twin of isOwnChannelPost, SAME scoping rule and safe failure: a `channel` naming
// anything but this session's id (slug included) is ANOTHER channel and gates.
function isOwnChannelRead(input, sessionChannelId) {
  const i = input || {};
  if (OWN_CHANNEL_READ_OPS.indexOf(i.op) === -1) return false;
  const target = i.channel;
  if (target == null || target === '') return true;
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// OWN-CHANNEL MARKERS (Axis B outbound). STRICTLY LESS POWERFUL than the own-channel `post`
// that `auto_outbound` already auto-allows, into the same channel from the same session:
//   milestone      one-line marker, addresses nobody, no deliverable; prompt-framing INSTRUCTS
//                  the agent to log them.
// ⚠ `propose_close` WAS THE OTHER MEMBER and is gone with thread closing (wiring plan Phase 4,
// 2026-08-18) — the op left the MCP enum entirely. The rule that admitted it is what to keep:
// a marker earns the outbound half by SAYING LESS than the post already auto-allowed beside
// it. Anything that settles shared state never qualified — `close_thread` was deliberately
// never on this list for exactly that reason. ⚠ Dropping a name from this ALLOW list makes the
// op gate, which is the safe direction; nothing here is a deny list.
const OWN_CHANNEL_MARKER_OPS = ['milestone'];

// Outbound twin of isOwnChannelRead, SAME footing as isOwnChannelPost: scoped by CHANNEL only.
// The THREAD is deliberately not scoped — the gate gets channelId, not taskId; a wrong thread
// id costs a confirm prompt inside a channel the operator is already bound to (F-139).
function isOwnChannelMarker(input, sessionChannelId) {
  const i = input || {};
  if (OWN_CHANNEL_MARKER_OPS.indexOf(i.op) === -1) return false;
  const target = i.channel;
  if (target == null || target === '') return true;
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// The accept_edits set (contract A2). Named HERE because Axis A and the grant key both read it.
const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

// ⚠ Grant-key machinery (session-grant-keys.js) is BOUND with THIS table's own classifiers, so
// a key can never disagree with the branch decision about the same call.
const grantKeyFor = makeGrantKeyFor({ isChannelTool, isOwnChannelPost, EDIT_TOOLS });

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

// ── AXIS B: MESSAGE FLOW (what crosses between machines) ──────────────────────────
// Per-session, starts `ask`, resets to `ask` on park. INBOUND half enforced at the inbound gate
// (session-gate.autoInbound / reducer's inboundAutoAccepted); OUTBOUND half enforced here, ONLY
// for a post into the session's OWN channel. Cross-channel post, `op=open direct:true`, invite,
// create_task always gate — that is the cross-user exfil surface.
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

// ⚠ THE WINDOWLESS FLOOR — THE ONE STATEMENT OF IT (2026-08-20, F-236).
//
// A WINDOWLESS session has NO ACCEPT SURFACE. `session-gate.js › enqueue` holds an inbound
// reply whenever `autoInbound(s)` is false, and the whole accept family that used to release
// one — `decideInbound`, `drainQueue`, `drainInbound` — went with the session window (F-228).
// So on a windowless session a HELD reply is held FOREVER: the session parks at
// `awaiting_inbound`, `io.noteGatedBody` records the body (which session-seed and
// session-history both filter out), and the peer's message becomes invisible to the agent
// permanently. That is the AUDIT D2 failure `session-gate.js` was written to prevent,
// reachable from the other end.
//
// So the IN half is FLOORED at auto. This raises the inbound half and NEVER touches the
// outbound one:
//     ask            -> auto_inbound     (in: floored; out: still asks)
//     auto_outbound  -> auto_both        (in: floored; out: unchanged, still auto)
//     auto_inbound   -> auto_inbound
//     auto_both      -> auto_both
//
// ⚠ IT WIDENS SUPERVISION, NEVER CONTAINMENT. Axis B decides whether a MESSAGE crosses, never
// what a tool may do; the profile is checked first and no message posture can widen it
// (`grantDecision` returns off Axis B before Axis A is consulted). Floored or not, an agent
// cannot post out without the outbound gate.
//
// ⚠ AND IT IS A FLOOR, NOT A DEFAULT. `channel-prefs.js › windowlessMessageMode` applies the
// same rule at LAUNCH; this is the same rule for a mode set on a session ALREADY RUNNING. The
// two are pinned against each other by `test/session-mode-floor.test.mjs` — two spellings of
// one floor is how one lane starts holding messages the other lane releases.
function floorWindowlessMessage(mode) {
  const m = normalizeMessageMode(mode);
  if (m === 'auto_inbound' || m === 'auto_both') return m;
  return m === 'auto_outbound' ? 'auto_both' : 'auto_inbound';
}

// Per-call decision the engine's canUseTool bridge makes:
//   'preapproved' — auto-allow, NO button (profile pre-approved AND shadowed via allowedTools).
//                   NEVER the channel tool.
//   'deny'        — hard-denied by the profile; checked FIRST, unopenable even via allowForTask.
//   'allow'       — operator granted this tool for the whole task.
//   'gate'        — surface Allow-once / Allow-for-task / Deny and await.
// `input` + `channelId` thread in so the channel tool can be op-scoped; absent toolMode /
// messageMode => most restrictive member of each axis.
// ⚠ ORDER IS THE CONTRACT: hard-deny -> Axis-B channel branch -> preapproved -> scoped standing
// grant -> Axis-A mode -> gate.
function grantDecision(args) {
  const a = args || {};
  const allowForTask = a.allowForTask || [];
  const cfg = buildSessionToolConfig(a.profile);
  // 0. Name canonicalized ONCE, so hard-deny, pre-approval and the Axis-A modes can never
  //    disagree about which server a tool came from. Non-Dopl names returned untouched. The
  //    GRANT KEY below deliberately keeps the RAW name — a grant is scoped to the shape the
  //    operator was shown, server included.
  const name = canonicalDoplName(a.toolName);
  // 1. HARD DENY, on the canonical name. A deny list a different server prefix walks past is
  //    not a deny list. Not openable by a task grant nor by `bypass` — which is why `bypass`
  //    is not permissionMode:bypass.
  if (cfg.disallowedTools.indexOf(name) !== -1) return 'deny';
  // 2. ⚠ THE INVARIANT — a message op branches to AXIS B here and NEVER reaches Axis A below.
  //    No tool posture, `bypass` included, can send a message.
  if (isChannelTool(a.toolName)) {
    // Fail-closed: a post whose `to` or `kind` is not a string is malformed — neither the key
    // nor the card can honestly describe it.
    if (!postFieldsOk(a.input)) return 'gate';
    // ⚠ ONLY a standing grant for THIS EXACT shape allows without a button. No bare-tool-name
    // fallback: that turns one channel grant (even on op=read) into a grant for op=open.
    if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1) return 'allow';
    // auto_outbound / auto_both: ONLY an own-channel post — everything else is the exfil
    // surface and gates.
    if (autoOutboundMode(a.messageMode) && isOwnChannelPost(a.input, a.channelId)) return 'allow';
    // Own-channel thread markers, same outbound half (OWN_CHANNEL_MARKER_OPS).
    if (autoOutboundMode(a.messageMode) && isOwnChannelMarker(a.input, a.channelId)) return 'allow';
    // Own-channel READ follows the INBOUND half: a read sends nothing, it brings the peer's
    // words into context unseen — what auto_inbound consents to. `auto_outbound` alone does
    // NOT cover it.
    if (autoInboundMode(a.messageMode) && isOwnChannelRead(a.input, a.channelId)) return 'allow';
    return 'gate';
  }
  if (cfg.preApproved.indexOf(name) !== -1) return 'preapproved';
  // 3. Scoped standing grant: keyed on the SHAPE the operator saw, so RAW name here.
  if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1) return 'allow';
  // 4. AXIS A. Message flow never consulted here — the other half of the invariant.
  if (toolModeAllows(a.toolMode, name)) return 'allow';
  return 'gate';
}

// ─── END SESSION-PROFILE TABLE ───

// ⚠ Built OUTSIDE the extracted table so the block stays self-contained and grantDecision's
// shape/ordering is byte-unchanged: an explanation must not be able to move a gate. Handed THIS
// table's own predicates, so the explainer can never classify differently from the gate.
const gateReason = makeGateReason({
  isChannelTool, isOwnChannelPost, isOwnChannelRead, postFieldsOk, grantKeyFor,
  OWN_CHANNEL_READ_OPS, BYPASS_TOOLS, normalizeToolMode,
  canonicalDoplName, isOwnChannelMarker, OWN_CHANNEL_MARKER_OPS,
});
// { decision, reason } — reason is a GATE_REASONS code, or null for a verdict nothing can
// honestly explain.
function grantDecisionDetail(args) {
  const decision = grantDecision(args);
  return { decision, reason: gateReason(args, decision) };
}

module.exports = {
  buildSessionToolConfig, grantDecision, shortDoplName, isOwnChannelPost,
  isOwnChannelRead, OWN_CHANNEL_READ_OPS, // own-channel READ set, Axis B inbound half
  isOwnChannelMarker, OWN_CHANNEL_MARKER_OPS, // own-channel MARKER set, Axis B outbound half
  mcpShortName, canonicalDoplName, // re-exported from mcp-tool-names
  grantDecisionDetail, GATE_REASONS,
  BYPASS_READS, // NAMED read-only tools `bypass` covers on top of the classified work set
  grantKeyFor, // scoped allowForTask key for EVERY tool class
  POST_GRANT, // own-channel post BASE; a real key extends it (to/kind/body segments)
  isChannelTool, // session-io uses it too
  // ⚠ The two axes: renderer/preload hold their own COPIES of these lists (a sandboxed
  // renderer cannot require main) — test/session-permission-axes pins all four surfaces
  // against each other. Change here => change there.
  TOOL_MODES, MESSAGE_MODES, EDIT_TOOLS, ESCALATION_TOOLS,
  AUTO_TOOLS, BYPASS_TOOLS, DOPL_READ_TOOLS, DOPL_WRITE_TOOLS,
  normalizeToolMode, normalizeMessageMode, toolModeAllows, autoInboundMode,
  floorWindowlessMessage, // AXIS B's windowless floor — one statement, two lanes (F-236)
};
