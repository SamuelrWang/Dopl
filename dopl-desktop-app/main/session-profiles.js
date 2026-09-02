// SESSION-mode gate. The DECISION — its order, its four verdicts, its reason codes, both message
// axes and every own-channel lane — and nothing about which runtime is driving the session.
//
// ⚠ THE AXIS-A TAIL LEFT ON 2026-08-31 (runtime-adapter port, §0.1b). `buildSessionToolConfig`,
// `TOOL_MODES`, `normalizeToolMode`, `toolModeAllows`, `AUTO_TOOLS`, `BYPASS_TOOLS`,
// `BYPASS_READS`, `EDIT_TOOLS`, `ESCALATION_TOOLS` and `floorWindowlessTool` now live in the
// RUNTIME ADAPTER (`main/runtime/claude/tools.js` for the one runtime registered today), because
// every one of them is a vocabulary of one runtime's BUILT-IN tool names. A runtime storing Axis A
// as its own words would resolve every call to the most restrictive mode -> false -> gate -> and,
// on a windowless session, DENY. They are re-exported at the bottom for the callers that ask
// without a session in hand; the DEFINITIONS are the adapter's and core holds no copy.
//
// ⚠ WHAT STAYED, AND WHY IT IS NOT ARBITRARY: everything below is DOPL'S, not a platform's.
// `grantDecision`'s order, the four verdicts, the reason codes, `UNIVERSAL_HARD_DENY`, every
// Axis-B lane, `floorWindowlessMessage`, the private-turn withdrawal and the grant keys carry no
// runtime vocabulary at all. `mcp__dopl__*` names are ours on every runtime and live in
// `main/session-dopl-tools.js`, which each adapter's `tools.js` COMPOSES rather than re-derives.
//
// TWO AXES, because an outbound message is technically a tool call (`dopl_channel op=post`) on
// the same permission plumbing as Bash:
//   AXIS A (toolMode)    what MY agent may do here — the RUNTIME's mode vocabulary.
//   AXIS B (messageMode) ask | auto_inbound | auto_outbound | auto_both — what crosses. DOPL'S.
// ⚠ INVARIANT: Axis A can NEVER auto-approve a message op; Axis B can NEVER auto-approve a work
// tool. grantDecision branches the channel tool to Axis B BEFORE any Axis A mode is consulted, and
// no other tool reads messageMode.
//
// ⚠ SHADOW GOTCHA: a tool in the platform's pre-approval list SHADOWS the held callback —
// auto-approved before any button appears. `preApproved` may hold ONLY silent-grant tools; a
// live-gated tool must NEVER appear there.
//
// ⚠ Modes are resolved HERE, never via a platform's own permission-mode switch: a bypass mode
// stops the platform calling our callback at all, killing the outbound message card and the
// hard-deny path. The launch spec pins the platform's mode to its most conservative value.
//
// PURE module (no electron/fs/SDK). `main/runtime/index.js` is electron-free at load BY CONTRACT
// (`main/runtime/claude/index.js` lazy-requires its platform half) precisely so this file can ask
// it. test/session-profiles + test/sdk-grant slice the block below and inject `runtimeFor`, the
// tool-profiles constants, `normalizeProfile`, `shaKey` and the two mcp-tool-names normalizers.

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
  isOwnChannelMarker, isOwnChannelThreadOpen, isOwnChannelEscalate, isOwnChannelOutbound,
} = require('./session-own-outbound');
const { channelOpKey } = require('./channel-op-key'); // <op>.<action>, the ONE spelling every classifier here asks (F-578)
const { isOwnMachineLaunch, launchLaneVerdict } = require('./session-own-launch'); // THE OWN-MACHINE LAUNCH LANE (Samuel's ruling, 2026-08-25; F-320) — its own §2 file, on F-301's precedent
const { isOwnMachineDirect, directLaneVerdict } = require('./session-own-direct'); // THE OWN-MACHINE DIRECT LANE (Samuel's ruling, 2026-08-31) — same conjunction, its own §2 file, and DELIBERATELY not a member of the launch list: that one carries the depth bound and folding this in would make private directions depend on the agent-chaining setting
// DOPL'S OWN SURFACE, §2-SPLIT 2026-08-31 so BOTH sides of the runtime seam can read it without a
// cycle. `mcp__dopl__*` names are runtime-independent; each adapter's `tools.js` composes them.
const { DOPL_READ_TOOLS, DOPL_WRITE_TOOLS, DOPL_READ_REFERENCE } = require('./session-dopl-tools');
// ⚠ THE REGISTRY, NOT AN ADAPTER. This is the ONLY require in core that reaches the runtime layer
// for a gate decision, and it names no vendor: `runtimeFor(id)` answers with the sixteen contract
// methods and nothing else (`main/runtime/contract.js › RUNTIME_METHODS`).
const runtimeRegistry = require('./runtime');
const { DOPL_CHANNEL_TOOL } = require('./tool-profiles');

