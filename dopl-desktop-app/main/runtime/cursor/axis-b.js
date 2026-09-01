// AXIS B's ENFORCEMENT POINT ON THIS RUNTIME — ⚠ `in-process`, AND IT IS THE ONLY ONE OF THE
// THREE. Dopl's channel ops are `local.customTools` THIS PROCESS IMPLEMENTS.
//
// ⚠ AXIS B IS DOPL'S PLANE AND HAS NO ENFORCEMENT POINT OF ITS OWN. The Dopl MCP server is remote
// HTTP on every runtime, so the desktop main process is not in the call path of a channel call;
// and no posture field ever crosses the wire, so `packages/mcp-server` does not know what Axis B
// is set to and could not refuse the post. Axis B therefore needs an IN-PROCESS TOOL BOUNDARY or a
// HELD CALLBACK, and where neither exists there is no outbound gate at all — the gate coming off,
// not a hidden capability (`main/runtime/contract.js › LAUNCH_BLOCKING`).
//
// ⚠ THIS RUNTIME HAS NO HELD CALLBACK (`approval.js`), SO THE IN-PROCESS BOUNDARY IS NOT AN
// OPTIMISATION — IT IS THE ADAPTER'S REASON TO EXIST. `cursor-research.md` documents
// `local.customTools` as description + JSON Schema + `execute()`, registered as a built-in
// `custom-user-tools` MCP server, local runtime only. `execute()` runs HERE, so it can block on
// the consent UI, read `input.op` / `input.channel` / `to` / `kind` with full fidelity, and stamp
// the forced thread tag before the call leaves. That is why `opScoped` is `true` BY CONSTRUCTION
// rather than by measurement: Dopl writes the implementation.
//
// ⚠ AND IT MUST NOT INHERIT THE `allowedTools` SHADOW. `main/agent-self-ops.js › makeAgentOpsServer`
// is the SAME MECHANISM with the opposite discipline: its two verbs ride the pre-approval list and
// are therefore shadowed past the gate entirely. That is defensible for a display verb and a stop
// verb; it is indefensible for a channel op, which is the call that HAS to gate. So: every tool
// built here calls `grantDecision` before it acts, and `tools.js › buildSessionToolConfig` returns
// `preApproved: []` on every profile so there is no list for one to ride.
//
// ⚠ ONE VERDICT SHAPE, AND THE ORDER IS THE TRAP (F-382). `execute()` asks the gate and receives
// CORE'S verdict — `{ behavior, message?, updatedInput? }` — and only THEN translates it into what
// this platform reads. Three core modules mint or read that shape and none of them is an adapter:
// `main/session-permissions.js` resolves the OPERATOR'S OWN CLICK with `{behavior:'allow'}` /
// `{behavior:'deny', message}`, `main/session-outbound-tag.js › allowResult` / `› wrapAllow` build
// the tagged allow, and `main/session-outbound.js › wrapGate` observes `verdict.behavior ===
// 'allow'` to resolve the card an allowed post painted. Translating to a platform word before
// `wrapGate` sees it would sail past that wrapper and leave an already-delivered post reading
// "awaiting your approval" forever. So: gate -> core verdict -> `approval.js › answerApproval`,
// in that order, in one function.
//
// ⚠ THE FORWARD IS INJECTED, NOT REQUIRED. The tools are OURS, so an allowed call still has to
// REACH the Dopl endpoint — but the HTTP half lives in `mcp.js` and arrives here as a `call`
// function. That keeps this module pure enough to drive from a fixture with no network, which is
// the same discipline every normalizer in this tree runs under.

const crypto = require('crypto');
// ⚠ THE BRIDGE IS LAZY, AND THAT IS A LOAD-ORDER CONTRACT, NOT A STYLE. `session-gate-bridge.js`
// reads `session-profiles.js`, which asks `main/runtime/index.js` for every gate decision — so a
// top-level require here would close the loop and hand the gate a half-initialised module whose
// exports are `undefined` at exactly the moment it asks for a deny list.
const bridge = () => require('../../session-gate-bridge');
const approval = require('./approval');
const { canonicalDoplName } = require('../../mcp-tool-names');

