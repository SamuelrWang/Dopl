// THE OWN-MACHINE MANAGE LANE — `dopl_channel(op="manage")`'s THREE HOUSEKEEPING ACTIONS
// (`rename` · `end` · `posture`) addressed at THIS session's own channel.
//
// ⚠ SAMUEL'S FIELD REPORT, 2026-09-17: a channel at tools=`bypass` / messages=`auto_both` — the
// posture the own-machine LAUNCH lane is written for — admitted an orchestrator's
// `manage(action="launch")` and then GATED the `manage(action="rename")` it issued against the
// agent it had just launched, verbatim from `listener.log`:
//
//   session gate: dopl_channel op=manage.rename gate channel-op-approval-required tool=bypass msg=auto_both
//
// **AND A GATE IS NOT A QUESTION HERE.** There is no surface on which a held channel-op gate can
// be answered, so the orchestrator waits forever on a call nobody can reach — F-320's defect
// class exactly, arriving one op later. It is not rare, either: the Coder template instructs
// every coder to rename itself the moment it starts, so the shipped templates walk into it.
//
// §2 SPLIT, on the precedent `session-own-launch.js` set on 2026-08-25 and `session-own-direct.js`
// followed on 2026-08-31: a ruling needs its ADMISSION ARGUMENT written down beside the list it
// admits, and `session-profiles.js` is at the 500-line cap. PURE, with ONE require (the shared
// `<op>.<action>` key): one frozen op list, one scope rule, one posture rule, one audit-code map.
//
// ⚠ IT CLASSIFIES; IT DOES NOT RENAME, END OR RE-POSTURE ANYTHING. Nothing here writes a row,
// claims one or stops a session — see the consent paragraph below, which is why admitting these
// three widens what may be ASKED and nothing about what this machine DOES.
//
// ── WHY THESE THREE EARN THE LAUNCH LANE'S CONJUNCTION, AND NOT A WIDER ONE ──────────────────
//
// They take the SAME two-axis admission the launch lane takes, for the same two reasons, and
// neither axis alone can decide one:
//
//   AXIS B, outbound half   because the ASK LEAVES THIS MACHINE. All three write a row into
//                           `channel_launch_directives` — `kind: 'rename' | 'end' |
//                           'set_agent_mode'` (`launch-directive-wire.js`) — carrying a name this
//                           session chose or a posture it asked for. That is at least as outbound
//                           as the post the same half already consents to.
//   AXIS A, `bypass` only   because what they reach is the operator's OWN MAC: a live session on
//                           it is relabelled, STOPPED, or re-postured. `bypass` is the posture
//                           that says "my agent may work on this machine without asking me
//                           first", and nothing narrower may reach another local process.
//
// A conjunction only ever narrows, so **the Axis-A/Axis-B invariant is intact in the direction
// that matters**: no TOOL posture can send a message (Axis B is still required), and no MESSAGE
// posture can touch a local session (Axis A is still required).
//
// ── ⚠ WHAT IS DELIBERATELY NOT ON THIS LIST ──────────────────────────────────────────────────
//
// `manage.launch` and `manage.direct` each keep their OWN lane and are NOT folded in here, for
// the reason `session-own-direct.js` already gives for staying out of the launch list: sameness
// of conjunction is not a reason to merge. `manage.launch` carries the LAUNCH-DEPTH bound and the
// channel's agent-chaining setting; folding a rename in beside it would make relabelling an agent
// depend on a containment switch that has nothing to say about labels — and folding `launch` in
// HERE would hand a capped session the one op the bound exists to refuse.
//
// ⚠ **AND THERE IS NO DEPTH QUESTION ON THIS LANE, WHICH IS THE WHOLE POINT RATHER THAN AN
// OVERSIGHT.** The depth bound counts how many agents come into EXISTENCE. These three create
// none: `rename` relabels one, `end` REMOVES one, and `posture` moves the axes of one that is
// already running. Asking the depth here would re-file the reported defect under a new code —
// the sessions that rename themselves are launched sessions, which are AT the cap by
// construction (`normalizeLaunchDepth`: absent reads as the cap), so every one of them would be
// denied instead of gated. Same reasoning, same answer, as the direct lane's missing bound.
//
// ── ⚠ THE CONSENT IS STILL THE OPERATOR'S, AND THIS LANE DOES NOT TOUCH IT ───────────────────
//
// **This lane admits ASKING.** The op files a REQUEST into the mailbox the operator's own machine
// claims (`launch-directives.js › handle`), and that machine decides. Its per-kind consent split
// is untouched and is NOT this file's to restate: `KINDS_NEEDING_LAUNCH_CONSENT` gates
// `set_agent_mode` behind `channel-prefs.js › getOrchestratorLaunch` (a posture can cause compute
// to be spent on the operator's hardware), and leaves `end` and `rename` outside it (a STOP verb
// and a DISPLAY verb widen nothing). ⚠ So on a machine whose launch toggle is OFF, an ADMITTED
// `manage.posture` still changes nothing and the row expires — exactly as an admitted launch
// does. Widening a gate did not move a consent.
//
// ── ⚠ THE SCOPE IS THE ROOM, AND WHOSE MACHINE IS REACHED IS NOT THIS FILE'S QUESTION ────────
//
// The target agent is named by `to` and is not checked here at all, exactly as
// `session-own-direct.js` does not check `agent_id`: a directive is stamped with the CALLER'S OWN
// `operator_user_id` server-side, so only this operator's machines can ever claim it, and a `to`
// that names nothing running is answered by the machine that would have delivered it. That is
// the honest place for that answer and it is not a posture question. **The ruling widens WHO MAY
// ASK on the operator's own machine, never WHOSE MACHINE MAY BE ASKED.**