// ── THE RUNTIME-RESOLVED AXIS-A SURFACE ──────────────────────────────────────────────────────
//
// ⚠ DELEGATES, NOT DEFINITIONS. Each one asks `main/runtime/index.js` for the session's runtime
// and calls a `contract.js › RUNTIME_METHODS` member or reads a descriptor field. Core holds no
// copy of any tool name and no copy of any Axis-A mode, which is what
// `test/core-vocabulary.test.mjs` exists to keep true.
// ⚠ THE TRAILING `runtimeId` IS OPTIONAL AND ABSENT MEANS THE DEFAULT RUNTIME. Some callers hold
// a session (the gate; `session-io.js › grantArgs`) and some do not (the durable posture's WRITE
// validator, which runs before a runtime is chosen). Making the argument required would have
// forced the second group to invent one, which is worse than resolving the default in one place.
// ⚠ DECLARED ABOVE THE TABLE, NOT BELOW IT: `grantDecisionDetail` is built at module load and is
// handed three of them, so a `const` after the block would be a TDZ crash at require time.
const runtimeFor = (runtimeId) => runtimeRegistry.runtimeFor(runtimeId);
const descriptorFor = (runtimeId) => runtimeRegistry.descriptorFor(runtimeId);
const cap = runtimeRegistry.capability;

const buildSessionToolConfig = (profile, runtimeId) => runtimeFor(runtimeId).toolConfigFor(profile);
const toolModeAllows = (mode, toolName, runtimeId) => runtimeFor(runtimeId).axisAAllows(mode, toolName);
const normalizeToolMode = (mode, runtimeId) => cap.normalizeToolMode(descriptorFor(runtimeId), mode);
const floorWindowlessTool = (mode, runtimeId) => cap.floorWindowlessTool(descriptorFor(runtimeId), mode);
// ⚠ WHY A WINDOWLESS LAUNCH IS REFUSED ON THIS RUNTIME, or `null` (2026-09-01, D1). The twin of
// `floorWindowlessTool` above: that one answers `null` when there is no orderable floor, and this
// one is the sentence that goes with it. Read at the LAUNCH (`session-launch.js`) rather than at
// the gate, because the harm is a session that runs and denies its own reads — a refusal after the
// spawn is a refusal nobody can act on.
const windowlessFloorRefusal = (runtimeId) => cap.windowlessFloorRefusal(descriptorFor(runtimeId));
// ⚠ AXIS B'S COLLAPSE WARNING (2026-09-01, D3), or `null`. A WARNING, not a refusal: a runtime
// whose gate cannot read a channel call's op fails CLOSED (unreadable input -> `gate` -> a
// windowless deny), so the agent is broken and the boundary is not. Carried at the launch because
// that is the only moment an operator can act on it.
const axisBOpScopedWarning = (runtimeId) => cap.axisBOpScopedWarning(descriptorFor(runtimeId));
// "In no Axis-A list at all", asked as "not allowed even at the WIDEST mode this runtime offers".
// ⚠ NOT A COPY OF A LIST: the widest mode is the last entry of `descriptor.toolMode.options`, so
// a runtime whose widest mode is not spelled `bypass` still answers correctly. This is the
// question `session-gate-reason.js › toolReason` asks to separate "in no list this build knows"
// from "known, but not covered by the posture you set" — the conflation that made bypass look
// broken and bought that whole module.
const isClassifiedTool = (toolName, runtimeId) =>
  runtimeFor(runtimeId).axisAAllows(cap.widestToolMode(descriptorFor(runtimeId)), toolName);

