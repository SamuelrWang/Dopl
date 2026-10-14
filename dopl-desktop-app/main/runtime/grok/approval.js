// GROK'S TWO GATE CHANNELS → DOPL'S GATE → THE REPLY. The one translator (INVARIANTS §11.0i approval slot).
//
// 1. `_x.ai/hooks/run` (PreToolUse, registered per session, `policy.js › HOOKS_META`) arrives for EVERY tool
//    before Grok's own permission rules, in every mode, read-only tools included, with `use_tool` already
//    resolved (`toolName: "dopl_session__post_message"`) — LIVE. Reply `{ decision: "continue" | "deny",
//    systemMessage }`; a deny fails only that tool and the turn goes on. It FAILS OPEN at the group's
//    `timeout` (LIVE, S11: a 3 s group, a reply held 9 s → the call ran), and Grok honours a reply held up to
//    that bound (LIVE, S11: held 40 s under the 600 s group, then `deny` → only that call failed, the turn went
//    on). So it answers the containment deny list (and, on a restricted profile, any built-in Dopl has not
//    classified) at once, and — for a Dopl MCP call — WAITS for the gate up to `policy.HOOK_HOLD_MS`: an
//    operator's Deny inside that window fails only that call (F-777). A reply's `updatedInput` is ignored
//    (LIVE, S11) — Dopl never rewrites. The payload's `permissionMode` is Grok's mode readback: a session
//    reported `bypassPermissions` (LIVE, S10: what a `/always-approve on` prompt switches to, while the
//    `yolo` flag stays false) is refused and stopped.
// 2. `session/request_permission` (ACP, no timeout) is where a PARKED verdict waits for the operator. Its
//    `toolCall.toolCallId` equals the hook's `toolUseId` (LIVE), so a call the hook already started is
//    answered from the same gate promise — the gate is asked ONCE per call (it mints the outbound tag).
//    Reply `{ outcome: { outcome: "selected", optionId } }`, a ONCE-scoped option only (never `allow_always`:
//    a remembered grant would satisfy the ask rule on a ledger Dopl cannot read). ⚠ `reject_once` ENDS THE
//    WHOLE TURN (`stopReason: "cancelled"`, `PermissionRejected` — LIVE, `smoke-s2`), and so does a
//    `cancelled` outcome (`PermissionCancelled`, LIVE, S11); there is no per-call reject option (offered:
//    `allow_once`, `reject_once`, `allow_always`). Only a verdict still parked when the hook's hold ran out
//    reaches here undecided.
// Fails closed everywhere: an unreadable request is denied; a gate that throws is a deny.

const { canonicalDoplName } = require('../../mcp-tool-names');
const tools = require('./tools');
const protocol = require('./protocol');
const policy = require('./policy');

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === 'string' ? v : '');

function rpcError(code, message) {
  const error = new Error(message);
  error.rpcCode = code;
  return error;
}

const isMcpName = (gateName) => gateName.startsWith('mcp__');

/** A permission request's tool → `{ name, input }` in the gate's words: `use_tool` unwrapped to the MCP tool
 *  it dispatches (`rawInput.tool_name` / `tool_input`), else Grok's own id with its raw input. */
function gateCallOf(toolCall) {
  const tc = obj(toolCall);
  const raw = obj(tc.rawInput);
  const meta = obj(obj(tc._meta)['x.ai/tool']);
  if (str(raw.tool_name)) return { name: tools.gateNameOf(raw.tool_name), input: obj(raw.tool_input) };
  const id = str(meta.name) || str(tc.title);
  const input = Object.assign({}, raw);
  delete input.variant;
  return { name: tools.gateNameOf(id) || 'unrecognised_request:tool', input };
}

/** A hook payload → `{ name, input, truncated }` (`toolInput` is the `use_tool` wrapper for an MCP call). */
function hookCallOf(params) {
  const p = obj(params);
  const input = obj(p.toolInput);
  const name = tools.gateNameOf(str(p.toolName));
  const mcp = isMcpName(name) && str(input.tool_name) ? obj(input.tool_input) : input;
  return { name, input: mcp, truncated: p.toolInputTruncated === true };
}

