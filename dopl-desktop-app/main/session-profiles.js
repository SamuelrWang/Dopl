// SESSION-mode gate. The DECISION — its order, its four verdicts, its reason codes, both message
// axes and every own-channel lane — and nothing about which runtime is driving the session.
//
// THE AXIS-A TAIL LEFT ON 2026-08-31 (runtime-adapter port, §0.1b). Every Axis-A name —
// `buildSessionToolConfig`, `TOOL_MODES`, `normalizeToolMode`, `toolModeAllows`, `AUTO_TOOLS`,
// `BYPASS_TOOLS`, `BYPASS_READS`, `EDIT_TOOLS`, `ESCALATION_TOOLS`, `floorWindowlessTool` — is a
// vocabulary of one runtime's BUILT-IN tool names and lives in the RUNTIME ADAPTER: a runtime
// storing Axis A as its own words would resolve every call to the most restrictive mode, gate, and
// on a windowless session DENY. They are re-exported at the bottom for callers with no session in
// hand; the DEFINITIONS are the adapter's and core holds no copy. What stayed is DOPL'S on every
// runtime — `grantDecision`'s order, the four verdicts, the reason codes, `UNIVERSAL_HARD_DENY`,
// every Axis-B lane, `floorWindowlessMessage`, the private-turn withdrawal and the grant keys.
//
// TWO AXES, because an outbound message is technically a tool call (`dopl_channel op=post`) on
// the same permission plumbing as Bash:
//   AXIS A (toolMode)    what MY agent may do here — the RUNTIME's mode vocabulary.
//   AXIS B (messageMode) ask | auto_inbound | auto_outbound | auto_both — what crosses. DOPL'S.
// INVARIANT: Axis A can NEVER auto-approve a message op; Axis B can NEVER auto-approve a work tool.
// grantDecision branches the channel tool to Axis B BEFORE any Axis A mode is consulted, and no
// other tool reads messageMode.
//
// SHADOW GOTCHA: a tool in the platform's pre-approval list SHADOWS the held callback, so
// `preApproved` may hold ONLY silent-grant tools. And modes are resolved HERE, never via a
// platform's own permission-mode switch: a bypass mode stops the platform calling our callback at
// all, killing the outbound message card and the hard-deny path. The launch spec pins the
// platform's mode to its most conservative value.
//
// PURE module (no electron/fs/SDK). `main/runtime/index.js` is electron-free at load BY CONTRACT
// precisely so this file can ask it. test/session-profiles + test/sdk-grant slice the block below
// and inject `runtimeFor`, the tool-profiles constants, `normalizeProfile`, `shaKey` and the two
// mcp-tool-names normalizers.