// ⚠ THE AXIS-A MODE ENUM, READ OFF THE DEFAULT RUNTIME. The three core copies this is pinned
// against (`session-state.js`'s reducer coercion, `channel-prefs.js`'s durable WRITE validator,
// and the SPA's `permission-modes.ts` re-validated here on arrival) all coerce a posture stored
// BEFORE a runtime is chosen, so there is one answer to give them today. When a second adapter
// registers, the UI renders `descriptor.toolMode.options` per agent (§3.1) and these coercions
// take the agent's runtime — a step-5 change, not a step-3 one.
const TOOL_MODES = cap.toolModes(descriptorFor(null));

// ⚠ THE AXIS-A TAXONOMY, READ OFF THE DEFAULT RUNTIME'S DESCRIPTOR — NOT A COPY AND NOT A
// MODULE REFERENCE. Every list below is a spelling of ONE runtime's built-in tool names; core
// must not hold one and must not name the module that defines one, so they arrive as DECLARED
// DATA through the same frozen descriptor the UI reads. A GATE DECISION never touches them: it
// asks `toolModeAllows` / `isClassifiedTool`, resolved against the session's own runtime, because
// only that runtime knows how its modes compose its lists. These exist for the suites that pin a
// runtime's taxonomy and for a caller with no session in hand.
const TAXONOMY = cap.toolTaxonomy(descriptorFor(null));
const AUTO_TOOLS = TAXONOMY.auto;
const BYPASS_TOOLS = TAXONOMY.bypass;
const BYPASS_READS = TAXONOMY.bypassReads;
const ESCALATION_TOOLS = TAXONOMY.escalation;

// ⚠ THE EDIT-SCOPED NAMES, READ OFF THE DESCRIPTOR RATHER THAN LISTED. `session-grant-keys.js ›
// makeGrantKeyFor` scopes an edit grant to the RESOLVED DIRECTORY of the file it was shown, so it
// has to know which tool names carry a path — a per-runtime fact. ⚠ That module still names
// `Bash` and the web tools directly, which is a SECOND core-held built-in vocabulary this wave
// did not move; it is on the deferred list in `test/core-vocabulary.test.mjs` with the step that
// owns it, not left as an absence someone re-derives.
const EDIT_TOOLS = cap.editScopedTools(descriptorFor(null));

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
// `members` is a roster the session's prompt framing already carries.
//
// ⚠ **KEYED `<op>.<action>` SINCE THE FIVE-OP COLLAPSE (2026-09-02, F-578)**, through
// `channel-op-key.js › channelOpKey`. The seven names this list used to hold — `read`, `await`,
// `list_threads`, `get_thread`, `members`, `read_sessions`, `read_directions` — are gone from the
// tool's enum, and a desktop that still matched on them classified EVERY new spelling as
// unclassified, which gates: a notification a human must answer for the call the old name would
// have allowed. The mapping is one-to-one and adds nothing: `read` absorbed `await` (a hold is
// `wait_ms`) and `get_thread` (a scoped read is `thread=`); `status` is `read_sessions` +
// `read_directions`; `rooms.threads` is `list_threads` and `rooms.members` is `members`.
//
// ⚠ **`rooms` IS ON THIS LIST ONLY BY ACTION, AND THAT IS THE WHOLE REASON THE KEY IS DOTTED.**
// Four of its eight actions WRITE (`open`, `invite`, `thread_mode`, `update`) — the same four
// `gating.ts › WRITE_OPS` names — so a bare `rooms` entry would hand the inbound half of the axis
// a lane that opens channels and invites people into them. It is the widening F-578 warns about,
// and it is refused here by construction.
//
// ⚠ `rooms.list` IS READ-ONLY AND IS STILL NOT HERE, for the reason its predecessor `list` was
// not: it enumerates EVERY channel and DM this account can reach, so it is not own-channel-scoped.
// `rooms.help` is not here either — `help` was never on this list, and the collapse is not the
// place to widen it. Every `send` and every `manage` stays gated in every posture.
//
// ⚠ THE OLD NAMES ARE GONE FROM THE LIST AND THAT LOSES NOTHING. A name no client can send
// grants nothing, and an in-flight call from an older desktop falls to the unclassified arm,
// which GATES — the safe direction. Only the ALLOW side shrinks; nothing leaks.
const OWN_CHANNEL_READ_OPS = ['read', 'status', 'rooms.threads', 'rooms.members'];

