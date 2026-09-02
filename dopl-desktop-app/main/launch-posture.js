// THE DIRECTIVE LANE'S POSTURE BOUND — one statement of "an orchestrator may ask, and it may
// never widen" (2026-09-01, T24 / the `set_agent_mode` kind).
//
// ── WHY IT IS ITS OWN FILE ───────────────────────────────────────────────────────────────
//
// TWO CALLERS AND ONE RULE. `launch-directives.js › spawn` resolves the pair a NEW session
// starts on; `directive-agent-ops.js › setAgentMode` resolves the pair a RUNNING one moves to.
// They read different ceilings from the same record and land on different engine ops, and the
// thing they must not do is disagree about what "no wider than the operator's own posture"
// means. A copy in each is exactly the drift `session-profiles.js` and `channel-prefs.js`
// already pin against each other for the enums themselves.
//
// ⚠ **AND IT IS THE SENTENCE `launch-directives.js`'S HEADER STATES IN CAPITALS**, made
// executable rather than left as prose: *"THE DIRECTIVE SUPPLIES GOAL, MODEL AND WHICH TEMPLATE,
// AND NOTHING ELSE… A directive-driven agent is exactly as contained as a button-driven one, and
// nothing an orchestrator writes can widen it."* T24 asked for the postures to become directive
// fields. They did — as a REQUEST that is clamped here, never as an input that decides. The
// ceiling on both lanes is `channel-prefs.js › getLaunchPosture`: the pair the OPERATOR chose,
// by hand, on the Settings tab of their own machine.
//
// ⚠ **THE TICKET'S OWN CARVE-OUT WAS REFUSED AND THE REASON IS MEASURABLE.** T24 said the bound
// could be lifted "unless the caller is the operator's own account". Every caller on this lane
// IS the operator's own account — a spawned session calls the MCP server with the OPERATOR'S
// credential (INVARIANTS §11: *"`operator_user_id` NEVER REFUSED A LAUNCHED AGENT AND COULD NOT
// HAVE"*) — so that exception is not narrow, it is the whole set. Implementing it would hand
// every agent on the machine the power to launch children wider than their operator's room
// allows, which is the self-authorizing lane the §6 threat model exists to prevent.
//
// PURE below the sentinel — no require, no clock, no store — so its suite evaluates it verbatim
// and both callers can require it without dragging anything in.

// ─── BEGIN LAUNCH-POSTURE (pure; unit-tested via source extraction) ──────────────────────

/**
 * NARROW A REQUESTED MODE TO A CEILING. Returns the requested value when it is no wider, the
 * CEILING when it is wider, and `''` when nothing was requested.
 *
 * ⚠ **THE COMPARISON IS AN INDEX INTO A NARROWEST-FIRST ARRAY**, which is this tree's one way of
 * ordering a posture enum (`descriptor.toolMode.options` states the rule, and
 * `launch-directive-wire.js › TOOL_MODES` / `MESSAGE_MODES` are ordered for it). Re-ordering
 * either array silently inverts this function.
 *
 * ⚠ **AN UNRECOGNISED VALUE ON EITHER SIDE RESOLVES TO THE CEILING, AND THE REQUEST SIDE NEEDS
 * ITS OWN TEST TO DO SO.** An unknown CEILING indexes to -1, which is narrower than every real
 * mode, so every request clamps to it and the reducer then coerces it fail-closed on the way in.
 * An unknown REQUEST also indexes to -1 — and `-1 > n` is FALSE, so a bare index comparison would
 * PASS IT THROUGH unexamined. That is the wrong direction on the one axis that must never fail
 * open, so membership is asked FIRST. ⚠ It is unreachable from a real directive (`directiveFrom`
 * collapses an unknown mode to `''`), which is exactly why it needed a test rather than a
 * comment: an unreachable branch that is wrong stays wrong until the day it is reachable.
 */
function narrowTo(requested, ceiling, order) {
  if (!requested) return '';
  if (order.indexOf(requested) === -1) return ceiling;
  return order.indexOf(requested) > order.indexOf(ceiling) ? ceiling : requested;
}

/**
 * THE PAIR A DIRECTIVE'S REQUEST RESOLVES TO, plus whether anything was clamped.
 *
 * `requested` / `ceiling` are `{ tools, messages }`; `''` on either axis of the REQUEST means
 * "not asked for", and the ceiling's own value is used. ⚠ THAT DEFAULT IS THE PRE-T24 BEHAVIOUR
 * EXACTLY: a directive that names no posture launches on the operator's stored channel pair,
 * which is what `channel-prefs.js › launchStartModes` has always handed the spawn.
 *
 * ⚠ **IT CLAMPS, IT DOES NOT REFUSE**, which is `session-reopen.js › setModeByTask`'s own rule
 * for the windowless floor one layer down and is the right trade for the same reason: refusing
 * would apply nothing when part of what was asked for was legal, and it would leave the caller
 * with a launch it did not get. `clamped` is what lets the caller SAY SO rather than move
 * silently — a clamp nobody reports is the "surface showing a posture main is not enforcing" lie
 * that this tree has paid for twice.
 */