// ── THE CLOSE LATCH ──────────────────────────────────────────────────────────────────────────
//
// ⚠ THIS IS THE ONE THING DOPL CAN STOP ON THIS RUNTIME, AND IT IS NOT AN INTERRUPT. §5 item X0
// is that the SDK documents no interrupt and no steer, so `session.interrupt` is `'unverified'`
// and the Stop control is refused (`capability.js › interruptRefusal`). What the in-process
// boundary DOES buy is that every DOPL-SIDE EFFECT of a run we cannot stop is still ours: after
// `close()`, every `execute()` refuses, so an abandoned agent cannot post, cannot read the
// channel and cannot write the workspace, whatever it is still doing on its own side.
// ⚠ THAT IS A MITIGATION AND NOT A RESOLUTION, and conflating the two would be the whole point of
// X0 lost: the run keeps burning tokens, keeps running shell commands under Cursor's own
// supervision, and keeps writing files. Dopl can stop being a party to it; it cannot stop it.
// ⚠ A WeakMap RATHER THAN A FIELD ON THE SESSION, so core never grows a vendor-shaped property
// and a settled session's latch is collected with it.
const CLOSED = new WeakSet();

const closeSession = (s) => { if (s && typeof s === 'object') CLOSED.add(s); };
const isClosed = (s) => !!(s && typeof s === 'object' && CLOSED.has(s));

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────

/**
 * The gate one `execute()` asks, in CORE's verdict vocabulary. Same bridge every runtime uses.
 *
 * ⚠ THE PROMISE IS THE MECHANISM, NOT A DETAIL: `execute()` awaits it, and the platform awaits
 * `execute()`, so the turn blocks on the operator's decision. Whether that is really true of this
 * SDK is §5 item X2 — if `execute()` is fire-and-forget, `axisB.enforcementPoint` is `null` here
 * and this adapter must not register at all. It is the second ship-gate after X0.
 *
 * ⚠ NO DISPATCH => DENY, NOT ALLOW. `decision.park` paints a card through the engine's dispatch;
 * a session wired without one has no surface to ask on, and the only safe answer to a question
 * nobody can be asked is no.
 */
function makeGate(s, dispatch, log) {
  return function gateCall(name, input, opts) {
    if (isClosed(s)) {
      return Promise.resolve({ behavior: 'deny', message: 'This session has ended.' });
    }
    const decision = bridge().gateCall(s, name, input, opts, dispatch, log);
    if (decision.settled) {
      // ⚠ THE SAME TWO SHAPES CORE ITSELF MINTS. `allowResult` folds the forced thread tag onto
      // the allow as `updatedInput`; `execute()` applies it below. Keeping the shape identical is
      // what lets `wrapGate` and the tag machinery stay core on all three runtimes.
      return Promise.resolve(decision.verdict === 'allow'
        ? require('../../session-outbound-tag').allowResult(decision.tag || null)
        : { behavior: 'deny', message: decision.message || 'Denied by operator' });
    }
    if (typeof dispatch !== 'function') {
      return Promise.resolve({ behavior: 'deny', message: 'This session has no surface to ask on.' });
    }
    return new Promise((resolve) => decision.park(resolve));
  };
}

// ── THE CALL ID ──────────────────────────────────────────────────────────────────────────────
//
// ⚠ READ TOLERANTLY, AND DECLARED UNMEASURED (§5 item X16). `main/session-outbound.js › wrapGate`
// and `session-gate-bridge.js › gatePayload` key the consent card on `opts.toolUseID` so the
// inline card the STREAM painted (`normalize.js`, keyed on `tool_call.call_id`) and the card the
// GATE paints are one card. `cursor-research.md` documents `tool_call` events carrying `call_id`
// and does NOT document what an `execute()` implementation is handed, so this reads the spellings
// a context argument would plausibly use and answers `null` otherwise.
// ⚠ `null` IS THE SAFE ANSWER, NOT A GUESSED ID. With no id `wrapGate` returns early and no
// auto-resolve events fire — a card that may go stale. A MINTED id would be worse: it would join
// the gate's card to nothing while looking joined, and the renderer would resolve an artifact that
// does not exist. The GATE is unaffected either way; every call still stops at `grantDecision`.
const CALL_ID_KEYS = ['call_id', 'callId', 'toolCallId', 'tool_call_id', 'id'];