// The membership half of `isOwnChannelRead`, without the channel scope — the one question the
// gate REASON also has to ask, so the explainer cannot grow a second copy of the key rule.
function isOwnChannelReadCall(input) {
  return OWN_CHANNEL_READ_OPS.indexOf(channelOpKey(input)) !== -1;
}

// ── ⚠ A HELD READ IS REFUSED ON A DESKTOP-RUN SESSION (2026-09-01, T85) ────────────────
//
// The `await` OP is gone (2026-09-02): a hold is `op="read"` carrying `wait_ms`, one lane
// instead of two. The refusal did not move with it — what is denied is the HOLD, not a spelling.
//
// An unheld `read` stays a member of the read set above — it IS an own-channel read, and the
// classifier is what `session-gate-reason.js › channelReason` uses to say "another channel"
// rather than "unknown op" — and `grantDecision` denies the held one before that allow can be
// reached. The two statements are not in tension: membership answers "what KIND of call is
// this", the deny answers "may THIS session make it", and collapsing them would make the diag
// line lie about a cross-channel hold.
//
// ⚠ WHY A DENY AND NOT A GATE. A desktop-run session is woken by the MESSAGE ITSELF — the
// listener's delivery (`session-dispatch.js › feedLiveSession`) delivers an addressed post as a
// TURN — so a hold adds nothing an ended turn does not already get, and it costs a long-poll
// plus every token the held context is re-read with. A GATE would be worse than either: on a
// windowless session it becomes a notification a human must answer for a call that could not
// have helped.
//
// ⚠ IT IS DENIED AHEAD OF EVERY GRANT AND BOTH AXES, so no standing grant, no posture and no
// operator click can open it. That is deliberate: this is not a permission question. There is
// nothing on this machine that makes the call useful, so an "allow" would be a mistake a
// surface let somebody make.
//
// ⚠ `wait_ms != null` IS THE TEST, NOT `> 0`. The schema coerces and floors the value; what this
// asks is whether the caller ASKED to be held, and an argument the server may clamp to zero is
// still that request. Absent (or explicitly null) is an ordinary read.
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

// ⚠ THE OWN-CHANNEL OUTBOUND OPS BESIDE THE POST live in `session-own-outbound.js` (§2 SPLIT,
// 2026-08-24): the two op lists, their union, and the three predicates over it. They are the
// OUTBOUND twin of `isOwnChannelRead` above and share its footing exactly — scoped by CHANNEL
// only, by ID, a slug classifying as another channel. ⚠ Read that module before adding a third
// op: the bar an op has to clear to earn this lane is written there, not here.

