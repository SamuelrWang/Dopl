// WHY a session tool call was gated or denied (2026-08-02, the "bypass still asks" round).
//
// THE DEFECT. grantDecision is CORRECT far more often than it looks. Under `bypass` an
// unclassified tool still gates on purpose (session-profiles FIX F3: unknown names are never
// auto-allowed), a slug-addressed post is classified cross-channel on purpose (isOwnChannelPost
// compares against the channel ID only), and a malformed `to`/`kind` refuses to auto-allow on
// purpose (FIX F9). None of that was ever SAID, so every one of them read to the operator as a
// broken toggle: "I turned bypass on and it still asks." A verdict the operator cannot explain
// is a verdict they stop trusting, and then they turn the gate off for the wrong reason.
//
// This module turns a verdict into a machine-readable REASON CODE. It is deliberately NOT a
// second decision point: it takes the DECISION grantDecision already made and only explains it,
// so it can never disagree with the gate about what happens — only about how it is described.
// The codes are stable identifiers; the operator-facing WORDS live in the renderer
// (session-render.gateReasonText) and the diag line prints the code, never the words.
//
// PURE + electron-free, like session-profiles: it is built by FACTORY with the predicates the
// session-profile table already owns (isChannelTool / isOwnChannelPost / postFieldsOk /
// grantKeyFor / BYPASS_TOOLS / normalizeToolMode / canonicalDoplName / the two own-channel op
// sets), so there is exactly ONE definition of each and this file cannot drift into its own
// copy of the rules — F-139 is what that discipline is for: the matcher and its explanation
// were wrong in lockstep, and normalizing in one place fixed both.

// The closed set of reason codes. A payload / diag line carries one of these or nothing;
// anything else is a bug, and the renderer renders no line at all for a code it does not know.
const GATE_REASONS = [
  // gate / deny
  'hard-denied', //              SESSION_HARD_DENY (or a restricted profile's deny list)
  'malformed-post-fields', //    FIX F9: `to` / `kind` is not a string, so nothing can describe it
  'cross-channel-post', //       AXIS B: op=post whose channel is not this session's channel ID
  'cross-channel-read', //       M3: a READ op whose channel is not this session's channel ID
  'message-approval-required', //AXIS B: an own-channel post while messageMode is not auto-outbound
  'read-approval-required', //   M3: an own-channel READ while messageMode is not auto-inbound
  'channel-op-approval-required', // AXIS B: open / invite / create_thread — never auto-run
  'not-covered-by-bypass', //    AXIS A miss on a CLASSIFIED tool while the posture is auto/bypass
  'unclassified-tool', //        FIX F3: a name in no list at all, which gates in EVERY mode
  'awaiting-approval', //        AXIS A miss under manual / accept_edits — the posture is "ask"
  // allow / preapproved (carried for the diag line, so "never landed" and "landed but not
  // covered" are distinguishable in the field without a source read)
  'profile-preapproved', //      shadowed via allowedTools; never actually reaches canUseTool
  'granted-for-session', //      the operator's scoped allowForTask key covers this exact shape
  'auto-outbound', //            AXIS B auto_outbound / auto_both on an own-channel post
  'auto-inbound-read', //        M3: AXIS B auto_inbound / auto_both on an own-channel READ
  'auto-outbound-marker', //     M4: the same outbound half on an own-channel milestone (its
  //                             sibling `propose_close` went with thread closing, Phase 4)
  'tool-mode', //                AXIS A: the current toolMode covers this tool
  'knowledge-read-op', //        2026-08-22 (OQ-1): an OP-SCOPED `dopl_kb` READ. Axis A does NOT
  //                             cover the tool (it is a write tool), the CALL is a read, and
  //                             that distinction is exactly what an audit of "what ran with no
  //                             click?" needs to see — `tool-mode` here would claim the operator
  //                             had granted the whole tool, which they had not.
];

