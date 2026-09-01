// AXIS B's ENFORCEMENT POINT ON THIS RUNTIME — the app-server's held approval request, and the
// verdict-free `PreToolUse` stamp that rides beside it.
//
// ⚠ AXIS B IS DOPL'S PLANE AND HAS NO ENFORCEMENT POINT OF ITS OWN. The Dopl MCP server is remote
// HTTP on every runtime, so the desktop main process is NOT in the call path of a channel call;
// and no posture field ever crosses the wire, so `packages/mcp-server` does not know what Axis B
// is set to and could not refuse the post. Axis B therefore needs an in-process tool boundary OR a
// held callback, and where neither exists there is no outbound gate at all — the gate coming off,
// not a hidden capability (`main/runtime/contract.js › LAUNCH_BLOCKING`).
//
// ⚠ THIS RUNTIME'S ANSWER IS `held-callback`, AND IT IS A REAL ONE.
// `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` are server->client
// JSON-RPC REQUESTS: the app-server blocks the turn until the client answers `accept` /
// `acceptForSession` / `decline` / `cancel`, then emits `serverRequest/resolved`
// (`codex-research.md` §1). A request that blocks the turn on OUR answer is exactly what makes the
// outbound consent card representable.
//
// ⚠ AND THE ONE THING THAT IS NOT PROVEN ABOUT IT IS WHERE AXIS B'S OWN CALL ENTERS.
// `dopl_channel` is an MCP tool, not a command execution or a file change, and the research does
// not settle two things about MCP-tool approvals:
//   §5 C3 — are MCP tool calls a DISTINCT client-answerable request type, or folded into
//           `commandExecution`? The `granular` table naming `mcp_elicitations` separately suggests
//           distinct. ⚠ IF THERE IS NO CLIENT-ANSWERABLE REQUEST FOR AN MCP TOOL AT ALL, THIS
//           RUNTIME'S `enforcementPoint` IS NOT `held-callback` FOR AXIS B AND THE ADAPTER MUST
//           NOT SHIP. That is a higher stake than the research's own framing of C3 and it is
//           recorded as such in the design's §5 amendment.
//   §5 C1 — does that request carry the call's ARGUMENTS? Dopl's Axis B is op-scoped and
//           input-scoped (`isOwnChannelPost` / `isOwnChannelRead` read `input.op` and
//           `input.channel`; `postFieldsOk` validates `to`/`kind`; `grantKeyFor` scopes a standing
//           grant to body/to/kind). Argument-less means Axis B collapses from op-scoped to
//           WHOLE-TOOL: every channel call gates, READS INCLUDED, and a held inbound on a
//           windowless session is then held forever — the exact failure
//           `session-profiles.js › floorWindowlessMessage` exists to prevent.
// `descriptor.opScoped` is `'unverified'` until C1 answers, which `capability.js › axisBOpScoped`
// reads as NOT op-scoped — the fail-closed direction, and the one that is true today.
//
// ⚠ `axisBTools()` IS NULL HERE BY DECLARATION, NOT BY OMISSION: the enforcement point is the held
// callback, so there is nothing to implement in-process. A runtime whose channel ops ARE in-process
// implementations must not let them ride a pre-approval list — that shadow is defensible for a
// display verb and indefensible for the call that has to gate.

// ⚠ THE BRIDGE IS LAZY, AND THAT IS A LOAD-ORDER CONTRACT, NOT A STYLE. `session-gate-bridge.js`
// reads `session-profiles.js`, which asks `main/runtime/index.js` for every gate decision — so a
// top-level require here would close the loop and hand the gate a half-initialised module whose
// exports are `undefined` at exactly the moment it asks for a deny list.
const bridge = () => require('../../session-gate-bridge');
const outboundTag = () => require('../../session-outbound-tag');
const approval = require('./approval');