// ⚠ Grant-key machinery (session-grant-keys.js) is BOUND with THIS table's own classifiers, so
// a key can never disagree with the branch decision about the same call. `EDIT_TOOLS` is the
// RUNTIME's list (`descriptor`-declared, adapter-owned) and is read off the DEFAULT runtime here
// for the same reason the re-exports at the bottom exist: a grant key is minted from the shape
// the operator was SHOWN, and this tree shows one runtime's shapes today.
const grantKeyFor = makeGrantKeyFor({ isChannelTool, isOwnChannelPost, EDIT_TOOLS });

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
//
// ⚠ ITS AXIS-A TWIN IS THE ADAPTER'S SINCE 2026-08-31 and the asymmetry is the argument, not an
// accident: this floor moves between members of a DOPL enum every runtime shares, while that one
// names a member of a vocabulary only one runtime speaks (`descriptor.toolMode.windowlessFloor`,
// applied by `main/runtime/capability.js › floorWindowlessTool`). They were written side by side
// and the halves still explain each other.
function floorWindowlessMessage(mode) {
  const m = normalizeMessageMode(mode);
  if (m === 'auto_inbound' || m === 'auto_both') return m;
  return m === 'auto_outbound' ? 'auto_both' : 'auto_inbound';
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
    if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1) return 'allow';
    // auto_outbound / auto_both: ONLY an own-channel post — everything else is the exfil
    // surface and gates.
    if (autoOutboundMode(a.messageMode) && isOwnChannelPost(a.input, a.channelId)) return 'allow';
    // Own-channel MARKERS and THREAD OPENS, same outbound half (OWN_CHANNEL_OUTBOUND_OPS —
    // `milestone`, and `create_thread` since Samuel's ruling of 2026-08-24). Both are outbound
    // CONTENT into this session's own channel, which is what the outbound half consents to; a
    // slug-addressed one classifies cross-channel and gates, exactly like a post.
    if (autoOutboundMode(a.messageMode) && isOwnChannelOutbound(a.input, a.channelId)) return 'allow';
    // ⚠ THE OWN-MACHINE LAUNCH LANE, WHICH IS NOT A MEMBER OF THE OUTBOUND SET ABOVE: it needs
    // BOTH axes and a DEPTH BOUND, and `session-own-launch.js` carries all three arguments.
    if (isOwnMachineLaunch(a.input, a.channelId)) return launchLaneVerdict(a, autoOutboundMode(a.messageMode));
    // ⚠ THE OWN-MACHINE DIRECT LANE (2026-08-31): SAME conjunction, SEPARATE list, NO depth question — `session-own-direct.js` carries all three arguments, including why sameness is not a reason to merge them. Its READ twin `read_directions` is on the inbound list above.
    if (isOwnMachineDirect(a.input, a.channelId)) return directLaneVerdict(a, autoOutboundMode(a.messageMode));
    // Own-channel READ follows the INBOUND half: a read sends nothing, it brings the peer's
    // words into context unseen — what auto_inbound consents to. `auto_outbound` alone does
    // NOT cover it.
    if (autoInboundMode(a.messageMode) && isOwnChannelRead(a.input, a.channelId)) return 'allow';
    return 'gate';
  }
  if (cfg.preApproved.indexOf(name) !== -1) return 'preapproved';
  // 3. Scoped standing grant: keyed on the SHAPE the operator saw, so RAW name here.
  if (allowForTask.indexOf(grantKeyFor(a.toolName, a.input, a.channelId)) !== -1) return 'allow';
  // 4. AXIS A, IN THIS RUNTIME'S OWN MODE VOCABULARY. Message flow never consulted here — the
  //    other half of the invariant. Fail-closed per runtime: an unknown mode allows nothing.
  if (rt.axisAAllows(a.toolMode, name)) return 'allow';
  // 5. ⚠ THE OP-SCOPED KNOWLEDGE READ (2026-08-22, OQ-1). SAME SHAPE AS THE AXIS-B CHANNEL
  //    BRANCH ABOVE AND FOR THE SAME REASON: one tool carries a read AND a write surface, so a
  //    WHOLE-TOOL verdict has to pick the wrong one. `dopl_kb` is a `DOPL_WRITE_TOOL` (correctly
  //    — seven of its twelve ops write to the shared workspace), so Axis A misses it at the
  //    middle mode, and a miss in a WINDOWLESS session is a DENY, not a question. Only the READ
  //    ops land here; the writes fall through to `gate` as before. ⚠ LAST, AFTER Axis A, so the
  //    widest mode (which does cover the whole tool) is still Axis A's answer and this narrows
  //    nothing. ⚠ AND UNREACHABLE UNDER `read_only`, which hard-denies the tool at step 1.
  //    ⚠ ASKED OF A REAL MEMBER rather than by naming modes — see `session-dopl-tools.js ›
  //    DOPL_READ_REFERENCE` for why a second statement of membership drifts.
  if (isKnowledgeReadCall(name, a.input) && rt.axisAAllows(a.toolMode, DOPL_READ_REFERENCE)) return 'allow';
  return 'gate';
}