const { makeGrantDetail, GATE_REASONS } = require('./session-gate-reason');
const { containerOnlyDenies } = require('./session-audience'); // §2 SPLIT 2026-08-26: B2's belt
const { makeGrantKeyFor, POST_GRANT, postFieldsOk } = require('./session-grant-keys');
// Client-agnostic tool-name normalizer the whole table matches through.
const { mcpShortName, canonicalDoplName, isDoplToolName } = require('./mcp-tool-names');
// OP-SCOPED KNOWLEDGE READS (2026-08-22, OQ-1). Injected into the extracted table by the two
// harness tests, like `normalizeProfile`. The whole argument lives in that module's header.
const { isKnowledgeReadCall } = require('./knowledge-ops');
// THE OWN-CHANNEL OUTBOUND OPS BESIDE THE POST — `milestone`, and `create_thread` since
// Samuel's ruling of 2026-08-24. §2 SPLIT out of this file (it measured 496 of the 500-line cap
// and could no longer carry the ruling's argument beside the list it admits to). Re-exported
// below, and injected into the extracted table by the two harness tests like the two above.
const {
  OWN_CHANNEL_MARKER_KIND, OWN_CHANNEL_THREAD_NEW, OWN_CHANNEL_ESCALATE_KIND, OWN_CHANNEL_OUTBOUND_OPS,
  OWN_CHANNEL_SEND_OPS, OWN_CHANNEL_ARTIFACT_OPS, // 2026-09-06: the union's two halves, named
  isOwnChannelMarker, isOwnChannelThreadOpen, isOwnChannelEscalate, isOwnChannelOutbound,
  isOwnChannelArtifact, isOwnChannelOutboundCall, // ...the fold, and the union's membership half
} = require('./session-own-outbound');
const { channelOpKey } = require('./channel-op-key'); // <op>.<action>, the ONE spelling every classifier here asks (F-578)
const { isOwnMachineLaunch, launchLaneVerdict } = require('./session-own-launch'); // THE OWN-MACHINE LAUNCH LANE (Samuel's ruling, 2026-08-25; F-320) — its own §2 file, on F-301's precedent
const { isOwnMachineDirect, directLaneVerdict } = require('./session-own-direct'); // THE OWN-MACHINE DIRECT LANE (Samuel's ruling, 2026-08-31) — same conjunction, its own §2 file, and DELIBERATELY not a member of the launch list: that one carries the depth bound and folding this in would make private directions depend on the agent-chaining setting
const { isOwnMachineManage, manageLaneVerdict, manageAllowReason, OWN_MACHINE_MANAGE_OPS } = require('./session-own-manage'); // THE OWN-MACHINE MANAGE LANE (Samuel's field report, 2026-09-17) — `rename` / `end` / `posture` on the SAME conjunction as the two lanes above, its own §2 file, and a SEPARATE list from both: `launch` carries the depth bound and the chaining setting (a rename must not depend on either), and `direct` buys a TURN where these three relabel, stop or re-posture one
// DOPL'S OWN SURFACE, §2-SPLIT 2026-08-31 so BOTH sides of the runtime seam can read it without a
// cycle. `mcp__dopl__*` names are runtime-independent; each adapter's `tools.js` composes them.
const { DOPL_READ_TOOLS, DOPL_WRITE_TOOLS, DOPL_READ_REFERENCE } = require('./session-dopl-tools');
// The runtime-resolved Axis-A surface lives in `session-profiles-runtime.js` (§2 SPLIT,
// 2026-09-14): the registry require — the ONLY one in core that reaches the runtime layer for a
// gate decision — and the delegates that hold NO copy of any tool name or Axis-A mode. Every name
// below is re-exported from here unchanged, and the table still reads `runtimeFor` / `EDIT_TOOLS`
// as the free vars its extraction injects.
const {
  runtimeFor,
  buildSessionToolConfig, toolModeAllows, normalizeToolMode, floorWindowlessTool, toolModesFor,
  windowlessFloorRefusal, axisBOpScopedWarning, isClassifiedTool, editToolsFor,
  TOOL_MODES, AUTO_TOOLS, BYPASS_TOOLS, BYPASS_READS, ESCALATION_TOOLS, EDIT_TOOLS,
} = require('./session-profiles-runtime');
const { DOPL_CHANNEL_TOOL } = require('./tool-profiles');

// ─── BEGIN SESSION-PROFILE TABLE (extracted by session-profiles/sdk-grant tests) ───

// ⚠ THE SERVER PREFIX IS THE CLIENT'S, NOT OURS. Match through `mcpShortName` /
// `canonicalDoplName` (mcp-tool-names.js), never the literal `mcp__dopl__` our own registration
// produces: the same tool arrives under another server segment and would miss EVERY list at once
// — Axis B, pre-approvals, both Axis-A modes, hard-deny. Injected by the extraction tests.