/**
 * The held approval callback this runtime's client wires.
 *
 * `name` is `approval.js › toolNameFor`'s answer for the raw request — one of Codex's own item or
 * category words, or an MCP tool name. `input` is the call's arguments where the request carries
 * them (§5 C1) and `{}` where it does not; `opts` carries the request id and title.
 *
 * ⚠ THE PROMISE IS THE MECHANISM, NOT A DETAIL: the app-server BLOCKS THE TURN on it, which is
 * what makes `gate` a real verdict rather than a pre-flight list.
 *
 * ⚠ IT ANSWERS IN CORE'S VERDICT VOCABULARY (`{ behavior, message }`), NOT IN CODEX'S — and that
 * is a CONTRACT, not a convenience. Three core modules mint or read that shape and none of them is
 * an adapter: `main/session-permissions.js` resolves the OPERATOR'S OWN CLICK with
 * `{behavior:'allow'}` / `{behavior:'deny', message}`, `main/session-outbound-tag.js › allowResult`
 * and `› wrapAllow` build the tagged allow, and `main/session-outbound.js › wrapGate` observes
 * `verdict.behavior === 'allow'` to resolve the card an allowed post painted. So the parked
 * resolver hands back `{behavior}` on EVERY runtime; a Codex-worded answer here would sail past
 * `wrapGate` and an auto-allowed post would leave a card on screen forever.
 * ⚠ THE TRANSLATION TO `accept` / `decline` THEREFORE HAPPENS AT THE WIRE, in `launch-spec.js`,
 * which is the one place that writes a JSON-RPC frame. That the word `behavior` came from one
 * platform's API and is now core's cross-runtime verdict shape is recorded as a finding rather
 * than fixed here — see docs/REFACTOR-FINDINGS.md.
 */
function makeCanUseTool(s, dispatch, log) {
  return function canUseTool(name, input, opts) {
    const decision = bridge().gateCall(s, name, input, opts, dispatch, log);
    if (decision.settled) {
      // ⚠ THE SAME TWO SHAPES CORE ITSELF MINTS. `allowResult` carries the forced thread tag as
      // `updatedInput` where a runtime can apply it; this one cannot (Codex's approval reply is
      // one of four words with no slot for rewritten arguments), so the wire DROPS that key and
      // the stamp travels `preToolUseStamp` below instead. Keeping the shape identical is what
      // lets `wrapGate` and the tag machinery stay core.
      return Promise.resolve(decision.verdict === 'allow'
        ? outboundTag().allowResult(decision.tag || null)
        : { behavior: 'deny', message: decision.message || 'Denied by operator' });
    }
    return new Promise((resolve) => decision.park(resolve));
  };
}

/**
 * In-process Axis-B tool implementations, or `null`. Null here — see the header.
 */
function axisBTools(_session) {
  return null;
}

// ── THE STAMP — VERDICT-FREE, ON PURPOSE ─────────────────────────────────────────────────────
//
// ⚠ ONE PLACE DECIDES, ONE PLACE STAMPS (design §0.1). The app-server approval callback above is
// the ONLY verdict; this is the ONLY rewrite. A `PreToolUse` hook that also returned a `decision`
// would put the gate in two places, which is the hole each review misses — the F-228 / 1.7.10
// lesson. So this returns `{ updatedInput }` and never a `decision` key, and using the hook to
// DECIDE anything is deferred out of v1 entirely (design §1.5, §7).
//
// ⚠ THE COUNTER IS MINTED HERE, IN MAIN, AND THAT IS WHY THIS FUNCTION TAKES THE SESSION.
// `session-outbound-tag.js › nextOwnPostId` mints `agent-<agentId>-<n>` AND RECORDS IT on
// `s.ownPostIds`, which is what `session-dispatch › wroteIt` reads to keep an agent from being fed
// its own post back under fan-out. A helper process minting its own ids would stamp values main
// never recorded and the self-filter would silently stop working — so the tag is computed on the
// side that owns the ring, and only the TRANSPORT (how a hook invocation reaches this function) is
// the open question.
//
// ⚠ THAT TRANSPORT IS UNVERIFIED AND NOTHING IS WRITTEN TO A SHARED FILE IN v1. `hooks.json` /
// inline `[hooks]` tables live at `~/.codex/` or `<repo>/.codex/` — files the operator and Codex
// itself also own — and non-managed hooks are HASHED AND MUST BE TRUSTED through the `/hooks` TUI
// command before they run, with modified hooks needing re-trust (`codex-research.md` §3). Neither
// the per-launch transport nor the trust path is settled by the research, so both are §5 items
// (C17 trust, C18 transport) and `launch-spec.js` emits no hook configuration at all until they
// come back. What ships in B2 is the CONTRACT — this function and `approval.js › stampOutbound` —
// fixture-tested against the hook payload shape the research documents, so answering C6/C17/C18 is
// a wiring change and not a design one.
const TOOL_INPUT_KEYS = ['tool_input', 'toolInput', 'input', 'arguments'];