// ⚠ **`<op>.<action>`, NOT AN OP (2026-09-02, F-578).** `manage` is a dispatcher over five
// actions; keying on the bare op would admit `launch` — which carries the depth bound — and
// `direct` through a door written for neither. The key is `channel-op-key.js › channelOpKey`, the
// same grain the gate's other classifiers and the server's own write gate read.
const { channelOpKey } = require('./channel-op-key'); // <op>.<action> — the ONE spelling (F-578)

// ⚠ AN ALLOW LIST, NAMED EXPLICITLY AND NEVER BY PREFIX. A key named nowhere resolves to `gate`
// in every posture, which is the safe direction, so a fourth action joins by being written down
// here or not at all.
const OWN_MACHINE_MANAGE_OPS = ['manage.rename', 'manage.end', 'manage.posture'];

// The Axis-A posture that may reach another process on this Mac. ⚠ COMPARED AS A LITERAL, and a
// value outside the enum is simply not it — `session-io.js › grantArgs` has already normalized
// and floored the axis by the time this is asked. Deliberately a THIRD spelling of
// `session-own-launch.js › LAUNCH_TOOL_MODE` rather than an import of it, on the reason
// `session-own-direct.js › DIRECT_TOOL_MODE` states: these are separate rulings that happen to
// agree, and a shared constant would make a future narrowing of one silently narrow the others.
const MANAGE_TOOL_MODE = 'bypass';

/**
 * THE AUDIT CODE PER ACTION — one `GATE_REASONS` entry each, never one for the lane.
 *
 * ⚠ **THREE CODES, NOT ONE, AND THE GRAIN IS THE ARGUMENT RATHER THAN THE VERB** — which is the
 * same rule that gave the four `artifact.*` actions a SINGLE code (`auto-outbound-artifact`,
 * 2026-09-06: they share one admission argument). These three do NOT share one. The question an
 * audit line answers is *"what happened on this machine with no click?"*, and **"an agent was
 * STOPPED"**, **"an agent was RELABELLED"** and **"an agent's POSTURE was asked to move"** are
 * three different answers — a distinction the delivery end already makes in code, where the
 * posture verb sits behind the operator's launch toggle and the other two do not
 * (`launch-directives.js › KINDS_NEEDING_LAUNCH_CONSENT`). One code would flatten the
 * only consequential verb into the two harmless ones.
 *
 * ⚠ AND NONE OF THEM MAY BORROW AN OUTBOUND CODE: nothing left this machine as CONTENT, exactly
 * as `auto-launch-own-machine` says for the lane next door.
 */
const MANAGE_ALLOW_REASONS = {
  'manage.rename': 'auto-rename-own-machine',
  'manage.end': 'auto-end-own-machine',
  'manage.posture': 'auto-posture-own-machine',
};

/**
 * A `manage(action="rename"|"end"|"posture")` aimed at THIS session's own channel.
 *
 * ⚠ SAME SCOPE RULE AND SAME SAFE FAILURE AS EVERY OTHER OWN-CHANNEL PREDICATE
 * (`session-own-launch.js › isOwnMachineLaunch`, `session-own-direct.js › isOwnMachineDirect`,
 * `session-own-outbound.js › scopedToOwnChannel`): the target is unset or EXACTLY this session's
 * channel ID. A SLUG is another channel and gates, and so is any other channel's id — an agent
 * must not be able to manage the staff of a room it is not in.
 */
function isOwnMachineManage(input, sessionChannelId) {
  const i = input || {};
  if (OWN_MACHINE_MANAGE_OPS.indexOf(channelOpKey(i)) === -1) return false;
  const target = i.channel;
  if (target == null || target === '') return true; // no explicit target -> own channel
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

/**
 * THE VERDICT FOR AN OWN-MACHINE MANAGE OP — the only thing `grantDecision` asks this module.
 *
 * ⚠ NO DEPTH QUESTION AND NO CHAINING SETTING: see the header. Nothing here can answer `deny`,
 * which is correct — the not-admitted case is a POSTURE the operator can widen, so it must stay
 * the refusable verdict.
 *
 * `autoOutbound` is Axis B's outbound half, resolved by the caller (`autoOutboundMode`) so this
 * module holds no second copy of the message enum.
 */
function manageLaneVerdict(args, autoOutbound) {
  const a = args || {};
  return a.toolMode === MANAGE_TOOL_MODE && autoOutbound === true ? 'allow' : 'gate';
}

/**
 * THE ALLOW CODE FOR AN ADMITTED CALL, or `null` for anything this lane did not admit.
 *
 * ⚠ IT ASKS `isOwnMachineManage` RATHER THAN INDEXING THE MAP, so the explainer cannot narrate a
 * CROSS-CHANNEL manage as an own-machine one on the day some other lane allows it. Same injection
 * discipline as every other predicate `session-gate-reason.js` is handed: one definition, and the
 * explainer holds no copy of it.
 */
function manageAllowReason(input, sessionChannelId) {
  if (!isOwnMachineManage(input, sessionChannelId)) return null;
  return MANAGE_ALLOW_REASONS[channelOpKey(input || {})] || null;
}

module.exports = {
  OWN_MACHINE_MANAGE_OPS,
  MANAGE_TOOL_MODE,
  MANAGE_ALLOW_REASONS,
  isOwnMachineManage,
  manageLaneVerdict,
  manageAllowReason,
};