// ⚠ Match the channel tool by SHORT NAME UNDER ANY SERVER, never one literal: `dopl_channel`
// or a `dopl_channel_` version/variant prefix, bare form accepted too. A miss here drops a
// message op into AXIS A, and a TOOL posture answering a MESSAGE op is the one inversion the
// contract forbids. Over-matching is the SAFE direction: Axis B gates everything but an
// own-channel post/read/marker, and hard-deny is checked BEFORE this branch, so a
// mis-classified tool asks rather than runs.
const CHANNEL_SHORT_NAME = mcpShortName(DOPL_CHANNEL_TOOL);
function isChannelTool(toolName) {
  const short = mcpShortName(typeof toolName === 'string' ? toolName : '');
  return short === CHANNEL_SHORT_NAME || short.indexOf(CHANNEL_SHORT_NAME + '_') === 0;
}

// Plain delivery post into the session's OWN channel? `op==='send'` AND target channel unset or
// exactly the session's channelId. (`channel` may be a slug or id; compared against the id
// only, so a slug-addressed post classifies as cross-channel — the safe failure.) Does NOT
// auto-allow: it only decides which grant KEY a post belongs to.
function isOwnChannelPost(input, sessionChannelId) {
  const i = input || {};
  if (i.op !== 'send') return false;
  const target = i.channel;
  if (target == null || target === '') return true; // no explicit target -> own channel
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// READ HALF OF THE OWN CHANNEL (Axis B inbound). Read-only calls scoped to the channel this
// session is already bound to: nothing writes, addresses anyone, or reaches an unopened channel.
//
// KEYED `<op>.<action>` since the five-op collapse (2026-09-02, F-578), through
// `channel-op-key.js › channelOpKey`. The seven names this list used to hold are gone from the
// tool's enum, and a desktop still matching on them classified every new spelling as unclassified,
// which gates. The mapping is one-to-one: `read` absorbed `await` (a hold is `wait_ms`) and
// `get_thread` (a scoped read is `thread=`); `status` is `read_sessions` + `read_directions`;
// `rooms.threads` is `list_threads`, `rooms.members` is `members`.
//
// `rooms` is on this list ONLY BY ACTION, which is the whole reason the key is dotted: four of its
// eight actions WRITE (`open`, `invite`, `thread_mode`, `update` — `gating.ts › WRITE_OPS`), so a
// bare `rooms` entry would hand the inbound half a lane that opens channels and invites people into
// them. `rooms.list` is read-only and still not here, because it enumerates EVERY channel and DM
// this account can reach; `rooms.help` is not here either. Every `send` and every `manage` stays
// gated in every posture. Dropping the old names loses nothing — a name no client can send grants
// nothing, and an in-flight call from an older desktop falls to the unclassified arm, which GATES.
const OWN_CHANNEL_READ_OPS = ['read', 'status', 'rooms.threads', 'rooms.members'];

// The membership half of `isOwnChannelRead`, without the channel scope — the one question the
// gate REASON also has to ask, so the explainer cannot grow a second copy of the key rule.
function isOwnChannelReadCall(input) {
  return OWN_CHANNEL_READ_OPS.indexOf(channelOpKey(input)) !== -1;
}

// ── A HELD READ IS REFUSED ON A DESKTOP-RUN SESSION (2026-09-01, T85) ─────────────────
//
// The `await` op is gone (2026-09-02): a hold is `op="read"` carrying `wait_ms`. What is denied is
// the HOLD, not a spelling. An unheld `read` stays a member of the read set above, and the two
// statements are not in tension — membership answers "what KIND of call is this", the deny answers
// "may THIS session make it", and collapsing them would make the diag line lie about a
// cross-channel hold.
//
// A DENY AND NOT A GATE. A desktop-run session is woken by the MESSAGE ITSELF
// (`session-dispatch.js › feedLiveSession` delivers an addressed post as a TURN), so a hold adds
// nothing an ended turn does not already get and costs a long-poll plus every token the held
// context is re-read with; a gate would be worse — on a windowless session, a notification a human
// must answer for a call that could not have helped. It is denied ahead of every grant and both
// axes, so no standing grant, posture or operator click can open it: this is not a permission
// question.
//
// `wait_ms != null` is the test, NOT `> 0`. The schema coerces and floors the value; what this asks
// is whether the caller ASKED to be held.
const AWAIT_OP = 'read';
function isAwaitOp(input) {
  return !!input && input.op === AWAIT_OP && input.wait_ms != null;
}

// Read twin of isOwnChannelPost, SAME scoping rule and safe failure: a `channel` naming
// anything but this session's id (slug included) is ANOTHER channel and gates.
function isOwnChannelRead(input, sessionChannelId) {
  const i = input || {};
  if (!isOwnChannelReadCall(i)) return false;
  const target = i.channel;
  if (target == null || target === '') return true;
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

// The own-channel OUTBOUND ops beside the post live in `session-own-outbound.js` (§2 SPLIT,
// 2026-08-24): the two op lists, their union, and the three predicates over it. They are the
// OUTBOUND twin of `isOwnChannelRead` above and share its footing exactly — scoped by CHANNEL only,
// by ID, a slug classifying as another channel. The bar an op must clear to earn this lane is
// written there, not here.

// Grant keys are minted with THIS table's own classifiers, so a key cannot disagree with the branch
// decision about the same call; edit scoping uses the session runtime's own edit-tool names.
const grantKeyFor = makeGrantKeyFor({ isChannelTool, isOwnChannelPost, editToolsFor });

// ── AXIS B: MESSAGE FLOW (what crosses between machines) ──────────────────────────
// Per-session, starts `ask`, resets to `ask` on park. INBOUND half enforced at the inbound gate
// (session-gate.autoInbound / reducer's inboundAutoAccepted); OUTBOUND half enforced here, ONLY
// for a post into the session's OWN channel. Cross-channel post, `op=open direct:true`, invite,
// create_task always gate — that is the cross-user exfil surface.
// ⚠ DOPL'S OWN ENUM, ON EVERY RUNTIME. Unlike Axis A it names no platform tool and no platform
// mode, which is why it did not move to the adapter on 2026-08-31 while its twin did.
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

// ── THE WINDOWLESS FLOOR — THE ONE STATEMENT OF IT (2026-08-20, F-236) ────────────────
//
// A WINDOWLESS session has NO ACCEPT SURFACE. `session-gate.js › enqueue` holds an inbound reply
// whenever `autoInbound(s)` is false, and the whole accept family that used to release one went
// with the session window (F-228). So a held reply is held FOREVER: the session parks at
// `awaiting_inbound`, `io.noteGatedBody` records a body that session-seed and session-history both
// filter out, and the peer's message becomes permanently invisible to the agent — AUDIT D2's
// failure, reached from the other end.
//
// So the IN half is FLOORED at auto. It raises the inbound half and NEVER touches the outbound one:
//     ask            -> auto_inbound     (in: floored; out: still asks)
//     auto_outbound  -> auto_both        (in: floored; out: unchanged, still auto)
//     auto_inbound   -> auto_inbound
//     auto_both      -> auto_both
//
// IT WIDENS SUPERVISION, NEVER CONTAINMENT: Axis B decides whether a MESSAGE crosses, never what a
// tool may do, the profile is checked first, and `grantDecision` returns off Axis B before Axis A
// is consulted.
//
// AND IT IS A FLOOR, NOT A DEFAULT. `channel-prefs.js › windowlessMessageMode` applies the same
// rule at LAUNCH; this is that rule for a session already running, and
// `test/session-mode-floor.test.mjs` pins the two — two spellings of one floor is how one lane
// starts holding messages the other releases. Its Axis-A twin is the adapter's since 2026-08-31,
// because that floor names a vocabulary only one runtime speaks.
function floorWindowlessMessage(mode) {
  const m = normalizeMessageMode(mode);
  if (m === 'auto_inbound' || m === 'auto_both') return m;
  return m === 'auto_outbound' ? 'auto_both' : 'auto_inbound';
}

// AXIS B WITH THE OUT-HALF WITHDRAWN — the PRIVATE TURN's gate (2026-08-22, Samuel's ruling).
//
// The exact inverse of `floorWindowlessMessage` above, and it sits beside it for that reason: that
// one RAISES the IN half because a windowless session has no accept surface, this one LOWERS the
// OUT half because a private answer must not leave the machine on its own. Both are one-line
// transforms over the same frozen enum, and neither may be re-spelled at a call site
// (`session-private.js › effectiveMessageMode` is this one's only caller).
//
// The IN half is preserved exactly, which is why this is not simply `'ask'`: own-channel READS
// follow the INBOUND half, and in a windowless session a gated read is a DENIED read. An agent
// asked a private question about a thread must still be able to go and look at it — the ruling is
// about what LEAVES.
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

// Per-call decision the engine's permission bridge makes:
//   'preapproved' — auto-allow, NO button (profile pre-approved AND shadowed past the callback).
//                   NEVER the channel tool.
//   'deny'        — hard-denied by the profile; checked FIRST, unopenable even via allowForTask.
//   'allow'       — operator granted this tool for the whole task.
//   'gate'        — surface Allow-once / Allow-for-task / Deny and await.
// `input` + `channelId` thread in so the channel tool can be op-scoped; absent toolMode /
// messageMode => most restrictive member of each axis.
// ⚠ ORDER IS THE CONTRACT: hard-deny -> audience belt -> Axis-B channel branch -> preapproved ->
// scoped standing grant -> Axis-A mode -> knowledge read -> gate.
//
// ⚠ `a.runtime` IS THE ONLY NEW ARGUMENT (2026-08-31) AND IT DECIDES NOTHING. It names WHICH
// vocabulary steps 1 and 4 are asked in; the order, the verdicts and every Axis-B lane are the
// same on every runtime. Absent resolves to the default runtime (`main/runtime/index.js ›
// resolve`), which is why every existing caller is byte-unchanged.
function grantDecision(args) {
  const a = args || {};
  const allowForTask = a.allowForTask || [];
  const rt = runtimeFor(a.runtime);
  const cfg = rt.toolConfigFor(a.profile);
  // 0. Name canonicalized ONCE, so hard-deny, pre-approval and the Axis-A modes can never
  //    disagree about which server a tool came from. Non-Dopl names returned untouched. The
  //    GRANT KEY below deliberately keeps the RAW name — a grant is scoped to the shape the
  //    operator was shown, server included.
  const name = canonicalDoplName(a.toolName);
  // 1. HARD DENY, on the canonical name. A deny list a different server prefix walks past is
  //    not a deny list. Not openable by a task grant nor by the widest Axis-A mode — which is
  //    why that mode is never the platform's own bypass switch.
  //    ⚠ THE LIST IS THE RUNTIME'S, AND `null` WOULD BE A LAUNCH BLOCKER, NOT A HIDDEN CONTROL
  //    (`main/runtime/contract.js › LAUNCH_BLOCKING`): this step is the gate's own first check,
  //    so a profile with no list in this runtime's vocabulary has no enforcement at all.
  if (cfg.disallowedTools.indexOf(name) !== -1) return 'deny';
  // 1.5 THE AUDIENCE BELT (plan §4.4 B2) — ahead of the channel branch AND of `preApproved`,
  //     which SHADOWS its tools past the permission bridge entirely. ⚠ A TRIPWIRE; `session-audience.js`.
  if (containerOnlyDenies(a, isDoplToolName)) return 'deny';
  // 2. ⚠ THE INVARIANT — a message op branches to AXIS B here and NEVER reaches Axis A below.
  //    No tool posture, the widest included, can send a message.
  if (isChannelTool(a.toolName)) {
    // Fail-closed: a post whose `to` or `kind` is not a string is malformed — neither the key
    // nor the card can honestly describe it.
    if (!postFieldsOk(a.input)) return 'gate';
    // ⚠ A HELD READ STOPS HERE, BEFORE EVERY GRANT AND BOTH AXES (2026-09-01, T85). See `isAwaitOp`
    // for why it is a deny rather than a gate, and why it is not a permission question.
    if (isAwaitOp(a.input)) return 'deny';
    // ⚠ ONLY a standing grant for THIS EXACT shape allows without a button. No bare-tool-name
    // fallback: that turns one channel grant (even on op=read) into a grant for op=open.
    if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId, a.runtime)) !== -1) return 'allow';
    // auto_outbound / auto_both: ONLY an own-channel post — everything else is the exfil
    // surface and gates.
    if (autoOutboundMode(a.messageMode) && isOwnChannelPost(a.input, a.channelId)) return 'allow';
    // Own-channel MARKERS, THREAD OPENS, DECISION CARDS and — since 2026-09-06 — ARTIFACT FOLDS,
    // all on the same outbound half (`OWN_CHANNEL_OUTBOUND_OPS`, the union). Every one of them
    // acts into THIS session's own channel, which is what the outbound half consents to; a
    // slug-addressed one classifies cross-channel and gates, exactly like a post.
    // The argument each was admitted on is in `session-own-outbound.js`, not here, and the fold is
    // the FOURTH time this line has been the fix for a live windowless DENY. Read that module
    // before a fifth op joins.
    if (autoOutboundMode(a.messageMode) && isOwnChannelOutbound(a.input, a.channelId)) return 'allow';
    // ⚠ THE OWN-MACHINE LAUNCH LANE, WHICH IS NOT A MEMBER OF THE OUTBOUND SET ABOVE: it needs
    // BOTH axes and a DEPTH BOUND, and `session-own-launch.js` carries all three arguments.
    if (isOwnMachineLaunch(a.input, a.channelId)) return launchLaneVerdict(a, autoOutboundMode(a.messageMode));
    // ⚠ THE OWN-MACHINE DIRECT LANE (2026-08-31): SAME conjunction, SEPARATE list, NO depth question — `session-own-direct.js` carries all three arguments, including why sameness is not a reason to merge them. Its READ twin was `read_directions`, which B8 RETIRED into `status`; that op is on the inbound list above under its live name.
    if (isOwnMachineDirect(a.input, a.channelId)) return directLaneVerdict(a, autoOutboundMode(a.messageMode));
    // ⚠ THE OWN-MACHINE MANAGE LANE (2026-09-17): `manage.rename` / `manage.end` / `manage.posture`, the SAME conjunction again and NO depth question — `session-own-manage.js` carries the argument, including why a depth question here would deny the very sessions the lane was filed for (a launched agent is AT the cap by construction, and the shipped Coder identity has every coder rename itself on start).
    if (isOwnMachineManage(a.input, a.channelId)) return manageLaneVerdict(a, autoOutboundMode(a.messageMode));
    // Own-channel READ follows the INBOUND half: a read sends nothing, it brings the peer's
    // words into context unseen — what auto_inbound consents to. `auto_outbound` alone does
    // NOT cover it.
    if (autoInboundMode(a.messageMode) && isOwnChannelRead(a.input, a.channelId)) return 'allow';
    return 'gate';
  }
  if (cfg.preApproved.indexOf(name) !== -1) return 'preapproved';
  // 3. Scoped standing grant: keyed on the SHAPE the operator saw, so RAW name here.
  if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId, a.runtime)) !== -1) return 'allow';
  // 4. AXIS A, IN THIS RUNTIME'S OWN MODE VOCABULARY. Message flow never consulted here — the
  //    other half of the invariant. Fail-closed per runtime: an unknown mode allows nothing.
  if (rt.axisAAllows(a.toolMode, name)) return 'allow';
  // 5. THE OP-SCOPED KNOWLEDGE READ (2026-08-22, OQ-1). Same shape as the Axis-B channel branch
  //    above and for the same reason: one tool carries a read AND a write surface, so a WHOLE-TOOL
  //    verdict has to pick the wrong one. `dopl_kb` is a `DOPL_WRITE_TOOL` (seven of its twelve ops
  //    write to the shared workspace), so Axis A misses it at the middle mode, and a miss in a
  //    WINDOWLESS session is a DENY, not a question. Only the READ ops land here; the writes fall
  //    through to `gate`. LAST, after Axis A, so the widest mode is still Axis A's answer and this
  //    narrows nothing; unreachable under `read_only`, which hard-denies the tool at step 1. Asked
  //    of a REAL MEMBER rather than by naming modes — see `session-dopl-tools.js`.
  if (isKnowledgeReadCall(name, a.input) && rt.axisAAllows(a.toolMode, DOPL_READ_REFERENCE)) return 'allow';
  return 'gate';
}