function resolvePosture(requested, ceiling, toolOrder, messageOrder) {
  const req = requested || {};
  const max = ceiling || {};
  const tools = narrowTo(req.tools, max.tools, toolOrder) || max.tools;
  const messages = narrowTo(req.messages, max.messages, messageOrder) || max.messages;
  return {
    tools: tools,
    messages: messages,
    clamped: (!!req.tools && req.tools !== tools) || (!!req.messages && req.messages !== messages),
  };
}

/**
 * MAY THIS DIRECTIVE'S SESSION LAUNCH FURTHER AGENTS?
 *
 * ⚠ **A REQUEST FOR CHAINING THE CHANNEL DOES NOT ALLOW IS REFUSED UP FRONT, NOT CLAMPED**, and
 * that asymmetry with the posture pair above is deliberate. A clamped POSTURE still produces a
 * working agent doing the asked-for work under more supervision; a clamped CHAIN produces an
 * agent that will hit a bound it was told it did not have, mid-run, after the orchestrator has
 * already handed it work that assumes workers. Refusing costs one round trip; clamping costs the
 * whole run and the orchestrator learns about it from silence.
 *
 * ⚠ **IT IS A SPAWN-TIME STAMP AND IS NOT LIVE-APPLIED** (INVARIANTS §11) — which is the other
 * half of why a refusal is right here: flipping the channel setting afterwards does not unblock
 * a session already started, so a caller that got a silent `false` could never recover.
 *
 * Returns `{ chain, refused }` — `refused` is true only for the ASK-AND-DENIED case, never for a
 * directive that asked for nothing.
 */
function resolveChain(requested, allowed) {
  if (requested === true && allowed !== true) return { chain: false, refused: true };
  return { chain: allowed === true, refused: false };
}

/**
 * THE WHOLE PLAN FOR ONE LAUNCH DIRECTIVE'S POSTURE, IN ONE CALL.
 *
 * ⚠ **IT EXISTS SO THE WATCHER GAINS FOUR LINES AND NOT THIRTY.** `launch-directives.js` sits at
 * the hard 500-line §1 cap with no exemptions, and a file at the cap does not merely stop
 * growing — it stops being CORRECTABLE, which is the state F-226 was taken out of. The seam is
 * real either way: that module answers "should this machine act on this row", and the arithmetic
 * of "what posture does the row resolve to" is a different question with a different clock.
 *
 * `floorMessages` is `channel-prefs.js › windowlessMessageMode`, injected rather than required so
 * this block stays pure. ⚠ **THE ORDER IS THE CONTRACT: CLAMP, THEN FLOOR.** The clamp bounds
 * what the OPERATOR sanctioned; the floor is what a session with no Accept surface can be
 * (INVARIANTS §11, F-236). Flooring first would let a clamped `ask` come back out as
 * `auto_inbound` and read as though the ceiling had allowed it.
 *
 * Returns `{ modes, chain, refused, clamped }` — `refused: true` is the chain case ONLY, and it
 * is the caller's cue to answer the row rather than spawn.
 *
 * ⚠ THE KEY IS `modes` AND NOT THE SPAWN'S OWN HAND-IN NAME, DELIBERATELY.
 * `test/session-preset-census.test.mjs` greps `main/` for that key's literal spelling to census
 * WHO HANDS A POSTURE INTO A SPAWN — the one list standing between this tree and a fourth
 * un-reviewed hander. This module COMPUTES a posture and hands nothing anywhere; appearing in
 * that census would blunt it by an entry that needs no review, which is how a census stops being
 * read. (⚠ The literal is deliberately not written in this comment either, for the same reason:
 * the grep reads COMMENTS too, and a file can join that list by explaining why it should not.)
 */
function resolveLaunch(a) {
  const o = a || {};
  const chainRule = resolveChain(o.chainRequested, o.chainAllowed);
  const pair = resolvePosture(o.requested, o.ceiling, o.toolOrder, o.messageOrder);
  return {
    modes: { tools: pair.tools, messages: o.floorMessages(pair.messages) },
    chain: chainRule.chain,
    refused: chainRule.refused,
    clamped: pair.clamped,
  };
}

// ⚠ THE SETTING'S NAME, ON THE WIRE-FACING SIDE, SPELLED ONCE. The refusal has to NAME the
// switch and whose it is or the caller re-issues forever — the defect class
// `session-permissions.js` exists to remove. It is the `electron-store` key
// (`channel-prefs.js › AGENT_CHAIN_KEY`), which is also the string the Settings tab's row is
// derived from, so an operator told this can find it.
const CHAIN_SETTING = 'channelAgentChain';

// ─── END LAUNCH-POSTURE ──────────────────────────────────────────────────────────────────

module.exports = { narrowTo, resolvePosture, resolveChain, resolveLaunch, CHAIN_SETTING };