/** The `tool_input` a `PreToolUse` payload carries, under any of its documented spellings. */
function inputOf(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  for (const key of TOOL_INPUT_KEYS) {
    if (p[key] && typeof p[key] === 'object') return p[key];
  }
  return {};
}

/**
 * ONE `PreToolUse` invocation for an own-channel post -> the hook's stdout JSON.
 *
 * ⚠ IT REWRITES ONLY A REAL OWN-CHANNEL POST, and asks the SAME predicate the gate's Axis-B branch
 * asks (`session-outbound-tag.js › isOutboundPost`), so a cross-channel post — the exfiltration
 * shape — is never rewritten by us. A conflict (the agent named a DIFFERENT thread) leaves the
 * whole call as written and logs: rewriting half a call the operator will see is worse than
 * rewriting none of it.
 * ⚠ NEVER MINTS AN ID FOR A CALL IT WILL NOT STAMP. `nextOwnPostId` mutates the session's ring, so
 * calling it on every hook invocation would spend ids the session never posts under and blunt the
 * bounded lookback the self-filter depends on.
 */
function preToolUseStamp(payload, s, log) {
  const tags = outboundTag();
  const input = inputOf(payload);
  const name = (payload && (payload.tool_name || payload.toolName)) || '';
  if (!tags.isOutboundPost(name, input, s && s.channelId)) return approval.stampOutbound(input, null);
  const tag = tags.threadTagFor(input, s && s.taskId, tags.nextOwnPostId(s));
  if (tag.action === 'conflict') {
    if (typeof log === 'function') {
      log('session: outbound post names thread', String(tag.supplied).slice(0, 24),
        'but this session drives', String(tag.wanted).slice(0, 24), '— leaving the call as written');
    }
    return approval.stampOutbound(input, null);
  }
  return approval.stampOutbound(input, tag);
}

// Descriptor half.
const descriptor = {
  enforcementPoint: 'held-callback',
  // ⚠ `'unverified'` — §5 C1, and `capability.js › axisBOpScoped` reads anything but `true` as
  // NOT op-scoped, which is the fail-closed reading and the one that is true today. Declaring
  // `true` would be assuming the answer to the item that changes step 7's design rather than one
  // descriptor field.
  opScoped: 'unverified',
  // The only documented input-rewrite lever this runtime has. ⚠ `null` is not a legal answer for a
  // shipped adapter — without the stamp, agents stop self-filtering their own posts in a shared
  // channel, which is a fan-out/echo failure and not a cosmetic one — so §5 C6 (does a
  // decision-less `PreToolUse` return pass through?) is a ship-blocking item, not a field note.
  inputRewrite: 'hook-updatedInput',
  // ⚠ ALWAYS THE UNIVERSAL HARD DENY, on every runtime. Dopl's own admin + retired tools, all
  // `mcp__dopl__*` — runtime-independent, and openable by no mode and no grant.
  hardDeny: require('../../tool-profiles').UNIVERSAL_HARD_DENY.slice(),
};

module.exports = { makeCanUseTool, axisBTools, preToolUseStamp, inputOf, descriptor };