// ─── END SESSION-PROFILE TABLE ───

// Built OUTSIDE the extracted table so the block stays self-contained and grantDecision's
// shape/ordering is byte-unchanged: an explanation must not be able to move a gate. Handed THIS
// table's own predicates, so the explainer can never classify differently from the gate. The three
// Axis-A predicates are runtime-resolved since 2026-08-31 and each takes the session's runtime as a
// trailing argument — the explainer must ask the SAME runtime the gate asked.
const grantDecisionDetail = makeGrantDetail(grantDecision, {
  isChannelTool, isOwnChannelPost, isOwnChannelRead, postFieldsOk, grantKeyFor,
  OWN_CHANNEL_READ_OPS, isOwnChannelReadCall, normalizeToolMode, isAwaitOp, // 2026-09-01 (T85): the await refusal
  canonicalDoplName, isOwnChannelMarker, isOwnChannelThreadOpen, isOwnChannelEscalate, isOwnChannelOutbound,
  isOwnChannelArtifact, isOwnChannelOutboundCall, // 2026-09-06: the fold's ALLOW code, and the membership half its CROSS-channel arm asks
  OWN_CHANNEL_OUTBOUND_OPS, isOwnMachineLaunch, isOwnMachineDirect, // 2026-08-25 (F-320): the own-machine launch lane; 2026-08-31: its direct twin
  // 2026-09-17: the MANAGE lane's membership half and its per-action ALLOW code. The CODE MAP is the lane's, injected like every other predicate, so the explainer cannot grow a second opinion about which verb ran.
  isOwnMachineManage, manageAllowReason,
  // 2026-08-22 (OQ-1): the two the op-scoped knowledge allow is explained by. Injected, like
  // every other predicate here, so the explainer cannot grow its own copy of the rule.
  toolModeAllows, isKnowledgeReadCall,
  // 2026-08-31: "is this name in ANY of this runtime's Axis-A lists?" — the question
  // `unclassified-tool` asks, expressed as the widest mode rather than as a copy of a list.
  isClassifiedTool,
  // 2026-08-26 (B2): the SAME predicate the gate denies on, so the explainer cannot disagree
  // with it about which refusal an operator is looking at.
  containerOnlyDenies, isDoplTool: isDoplToolName, buildSessionToolConfig,
});

