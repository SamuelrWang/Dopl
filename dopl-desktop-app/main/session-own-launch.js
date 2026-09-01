// THE OWN-MACHINE LAUNCH LANE — `dopl_channel(op="launch_agent")` addressed at THIS session's
// own channel, and the RECURSION BOUND that comes with it.
//
// ⚠ SAMUEL'S RULING, 2026-08-25: **an agent session MUST be able to launch other agents.**
// F-320 is the live measurement it was ruled on — a windowless desktop-run orchestrator
// (`runtime=desktop-session`, no window surface) tried to put its workers in visible windows and
// was AUTO-REFUSED, verbatim: "This tool needs a permission prompt and this session has no
// surface to show one on, so the call was refused automatically."
//
// §2 SPLIT for the same reason `session-own-outbound.js` was split out of `session-profiles.js`
// on 2026-08-24 (F-301): a ruling needs its ADMISSION ARGUMENT written down beside the list it
// admits to, and that file measured 495 of the 500-line cap. PURE, with NO require at all: one
// frozen op list, one scope rule, one posture rule, one depth rule.
//
// ⚠ IT CLASSIFIES AND IT BOUNDS; IT DOES NOT SPAWN. Nothing here starts a process — see the
// consent paragraph below, which is the whole reason this admission is not the inversion F-320
// warned it would be.
//
// ── WHY THIS OP EARNS A LANE, AND WHY IT IS NOT THE OUTBOUND ONE ────────────────────────────
//
// F-320's own argument, kept and answered rather than argued away: `launch_agent` is NOT
// outbound CONTENT. `create_thread` earned the outbound lane by being a post with a title on it;
// this op is not a post at all. Putting it on `OWN_CHANNEL_OUTBOUND_OPS` would hand every
// windowless agent an unprompted LAUNCH under a MESSAGE posture, which inverts the 2026-08-22
// local-desktop-toggle ruling instead of extending it. So it is a THIRD lane, not a third member.
//
// ⚠ AND THE ADMISSION IS NARROWER THAN EITHER AXIS ALONE — THE CONJUNCTION IS THE POINT:
//
//   AXIS B, outbound half   because the ASK LEAVES THIS MACHINE. `launch_agent` writes a row
//                           into `channel_launch_directives` in the shared workspace; a goal
//                           another agent wrote travels with it. That is at least as outbound as
//                           the post the same half already consents to.
//   AXIS A, `bypass` only   because what it asks for is LOCAL COMPUTE on the operator's own Mac.
//                           `bypass` is the posture that says "my agent may work on this machine
//                           without asking me first", and nothing narrower may buy a process.
//
// Neither axis alone can allow it, so **the Axis-A/Axis-B invariant is intact in the direction
// that matters**: no TOOL posture can send a message (Axis B is still required), and no MESSAGE
// posture can start a process (Axis A is still required). A conjunction only ever narrows.
//
// ── ⚠ THE CONSENT IS STILL THE LOCAL TOGGLE, AND THIS LANE DOES NOT TOUCH IT ────────────────
//
// **This lane admits ASKING, never launching.** The op files a REQUEST; the operator's own
// machine claims it and decides (`launch-directives.js`), and `channel-prefs.js ›
// getOrchestratorLaunch` — a per-machine `electron-store` boolean, default FALSE, reachable from
// one `appWindowOnly` IPC pair and from no route, op or column — is what turns a request into a
// process. Samuel ruled that toggle the consent for launch-over-MCP on 2026-08-22 and it is
// untouched here: with it off, an admitted call still starts nothing and the row expires.
//
// ── ⚠ THE RECURSION BOUND (Samuel's ruling, 2026-08-25) ─────────────────────────────────────
//
// Agents launching agents must carry a bound, and `MAX_CONCURRENT_SESSIONS` is not one: it caps
// how many run AT ONCE (six), not how many generations deep the chain goes, and sessions settle
// and free their slots. So a session carries a LAUNCH DEPTH and may only ask while it is under
// the cap.
//
//   depth 0    THE OPERATOR STARTED IT, at this machine's own launch surface — the New Agent
//              button (`session-launch-op.js › launchFromButton`, the ONE lane that passes it).
//   depth 1+   EVERYTHING ELSE, and it is AT the cap: it may not ask for another agent.
//
// ⚠ **ABSENT MEANS THE CAP, NOT ZERO** (`normalizeLaunchDepth`). Every lane that does not
// explicitly say "a human started this" — the directive lane (`launch-directives.js › spawn`),
// the peer-triggered responder (`trigger.js`), a CRASH RECREATE (`session-park.js › startResume`,
// which rebuilds the spec from the durable record and passes none) — lands at the cap and cannot
// launch. That is the fail-CLOSED direction and it is the same discipline Axis A already follows
// (`manual` is its start value AND its park reset: an abandoned session must never resume
// pre-authorized), and the same one `startResume` already applies to the stored PROFILE.
// ⚠ **AN ORDINARY IDLE PARK + RESUME KEEPS IT, AND THAT IS NOT AN INCONSISTENCY.** `session-park
// .js › resumeParked` restarts the QUERY on the SAME session object — nothing is rebuilt, so the
// stamp is simply still there. What loses it is a RECREATE, where the only input is the durable
// record, and `session-io.js › baseRecord` is a whitelist that does not carry this field. Neither
// half needs a rule: one keeps the object, the other keeps nothing, and both fail safe.
//
// ⚠ **WHY THE CAP IS 1 AND NOT 2, STATED HONESTLY RATHER THAN CHOSEN FOR ROOM.** "parent depth
// + 1" needs the PARENT's depth to survive the round trip, and it cannot: the ask leaves this
// machine as a `channel_launch_directives` row and comes back through the server, and that row
// has NO depth — `launch-directive-wire.js › directiveFrom` is a literal whitelist over the
// columns the table actually has. This machine can therefore distinguish exactly two things: a
// session a human started HERE, and a session something else started. Arithmetic over a number
// that cannot cross the wire would be a bound in name only, so the honest cap is ONE GENERATION:
// an operator's orchestrator may staff itself, and its staff may not staff themselves.
// **Raising it to 2 is a wire change** (a depth column, the DTO, the narrowing, the create
// route) — filed, not guessed at.
// ⚠ F-315 (an unbounded agent CONVERSATION) is the adjacent shape and is NOT fixed here: this
// bounds how many agents come into existence, not how long two of them talk.
//
// ⚠ THE BOUND IS NOT POSTURE-OPENABLE, WHICH IS WHY IT ANSWERS `deny` AND NOT `gate`. A `gate`
// on a windowless session is an auto-deny carrying "your operator can widen this session's tool
// posture" — and for a capped session that sentence is FALSE in exactly the way F-320 was filed
// for. The deny carries its own reason code (`launch-depth-capped`) and its own sentence
// (`session-permissions.js › denyMessageFor`), which says the bound is a bound.
// ⚠ **IT IS NOT POSTURE-OPENABLE AND IT IS NOW SETTING-OPENABLE, AND THOSE ARE DIFFERENT CLAIMS**
// — see the block below. The deny sentence had to be corrected in the same change, because it
// said *"no setting will widen this"* and that stopped being true.
//
// ── ⚠ THE BOUND IS A CHANNEL SETTING SINCE 2026-08-31 (Samuel's ruling; post-1.23.0 field run) ──
//
// FIELD MEASUREMENT: a launched agent's five worker-launch attempts were all refused with the
// sentence above. The operator wanted the shape the bound forbids — an orchestrator that staffs
// supervisors that staff workers — in the ONE room they run orchestrators in. Samuel's ruling:
// **the one-generation limit becomes a CHANNEL SETTING, toggleable on and off, DEFAULT OFF**
// (i.e. the default is today's bound, unchanged), flipped per channel by the operator.
//
//   OFF (default)  everything above applies verbatim. `deny`, `launch-depth-capped`, one
//                  generation. A machine that has never seen the setting behaves identically.
//   ON             the DEPTH question is not asked at all, and a launched session may launch.
//
// ⚠ **THE FLAG IS A SPAWN-TIME STAMP, NOT A LIVE READ, AND THAT IS DELIBERATE RATHER THAN LAZY.**
// The 2026-08-25 live-apply ruling (`channel-dir-ipc.js › applyPostureToLive`) fans a changed
// POSTURE out to running sessions on an argument that names its own limit: it *"widens
// SUPERVISION — is the operator asked? — never CONTAINMENT."* This flag is CONTAINMENT, so it
// takes the stamp discipline `launchDepth` and `profile` already take: a session is bound by what
// the room said when it started, and flipping the switch reaches the sessions started after it.
// ⚠ ABSENT READS FALSE, so every lane that does not deliberately pass it keeps the ONE-GENERATION
// bound — the same fail-CLOSED direction the depth stamp has, and the reason a resume, a recreate
// or a peer-triggered wake cannot inherit chaining by forgetting a field.
//
// ⚠ **WITH IT ON, THERE IS NO GENERATION BOUND LEFT. STATED, NOT IMPLIED.** Arithmetic over depth
// is impossible here for the reason written above — the ask leaves this machine as a
// `channel_launch_directives` row with no depth column — so a "hard cap at N generations" is not a
// bound this build can express and pretending otherwise would be the bound-in-name-only this
// module was written to refuse. **What stands in its place is TWO REAL CEILINGS, both enforced
// where a process is actually bought and neither described as a generation count:**
//
//   INSTANTANEOUS  `session-windowless.js › MAX_CONCURRENT_SESSIONS` (FIFTEEN live sessions per
//                  machine since 2026-09-01, six before), refused at `session-launch.js ›
//                  launch` as `cap`. Already there, already applies to every spawn shape, and
//                  unchanged by this ruling — the 2026-09-01 raise moved the number, not the
//                  mechanism.
//   OVER TIME      `launch-budget.js` — a ROLLING PER-CHANNEL LAUNCH BUDGET, spent only by a
//                  chained spawn, refused as the same `cap` word. It exists because the
//                  concurrency ceiling is not a bound over time: sessions settle and free their
//                  slots, so an unbounded chain under a fixed concurrency ceiling is a fork bomb
//                  that merely runs at a steady rate. The budget is what makes ON ≠ fork bomb.
//
// ⚠ A DEPTH COLUMN IS THE ONLY THING THAT WOULD BUY A REAL GENERATION CAP, and it is FILED
// (REFACTOR-FINDINGS F-378) rather than guessed at — it is a wire change across the DTO, the
// create route, the narrowing and this machine's stamp, exactly as the paragraph above says.