/**
 * The INSTANT containment verdict for a hook call, or null. `cfg` is `tools.buildSessionToolConfig(profile)`.
 * The deny list is `grantDecision` step 1's own list (same canonical names); `native.hookAllow` is the
 * restricted profiles' positive list of built-ins.
 */
function hookVerdict(name, cfg) {
  const c = cfg || {};
  const deny = Array.isArray(c.disallowedTools) ? c.disallowedTools : [];
  if (!name) return 'Dopl could not tell which tool this is, so it is not allowed.';
  if (deny.indexOf(canonicalDoplName(name)) !== -1 || deny.indexOf(name) !== -1) {
    return `Dopl containment: ${name.replace(/^mcp__/, '')} is not allowed for this agent.`;
  }
  const allow = c.native && Array.isArray(c.native.hookAllow) ? c.native.hookAllow : null;
  if (allow && !isMcpName(name) && allow.indexOf(name) === -1) {
    return `Dopl containment: ${name} is not allowed for this agent.`;
  }
  return null;
}

/** The option that carries a verdict, or null. ONCE-scoped only. */
function optionFor(options, verdict) {
  const list = Array.isArray(options) ? options.filter((o) => o && typeof o.optionId === 'string') : [];
  return list.find((o) => o.kind === (verdict === 'allow' ? 'allow_once' : 'reject_once')) || null;
}

const asVerdict = (v) => {
  if (v === 'allow') return { behavior: 'allow' };
  if (v && typeof v === 'object' && v.behavior === 'allow') return v;
  return { behavior: 'deny', message: (v && typeof v === 'object' && typeof v.message === 'string' && v.message) || '' };
};

/** `p` settled within `ms` → `{ settled: true, verdict }`; `stop` resolved first → `{ cancelled: true }`;
 *  else `{ settled: false }`. */
function settledWithin(p, ms, stop) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const take = (value) => { if (!done) { done = true; if (timer) clearTimeout(timer); resolve(value); } };
    p.then((v) => take({ settled: true, verdict: v }), () => take({ settled: true, verdict: asVerdict(null) }));
    if (stop) stop.then(() => take({ cancelled: true }));
    if (ms > 0) timer = setTimeout(() => take({ settled: false }), ms);
    else setImmediate(() => take({ settled: false }));
  });
}

// The modes a Dopl session may report in the hook (`permissionMode`): Grok's `default` (Ask, Full) and `auto`
// (Auto) — LIVE. Anything else (`bypassPermissions` after a `/always-approve on`, LIVE S10) means Grok is no
// longer asking what Dopl's ask rule needs it to ask.
const EXPECTED_MODES = Object.freeze(['default', 'auto']);

/**
 * The approval driver for one session. `o`:
 *   `gate(name, input, meta)` → Promise of core's `{ behavior, message }` (or `'allow'|'deny'`);
 *   `cfg` → this session's tool config (`tools.buildSessionToolConfig`);
 *   `onUnknown(method)` → show a server request Dopl does not know;
 *   `onUnsafe(text)` → stop a session Grok reports in a mode Dopl never chose;
 *   `hookHoldMs` → how long the hook waits on a parked verdict (default `policy.HOOK_HOLD_MS`);  `log`.
 * Returns `{ onServerRequest(msg), cancelPending(), wasUnasked(toolCallId), endTurn() }`.
 */
