// THE OWN-MACHINE MANAGE LANE — `dopl_channel(op="manage")`'s three housekeeping actions
// (`rename` · `end` · `posture`) addressed at THIS session's own channel.
//
// F-320's defect class, one op later (Samuel, 2026-09-17): a `bypass` / `auto_both` channel
// admitted an orchestrator's `manage(action="launch")` and then GATED the
// `manage(action="rename")` that agent issued against the one it had just launched. A gate is not
// a question here — a held channel-op gate has no surface to be answered on, so the orchestrator
// waits forever — and the shipped Coder template tells every coder to rename itself on start.
//
// §2 SPLIT, on the precedent `session-own-launch.js` set: a ruling's admission argument lives
// beside the list it admits, and `session-profiles.js` is at the 500-line cap. PURE, with one
// require (the shared `<op>.<action>` key). IT CLASSIFIES ONLY — nothing here writes a row, claims
// one or stops a session, so this widens what may be ASKED and nothing about what this machine
// DOES.
//
// The three take the launch lane's two-axis conjunction, and neither axis alone can decide one:
//   AXIS B, outbound half   the ask LEAVES this machine — all three write a
//                           `channel_launch_directives` row (`kind: 'rename' | 'end' |
//                           'set_agent_mode'`), at least as outbound as a post.
//   AXIS A, `bypass` only   what they reach is the operator's OWN MAC: a live session on it is
//                           relabelled, STOPPED or re-postured, and nothing narrower may reach
//                           another local process.
// A conjunction only narrows, so the Axis-A/Axis-B invariant holds in the direction that matters.
//
// NO DEPTH QUESTION, BY DESIGN. The launch-depth bound counts agents coming into EXISTENCE and
// these three create none; asking it would DENY every renaming session rather than gate it, since
// launched sessions sit AT the cap by construction (`normalizeLaunchDepth`). `manage.launch` and
// `manage.direct` keep their own lanes — sameness of conjunction is not a reason to merge, and
// folding `launch` in here would hand a capped session the one op the bound exists to refuse.
//
// THE CONSENT IS STILL THE OPERATOR'S. This lane admits ASKING: the op files a request into the
// mailbox the operator's own machine claims (`launch-directives.js › handle`), and that machine's
// per-kind consent split is untouched — `KINDS_NEEDING_LAUNCH_CONSENT` gates `set_agent_mode`
// behind `channel-prefs.js › getOrchestratorLaunch` and leaves `end` and `rename` outside it. On a
// machine whose launch toggle is off an admitted `manage.posture` still changes nothing.
//
// The target agent named by `to` is not checked here, exactly as `session-own-direct.js` does not
// check `agent_id`: a directive is stamped with the CALLER'S OWN `operator_user_id` server-side,
// so only this operator's machines can claim it. The ruling widens WHO MAY ASK on the operator's
// own machine, never WHOSE MACHINE MAY BE ASKED.

// `<op>.<action>`, NOT AN OP (2026-09-02, F-578). `manage` dispatches over five actions, and
// keying on the bare op would admit `launch` — which carries the depth bound — and `direct`
// through a door written for neither. The key is the same grain the gate's other classifiers and
// the server's own write gate read.
const { channelOpKey } = require('./channel-op-key'); // <op>.<action> — the ONE spelling (F-578)

// AN ALLOW LIST, NAMED EXPLICITLY AND NEVER BY PREFIX. A key named nowhere resolves to `gate` in
// every posture, so a fourth action joins by being written down here or not at all.
const OWN_MACHINE_MANAGE_OPS = ['manage.rename', 'manage.end', 'manage.posture'];

// The Axis-A posture that may reach another process on this Mac. Compared as a LITERAL —
// `session-io.js › grantArgs` has already normalized and floored the axis. Deliberately a third
// spelling rather than an import of `session-own-launch.js › LAUNCH_TOOL_MODE`: these are separate
// rulings that happen to agree, and a shared constant would make a future narrowing of one
// silently narrow the others.
const MANAGE_TOOL_MODE = 'bypass';

/**
 * THE AUDIT CODE PER ACTION — three codes, not one, because the grain is the ARGUMENT rather than
 * the verb (the same rule that gave the four `artifact.*` actions a single code). "An agent was
 * STOPPED", "an agent was RELABELLED" and "an agent's POSTURE was asked to move" are three
 * different answers to *"what happened on this machine with no click?"* — a distinction the
 * delivery end already makes in code, where only the posture verb sits behind the operator's
 * launch toggle (`launch-directives.js › KINDS_NEEDING_LAUNCH_CONSENT`).
 *
 * None of them may borrow an outbound code: nothing left this machine as CONTENT.
 */
const MANAGE_ALLOW_REASONS = {
  'manage.rename': 'auto-rename-own-machine',
  'manage.end': 'auto-end-own-machine',
  'manage.posture': 'auto-posture-own-machine',
};

/**
 * A `manage(action="rename"|"end"|"posture")` aimed at THIS session's own channel.
 *
 * Same scope rule and same safe failure as every other own-channel predicate: the target is unset
 * or EXACTLY this session's channel id. A SLUG is another channel and gates, and so is any other
 * channel's id — an agent must not manage the staff of a room it is not in.
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
 * Nothing here can answer `deny`, which is correct: the not-admitted case is a POSTURE the
 * operator can widen, so it must stay the refusable verdict. `autoOutbound` is Axis B's outbound
 * half, resolved by the caller so this module holds no second copy of the message enum.
 */
function manageLaneVerdict(args, autoOutbound) {
  const a = args || {};
  return a.toolMode === MANAGE_TOOL_MODE && autoOutbound === true ? 'allow' : 'gate';
}

/**
 * THE ALLOW CODE FOR AN ADMITTED CALL, or `null` for anything this lane did not admit. It asks
 * `isOwnMachineManage` rather than indexing the map, so the explainer cannot narrate a
 * CROSS-CHANNEL manage as an own-machine one on the day some other lane allows it.
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