// THE OP, NAMED EXPLICITLY. ⚠ A LIST OF ONE, DELIBERATELY: this is an ALLOW list, never a
// default-widening of unknown ops. An op named nowhere resolves to `gate` in every posture,
// which is the safe direction, so a new op joins a lane by being written down or not at all.
const OWN_MACHINE_LAUNCH_OPS = ['launch_agent'];

// The Axis-A posture that may buy local compute. ⚠ COMPARED AS A LITERAL, and a value outside
// the enum is simply not it — `session-io.js › grantArgs` has already normalized and floored the
// axis by the time this is asked (`floorWindowlessTool` keeps `bypass` and floors everything
// else to `auto`), so nothing here re-spells that rule.
const LAUNCH_TOOL_MODE = 'bypass';

// ONE GENERATION. See the header for why this is 1 and what it would take to make it 2.
const MAX_LAUNCH_DEPTH = 1;

/**
 * The stamp, normalized FAIL-CLOSED: anything that is not a real, non-negative, whole number of
 * generations reads as the CAP. Absent, null, NaN, '2', -1 and 1e9 all land there.
 */
function normalizeLaunchDepth(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return MAX_LAUNCH_DEPTH;
  return n > MAX_LAUNCH_DEPTH ? MAX_LAUNCH_DEPTH : n;
}

