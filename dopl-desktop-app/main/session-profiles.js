// SESSION-mode tool grant table (v1.9 Session Window, Track T1).
//
// Maps a tool profile -> the SDK-option pieces a live session needs:
//   { builtinTools, disallowedTools, preApproved, doplToolsPolicy }
// The SESSION analog of tool-profiles.js's HEADLESS containment. The two differ deliberately
// (§G-Q3): headless has no TTY so it can only PRE-APPROVE a fixed safe set; a session has a
// visible window + live canUseTool buttons, so dangerous tools can be LIVE-GATED per call.
//
// THE SHADOW GOTCHA (research §3, contract §A.5 / §H-1). A tool named in the SDK's
// `allowedTools` SHADOWS the `canUseTool` callback — it auto-approves before the button can
// appear. So `preApproved` (== allowedTools) must contain ONLY tools we intend to grant
// silently at launch; a live-gated tool must NEVER appear there.
//
// SECURITY (adversarial review) — each fix is documented in full at its implementation site:
//   H1 + v2.5 D2 — `dopl_channel` is pre-approved on NO profile and auto-allows on NO op, an
//     own-channel post included, so no message leaves this machine without a click (or AXIS B).
//   F2 — every dopl_channel grant is OP-SCOPED with no bare-tool-name fallback.
//   H2 + H3 — under `full` the delegation / persistence / exfil subset is HARD-DENIED rather
//     than live-gated, and Task/Agent are hard-denied under EVERY profile.
//
// v2.9 — TWO AXES. One "Auto-approve" switch used to control two unrelated things, because
// an outbound message is technically a tool call (`dopl_channel op=post`) and rides the same
// canUseTool plumbing as Bash (HIGH-4). They are split now:
//   AXIS A (toolMode)    manual | accept_edits | auto | bypass — what MY agent may do here.
//   AXIS B (messageMode) ask | auto_inbound | auto_outbound | auto_both — what crosses.
// THE INVARIANT: Axis A can NEVER auto-approve a message operation and Axis B can NEVER
// auto-approve a work tool. The channel tool branches to Axis B in grantDecision BEFORE any
// Axis A mode is consulted, and no other tool ever reads messageMode.
//
// The modes are resolved HERE, never via the SDK's `permissionMode`: bypassPermissions stops
// the SDK calling canUseTool at all, which would silently kill the outbound message card (the
// same fusion, a new mechanism) and drop the hard-deny enforcement path. buildSdkOptions
// keeps `permissionMode: 'default'` + `settingSources: []` pinned.
//
// 2026-08-02 — WHY, NOT JUST WHAT. grantDecisionDetail (below the table) pairs the verdict with
// a REASON CODE from session-gate-reason.js, because a gate nobody can explain reads as a broken
// toggle. It explains the decision this table already made; it never makes one.
//
// PURE module: requires the (pure) tool-profiles constants + session-gate-reason +
// mcp-tool-names + node's `crypto`, used ONLY to digest a grant key (no key material, no
// randomness). The extracted block references the tool-profiles constants + normalizeProfile +
// shaKey + the two mcp-tool-names normalizers, which test/session-profiles and test/sdk-grant
// inject as parameters when they evaluate the sliced block (the same source-extraction idiom
// as tool-profiles, kept electron/fs/path/SDK-free).

const { makeGateReason, GATE_REASONS } = require('./session-gate-reason');
const { makeGrantKeyFor, POST_GRANT, postFieldsOk } = require('./session-grant-keys');
// F-139: the client-agnostic tool-name normalizer the whole table matches through.
const { mcpShortName, canonicalDoplName } = require('./mcp-tool-names');
const {
  READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS,
  // F-139: DOPL_SERVER_PREFIX is deliberately NOT read here any more. It names ONE server —
  // ours — and this table must not compare a client-supplied tool name against it. It is
  // consumed in mcp-tool-names.js, as the canonical form to normalize ONTO.
  DOPL_CHANNEL_TOOL, normalizeProfile,
} = require('./tool-profiles');

