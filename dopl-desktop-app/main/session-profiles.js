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
// OP-SCOPED KNOWLEDGE READS (2026-08-22, OQ-1). Injected into the extracted table by the two
// harness tests, like `normalizeProfile`. The whole argument lives in that module's header.
const { isKnowledgeReadCall } = require('./knowledge-ops');
// THE OWN-CHANNEL OUTBOUND OPS BESIDE THE POST — `milestone`, and `create_thread` since
// Samuel's ruling of 2026-08-24. §2 SPLIT out of this file (it measured 496 of the 500-line cap
// and could no longer carry the ruling's argument beside the list it admits to). Re-exported
// below, and injected into the extracted table by the two harness tests like the two above.
const {
  OWN_CHANNEL_MARKER_OPS, OWN_CHANNEL_THREAD_OPS, OWN_CHANNEL_OUTBOUND_OPS,
  isOwnChannelMarker, isOwnChannelThreadOpen, isOwnChannelOutbound,
} = require('./session-own-outbound');
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

// ⚠ "WHERE DOES A DOPL READ RESOLVE?", ASKED OF THE TABLE RATHER THAN ANSWERED TWICE. The
// op-scoped knowledge branch below grants a `dopl_kb` READ exactly where a `DOPL_READ_TOOL` is
// already granted. Naming those modes there would be a SECOND statement of AUTO_TOOLS'
// membership, which stops being true the day the floor or the lists move; asking
// `toolModeAllows` about a real member cannot drift.
const DOPL_READ_REFERENCE = DOPL_READ_TOOLS[0] || 'mcp__dopl__dopl_search';

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
//
// `read_sessions` JOINED ON 2026-08-22 (Samuel's ruling 7, investigation A4). Its absence was
// an OMISSION, not a rule: it is strictly weaker than the `read` already on this list, because
// it returns THIS OPERATOR'S OWN sessions — handle, state, thread — and never a peer's, so it
// carries no counterparty content at all (packages/mcp-server channel-description.ts: "This is
// YOUR side only — it never shows a PEER's sessions"). It may be moot under the windowless
// message floor, which auto-allows the inbound half anyway; the list should be correct.
// ⚠ IT IS THE ONE READ WHOSE `channel` IS AN OPTIONAL FILTER rather than a required argument
// (channel-schema.ts), so an unfiltered call spans the WORKSPACE — which is exactly the shape
// that keeps `list` off this list, and it still qualifies for the reason `list` does not:
// `list` enumerates OTHER PEOPLE'S channels and DMs, this enumerates only our own runtimes.
const OWN_CHANNEL_READ_OPS = ['read', 'await', 'list_threads', 'get_thread', 'members',
  'read_sessions'];

