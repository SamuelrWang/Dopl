// AXIS B's ENFORCEMENT POINT ON THIS RUNTIME — ⚠ `in-process`, THE ONLY ONE OF THE THREE. Dopl's
// channel ops are `local.customTools` THIS PROCESS IMPLEMENTS.
//
// ⚠ AXIS B HAS NO ENFORCEMENT POINT OF ITS OWN: the Dopl MCP server is remote HTTP and no posture
// field crosses the wire, so the server cannot refuse the post. Axis B needs an in-process tool
// boundary or a held callback; with neither there is no outbound gate (`contract.js ›
// LAUNCH_BLOCKING`). This runtime has no held callback (`approval.js`), so this boundary is the
// adapter's reason to exist. `execute()` runs HERE (`cursor-research.md`: description + JSON
// Schema + `execute()`, registered as a built-in `custom-user-tools` MCP server), so it can block
// on the consent UI, read `op` / `channel` / `to` / `kind` in full, and stamp the thread tag —
// `opScoped` is `true` BY CONSTRUCTION.
//
// ⚠ IT MUST NOT INHERIT THE `allowedTools` SHADOW: `runtime/claude/axis-b.js › makeAgentOpsServer`
// is the same mechanism with its verbs pre-approved past the gate — fine for display/stop verbs,
// indefensible for a channel op. Every tool here calls `grantDecision` before it acts, and
// `tools.js › buildSessionToolConfig` returns `preApproved: []` on every profile.
//
// ⚠ ONE VERDICT SHAPE, AND THE ORDER IS THE TRAP (F-382): gate -> CORE's verdict
// `{ behavior, message?, updatedInput? }` -> `approval.js › answerApproval`, in that order, in one
// function. Translating earlier hands core a word it cannot read.
//
// ⚠ THE FORWARD IS INJECTED (`call` from `mcp.js`), so this module drives from a fixture with no
// network.

const crypto = require('crypto');
// ⚠ THE BRIDGE IS LAZY — A LOAD-ORDER CONTRACT: `session-gate-bridge.js` → `session-profiles.js` →
// `main/runtime/index.js`; a top-level require closes the loop and hands the gate a half-initialised
// module whose exports are `undefined` when it asks for a deny list.
const bridge = () => require('../../session-gate-bridge');
const approval = require('./approval');
const { settledVerdict } = require('../held-gate');
const { canonicalDoplName } = require('../../mcp-tool-names');

// ── THE CLOSE LATCH ──────────────────────────────────────────────────────────────────────────
//
// ⚠ THIS IS THE ONE THING DOPL CAN STOP ON THIS RUNTIME, AND IT IS NOT AN INTERRUPT. §5 item X0
// is that the SDK documents no interrupt and no steer, so `session.interrupt` is `'unverified'`
// (the agent panel reads it and refuses Stop: `runtime-capability.ts › interruptRefusal`). What the in-process
// boundary DOES buy is that every DOPL-SIDE EFFECT of a run we cannot stop is still ours: after
// `close()`, every `execute()` refuses, so an abandoned agent cannot post, cannot read the
// channel and cannot write the workspace, whatever it is still doing on its own side.
// ⚠ A MITIGATION, NOT A RESOLUTION: the run keeps burning tokens, running shell commands and
// writing files under Cursor's own supervision. Dopl stops being a party to it; it cannot stop it.
// ⚠ A WeakSet RATHER THAN A FIELD ON THE SESSION, so core never grows a vendor-shaped property
// and a settled session's latch is collected with it.
const CLOSED = new WeakSet();

const closeSession = (s) => { if (s && typeof s === 'object') CLOSED.add(s); };
const isClosed = (s) => !!(s && typeof s === 'object' && CLOSED.has(s));

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────

/**
 * The gate one `execute()` asks, in CORE's verdict vocabulary. Same bridge every runtime uses.
 *
 * ⚠ THE PROMISE IS THE MECHANISM: `execute()` awaits it and the platform awaits `execute()`, so the
 * turn blocks on the operator. Unverified for this SDK (§5 item X2): if `execute()` is
 * fire-and-forget there is no enforcement point and this adapter must not register.
 * ⚠ NO DISPATCH => DENY: `decision.park` paints its card through the engine's dispatch; with none,
 * there is no surface to ask on.
 */
function makeGate(s, dispatch, log) {
  return function gateCall(name, input, opts) {
    if (isClosed(s)) {
      return Promise.resolve({ behavior: 'deny', message: 'This session has ended.' });
    }
    const decision = bridge().gateCall(s, name, input, opts, dispatch, log);
    // The allow carries the forced thread tag as `updatedInput`; `execute()` applies it below.
    if (decision.settled) return Promise.resolve(settledVerdict(decision));
    if (typeof dispatch !== 'function') {
      return Promise.resolve({ behavior: 'deny', message: 'This session has no surface to ask on.' });
    }
    return new Promise((resolve) => decision.park(resolve));
  };
}