// ─── END SESSION-PROFILE TABLE ───

// ⚠ Built OUTSIDE the extracted table so the block stays self-contained and grantDecision's
// shape/ordering is byte-unchanged: an explanation must not be able to move a gate. Handed THIS
// table's own predicates, so the explainer can never classify differently from the gate.
//
// ⚠ THE THREE AXIS-A PREDICATES ARE RUNTIME-RESOLVED SINCE 2026-08-31 and each takes the
// session's runtime as a trailing argument. The explainer must ask the SAME runtime the gate
// asked, or a Codex session's `unclassified-tool` would be narrated against Claude's lists.
const grantDecisionDetail = makeGrantDetail(grantDecision, {
  isChannelTool, isOwnChannelPost, isOwnChannelRead, postFieldsOk, grantKeyFor,
  OWN_CHANNEL_READ_OPS, isOwnChannelReadCall, normalizeToolMode, isAwaitOp, // 2026-09-01 (T85): the await refusal
  canonicalDoplName, isOwnChannelMarker, isOwnChannelThreadOpen, isOwnChannelEscalate, isOwnChannelOutbound,
  OWN_CHANNEL_OUTBOUND_OPS, isOwnMachineLaunch, isOwnMachineDirect, // 2026-08-25 (F-320): the own-machine launch lane; 2026-08-31: its direct twin
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
  isOwnChannelOutbound, OWN_CHANNEL_OUTBOUND_OPS, // the union grantDecision's Axis-B branch asks
  isKnowledgeReadCall, // 2026-08-22 (OQ-1): re-exported from knowledge-ops, the op-scoped kb read
  DOPL_READ_REFERENCE, // the member the knowledge branch asks "where does a Dopl read resolve?"
  mcpShortName, canonicalDoplName, // re-exported from mcp-tool-names
  grantDecisionDetail, GATE_REASONS,
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
  TOOL_MODES, MESSAGE_MODES,
  // The DEFAULT runtime's Axis-A taxonomy, read off its descriptor — see the block above for why
  // these are declared data and why no gate decision may compare against them.
  EDIT_TOOLS, ESCALATION_TOOLS, AUTO_TOOLS, BYPASS_TOOLS, BYPASS_READS,
  DOPL_READ_TOOLS, DOPL_WRITE_TOOLS, // re-exported from session-dopl-tools.js (§2 SPLIT 2026-08-31)
  normalizeToolMode, normalizeMessageMode, toolModeAllows, isClassifiedTool, autoInboundMode,
  floorWindowlessMessage, // AXIS B's windowless floor — one statement, two lanes (F-236)
  floorWindowlessTool, // ...and AXIS A's, now the RUNTIME's (§0.1b) — applied at the READ (session-io.js › grantArgs)
  windowlessFloorRefusal, // D1: and the LAUNCH refusal when that floor cannot be ordered
  axisBOpScopedWarning, // D3: Axis B's collapse warning — a WARNING, because it fails closed
  privateTurnMessageMode, // ...and its inverse: the PRIVATE TURN withdraws the OUT half
};