// Read twin of isOwnChannelPost, SAME scoping rule and safe failure: a `channel` naming
// anything but this session's id (slug included) is ANOTHER channel and gates.
function isOwnChannelRead(input, sessionChannelId) {
  const i = input || {};
  if (OWN_CHANNEL_READ_OPS.indexOf(i.op) === -1) return false;
  const target = i.channel;
  if (target == null || target === '') return true;
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// ⚠ THE OWN-CHANNEL OUTBOUND OPS BESIDE THE POST live in `session-own-outbound.js` (§2 SPLIT,
// 2026-08-24): the two op lists, their union, and the three predicates over it. They are the
// OUTBOUND twin of `isOwnChannelRead` above and share its footing exactly — scoped by CHANNEL
// only, by ID, a slug classifying as another channel. ⚠ Read that module before adding a third
// op: the bar an op has to clear to earn this lane is written there, not here.

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

// ⚠ AXIS A'S WINDOWLESS FLOOR — THE ONE STATEMENT OF IT (2026-08-22, Samuel's ruling 4).
//
// ⚠ IT SITS BESIDE THE AXIS-B FLOOR ABOVE BECAUSE IT IS THE SAME FACT ABOUT THE SAME SHAPE,
// not because the axes mix. A windowless session has NO GATE SURFACE:
// `session-windowless.js › claimGate` answers a `permission_request` with
// `setImmediate(() => decide(rid, 'deny'))`. The floor above exists because a HELD INBOUND is
// held forever there; this one exists because a GATED TOOL is DENIED there. Under `manual` —
// Axis A's start value AND its park reset, so the common case, not an odd one — `toolModeAllows`
// returns false for every name, so EVERY work tool is silently denied, including the read tools
// `prompt-framing.js` ORDERS the agent to use. Flooring at `auto` makes AUTO_TOOLS
// (READ_BUILTINS + EDIT_TOOLS + MultiEdit + DOPL_READ_TOOLS) reachable with no gate to answer —
// ⚠ ONLY AS FAR AS THE PROFILE ALREADY REACHES (clause missing here until 2026-08-22, F-267).
// `buildSessionToolConfig` bounds `builtinTools` and fills `disallowedTools` BEFORE Axis A, so a
// hard-denied name is absent from context and no floor reopens it: DOPL_READ_TOOLS reach only
// `full`, and `read_only` offers neither them nor EDIT_TOOLS. The floor widens what the PROFILE
// permits; it never makes the Dopl reads reachable.
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

// AXIS B WITH THE OUT-HALF WITHDRAWN — the PRIVATE TURN's gate (2026-08-22, Samuel's ruling).
//
// ⚠ IT IS THE EXACT INVERSE OF `floorWindowlessMessage` ABOVE and sits beside it for that
// reason: that one RAISES the IN half because a windowless session has no accept surface, this
// one LOWERS the OUT half because a private answer must not be able to leave the machine on its
// own. Both are one-line transforms over the same frozen enum, and neither may be re-spelled at
// a call site (`session-private.js › effectiveMessageMode` is this one's only caller).
//
// ⚠ THE IN HALF IS PRESERVED EXACTLY, WHICH IS WHY THIS IS NOT SIMPLY `'ask'`. Own-channel READS
// follow the INBOUND half (`isOwnChannelRead`), and in a windowless session a gated read is a
// DENIED read — there is no surface to answer it on. An agent asked a private question about a
// thread must still be able to go and look at it. The ruling is about what LEAVES.
//   auto_both      -> auto_inbound   (reads still auto; posts and milestones gate)
//   auto_outbound  -> ask            (its IN half was already ask; only the OUT half moves)
//   auto_inbound   -> auto_inbound   (nothing to withdraw)
//   ask            -> ask
function privateTurnMessageMode(mode) {
  const m = normalizeMessageMode(mode);
  if (m === 'auto_both') return 'auto_inbound';
  if (m === 'auto_outbound') return 'ask';
  return m;
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
    // Own-channel MARKERS and THREAD OPENS, same outbound half (OWN_CHANNEL_OUTBOUND_OPS —
    // `milestone`, and `create_thread` since Samuel's ruling of 2026-08-24). Both are outbound
    // CONTENT into this session's own channel, which is what the outbound half consents to; a
    // slug-addressed one classifies cross-channel and gates, exactly like a post.
    if (autoOutboundMode(a.messageMode) && isOwnChannelOutbound(a.input, a.channelId)) return 'allow';
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
  // 5. ⚠ THE OP-SCOPED KNOWLEDGE READ (2026-08-22, OQ-1). SAME SHAPE AS THE AXIS-B CHANNEL
  //    BRANCH ABOVE AND FOR THE SAME REASON: one tool carries a read AND a write surface, so a
  //    WHOLE-TOOL verdict has to pick the wrong one. `dopl_kb` is a `DOPL_WRITE_TOOL` (correctly
  //    — seven of its twelve ops write to the shared workspace), so Axis A misses it at `auto`,
  //    and a miss in a WINDOWLESS session is a DENY, not a question. Only the READ ops land
  //    here; the writes fall through to `gate` as before. ⚠ LAST, AFTER Axis A, so `bypass`
  //    (which does cover the whole tool) is still Axis A's answer and this narrows nothing.
  //    ⚠ AND UNREACHABLE UNDER `read_only`, which hard-denies the tool at step 1.
  if (isKnowledgeReadCall(name, a.input) && toolModeAllows(a.toolMode, DOPL_READ_REFERENCE)) return 'allow';
  return 'gate';
}

// ─── END SESSION-PROFILE TABLE ───

// ⚠ Built OUTSIDE the extracted table so the block stays self-contained and grantDecision's
// shape/ordering is byte-unchanged: an explanation must not be able to move a gate. Handed THIS
// table's own predicates, so the explainer can never classify differently from the gate.
const gateReason = makeGateReason({
  isChannelTool, isOwnChannelPost, isOwnChannelRead, postFieldsOk, grantKeyFor,
  OWN_CHANNEL_READ_OPS, BYPASS_TOOLS, normalizeToolMode,
  canonicalDoplName, isOwnChannelMarker, isOwnChannelThreadOpen, isOwnChannelOutbound,
  OWN_CHANNEL_OUTBOUND_OPS,
  // 2026-08-22 (OQ-1): the two the op-scoped knowledge allow is explained by. Injected, like
  // every other predicate here, so the explainer cannot grow its own copy of the rule.
  toolModeAllows, isKnowledgeReadCall,
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
  // Axis B's OUTBOUND half beside the post — re-exported from session-own-outbound.js (§2
  // SPLIT, 2026-08-24), so `require('./session-profiles')` still answers for all of it.
  isOwnChannelMarker, OWN_CHANNEL_MARKER_OPS, // the `milestone` half (M4, 2026-08-05)
  isOwnChannelThreadOpen, OWN_CHANNEL_THREAD_OPS, // `create_thread` (Samuel's ruling, 2026-08-24)
  isOwnChannelOutbound, OWN_CHANNEL_OUTBOUND_OPS, // the union grantDecision's Axis-B branch asks
  isKnowledgeReadCall, // 2026-08-22 (OQ-1): re-exported from knowledge-ops, the op-scoped kb read
  DOPL_READ_REFERENCE, // the member the knowledge branch asks "where does a Dopl read resolve?"
  mcpShortName, canonicalDoplName, // re-exported from mcp-tool-names
  grantDecisionDetail, GATE_REASONS,
  BYPASS_READS, // NAMED read-only tools `bypass` covers on top of the classified work set
  grantKeyFor, // scoped allowForTask key for EVERY tool class
  POST_GRANT, // own-channel post BASE; a real key extends it (to/kind/body segments)
  isChannelTool, // session-io uses it too
  // ⚠ THE TWO AXES ARE COPIED, AND THE COUNT IS RE-MEASURED (2026-08-20). This said "renderer/
  // preload hold their own COPIES … pins all FOUR surfaces": that preload is deleted and this
  // tree's copies are `session-state.js` (the reducer's own fail-closed coercion) and
  // `channel-prefs.js` (the durable posture's WRITE validator). `test/session-permission-axes`
  // pins all three against each other — the third was unpinned until 2026-08-20 and REJECTS a
  // value outside its lists, so a fifth mode would have made the posture silently unwritable.
  // A FOURTH copy lives in the SPA (`src/features/channels/lib/permission-modes.ts`), out of
  // this tree's reach and re-validated here on arrival. Change here => change in three places.
  TOOL_MODES, MESSAGE_MODES, EDIT_TOOLS, ESCALATION_TOOLS,
  AUTO_TOOLS, BYPASS_TOOLS, DOPL_READ_TOOLS, DOPL_WRITE_TOOLS,
  normalizeToolMode, normalizeMessageMode, toolModeAllows, autoInboundMode,
  floorWindowlessMessage, // AXIS B's windowless floor — one statement, two lanes (F-236)
  floorWindowlessTool, // ...and AXIS A's, applied at the READ (session-io.js › grantArgs)
  privateTurnMessageMode, // ...and its inverse: the PRIVATE TURN withdraws the OUT half
};