function callIdOf(context) {
  const c = context && typeof context === 'object' ? context : {};
  for (const key of CALL_ID_KEYS) {
    if (typeof c[key] === 'string' && c[key]) return c[key];
  }
  return null;
}

// ── THE TOOLS ────────────────────────────────────────────────────────────────────────────────

/**
 * One Dopl tool, as this platform's `customTools` entry.
 *
 * `spec` — `{ name, description, inputSchema }` AS THE DOPL SERVER DESCRIBES IT. ⚠ Never authored
 * here: the descriptions and schemas are `packages/mcp-server`'s and are read off its own
 * `tools/list` (`mcp.js › listDoplTools`). A hand-written schema in this file would be a second
 * statement of the server's surface, which is exactly what `main/session-dopl-tools.js`'s header
 * refuses — and it would drift the day a tool gains an argument.
 */
function buildTool(spec, ctx) {
  const bare = String(spec.name);
  // ⚠ THE GATE IS ASKED THE CANONICAL NAME, AND ON THIS RUNTIME THAT IS FREE. F-139 is the defect
  // where a Dopl tool arriving under an unexpected host prefix missed every list in the gate at
  // once — Axis B, the pre-approvals, both Axis-A lists and HARD-DENY. Here there is no host
  // prefix to guess: this process REGISTERED the tool, so it knows which one `execute()` belongs
  // to and canonicalises once, at build time. What the MODEL sees the tool called is a separate
  // question (`mcp.descriptor.toolNamePrefix`, §5 item X17) and it cannot reach the gate.
  const gateName = canonicalDoplName(bare);
  return {
    name: bare,
    description: spec.description,
    inputSchema: spec.inputSchema,
    async execute(args, context) {
      const input = args && typeof args === 'object' ? args : {};
      const opts = { requestId: crypto.randomUUID(), toolUseID: callIdOf(context) };
      let verdict = null;
      try {
        verdict = await ctx.gate(gateName, input, opts);
      } catch (err) {
        // ⚠ FAIL CLOSED. A gate that threw is a gate that did not answer, and the only safe answer
        // to a question nobody answered is no.
        if (typeof ctx.log === 'function') ctx.log('cursor: gate threw —', (err && err.message) || err, '(denying)');
        verdict = null;
      }
      if (!verdict || verdict.behavior !== 'allow') {
        return approval.answerApproval({ message: verdict && verdict.message }, 'deny');
      }
      // ⚠ THE NATIVE STAMP, APPLIED ONCE. The tag was MINTED by the bridge (`nextOwnPostId`
      // mutates the session's bounded ring, so minting a second one here would spend ids the
      // session never posts under and blunt the fan-out self-filter's lookback) and rides the
      // allow as `updatedInput`. `approval.stampOutbound` is the one applicator.
      const tag = verdict.updatedInput && typeof verdict.updatedInput === 'object'
        ? { action: 'inject', input: verdict.updatedInput }
        : null;
      const sent = approval.stampOutbound(input, tag).updatedInput;
      if (isClosed(ctx.session)) {
        return approval.answerApproval({ message: 'This session ended before the call was sent.' }, 'deny');
      }
      const answer = await ctx.call(bare, sent);
      return answer && answer.ok === false
        ? approval.answerApproval({ message: answer.text || 'The Dopl call failed.' }, 'deny')
        : approval.answerApproval({ text: (answer && answer.text) || '' }, 'allow');
    },
  };
}

