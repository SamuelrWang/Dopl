// THE OWN-MACHINE DIRECT LANE — `dopl_channel(op="direct_agent")` addressed at THIS session's own
// channel, so that an operator's OWN agents may direct each other PRIVATELY.
//
// ⚠ SAMUEL'S RULING, 2026-08-31: **the user's OWN agents may `direct_agent` each other privately.
// Another user's agent: NEVER — channel or thread only; the existing fence stays for peers.**
//
// §2 SPLIT, on `session-own-launch.js`'s own precedent (which split out of `session-profiles.js`
// on the same argument on 2026-08-25): a ruling needs its ADMISSION ARGUMENT written down beside
// the list it admits, and `session-profiles.js` is AT the 500-line cap. PURE, with NO require at
// all: one frozen op list, one scope rule, one posture rule.
//
// ⚠ IT CLASSIFIES; IT DOES NOT DELIVER. Nothing here starts a turn, claims a row or decides one.
//
// ── WHAT THE FENCE ACTUALLY WAS, MEASURED BEFORE IT WAS MOVED ────────────────────────────────
//
// The field report called the external-session side "a gap", and the reason it read that way is
// worth writing down, because the obvious guess is wrong. **The `operator_user_id` fence was never
// what stopped a desktop agent — it could not have been.**
//
//   THE CREDENTIAL. A launched session calls the Dopl MCP server with the OPERATOR'S OWN
//   credential: the 90-day device token (`mcp-config.js › deviceTokenForSpawn`), or a
//   container-locked child of it (`session-credential.js › sessionBearer`) when the workspace is
//   a shared `kind='link'` container. Both are rows in `mcp_tokens` whose `user_id` IS the
//   operator's, minted `sessionOnly` under the operator's own cookie session. `with-auth.ts`
//   resolves `tok.userId` and hands it on as `ctx.userId`; `agentTokenId` is the ONLY per-caller
//   signal, and it is read for truthiness (is this an agent at all?) and never for identity.
//   ⚠ **SO THE SERVER FENCE ALREADY ADMITTED A LAUNCHED AGENT AND STILL DOES.** It compares
//   OPERATOR IDS, not credential kinds, which is why this ruling needs no server change at all:
//   `repository-directions.ts` stamps `ctx.userId` as `operator_user_id` and predicates every
//   read and write on it, and a launched agent's `ctx.userId` is the operator's.
//
//   WHAT ACTUALLY REFUSED IT. **This machine's own Axis-A gate.** `direct_agent` was on no
//   allow list — not `OWN_CHANNEL_OUTBOUND_OPS`, not `OWN_CHANNEL_READ_OPS`, not
//   `OWN_MACHINE_LAUNCH_OPS` — so it fell through to the Axis-A branch, and a WINDOWLESS session
//   answers a `gate` with an auto-deny (there is no surface to ask on). INVARIANTS §11 recorded
//   that absence as the thing closing the in-machine loop, which is exactly what this ruling
//   trades away deliberately, in exchange for the bound below.
//
// ── ⚠ WHY IT TAKES THE LAUNCH LANE'S CONJUNCTION AND NOT THE OUTBOUND HALF ALONE ─────────────
//
//   AXIS B, outbound half   because the ASK LEAVES THIS MACHINE. `direct_agent` writes a row into
//                           `channel_agent_directions` in the shared workspace, and a BODY this
//                           session wrote travels with it. That is at least as outbound as a post.
//   AXIS A, `bypass` only   because what it buys is LOCAL COMPUTE: a direction makes a running
//                           agent on the operator's Mac take a TURN. `bypass` is the posture that
//                           says "my agent may work on this machine without asking me first", and
//                           nothing narrower may buy a turn any more than it may buy a process.
//
// Neither axis alone can allow it, so the Axis-A/Axis-B invariant is intact in the direction that
// matters: no TOOL posture can send, and no MESSAGE posture can start work. A conjunction narrows.
//
// ⚠ **AND IT IS NOT A MEMBER OF `OWN_MACHINE_LAUNCH_OPS`, THOUGH THE CONJUNCTION IS IDENTICAL.**
// That list carries the LAUNCH-DEPTH bound, which is a bound on how many agents come into
// EXISTENCE; folding `direct_agent` into it would silently make private directions depend on the
// channel's agent-chaining setting — two of Samuel's rulings answering through each other, and
// the one that is off by default would have quietly governed the one that is not.
//
// ── ⚠ THE CONSENT IS STILL THE LOCAL TOGGLE, AND THIS LANE DOES NOT TOUCH IT ─────────────────
//
// **This lane admits ASKING.** The op files a row; the operator's own machine claims it and
// decides (`agent-directions.js`), and `orchestrator-consent.js › getOrchestratorDirect` — a
// per-machine `electron-store` boolean, default FALSE, reachable from one `appWindowOnly` IPC
// pair and from no route, op or column — is what turns a request into a TURN. With it off, an
// admitted call still delivers nothing and the row expires where the caller can see it happen.
//
// ── ⚠ THE PEER FENCE IS UNTOUCHED, AND IT IS NOT THIS FILE'S ─────────────────────────────────
//
// Admitting the op says nothing about WHOSE machine a direction reaches, because this file cannot
// change that and must not look as though it could. A peer's agent holds a credential whose
// `user_id` is the PEER's, so the row it writes is stamped with the PEER's `operator_user_id` and
// only the PEER's desktop can claim it — a peer cannot address this Mac at all, in any posture,
// and there is no argument on this op that says otherwise (no schema on the path accepts an
// operator id). The in-process twin, `session-reopen.js › messageByTask`'s F-373 check, refuses a
// direction whose `operatorUserId` differs from the target session's stamp and fails closed on an
// unstamped one. **Both stand exactly as they did; this ruling widens WHO MAY ASK on the
// operator's own machine, never WHOSE MACHINE MAY BE ASKED.**
//
// ── ⚠ THE LOOP, AND THE BOUND THAT NOW HOLDS IT (F-374) ──────────────────────────────────────
//
// F-374 recorded the CROSS-machine direction loop as unbounded and ACCEPTED, on the reasoning
// that the in-machine one was closed by the absence of this lane. **This ruling opens that lane,
// so the same-machine loop is now real: agent A directs B, B directs A, forever.** Directions
// carry no depth column and cannot (the row is a literal whitelist over columns the table has —
// `agent-direction-wire.js › directionFrom`), so a generation count is not available here for the
// launch lane's reason. The bound chosen instead is a **PER-TARGET-SESSION INBOUND DIRECTION-RATE
// LIMIT**, enforced desktop-side at the one claim funnel: `direction-rate.js`, called from
// `agent-directions.js › handle`. It is at the DELIVERY end deliberately — every hop of any loop,
// same-machine or cross-machine, must land a turn on some session, so bounding what a session
// will RECEIVE bounds the loop from both directions and bounds the cross-machine case F-374
// wished for at the same time. It cannot bound the operator's own composer, which does not go
// through that funnel at all.

