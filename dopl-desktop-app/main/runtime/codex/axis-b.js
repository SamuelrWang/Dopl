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
// 🔒 ⚠ **C3 AND C1 ARE MEASURED (2026-09-22, codex-cli 0.155.1, U4), AND THE THIRD THING THEY
// TURNED UP — A HELD APPROVAL THAT NAMES NO TOOL — IS RESOLVED BY SERVER, SAME DAY.**
// The capture lives in `test/codex-mcp-surface.test.mjs`; what it found:
//   §5 C3 — ARE MCP TOOL CALLS A DISTINCT CLIENT-ANSWERABLE REQUEST? **YES, AND IT IS HELD.**
//           `tools.dopl_channel.approval_mode = 'prompt'` produces a server->client REQUEST that
//           blocks the turn — but NOT an `item/*/requestApproval`. It is
//           `mcpServer/elicitation/request`, discriminated by
//           `_meta.codex_approval_kind === 'mcp_tool_call'`, answered with
//           `{ action: 'accept'|'decline'|'cancel' }` rather than `{ decision }`. So
//           `enforcementPoint: 'held-callback'` is TRUE for Axis B on this runtime.
//   §5 C1 — DOES IT CARRY THE CALL'S ARGUMENTS? **YES** — `_meta.tool_params` held `{op:'rooms'}`
//           verbatim, so op-scoping is representable in principle.
//   ⚠ THE THIRD THING, WHICH WAS THE BLOCKER: **THE REQUEST CARRIES NO TOOL NAME.** Its params
//           are `serverName`, `threadId`, `turnId`, `mode`, `_meta` and a `message` — the tool's
//           name appears only inside that operator-facing sentence, and there is no `itemId` to
//           join it to the `mcpToolCall` item that DOES carry `{ server, tool }`. So for a day,
//           `server-requests.js` answered the elicitation with an unconditional
//           `{ action: 'decline' }` without asking the gate: fail-closed, and also a Dopl channel
//           call that could never be ALLOWED at all — the agent could not post, could not read,
//           and could not be told why by a gate that never ran.
// 🔒 **RESOLVED BY SERVER (Samuel's ruling, 2026-09-22), AND NOT BY READING THE SENTENCE.** The
// request does carry, structurally, the SERVER it came from — and Dopl mounts that server itself.
// `mcp.js` now pins exactly ONE tool on Dopl's entry in a mode that can ask
// (`TOOL_APPROVAL_MODES`, with `default_tools_approval_mode: 'auto'` beside it and the cost of
// that change written out there), so server identity plus "an ask happened" resolves the tool with
// nothing parsed. `approval.js › doplElicitation` performs both checks and
// `server-requests.js › elicitationAnswer` hands the result — the name, and the call's own
// `_meta.tool_params` — to `makeCanUseTool` below, i.e. to the SAME gate every other request
// reaches. A non-Dopl server, a missing `_meta`, a different `codex_approval_kind` and a
// non-singleton asking set all still decline.
// ⚠ `descriptor.opScoped` STAYS `'unverified'` ANYWAY, AND THAT IS A DELIBERATE UNDER-CLAIM.
// The op now genuinely reaches the gate, so the field COULD read `true` — but the join that
// carries it is Dopl's own CONFIGURATION, not a measurement of the wire, and one thing that
// configuration rests on is unmeasured: whether an `approval_policy` of
// `{ granular: { mcp_elicitations: true, … } }` can raise an elicitation for a tool whose per-tool
// mode is `auto`. If it can, the asking set is not the one `mcp.js` computes. Declaring a
// capability on an unmeasured premise is the failure this descriptor exists to prevent, so the
// field waits for that measurement (§5 item C1b) and the launch keeps carrying the warning, which
// over-warns rather than over-claims. ⚠ FLIPPING IT LATER ALSO MOVES A TEST OUTSIDE THIS ADAPTER:
// `test/session-engine-slot.test.mjs` uses Codex as its SHIPPED example of a runtime that warns.
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
 * category words, or, for a tool-call elicitation from DOPL'S OWN MCP server, the one tool that
 * server's entry configures to ask (`approval.js › doplElicitation`). `input` is the call's
 * arguments where the request carries them (§5 C1 — `_meta.tool_params` for an elicitation) and
 * `{}` where it does not; `opts` carries the request id and title.
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
  // 🔒 `true` SINCE CXP-3A (MEASURED 2026-09-22, codex-cli 0.155.1, §5 C1b answered). A channel
  // call's FULL arguments ride the elicitation's `_meta.tool_params` (a `send` carried op,
  // channel, thread, kind and body), and the join through Dopl's per-tool approval table is now
  // TRUE ON THE WIRE: with the default at `'approve'` a non-channel Dopl tool raises no request at
  // all, so every elicitation from `serverName: 'dopl'` IS `dopl_channel` (`mcp.js ›
  // DEFAULT_TOOL_APPROVAL_MODE`; `test/codex-mcp-discovery.test.mjs` re-measures both halves).
  opScoped: true,
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