// ── THE CALL ID ──────────────────────────────────────────────────────────────────────────────
//
// ⚠ READ TOLERANTLY, UNMEASURED (§5 item X16). `session-gate-bridge.js › gatePayload` keys the
// consent card on `opts.toolUseID` so the stream's card (`normalize.js`, keyed on
// `tool_call.call_id`) and the gate's card are one. What `execute()` is handed is undocumented, so
// plausible spellings are read and `null` answers otherwise.
// ⚠ `null`, NEVER A MINTED ID: a minted id joins the card to nothing while looking joined. The gate
// is unaffected either way.
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
 * `spec` — `{ name, description, inputSchema }` AS THE DOPL SERVER DESCRIBES IT (its own
 * `tools/list`, `mcp.js › connect().list`). ⚠ Never authored here: a hand-written schema drifts the
 * day a tool gains an argument.
 */
function buildTool(spec, ctx) {
  const bare = String(spec.name);
  // ⚠ THE GATE IS ASKED THE CANONICAL NAME (F-139: an unexpected host prefix once missed every
  // gate list). This process registered the tool, so it canonicalises once, at build time; the
  // name the MODEL sees (§5 item X17) cannot reach the gate.
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
        // ⚠ FAIL CLOSED: a gate that threw did not answer.
        if (typeof ctx.log === 'function') ctx.log('cursor: gate threw —', (err && err.message) || err, '(denying)');
        verdict = null;
      }
      if (!verdict || verdict.behavior !== 'allow') {
        return approval.answerApproval({ message: verdict && verdict.message }, 'deny');
      }
      // ⚠ THE NATIVE STAMP, APPLIED ONCE. The bridge MINTED the tag (`nextOwnPostId` mutates the
      // session's bounded ring; a second mint here would spend ids never posted under and blunt the
      // fan-out self-filter's lookback); it rides the allow as `updatedInput`.
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
 * ⚠ TAKES THE ENGINE'S REQUEST OBJECT, NOT A BARE SESSION: the gate paints and resolves a card, so
 * it needs the engine's injected dispatch, and this module must not require the engine back.
 * ⚠ ASYNC because the surface is the server's (`list`); `launch-spec.js › frames` awaits it so
 * `start` still returns its handle synchronously.
 *
 * `request` — `{ session, dispatch, log, policy, deny, list, call }`.
 *   `policy`  the profile's `doplToolsPolicy` (bare names), or null for the whole surface.
 *   `deny`    the profile's deny list — belt for the braces below.
 *   `list`    `() => Promise<[{name, description, inputSchema}]>`
 *   `call`    `(bareName, args) => Promise<{ok, text}>`
 */
async function axisBTools(request) {
  const req = request || {};
  const s = req.session;
  if (!s || typeof req.list !== 'function' || typeof req.call !== 'function') return null;
  const gate = makeGate(s, req.dispatch, req.log);
  const ctx = { session: s, gate, call: req.call, log: req.log };

  let specs = [];
  try {
    specs = await req.list();
  } catch (err) {
    // ⚠ NO SURFACE IS NOT A BROKEN LAUNCH: a thrown launch takes the session with it for a roster read.
    if (typeof req.log === 'function') req.log('cursor: dopl tools/list failed —', (err && err.message) || err);
    return [];
  }
  return specs.filter((spec) => allowRegister(spec, req.policy, req.deny)).map((spec) => buildTool(spec, ctx));
}

/**
 * ⚠ A TOOL WE DO NOT REGISTER CANNOT BE CALLED — THE BELT. The braces are `grantDecision` step 1,
 * which reads the same deny list. Both layers, so containment never rests on one list in one place.
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
  // ⚠ The only non-callback answer of the three — the only mechanism there is (header).
  enforcementPoint: 'in-process',
  // ⚠ `true` BY CONSTRUCTION, NOT MEASUREMENT: Dopl writes `execute()`, so the gate reads the model's
  // own arguments in full, exactly as on Claude.
  opScoped: true,
  // ⚠ `native`: the adapter implements the tool and stamps inside it.
  inputRewrite: 'native',
  // ⚠ ALWAYS THE UNIVERSAL HARD DENY: Dopl's admin + retired tools, openable by no mode and no grant.
  hardDeny: require('../../tool-profiles').UNIVERSAL_HARD_DENY.slice(),
};

module.exports = {
  axisBTools, makeGate, callIdOf,
  closeSession, isClosed, descriptor,
};