// Build the explainer. `deps` are the session-profile table's own predicates — passed in rather
// than required, because session-profiles requires THIS module and a cycle would leave one half
// half-initialized at load.
function makeGateReason(deps) {
  const d = deps || {};
  const grantedFor = function (a) {
    const held = a.allowForTask || [];
    return held.indexOf(d.grantKeyFor(a.toolName, a.input, a.channelId)) !== -1;
  };
  // WHY did a CHANNEL call stop? The order MIRRORS grantDecision's own channel branch, which is
  // what keeps the explanation true: malformed first (it gates before anything else is asked),
  // then the own-post case, then M3's own-read case, then the shapes that are never auto-run.
  const channelReason = function (a) {
    if (!d.postFieldsOk(a.input)) return 'malformed-post-fields';
    if (d.isOwnChannelPost(a.input, a.channelId)) return 'message-approval-required';
    if (d.isOwnChannelRead(a.input, a.channelId)) return 'read-approval-required';
    // M4: an own-channel milestone follows the OUTBOUND half of the axis exactly as a post
    // does, so it stops on the same fact and must say the same thing.
    // 'channel-op-approval-required' ("message approval covers this channel's messages, not
    // this operation") became FALSE for it the moment the axis started covering it. (Its
    // sibling `propose_close` was on this branch until thread closing, Phase 4, 2026-08-18.)
    if (d.isOwnChannelMarker(a.input, a.channelId)) return 'message-approval-required';
    const op = a.input && a.input.op;
    // A SLUG lands here too, and that is the single most confusing gate in the product: the
    // agent addressed its own channel by name, isOwnChannelPost compares against the ID, and the
    // safe classification is "another channel". The renderer's copy names the fix (use the id).
    // M4: a marker op that got past isOwnChannelMarker named ANOTHER channel — most often the
    // session's own channel written as a SLUG. It shares the post code deliberately: the fact
    // and the operator's fix are identical ("address your own channel by id"), and a code the
    // operator cannot act on differently is a code that should not exist.
    if (op === 'post' || (d.OWN_CHANNEL_MARKER_OPS || []).indexOf(op) !== -1) return 'cross-channel-post';
    // M3: a READ op that got here named a channel this session is not bound to (or a slug),
    // which is a DIFFERENT fact from "reads are never auto-run" and now says so.
    if ((d.OWN_CHANNEL_READ_OPS || []).indexOf(op) !== -1) return 'cross-channel-read';
    return 'channel-op-approval-required';
  };
  // WHY did a WORK tool stop? "Not in any list this build knows" is a DIFFERENT fact from "known
  // but not covered by the posture you set", and conflating them is what made bypass look broken.
  const toolReason = function (a) {
    // F-139: the SAME canonical name grantDecision matched on. Reading the raw name here would
    // report `unclassified-tool` for a dopl tool the gate had just covered under a different
    // server prefix — the diagnostic and the defect were one bug and must stay one fix.
    const name = d.canonicalDoplName(a.toolName);
    if ((d.BYPASS_TOOLS || []).indexOf(name) === -1) return 'unclassified-tool';
    const m = d.normalizeToolMode(a.toolMode);
    return m === 'auto' || m === 'bypass' ? 'not-covered-by-bypass' : 'awaiting-approval';
  };
  return function gateReason(args, decision) {
    const a = args || {};
    if (decision === 'deny') return 'hard-denied';
    if (decision === 'preapproved') return 'profile-preapproved';
    const channel = d.isChannelTool(a.toolName);
    if (decision === 'allow') {
      if (grantedFor(a)) return 'granted-for-session';
      // ⚠ THE ORDER MIRRORS `grantDecision` AGAIN: Axis A is consulted BEFORE the op-scoped
      // knowledge branch, so a `dopl_kb` call under `bypass` (where `BYPASS_TOOLS` really does
      // carry the whole tool) is honestly reported as `tool-mode`, and only a call Axis A
      // MISSED can be a `knowledge-read-op`.
      if (!channel) {
        const name = d.canonicalDoplName(a.toolName);
        if (d.toolModeAllows(a.toolMode, name)) return 'tool-mode';
        return d.isKnowledgeReadCall(name, a.input) ? 'knowledge-read-op' : 'tool-mode';
      }
      // M3: the Axis-B allows are different rules and the diag must be able to tell them
      // apart — "your outbound setting sent this" vs "your inbound setting read this".
      if (d.isOwnChannelRead(a.input, a.channelId)) return 'auto-inbound-read';
      // M4: a marker keeps its OWN code on the allow side, where the gate codes were merged.
      // The question this line answers in an audit is "what left this machine with no click?",
      // and "the agent proposed a close" is not the same answer as "the agent sent a message".
      if (d.isOwnChannelMarker(a.input, a.channelId)) return 'auto-outbound-marker';
      return 'auto-outbound';
    }
    if (decision !== 'gate') return null; // an unknown verdict explains nothing, honestly
    return channel ? channelReason(a) : toolReason(a);
  };
}

module.exports = { GATE_REASONS, makeGateReason };