// THE OP, NAMED EXPLICITLY. ⚠ A LIST OF ONE, DELIBERATELY: this is an ALLOW list, never a
// default-widening of unknown ops. An op named nowhere resolves to `gate` in every posture.
// ⚠ `read_directions` IS NOT HERE AND MUST NOT BE. It is a READ — it starts no turn and sends
// nothing — so it belongs to Axis B's INBOUND half and is a member of `session-profiles.js ›
// OWN_CHANNEL_READ_OPS`, beside `read_sessions`, whose shape it shares exactly (this operator's
// own runtimes, `channel` an optional filter rather than a required argument). Putting a read
// behind a `bypass` conjunction would be the strictly wrong answer for it.
const OWN_MACHINE_DIRECT_OPS = ['direct_agent'];

// The Axis-A posture that may buy local compute. ⚠ COMPARED AS A LITERAL, and a value outside the
// enum is simply not it — `session-io.js › grantArgs` has already normalized and floored the axis
// by the time this is asked. Deliberately a SECOND spelling of `session-own-launch.js ›
// LAUNCH_TOOL_MODE` rather than an import of it: these are two rulings that happen to agree, and
// a shared constant would make a future narrowing of one silently narrow the other.
const DIRECT_TOOL_MODE = 'bypass';

/**
 * A `direct_agent` aimed at THIS session's own channel.
 *
 * ⚠ SAME SCOPE RULE AND SAME SAFE FAILURE AS EVERY OTHER OWN-CHANNEL PREDICATE
 * (`session-own-launch.js › isOwnMachineLaunch`, `session-own-outbound.js › scopedToOwnChannel`):
 * the target is unset or EXACTLY this session's channel ID. A SLUG is another channel and gates,
 * and so is any other channel's id.
 * ⚠ THE SCOPE IS ABOUT THE ROOM, NOT THE RECIPIENT. `agent_id` names an instance on the
 * operator's own machine and is not checked here at all — a direction to an id that is not
 * running is answered `no-session` by the machine that would have delivered it, which is the
 * honest place for that answer and not a posture question.
 */
function isOwnMachineDirect(input, sessionChannelId) {
  const i = input || {};
  if (OWN_MACHINE_DIRECT_OPS.indexOf(i.op) === -1) return false;
  const target = i.channel;
  if (target == null || target === '') return true; // no explicit target -> own channel
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

/**
 * THE VERDICT FOR AN OWN-MACHINE DIRECTION — the only thing `grantDecision` asks this module.
 *
 * ⚠ NO DEPTH QUESTION, AND ITS ABSENCE IS THE DESIGN RATHER THAN AN OVERSIGHT. The launch lane
 * bounds how many agents come into EXISTENCE and can do so because this machine can tell a
 * human-started session from any other. A direction creates nothing; what it can run away with is
 * a CONVERSATION, which is a rate, not a generation — and a rate is bounded where the turn lands
 * (`direction-rate.js`), not where the ask is classified.
 *
 * `autoOutbound` is Axis B's outbound half, resolved by the caller (`autoOutboundMode`) so this
 * module holds no second copy of the message enum.
 */
function directLaneVerdict(args, autoOutbound) {
  const a = args || {};
  return a.toolMode === DIRECT_TOOL_MODE && autoOutbound === true ? 'allow' : 'gate';
}

module.exports = {
  OWN_MACHINE_DIRECT_OPS,
  DIRECT_TOOL_MODE,
  isOwnMachineDirect,
  directLaneVerdict,
};