/** Has this session spent its generation? */
function launchDepthExhausted(depth) {
  return normalizeLaunchDepth(depth) >= MAX_LAUNCH_DEPTH;
}

/**
 * IS THE DEPTH BOUND LIFTED FOR THIS SESSION? The channel's chaining setting, stamped at spawn
 * (`channel-prefs.js › getAgentChain` → `launch-directives.js` → the funnel → the session).
 *
 * ⚠ `=== true` AND NOTHING ELSE. A missing field, a string, a 1 and a truthy object all read
 * FALSE, so the bound survives every lane that does not deliberately hand a real boolean in —
 * the same fail-closed direction `normalizeLaunchDepth` takes from the other side.
 */
function launchChainEnabled(flag) {
  return flag === true;
}

/**
 * A `launch_agent` aimed at THIS session's own channel.
 *
 * ⚠ SAME SCOPE RULE AND SAME SAFE FAILURE AS EVERY OTHER OWN-CHANNEL PREDICATE
 * (`session-own-outbound.js › scopedToOwnChannel`, `session-profiles.js › isOwnChannelPost`):
 * the target is unset or EXACTLY this session's channel ID. A SLUG is another channel and gates,
 * and so is any other channel's id — an agent must not be able to staff a room it is not in.
 */
function isOwnMachineLaunch(input, sessionChannelId) {
  const i = input || {};
  if (OWN_MACHINE_LAUNCH_OPS.indexOf(i.op) === -1) return false;
  const target = i.channel;
  if (target == null || target === '') return true; // no explicit target -> own channel
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

/**
 * THE VERDICT FOR AN OWN-MACHINE LAUNCH — the only thing `grantDecision` asks this module.
 *
 * ⚠ THE DEPTH IS ASKED FIRST, AND THAT ORDER IS THE HONESTY. A capped session gets `deny` in
 * EVERY posture, so it is never told to go widen something that would not help; only a session
 * still under the cap can reach the posture question at all.
 *
 * `autoOutbound` is Axis B's outbound half, resolved by the caller (`autoOutboundMode`) so this
 * module holds no second copy of the message enum.
 */
function launchLaneVerdict(args, autoOutbound) {
  const a = args || {};
  // ⚠ THE SETTING IS ASKED **BEFORE** THE DEPTH, AND ONLY TO SKIP IT (2026-08-31). It is not a
  // third grant: a chained session still has to clear BOTH axes below, exactly like the first
  // generation does, so turning chaining on can never widen a posture. The one thing it changes
  // is whether the depth question is asked at all.
  if (!launchChainEnabled(a.launchChain) && launchDepthExhausted(a.launchDepth)) return 'deny';
  return a.toolMode === LAUNCH_TOOL_MODE && autoOutbound === true ? 'allow' : 'gate';
}

module.exports = {
  OWN_MACHINE_LAUNCH_OPS,
  LAUNCH_TOOL_MODE,
  MAX_LAUNCH_DEPTH,
  normalizeLaunchDepth,
  launchDepthExhausted,
  launchChainEnabled, // 2026-08-31: the channel setting that lifts the depth bound, `=== true`
  isOwnMachineLaunch,
  launchLaneVerdict,
};
