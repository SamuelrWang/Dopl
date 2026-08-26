// THE OWN-CHANNEL OUTBOUND OPS BESIDE THE POST — AXIS B's outbound half for the `dopl_channel`
// ops that are not `op="post"`.
//
// §2 SPLIT out of session-profiles.js (2026-08-24, Samuel's create_thread ruling). That file
// measured 496 of the 500-line cap, and the ruling needed the ADMISSION ARGUMENT written down
// beside the list it admits to — a file at the cap does not just stop growing, it stops being
// correctable, which is the same reason session-grant-keys.js was split out (2026-08-02) and
// session-preset-census.test.mjs before it.
//
// PURE, and with NO require at all: two frozen op lists and one scope rule over them.
// session-profiles.js requires this at its module head and RE-EXPORTS everything here, so no
// caller moved; the two harness tests that slice the SESSION-PROFILE TABLE inject these names
// exactly as they already inject `makeGrantKeyFor` / `isKnowledgeReadCall`.
//
// ⚠ IT CLASSIFIES, IT DOES NOT DECIDE — the same discipline as session-grant-keys.js. Nothing
// here answers "may this run"; it answers "which lane is this call in". `grantDecision` is the
// only thing that turns that into a verdict, and it still consults the OUTBOUND half of the
// message axis before any of these can allow anything.
//
// ── WHAT EARNS THIS LANE, AND THE TWO DIFFERENT ARGUMENTS THAT PUT THE TWO OPS ON IT ────────
//
//   milestone      A one-line marker: it addresses nobody, carries no deliverable, and nothing
//                  reads one as an answer. It earns the lane by being STRICTLY LESS POWERFUL
//                  than the own-channel `post` that `auto_outbound` already auto-allows into
//                  the same channel from the same session; prompt-framing INSTRUCTS the agent
//                  to log them, so gating it cost a click per exchange and removed no consent
//                  point. (M4, 2026-08-05, F-139.)
//
//   create_thread  ⚠ SAMUEL'S RULING, 2026-08-24. It is NOT less powerful, and pretending it
//                  were is how it would end up mis-named a "marker": it is a post with a TITLE
//                  on it, opening the exchange the tool's own protocol tells an agent to open
//                  FIRST ("open a thread with create_thread"). It earns the lane on the OTHER
//                  argument — it is OUTBOUND CONTENT INTO THIS SESSION'S OWN CHANNEL, addressed
//                  to a member of that same channel, which is exactly and only what the
//                  outbound half of the axis consents to.
//                  ⚠ WHAT IT COST TO LEAVE IT OFF, live-observed on v1.19.0: unclassified, it
//                  fell through to the AXIS-A gate, and a WINDOWLESS session answers a gate
//                  with `deny` (`session-windowless.js › claimGate`). So the op an agent is
//                  told to start with was AUTO-REFUSED, verbatim: "This tool needs a permission
//                  prompt and this session has no surface to show one on, so the call was
//                  refused automatically." It was never a posture the operator could set.
//
// ⚠ AND `launch_agent` IS NOT A THIRD MEMBER — IT IS A THIRD LANE (2026-08-25, F-320). It was
// admitted on the SAME DAY'S ruling and to the SAME windowless sessions, so the temptation to
// add one string to the list below is real: do not. A launch is not outbound CONTENT, it asks
// for a PROCESS on the operator's machine, and this lane is governed by the message axis ALONE —
// admitting it here would hand every windowless agent an unprompted launch under a message
// posture. It lives in `session-own-launch.js`, gated on BOTH axes and on a depth bound.
//
// ⚠ THE BAR THE TWO SHARE, AND IT IS THE ONE TO KEEP: ANYTHING THAT SETTLES SHARED STATE NEVER
// QUALIFIED. `close_thread` was deliberately never on this list, and `propose_close` — the
// marker's original sibling — left the MCP enum entirely with thread closing (wiring plan
// Phase 4, 2026-08-18). A thread OPEN is not a settle: nothing about it is terminal, a thread
// has no finished state for anyone to set, and its two parties are this session's operator and
// one member of a channel they are both already in.
//
// ⚠ THESE ARE ALLOW LISTS, NEVER DENY LISTS. Dropping a name makes the op GATE, which is the
// safe direction; an op named in neither list resolves to `gate` in every posture, which is why
// a deleted op never needs an explicit deny.
//
// ⚠ AND THE SCOPE IS THE CHANNEL, BY ID. A `channel` naming anything but this session's channel
// id — A SLUG INCLUDED — is ANOTHER channel and gates, exactly as for a post. The THREAD is
// deliberately NOT scoped: the gate is handed a channelId, not a taskId, so a wrong thread id
// costs a confirm prompt inside a channel the operator is already bound to (F-139).

// The MARKER half. Kept as its own name because the diag line's `auto-outbound-marker` reason
// code is keyed on it, and "the agent logged a milestone" is not the same answer to "what left
// this machine with no click?" as "the agent opened a thread".
const OWN_CHANNEL_MARKER_OPS = ['milestone'];

// The THREAD-OPEN half (Samuel's ruling, 2026-08-24). Its own name for the same reason.
const OWN_CHANNEL_THREAD_OPS = ['create_thread'];

// What `grantDecision` actually asks about. Derived, never restated: a third member added to
// either list above joins the lane and the reason codes for free.
const OWN_CHANNEL_OUTBOUND_OPS = OWN_CHANNEL_MARKER_OPS.concat(OWN_CHANNEL_THREAD_OPS);

// THE ONE SCOPE RULE, shared by every predicate below so two of them can never disagree about
// what "my own channel" means. Same shape and same safe failure as
// `session-profiles.js › isOwnChannelPost`: target unset or exactly the session's channel ID.
function scopedToOwnChannel(ops, input, sessionChannelId) {
  const i = input || {};
  if (ops.indexOf(i.op) === -1) return false;
  const target = i.channel;
  if (target == null || target === '') return true; // no explicit target -> own channel
  return String(target) === String(sessionChannelId == null ? '' : sessionChannelId);
}

/** An own-channel `milestone`. Used by the gate REASON, to say which allow this was. */
function isOwnChannelMarker(input, sessionChannelId) {
  return scopedToOwnChannel(OWN_CHANNEL_MARKER_OPS, input, sessionChannelId);
}

/** An own-channel `create_thread`. Also the predicate `session-io.js` asks to decide that a
 *  gated one raises the OUTBOUND consent payload rather than the dock's `permission_request`. */
function isOwnChannelThreadOpen(input, sessionChannelId) {
  return scopedToOwnChannel(OWN_CHANNEL_THREAD_OPS, input, sessionChannelId);
}

/** Either of them — the single question `grantDecision`'s Axis-B branch asks. */
function isOwnChannelOutbound(input, sessionChannelId) {
  return scopedToOwnChannel(OWN_CHANNEL_OUTBOUND_OPS, input, sessionChannelId);
}

module.exports = {
  OWN_CHANNEL_MARKER_OPS,
  OWN_CHANNEL_THREAD_OPS,
  OWN_CHANNEL_OUTBOUND_OPS,
  isOwnChannelMarker,
  isOwnChannelThreadOpen,
  isOwnChannelOutbound,
};
