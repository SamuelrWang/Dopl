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
// grantKeyFor / BYPASS_TOOLS / normalizeToolMode), so there is exactly ONE definition of each
// and this file cannot drift into its own copy of the rules.

// The closed set of reason codes. A payload / diag line carries one of these or nothing;
// anything else is a bug, and the renderer renders no line at all for a code it does not know.
const GATE_REASONS = [
  // gate / deny
  'hard-denied', //              SESSION_HARD_DENY (or a restricted profile's deny list)
  'malformed-post-fields', //    FIX F9: `to` / `kind` is not a string, so nothing can describe it
  'cross-channel-post', //       AXIS B: op=post whose channel is not this session's channel ID
  'message-approval-required', //AXIS B: an own-channel post while messageMode is not auto-outbound
  'channel-op-approval-required', // AXIS B: open / invite / read / create_task — never auto-sent
  'not-covered-by-bypass', //    AXIS A miss on a CLASSIFIED tool while the posture is auto/bypass
  'unclassified-tool', //        FIX F3: a name in no list at all, which gates in EVERY mode
  'awaiting-approval', //        AXIS A miss under manual / accept_edits — the posture is "ask"
  // allow / preapproved (carried for the diag line, so "never landed" and "landed but not
  // covered" are distinguishable in the field without a source read)
  'profile-preapproved', //      shadowed via allowedTools; never actually reaches canUseTool
  'granted-for-session', //      the operator's scoped allowForTask key covers this exact shape
  'auto-outbound', //            AXIS B auto_outbound / auto_both on an own-channel post
  'tool-mode', //                AXIS A: the current toolMode covers this tool
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
  // then the own-post case, then the two shapes that are never auto-sent.
  const channelReason = function (a) {
    if (!d.postFieldsOk(a.input)) return 'malformed-post-fields';
    if (d.isOwnChannelPost(a.input, a.channelId)) return 'message-approval-required';
    const op = a.input && a.input.op;
    // A SLUG lands here too, and that is the single most confusing gate in the product: the
    // agent addressed its own channel by name, isOwnChannelPost compares against the ID, and the
    // safe classification is "another channel". The renderer's copy names the fix (use the id).
    return op === 'post' ? 'cross-channel-post' : 'channel-op-approval-required';
  };
  // WHY did a WORK tool stop? "Not in any list this build knows" is a DIFFERENT fact from "known
  // but not covered by the posture you set", and conflating them is what made bypass look broken.
  const toolReason = function (a) {
    const name = typeof a.toolName === 'string' ? a.toolName : '';
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
      return channel ? 'auto-outbound' : 'tool-mode';
    }
    if (decision !== 'gate') return null; // an unknown verdict explains nothing, honestly
    return channel ? channelReason(a) : toolReason(a);
  };
}

module.exports = { GATE_REASONS, makeGateReason };