// ─── BEGIN SESSION-PROFILE TABLE (extracted by session-profiles/sdk-grant tests) ───

// The dopl server registers tools under bare names (`dopl_channel`); the CLI exposes them as
// `mcp__dopl__<tool>`. The per-server MCP `tools` policy uses the bare server-local name, so
// strip our `mcp__dopl__` prefix for doplToolsPolicy.
function shortDoplName(full) {
  return String(full).replace(/^mcp__dopl__/, '');
}

// F-139 (2026-08-05) — THE SERVER PREFIX IS THE CLIENT'S, NOT OURS. `mcpShortName` /
// `canonicalDoplName` live in mcp-tool-names.js (the §2 cap; that file carries the whole
// incident and the residual-risk argument). Every matcher below used to compare against the
// literal `mcp__dopl__` form our own registration happens to produce, so the same tool arriving
// as `mcp__claude_ai_Dopl__…` or `mcp__<uuid>__…` missed EVERY list at once — Axis B, the
// pre-approvals, both Axis-A modes and the hard-deny set. Injected by the extraction tests.

// FIX H2 / H3 — the SESSION HARD-DENY set for the `full` profile. A live session gives the
// operator a visible window + per-call Allow/Deny buttons, so the VISIBLE + REVERSIBLE work
// tools (Bash / Write / Edit / MultiEdit / NotebookEdit, plus WebFetch and the non-admin dopl
// tools, none of which are denied under full) can be LIVE-GATED. But the delegation /
// persistence / exfil / escalation tools must NOT be live-gated: a single "Allow for this
// task" on one of them OUTLIVES the watched window — Task/Agent spawn a FRESH session that
// does NOT inherit this session's canUseTool bound (tool-profiles.js warns the same; hence H3
// denies them under every profile), Cron*/ScheduleWakeup/Monitor persist and re-run
// unattended, SendMessage/RemoteTrigger/Artifact/… exfiltrate off-machine without the visible
// dopl_channel post. So `full` HARD-DENIES them. Derived from tool-profiles' DENIED_BUILTINS
// (the full blacklist) MINUS the work tools we keep live-gated, PLUS the six dopl_*_admin
// tools — reusing the shared constants so the two never drift.
// 2026-08-02 FIX 2 — BashOutput / KillShell are the READ HALF of an already-gated Bash: they
// poll and stop a background shell this session already had to earn a button for. Hard-denying
// them (they sit in DENIED_BUILTINS with Bash, and hard-deny is checked FIRST) made background
// Bash unusable under `full` and read as one more way bypass was broken. They live-gate with
// Bash now, and they are added HERE only — the restricted profiles keep denying them via
// DENIED_BUILTINS, so read_only, which offers no Bash at all, gains no shell surface.
const SESSION_GATED_WORK_TOOLS = ['Bash', 'BashOutput', 'KillShell',
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const SESSION_HARD_DENY = DENIED_BUILTINS
  .filter(function (t) { return SESSION_GATED_WORK_TOOLS.indexOf(t) === -1; })
  .concat(DOPL_ADMIN_TOOLS);

// FIX F2 (v2.9 review) — DOPL_SAFE_TOOLS is "non-admin", which is NOT the same as
// "read-only". These six each WRITE to the shared workspace: dopl_kb alone registers
// write_file / create_base / create_folder / move_file (packages/mcp-server knowledge.ts),
// and dopl_skill / dopl_ontology / dopl_workflow / dopl_chats / dopl_cluster carry the same
// create+update shape. A write here lands OFF this machine, in rows every workspace member
// can then read, so it is an exfiltration path in the same class as an outbound post — it
// must never be silent. They are split out so (a) `auto` GATES them and only `bypass`
// covers them, and (b) `dopl_only` stops SHADOWING them via allowedTools. The read half is
// derived by subtraction so the two can never drift from tool-profiles' list.
const DOPL_WRITE_TOOLS = [
  'mcp__dopl__dopl_kb', 'mcp__dopl__dopl_skill', 'mcp__dopl__dopl_ontology',
  'mcp__dopl__dopl_workflow', 'mcp__dopl__dopl_chats', 'mcp__dopl__dopl_cluster',
];
const DOPL_READ_TOOLS = DOPL_SAFE_TOOLS
  .filter(function (t) { return DOPL_WRITE_TOOLS.indexOf(t) === -1; });

// The SESSION grant config for a profile. `preApproved` -> SDK allowedTools (shadowed, no
// button). `builtinTools` -> SDK tools (a POSITIVE bound; [] means no bound, i.e. all
// built-ins offered, only some gated). `disallowedTools` -> SDK disallowedTools (hard-denied,
// never offered). `doplToolsPolicy` -> the dopl MCP server's per-server `tools` allowlist
// (null => all dopl tools reachable).
//
// `dopl_channel` is NOT in `preApproved` on ANY profile (FIX H1) — it is left out of both
// preApproved and disallowedTools so it REACHES the gate, where grantDecision op-scopes it.
// It stays in each restricted profile's `doplToolsPolicy` (defense in depth: the MCP server
// still only offers the scoped dopl tools).
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
    // Local reads + web reads + the READ-ONLY dopl tools pre-approved; channel delivery
    // AND the workspace-WRITE dopl tools via the gate. Admins + write/exec/escape denied.
    // FIX F2: DOPL_WRITE_TOOLS used to sit in preApproved, i.e. in allowedTools, i.e.
    // SHADOWED — a dopl_only session could write into the shared workspace without
    // canUseTool ever being called, the v1.9 half of the same hole that let `auto`
    // auto-approve them. They are now in NEITHER list, so they reach the gate exactly
    // like dopl_channel does, and stay in doplToolsPolicy (the server still offers them).
    return {
      builtinTools: READ_BUILTINS.concat(WEB_TOOLS),
      preApproved: READ_BUILTINS.concat(WEB_TOOLS, DOPL_READ_TOOLS),
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

// FIX F3 (v2.9 review) — IS THIS THE CHANNEL TOOL? The Axis-B branch used to match the
// single literal 'mcp__dopl__dopl_channel', so a renamed or versioned channel tool
// ('mcp__dopl__dopl_channel_v2') fell straight through to AXIS A — and with `auto`/`bypass`
// answering unrecognized names permissively, A TOOL POSTURE ANSWERED A MESSAGE OPERATION,
// the one inversion the contract forbids. Match by SERVER PREFIX + SHORT NAME instead: any
// tool this server exposes whose short name is `dopl_channel` or starts `dopl_channel_`
// (a version/variant suffix) is a message operation and is governed by Axis B alone. The
// bare short name is accepted too — the server registers tools bare and only the CLI adds
// the prefix. Over-matching is the SAFE direction here: Axis B gates everything except an
// own-channel post, so a mis-classified tool asks rather than runs.
//
// F-139 (2026-08-05) — THE "SERVER PREFIX" WAS ONE HARDCODED SERVER NAME. The reasoning above
// is right; the implementation only ever honoured `mcp__dopl__`. Under any other server
// segment the strip missed, `short` stayed the full dotted name, neither test hit, and the
// REAL channel tool was classified OUT of Axis B (mcpShortName's header carries the live
// evidence). Matched by SHORT NAME UNDER ANY SERVER now.
//
// WHY OVER-MATCHING STILL COSTS NOTHING, restated for the wider match. Axis B is the STRICTER
// axis: only an own-channel post — and, since M3/M4, an own-channel read or thread marker —
// auto-allows; every other shape gates in every posture. The HARD-DENY set is checked BEFORE
// this branch either way, so nothing can be demoted out of `deny` by landing here. Misrouting
// an unrelated tool INTO Axis B therefore makes it ASK. The old behaviour misrouted the real
// tool OUT of Axis B and into "unclassified", which also asks — so neither direction is
// unsafe, and only one of them lets the operator's posture work at all.
const CHANNEL_SHORT_NAME = shortDoplName(DOPL_CHANNEL_TOOL);
function isChannelTool(toolName) {
  const short = mcpShortName(typeof toolName === 'string' ? toolName : '');
  return short === CHANNEL_SHORT_NAME || short.indexOf(CHANNEL_SHORT_NAME + '_') === 0;
}

// FIX H1 — is this dopl_channel call a plain delivery post into the session's OWN channel?
// `op==='post'` AND the target channel is either unset or exactly the session's channelId.
// Any other op — open, invite, a cross-channel post, create_task, close_task, set_task_mode —
// is NOT an own-channel post. (`channel` may be a slug or id; we compare against the id only,
// so a slug-addressed post is classified as cross-channel rather than as an own-channel post,
// the safe failure.) v2.5 D2: this no longer AUTO-ALLOWS. It only decides which grant KEY a
// post belongs to (below); every post still reaches the operator's dock.
function isOwnChannelPost(input, sessionChannelId) {
  const i = input || {};
  if (i.op !== 'post') return false;
  const target = i.channel;
  if (target == null || target === '') return true; // no explicit target -> own channel
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// M3 (2026-08-05) — THE READ HALF OF THE OWN CHANNEL. Axis B used to auto-allow exactly one
// shape, an own-channel POST, and gate every other op on this tool in every posture. So POSTING
// into the session's own channel ran with no card while READING that same channel asked: the more
// dangerous op was the permitted one, and the operator saw `dopl_channel gate
// channel-op-approval-required tool=bypass msg=auto_both` with both axes wide open. Incoherent,
// and one of the three separate mechanisms behind "I set automatic and it still asks me".
//
// WHICH OPS, AND WHY THESE. Read-only, and scoped to the channel this session is already bound
// to — nothing here writes, addresses anyone, or reaches a channel the operator did not open:
//   read / await   the channel's messages (await is the same read, long-polled: it is what an
//                  agent blocked on the peer is doing, and gating it gates waiting itself)
//   list_threads / get_thread   this channel's threads and one thread's contents
//   members / agents            this channel's roster, which the session's own prompt framing
//                  already carries; enumerating it discloses nothing the agent was not told
// WHAT DELIBERATELY STAYS GATED IN EVERY POSTURE, because the v1.9 FIX H1 exfil reasoning is
// sound and untouched: `open` (opens a channel or a DM with another member), `invite`,
// `create_thread`, `propose_close` and `close_thread`, `set_thread_mode`, `join_thread` /
// `leave_thread`, the agent-lifecycle ops (`summon_agent` / `rename_agent` / `set_agent_status` /
// `disengage_agent`), `milestone` and every post — plus `list`, which is read-only but enumerates
// EVERY channel and DM this account can reach and is therefore not own-channel-scoped at all.
// "Read my own room for me" is not consent to open a DM with a stranger.
const OWN_CHANNEL_READ_OPS = ['read', 'await', 'list_threads', 'get_thread', 'members', 'agents'];

// The read twin of isOwnChannelPost, with the SAME scoping rule and the same safe failure: a
// `channel` naming anything but this session's id (a slug included) is classified as ANOTHER
// channel and gates. Absent/empty means the session's own channel, exactly as for a post.
function isOwnChannelRead(input, sessionChannelId) {
  const i = input || {};
  if (OWN_CHANNEL_READ_OPS.indexOf(i.op) === -1) return false;
  const target = i.channel;
  if (target == null || target === '') return true;
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// M4 (2026-08-05, F-139) — THE PROPOSAL IS NOT THE CLOSE. Live on `bypass` + `auto_both`:
// `session gate: dopl_channel op=propose_close gate channel-op-approval-required`. So the
// operator answered TWO prompts for ONE decision — once to permit the agent's CALL, then again
// to confirm the close itself. The second is the FEATURE (propose-then-confirm: an agent
// proposes, the human decides) and is untouched here. The first bought nothing.
//
// WHY THESE TWO OPS AUTO-ALLOW, AND WHY IT IS NOT A WIDENING. Both are STRICTLY LESS POWERFUL
// than the plain own-channel `post` that `auto_outbound` already auto-allows, into the same
// channel, from the same session:
//   propose_close  posts a marked note and surfaces a confirmable prompt to the operator. It
//                  closes NOTHING — the thread stays open, routing and live until the human
//                  acts (packages/mcp-server channel-description), and the server refuses an
//                  agent-token close outright. Gating the call costs a click per exchange and
//                  removes no consent point, because the consent point is the confirm.
//   milestone      a one-line marker that a step landed. It addresses nobody, notifies nobody
//                  and carries no deliverable. Its ONLY effect is agent-authored text in this
//                  session's own thread — which is precisely what an auto-allowed `post` does
//                  with more reach. The marginal exfil surface over `post` is therefore zero,
//                  and prompt-framing actively INSTRUCTS the agent to log milestones, so
//                  gating it is the product asking permission for what it just ordered.
// Deciding `milestone` the other way would have left the same incoherence M3 removed, one op
// along: the more powerful op permitted, the weaker one asking.
//
// WHICH AXIS: OUTBOUND. Both put CONTENT into the shared channel — they are statements that
// leave this machine, which is what `auto_outbound` ("send my replies for me") consents to.
// The M3 read set went to the INBOUND half for the mirror-image reason (a read sends nothing;
// it brings the peer's words in). Neither of these can be reached by `auto_inbound` alone.
//
// WHAT DELIBERATELY STAYS GATED IN EVERY POSTURE: `close_thread` above all — it is the
// operator's act, it settles a SHARED thread for both members, and it is never conflated with
// its proposal here. Plus everything F-138 M3 named: `open`, `invite`, `create_thread`,
// `set_thread_mode`, `join_thread`/`leave_thread`, the agent-lifecycle ops, `list`, and any
// cross-channel shape of ANY op including these two.
const OWN_CHANNEL_MARKER_OPS = ['propose_close', 'milestone'];

// The outbound twin of isOwnChannelRead, on the SAME footing as isOwnChannelPost: scoped by
// CHANNEL, absent/empty meaning this session's own, and a `channel` naming anything else — a
// slug included — classified as another channel and gated. (The THREAD is not scoped here: the
// gate is handed the session's channelId and not its taskId, and the blast radius of the wrong
// thread id is a confirm prompt the operator reads, inside the channel they are already bound
// to. Flagged in F-139 rather than silently widened.)
function isOwnChannelMarker(input, sessionChannelId) {
  const i = input || {};
  if (OWN_CHANNEL_MARKER_OPS.indexOf(i.op) === -1) return false;
  const target = i.channel;
  if (target == null || target === '') return true;
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// The accept_edits set (contract A2). Named HERE because Axis A and the grant key both read
// it, and the key machinery is handed it by the factory below rather than keeping a copy.
const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

// §2 SPLIT (2026-08-02): the SCOPED GRANT KEY machinery moved to session-grant-keys.js when
// this file hit the 500-line cap. It is BOUND here with this table's own two classifiers, so
// there is one definition of "is this the channel tool" and a key can never disagree with the
// decision about which branch a call belongs to. POST_GRANT / postFieldsOk come from the same
// module; grantKeyFor is re-exported below, so no caller of this file moved.
const grantKeyFor = makeGrantKeyFor({ isChannelTool, isOwnChannelPost, EDIT_TOOLS });

// ── AXIS A: TOOL PERMISSIONS (what MY agent may do on THIS machine) ───────────────
// Per-session, never persisted, always starts `manual`, RESET to `manual` on park (the
// v2.3 FIX #3 rule extended: an abandoned session must never resume pre-authorized).
const TOOL_MODES = ['manual', 'accept_edits', 'auto', 'bypass'];
// ESCALATION-SHAPED ops that `auto` still asks about, and part of the reason `auto` is not
// `bypass`: these reach the SHELL or the NETWORK, and the counterparty's message text
// steers what the agent proposes, so a hands-off tool posture must still stop here.
// `bypass` covers them; NOTHING covers the hard-deny set. FIX 2 (2026-08-02): BashOutput and
// KillShell sit HERE, with Bash, so the tool axis answers all three identically — the read half
// of a shell is still the shell, and a posture that asks about `Bash` must ask about its output.
const ESCALATION_TOOLS = ['Bash', 'BashOutput', 'KillShell', 'WebFetch', 'WebSearch'];

// FIX F2 / F3 (v2.9 review) — `auto` and `bypass` are POSITIVE ALLOW-LISTS now, not negative
// ones. Two bugs, one root cause: `auto` was "everything except three names" and `bypass` was
// "everything", so (F2) the workspace-WRITE dopl tools were auto-approved by a mode whose copy
// only mentions commands, shell and web — an off-machine write every workspace member can
// read, with no card — and (F3) EVERY unrecognized name resolved to allow: '', null, undefined,
// 'SomeFutureTool', and a renamed channel tool alike. The hard-deny set is a BLACKLIST of names
// known at build time, which is exactly why an unrecognized name must not be auto-allowed: a
// CLI that ships a new delegation or exfil built-in tomorrow lands in neither list, and a
// negative mode would run it silently. Unknown therefore GATES IN EVERY MODE, `bypass`
// included: bypass hands over every work tool WE HAVE CLASSIFIED on this machine, which is what
// its copy claims, and one extra click on a tool nobody has ever seen is the cost of that bound.
//
// 2026-08-02 — the NAMED read-only additions to `bypass`. The bundled sdk-tools union carries a
// tail of built-ins that were in no list and therefore always gated, which is the single biggest
// source of "bypass still asks". The list is NOT widened wholesale (the positive-list rationale
// above is exactly why): only names with no side effect and no new reach earn a line here, each
// one justified where it sits. Everything else — AskUserQuestion, EnterPlanMode, ExitPlanMode,
// RefreshMcpTools — keeps gating, because each changes what the SESSION is (its plan posture,
// its tool surface, what the operator is asked) rather than reading something already in reach.
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

// Does Axis A auto-allow this tool? MultiEdit is deliberately NOT in the accept_edits set
// (contract A2 names exactly Write / Edit / NotebookEdit) — the restrictive reading.
// Nothing here ever sees a dopl_channel call: grantDecision branches to Axis B first.
// F-139: the name is CANONICALIZED first, so the dopl entries in AUTO_TOOLS / BYPASS_TOOLS
// (written `mcp__dopl__…`) match the same tool arriving under any other server prefix. Every
// non-Dopl name passes through untouched, so an unknown tool still gates in every mode.
// Canonicalization is idempotent, so callers that already normalized lose nothing.
function toolModeAllows(mode, toolName) {
  const m = normalizeToolMode(mode);
  const name = canonicalDoplName(toolName);
  if (m === 'manual') return false;
  if (m === 'accept_edits') return EDIT_TOOLS.indexOf(name) !== -1;
  if (m === 'auto') return AUTO_TOOLS.indexOf(name) !== -1;
  return BYPASS_TOOLS.indexOf(name) !== -1; // bypass — every KNOWN work tool, nothing else
}

// ── AXIS B: MESSAGE FLOW (what crosses between machines) ──────────────────────────
// Per-session, starts `ask`, resets to `ask` on park. The INBOUND half is enforced at the
// inbound gate (session-gate.autoInbound / the reducer's inboundAutoAccepted); the OUTBOUND
// half is enforced here, and ONLY for a post into the session's OWN channel. A cross-channel
// post, `op=open direct:true`, invite, create_task and friends always gate: they are the
// cross-user exfil surface v1.9 FIX H1 closed, and "send my replies for me" is not consent
// to open a DM with another workspace member.
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
//   'preapproved' — auto-allow with NO button (a profile pre-approved tool that is ALSO
//                   shadowed via allowedTools). NEVER the channel tool (FIX H1 kept it out of
//                   allowedTools; D2 removed its own-channel post case).
//   'deny'        — hard-denied by the profile (checked FIRST so a denied tool can never be
//                   opened, not even via allowForTask).
//   'allow'       — the operator granted this tool for the whole task (engine Set).
//   'gate'        — surface Allow-once / Allow-for-task / Deny buttons and await.
// `input` + `channelId` are threaded in so the channel tool can be op-scoped; `toolMode`
// (Axis A) and `messageMode` (Axis B) are the per-session postures, absent => the most
// restrictive member of each axis. ORDER (v2.9, unchanged at the top): hard-deny FIRST and
// immovable in EVERY mode, bypass included -> the Axis-B branch for the channel tool ->
// preapproved -> the scoped standing grant -> the Axis-A mode -> gate.
function grantDecision(args) {
  const a = args || {};
  const allowForTask = a.allowForTask || [];
  const cfg = buildSessionToolConfig(a.profile);
  // 0. F-139 — THE NAME, NORMALIZED ONCE. Every list this function consults is written in the
  //    `mcp__dopl__…` form our own registration produces, and the SAME tool reaches this gate
  //    as `mcp__claude_ai_Dopl__…` (connector) or `mcp__<uuid>__…` (other clients). One
  //    canonicalization covers all three lookups below, so hard-deny, pre-approval and the
  //    Axis-A modes can never again disagree about which server a tool came from. Non-Dopl
  //    names are returned untouched. The GRANT KEY deliberately keeps the REAL tool name
  //    (below): a grant is scoped to the shape the operator was shown, server included.
  const name = canonicalDoplName(a.toolName);
  // 1. HARD DENY. Checked first so a denied tool can never be opened — not by a task
  //    grant, and not by `bypass` (which is why `bypass` is not permissionMode:bypass).
  //    F-139: on the canonical name, because a deny list that a different server prefix walks
  //    past is not a deny list — `mcp__<other>__dopl_kb_admin` used to resolve 'gate', which
  //    is one operator click away from a tool this table says can never be opened.
  if (cfg.disallowedTools.indexOf(name) !== -1) return 'deny';
  // 2. THE INVARIANT — a message operation branches to AXIS B here and NEVER reaches the
  //    Axis A mode below. No tool posture, `bypass` included, can send a message. FIX F3:
  //    matched by server prefix + short name, so a renamed/versioned channel tool cannot
  //    fall through to Axis A and have a TOOL posture answer a MESSAGE operation.
  if (isChannelTool(a.toolName)) {
    // FIX F9 fail-closed: a post whose `to` or `kind` is not a string is malformed. It can
    // never be auto-allowed, because neither the key nor the card can honestly describe it.
    if (!postFieldsOk(a.input)) return 'gate';
    // ONLY a standing grant for THIS EXACT shape allows without a button. FIX F2 deleted
    // the bare-tool-name fallback that used to sit here: it turned any one channel grant
    // (even one taken on op=read) into a grant for every op, op=open included. Grants are
    // never persisted, so there is nothing to migrate.
    if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1) return 'allow';
    // auto_outbound / auto_both send the agent's own replies with no click. ONLY an
    // own-channel post: everything else on this tool is the exfil surface, so it gates.
    if (autoOutboundMode(a.messageMode) && isOwnChannelPost(a.input, a.channelId)) return 'allow';
    // M4: and the two own-channel THREAD MARKERS follow the same outbound half. Both put
    // content into the channel this session is already bound to and both are strictly less
    // powerful than the post above — `propose_close` closes nothing (the operator's confirm
    // is the consent point and is untouched) and `milestone` carries no deliverable. See
    // OWN_CHANNEL_MARKER_OPS. `close_thread` is NOT among them and gates in every posture.
    if (autoOutboundMode(a.messageMode) && isOwnChannelMarker(a.input, a.channelId)) return 'allow';
    // M3: and the READ half of that same channel follows the INBOUND half of the axis. A read
    // sends nothing; what it does is bring the peer's words into this agent's context without an
    // operator seeing them first, which is precisely what auto_inbound / auto_both consent to
    // (the inbound gate makes the identical call about a pushed turn). `auto_outbound` alone
    // therefore does NOT cover it: "send my replies for me" is a statement about what leaves.
    if (autoInboundMode(a.messageMode) && isOwnChannelRead(a.input, a.channelId)) return 'allow';
    return 'gate';
  }
  if (cfg.preApproved.indexOf(name) !== -1) return 'preapproved';
  // 3. THE SCOPED standing grant (HIGH-1): the key covers the SHAPE the operator saw — which
  //    includes the tool name they were shown, so this one stays on the RAW name.
  if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1) return 'allow';
  // 4. AXIS A. Message flow is never consulted here, so no message posture can run a
  //    work tool — the other half of the invariant.
  if (toolModeAllows(a.toolMode, name)) return 'allow';
  return 'gate';
}

// ─── END SESSION-PROFILE TABLE ───

// 2026-08-02 — THE VERDICT PLUS WHY. Built OUTSIDE the extracted table (like shaKey and
// tool-profiles' profileLabel) so the block stays self-contained and grantDecision's shape,
// ordering and source pins are byte-unchanged: an explanation must not be able to move a gate.
// The explainer is handed THIS table's own predicates, so there is one definition of each rule.
const gateReason = makeGateReason({
  isChannelTool, isOwnChannelPost, isOwnChannelRead, postFieldsOk, grantKeyFor,
  OWN_CHANNEL_READ_OPS, BYPASS_TOOLS, normalizeToolMode,
  // F-139: the explainer classifies by the SAME canonical name and the SAME marker predicate
  // the gate decided on, or it would report `unclassified-tool` for a tool the gate just
  // covered — the diagnostic hole and the bug would come back paired, exactly as they did.
  canonicalDoplName, isOwnChannelMarker, OWN_CHANNEL_MARKER_OPS,
});
// { decision, reason } — the reason is a GATE_REASONS code, or null for a verdict nothing can
// honestly explain. Callers that only route on the verdict keep using grantDecision unchanged.
function grantDecisionDetail(args) {
  const decision = grantDecision(args);
  return { decision, reason: gateReason(args, decision) };
}

module.exports = {
  buildSessionToolConfig, grantDecision, shortDoplName, isOwnChannelPost,
  isOwnChannelRead, OWN_CHANNEL_READ_OPS, // M3: the own-channel READ set Axis B's inbound half covers
  isOwnChannelMarker, OWN_CHANNEL_MARKER_OPS, // M4: the own-channel MARKER set its outbound half covers
  mcpShortName, canonicalDoplName, // F-139, re-exported from mcp-tool-names so no caller moved
  grantDecisionDetail, GATE_REASONS, // 2026-08-02: the verdict + the code that explains it
  BYPASS_READS, // the NAMED read-only tools `bypass` covers on top of the classified work set
  grantKeyFor, // v2.9 HIGH-1: the scoped allowForTask key for EVERY tool class
  POST_GRANT, // the own-channel post BASE; a real key extends it (to/kind/body segments)
  isChannelTool, // FIX F3: prefix + short name, never one literal (session-io uses it too)
  // v2.9 the two axes (the renderer/preload hold their own copies of these lists — a
  // sandboxed renderer cannot require main — and test/session-permission-axes pins all four
  // surfaces against each other). FIX F2/F3 add the POSITIVE per-mode allow-lists and the
  // dopl read/write split they rest on.
  TOOL_MODES, MESSAGE_MODES, EDIT_TOOLS, ESCALATION_TOOLS,
  AUTO_TOOLS, BYPASS_TOOLS, DOPL_READ_TOOLS, DOPL_WRITE_TOOLS,
  normalizeToolMode, normalizeMessageMode, toolModeAllows, autoInboundMode, autoOutboundMode,
};
