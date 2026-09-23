// The posture bound: an orchestrator may ASK for a narrower posture or a chain, never wider than the
// operator's channel record (no "caller is the operator" carve-out — every caller holds the operator's
// credential, §6). Used by `launch-directive-spawn.js` and the reducer (`_reducer-block.mjs`).

// ─── BEGIN LAUNCH-POSTURE (pure; unit-tested via source extraction) ──────────────────────

/**
 * Narrow a requested mode to a ceiling: the request when no wider, else the ceiling; `''` when
 * nothing was asked. `order` is NARROWEST-FIRST (a runtime's `descriptor.toolMode.options` order) —
 * re-ordering it inverts this. An unknown request resolves to the ceiling: membership is asked
 * first because `-1 > n` would otherwise pass it through.
 */
function narrowTo(requested, ceiling, order) {
  if (!requested) return '';
  if (order.indexOf(requested) === -1) return ceiling;
  return order.indexOf(requested) > order.indexOf(ceiling) ? ceiling : requested;
}

/**
 * The message axis is NOT a line (`auto_inbound` and `auto_outbound` are independent), so its clamp
 * is a bit INTERSECTION — bit 1 inbound, bit 2 outbound; an empty intersection is `ask` — never an
 * index comparison, which widened. `MESSAGE_BY_BITS` is indexed by those bits.
 */
const MESSAGE_BITS = { ask: 0, auto_inbound: 1, auto_outbound: 2, auto_both: 3 };
const MESSAGE_BY_BITS = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];

function messageBits(mode) { // own-property check: the keys are wire values (`constructor`)
  return Object.prototype.hasOwnProperty.call(MESSAGE_BITS, mode) ? MESSAGE_BITS[mode] : -1;
}

function narrowMessageMode(requested, ceiling) {
  if (!requested) return '';
  // An unrecognised value on either side resolves to the ceiling, as in `narrowTo`.
  const r = messageBits(requested);
  const c = messageBits(ceiling);
  if (r === -1 || c === -1) return ceiling;
  return MESSAGE_BY_BITS[r & c];
}

/** `{ tools, messages, clamped }`; `''` on a requested axis = not asked (the ceiling applies). Clamps, never refuses. */
function resolvePosture(requested, ceiling, toolOrder) {
  const req = requested || {};
  const max = ceiling || {};
  const tools = narrowTo(req.tools, max.tools, toolOrder) || max.tools;
  const messages = narrowMessageMode(req.messages, max.messages) || max.messages;
  return {
    tools: tools,
    messages: messages,
    clamped: (!!req.tools && req.tools !== tools) || (!!req.messages && req.messages !== messages),
  };
}

/**
 * `{ chain, refused }`. `true` is granted only if the channel allows, else REFUSED up front (a
 * spawn-time stamp: a silently un-chained worker fails mid-run); `false` always; `null` inherits.
 */
function resolveChain(requested, allowed) {
  if (requested === true && allowed !== true) return { chain: false, refused: true };
  if (requested === false) return { chain: false, refused: false };
  return { chain: allowed === true, refused: false };
}

/**
 * One launch directive's posture plan — `{ modes, chain, refused, clamped }` (`refused` is the chain
 * case only). `floorMessages` is `session-profiles.js › floorWindowlessMessage`, injected to keep
 * this pure. CLAMP, THEN FLOOR: flooring first would pass a clamped `ask` off as allowed.
 * The key is `modes`, not the spawn's hand-in name: `session-preset-census.test.mjs` greps that
 * literal (comments included) to census posture handers, and this module hands nothing.
 */
function resolveLaunch(a) {
  const o = a || {};
  const chainRule = resolveChain(o.chainRequested, o.chainAllowed);
  const pair = resolvePosture(o.requested, o.ceiling, o.toolOrder);
  return {
    modes: { tools: pair.tools, messages: o.floorMessages(pair.messages) },
    chain: chainRule.chain,
    refused: chainRule.refused,
    clamped: pair.clamped,
  };
}

// The chaining refusal names this setting so an orchestrator can ask for the switch; it is the
// electron-store key (`channel-agent-chain.js › AGENT_CHAIN_KEY`).
const CHAIN_SETTING = 'channelAgentChain';

// ─── END LAUNCH-POSTURE ──────────────────────────────────────────────────────────────────

module.exports = {
  narrowTo, narrowMessageMode, resolvePosture, resolveChain, resolveLaunch, CHAIN_SETTING,
};