module.exports = {
  buildSessionToolConfig, grantDecision, isOwnChannelPost,
  isOwnChannelRead, OWN_CHANNEL_READ_OPS, // own-channel READ set, Axis B inbound half
  isOwnChannelReadCall, // 2026-09-02 (F-578): its membership half, keyed <op>.<action>
  channelOpKey, // re-exported from channel-op-key.js — the key every channel classifier reads
  isAwaitOp, // 2026-09-01 (T85): the one op a desktop-run session is refused outright
  // Axis B's OUTBOUND half — re-exported from session-own-outbound.js (§2 SPLIT, 2026-08-24), which
  // carries the ARGUMENT each of the three was admitted on and why each keeps its own constant.
  // ⚠ 2026-09-02 (F-578): the three are SHAPES of `send` now, so the constants are the `kind` /
  // `thread` literals that tell them apart rather than three retired op names.
  isOwnChannelMarker, OWN_CHANNEL_MARKER_KIND, isOwnChannelThreadOpen, OWN_CHANNEL_THREAD_NEW,
  isOwnChannelEscalate, OWN_CHANNEL_ESCALATE_KIND,
  // 2026-09-06: the ARTIFACT FOLD — the fourth member of the lane and the first that is not a
  // `send`. Its four `<op>.<action>` keys, the predicate, and the two halves of the union named
  // separately: the SHAPE predicates above ask `OWN_CHANNEL_SEND_OPS`, the gate asks the union.
  isOwnChannelArtifact, OWN_CHANNEL_ARTIFACT_OPS, OWN_CHANNEL_SEND_OPS,
  isOwnChannelOutboundCall, // ...and its membership half, keyed <op>.<action> like the read twin
  isOwnChannelOutbound, OWN_CHANNEL_OUTBOUND_OPS, // the union grantDecision's Axis-B branch asks
  // 2026-09-17: the OWN-MACHINE MANAGE LANE — re-exported from session-own-manage.js (§2 SPLIT), which carries the admission argument for `rename` / `end` / `posture` and why each keeps its own audit code.
  isOwnMachineManage, OWN_MACHINE_MANAGE_OPS, manageAllowReason,
  isKnowledgeReadCall, // 2026-08-22 (OQ-1): re-exported from knowledge-ops, the op-scoped kb read
  DOPL_READ_REFERENCE, // the member the knowledge branch asks "where does a Dopl read resolve?"
  mcpShortName, canonicalDoplName, // re-exported from mcp-tool-names
  grantDecisionDetail, GATE_REASONS,
  grantKeyFor, // scoped allowForTask key for EVERY tool class
  POST_GRANT, // own-channel post BASE; a real key extends it (to/kind/body segments)
  isChannelTool, // session-io uses it too
  // THE TWO AXES ARE COPIED, AND THE COUNT IS RE-MEASURED (2026-08-20): this tree's copies are
  // `session-state.js` (the reducer's own fail-closed coercion) and `channel-prefs.js` (the durable
  // posture's WRITE validator), and `test/session-permission-axes` pins all three against each
  // other — the third REJECTS a value outside its lists, so a fifth mode would have made the
  // posture silently unwritable. A FOURTH copy lives in the SPA
  // (`src/features/channels/lib/permission-modes.ts`), out of this tree's reach and re-validated
  // here on arrival. Change here => change in three places.
  TOOL_MODES, MESSAGE_MODES,
  // The DEFAULT runtime's Axis-A taxonomy, read off its descriptor — see the block above for why
  // these are declared data and why no gate decision may compare against them.
  EDIT_TOOLS, ESCALATION_TOOLS, AUTO_TOOLS, BYPASS_TOOLS, BYPASS_READS,
  DOPL_READ_TOOLS, DOPL_WRITE_TOOLS, // re-exported from session-dopl-tools.js (§2 SPLIT 2026-08-31)
  normalizeToolMode, normalizeMessageMode, toolModeAllows, isClassifiedTool, autoInboundMode,
  toolModesFor, // a session's own Axis-A words, narrowest first
  // `autoOutboundMode` is exported since 2026-09-06 (Samuel's full-auto ruling); its INBOUND twin
  // has been since M3. Exported rather than re-spelled in `session-private.js ›
  // effectiveMessageMode`: "does this posture consent to posting" must have ONE answer, or the gate
  // and the private-turn rule can disagree about a mode.
  autoOutboundMode,
  floorWindowlessMessage, // AXIS B's windowless floor — one statement, two lanes (F-236)
  floorWindowlessTool, // ...and AXIS A's, now the RUNTIME's (§0.1b) — applied at the READ (session-io.js › grantArgs)
  windowlessFloorRefusal, // D1: and the LAUNCH refusal when that floor cannot be ordered
  axisBOpScopedWarning, // D3: Axis B's collapse warning — a WARNING, because it fails closed
  privateTurnMessageMode, // ...and its inverse: the PRIVATE TURN withdraws the OUT half
};