function makeApprovalDriver(o) {
  const log = typeof o.log === 'function' ? o.log : () => {};
  const holdMs = Number.isFinite(o.hookHoldMs) ? o.hookHoldMs : policy.HOOK_HOLD_MS;
  let unsafeSaid = false;
  const memos = new Map(); // toolCallId → Promise<verdict>, started by the hook for a Dopl MCP call
  const parked = new Set(); // ids the hook left waiting on the operator, not yet asked by Grok
  // An interrupt answers every permission reply still waiting as `cancelled`; a fresh latch per interrupt.
  const freshCancel = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  };
  let cancelGen = freshCancel();

  function ask(id, name, input) {
    let p;
    try { p = Promise.resolve(o.gate(name, input, { requestId: id || null, toolUseID: id || null })).then(asVerdict, () => asVerdict(null)); } catch (_) { p = Promise.resolve(asVerdict(null)); }
    return p;
  }

  async function onHook(params) {
    const mode = obj(params).permissionMode;
    if (typeof mode === 'string' && EXPECTED_MODES.indexOf(mode) === -1) {
      const why = `Grok reported its permission mode as \`${mode}\` — refusing a session that would not run under `
        + 'the restrictions the operator chose.';
      if (!unsafeSaid && typeof o.onUnsafe === 'function') { unsafeSaid = true; o.onUnsafe(why); }
      return { decision: 'deny', systemMessage: why };
    }
    const call = hookCallOf(params);
    const contained = hookVerdict(call.name, o.cfg);
    if (contained) return { decision: 'deny', systemMessage: contained };
    // Only a Dopl MCP call is put to the gate here: a built-in Grok never asks about would park a card nobody
    // consumes. A truncated input is never judged — the permission request carries it whole.
    if (!isMcpName(call.name) || call.truncated) return { decision: 'continue' };
    const id = str(obj(params).toolUseId);
    const p = ask(id, call.name, call.input);
    if (id) memos.set(id, p);
    // Held for the operator up to the hold (below the group timeout, which would fail OPEN): a Deny inside it
    // fails only this call (F-777). Past it, `continue` — the permission request (no timeout) waits on the
    // same promise, and a Deny there ends the turn (fails closed).
    const now = await settledWithin(p, holdMs, cancelGen.promise);
    if (now.cancelled) { if (id) memos.delete(id); return { decision: 'deny', systemMessage: 'The turn was stopped.' }; }
    if (!now.settled) { if (id) parked.add(id); return { decision: 'continue' }; }
    if (now.verdict.behavior === 'allow') return { decision: 'continue' };
    if (id) memos.delete(id);
    return { decision: 'deny', systemMessage: now.verdict.message || 'Dopl did not allow this call.' };
  }

  async function onPermission(params) {
    const p = obj(params);
    const tc = obj(p.toolCall);
    const id = str(tc.toolCallId);
    const call = gateCallOf(tc);
    const pending = (id && memos.get(id)) || ask(id, call.name, call.input);
    parked.delete(id);
    const verdict = await Promise.race([pending, cancelGen.promise.then(() => null)]);
    if (id) memos.delete(id);
    if (verdict === null) return { outcome: { outcome: 'cancelled' } };
    let option = optionFor(p.options, verdict.behavior === 'allow' ? 'allow' : 'deny');
    // An allow with no once-scoped allow option is not widened to a standing grant: it is a deny.
    if (!option && verdict.behavior === 'allow') option = optionFor(p.options, 'deny');
    if (!option) {
      log(`grok: permission ${id || '?'} offers no once-scoped option — answered cancelled`);
      return { outcome: { outcome: 'cancelled' } };
    }
    return { outcome: { outcome: 'selected', optionId: option.optionId } };
  }

  return {
    // A request Dopl does not know is SHOWN and refused, never answered in a guessed shape.
    onServerRequest(msg) {
      const method = str(msg && msg.method);
      if (method === protocol.SERVER_REQUESTS.HOOK) return onHook(msg.params);
      if (method === protocol.SERVER_REQUESTS.PERMISSION) return onPermission(msg.params);
      if (typeof o.onUnknown === 'function') o.onUnknown(method);
      throw rpcError(-32601, `Dopl does not answer Grok's ${method || '(no method)'} request in this version`);
    },
    /** An interrupt: every permission reply still waiting is answered `cancelled` (ACP's cancel contract). */
    cancelPending() { cancelGen.resolve(); cancelGen = freshCancel(); },
    /** Did Grok run this Dopl call without asking although the gate was still waiting? (drift) */
    wasUnasked(id) { const hit = parked.has(id); parked.delete(id); return hit; },
    endTurn() { memos.clear(); parked.clear(); },
  };
}

// Descriptor half — Axis A's answer shape.
const descriptor = {
  // `session/request_permission` parks the turn until Dopl answers.
  heldCallback: true,
  // Grok names each tool (its own ids, MCP tools as `<server>__<tool>`).
  granularity: 'per-tool',
  categories: null,
};

module.exports = {
  makeApprovalDriver, gateCallOf, hookCallOf, hookVerdict, optionFor, asVerdict, settledWithin, descriptor, rpcError,
  EXPECTED_MODES,
};