/**
 * The in-process Axis-B tool surface for one session.
 *
 * ⚠ IT TAKES THE ENGINE'S REQUEST OBJECT, NOT A BARE SESSION, and the contract's one-argument
 * signature is what makes that legal. The gate PAINTS A CARD and RESOLVES one, so it needs the
 * dispatch and the replay-aware quiet emitter — the same two injected handles `buildLaunchSpec`
 * takes, for the same reason, and this module must not require the engine back.
 * ⚠ IT IS ASYNC BECAUSE THE SURFACE IS THE SERVER'S. `listDoplTools` asks `packages/mcp-server`
 * what it offers rather than this file restating it; `launch-spec.js › start` awaits it inside the
 * detached boot so the handle is still returned synchronously.
 *
 * `request` — `{ session, dispatch, emitQuiet, log, policy, deny, list, call }`.
 *   `policy`  the profile's `doplToolsPolicy` (bare names), or null for the whole surface.
 *   `deny`    the profile's deny list — belt for the braces below.
 *   `list`    `() => Promise<[{name, description, inputSchema}]>`
 *   `call`    `(bareName, args) => Promise<{ok, text}>`
 */
async function axisBTools(request) {
  const req = request || {};
  const s = req.session;
  if (!s || typeof req.list !== 'function' || typeof req.call !== 'function') return null;
  const sessionOutbound = require('../../session-outbound');
  const inner = makeGate(s, req.dispatch, req.log);
  // ⚠ WRAPPED IN CORE'S OWN OBSERVER, NOT A COPY OF IT. `wrapGate` resolves the card an
  // AUTO-ALLOWED post painted — the F2 path — and it is core because it observes a verdict and
  // never makes one. Every runtime wraps the same function.
  const gate = sessionOutbound.wrapGate(s, inner, req.emitQuiet || function () {});
  const ctx = { session: s, gate, call: req.call, log: req.log };

  let specs = [];
  try {
    specs = await req.list();
  } catch (err) {
    // ⚠ NO SURFACE IS NOT A BROKEN LAUNCH. A session with no Dopl tools runs and can still be
    // read; a THROWN launch takes the whole session with it for a roster read.
    if (typeof req.log === 'function') req.log('cursor: dopl tools/list failed —', (err && err.message) || err);
    return [];
  }
  return specs.filter((spec) => allowRegister(spec, req.policy, req.deny)).map((spec) => buildTool(spec, ctx));
}

/**
 * ⚠ A TOOL WE DO NOT REGISTER CANNOT BE CALLED, AND THAT IS THE BELT. The braces are
 * `grantDecision` step 1, which reads the same deny list and refuses the call even if it somehow
 * arrives — both layers, because a profile whose containment depends on one list being applied in
 * one place is a profile with one bug between it and nothing.
 */
function allowRegister(spec, policy, deny) {
  const bare = spec && typeof spec.name === 'string' ? spec.name : '';
  if (!bare) return false;
  const canonical = canonicalDoplName(bare);
  if (Array.isArray(deny) && (deny.indexOf(canonical) !== -1 || deny.indexOf(bare) !== -1)) return false;
  if (!Array.isArray(policy)) return true; // null => the whole surface, each call still gated
  return policy.indexOf(bare) !== -1;
}

// Descriptor half.
const descriptor = {
  // ⚠ THE ONLY NON-CALLBACK ANSWER OF THE THREE. See the header: with no held callback this is not
  // a choice between two mechanisms, it is the only mechanism there is.
  enforcementPoint: 'in-process',
  // ⚠ `true` BY CONSTRUCTION, NOT BY MEASUREMENT, and that distinction is worth keeping: on a
  // held-callback runtime this field asks whether the PLATFORM hands the gate the call's
  // arguments (§5 item C1 on the other one, still unanswered). Here Dopl writes `execute()`, so
  // the arguments are the model's own, in full, and `isOwnChannelPost` / `postFieldsOk` /
  // `grantKeyFor` all read exactly what they read on Claude.
  opScoped: true,
  // ⚠ `native`: the adapter implements the tool and stamps inside it. The other two runtimes have
  // to smuggle the rewrite through a platform mechanism, and each of those is a §5 item.
  inputRewrite: 'native',
  // ⚠ ALWAYS THE UNIVERSAL HARD DENY, on every runtime. Dopl's own admin + retired tools, all
  // `mcp__dopl__*` — runtime-independent, and openable by no mode and no grant.
  hardDeny: require('../../tool-profiles').UNIVERSAL_HARD_DENY.slice(),
};

module.exports = {
  axisBTools, makeGate, buildTool, allowRegister, callIdOf,
  closeSession, isClosed, descriptor,
};
