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
// grantKeyFor / isClassifiedTool / normalizeToolMode / canonicalDoplName / the two own-channel op
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
  'launch-posture-required', //  2026-08-25 (F-320): an own-channel `launch_agent` while the two
  //                             postures its lane needs are not BOTH set (tools `bypass` AND
  //                             messages auto-outbound). Its own code because the operator's fix
  //                             is TWO settings, not the one `message-approval-required` names.
  'launch-depth-capped', //      ...and the DENY half: this session is at MAX_LAUNCH_DEPTH, so no
  //                             posture can open it (`session-own-launch.js`). ⚠ IT IS NOT
  //                             `hard-denied`: that code means the PROFILE refused a tool, and
  //                             `dopl_channel` is hard-denied on no profile at all — reporting
  //                             the bound as a profile deny would send an operator to a deny
  //                             list that does not contain it.
  'await-desktop-session', //    2026-09-01 (T85): a HELD `dopl_channel(op="read", wait_ms=…)` from a session this
  //                             machine RUNS. Its own code for the reason `launch-depth-capped`
  //                             has one — `dopl_channel` is hard-denied on no profile, so
  //                             `hard-denied` would send an operator to a deny list that does not
  //                             contain it — and because the fix is NOT a setting: the call is
  //                             refused because a wake already arrives as a TURN here
  //                             (`session-profiles.js › isAwaitOp`).
  'container-audience', //       2026-08-26 (plan §4.4 B2): this session runs in a SHARED link
  //                             container and the call named a DIFFERENT workspace. Its own code
  //                             for the same reason `launch-depth-capped` has one — the tool is
  //                             on no deny list, so `hard-denied` would send the operator to a
  //                             setting that has nothing to do with it. ⚠ The refusal is about
  //                             WHICH WORKSPACE, and this is the only code that says so. ⚠ IT
  //                             NAMES A TRIPWIRE: Bash can issue the same call as plain HTTP and
  //                             never reach this gate — see `session-audience.js`.
  // allow / preapproved (carried for the diag line, so "never landed" and "landed but not
  // covered" are distinguishable in the field without a source read)
  'profile-preapproved', //      shadowed via allowedTools; never actually reaches canUseTool
  'granted-for-session', //      the operator's scoped allowForTask key covers this exact shape
  'auto-outbound', //            AXIS B auto_outbound / auto_both on an own-channel post
  'auto-inbound-read', //        M3: AXIS B auto_inbound / auto_both on an own-channel READ
  'auto-outbound-marker', //     M4: the same outbound half on an own-channel milestone (its
  //                             sibling `propose_close` went with thread closing, Phase 4)
  'auto-launch-own-machine', //  2026-08-25 (Samuel's ruling, F-320): an own-channel
  //                             `launch_agent` that BOTH axes covered — the audit answer to
  //                             "what asked this machine for a process with no click?", which no
  //                             outbound code can give, because nothing left as CONTENT.
  'auto-outbound-escalate', //   2026-08-31 (Samuel's ruling): the same outbound half on an
  //                             own-channel `send(kind="decision")` — an agent asking a HUMAN a structured
  //                             question. Its own code because "the agent asked for a decision"
  //                             is a different answer to "what left with no click?" than a
  //                             milestone or a thread open.
  'auto-outbound-thread-open', //2026-08-24 (Samuel's ruling): the same outbound half on an
  //                             own-channel `create_thread`. ITS OWN CODE, for the reason the
  //                             marker has one: the question an audit asks is "what left this
  //                             machine with no click?", and "the agent opened an exchange with
  //                             a member" is not the same answer as "the agent logged a step".
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
    // ⚠ AND `create_thread` JOINED IT ON 2026-08-24 (Samuel's ruling) — `isOwnChannelOutbound`
    // is the union, so the GATE code is shared even though the ALLOW codes are not. It stops on
    // the same fact ("your outbound setting is not auto"), and the operator's fix is identical.
    if (d.isOwnChannelOutbound(a.input, a.channelId)) return 'message-approval-required';
    // ⚠ 2026-08-25 (F-320): an own-channel LAUNCH stops on a DIFFERENT fact from either half of
    // the message axis — it needs tools=`bypass` AND messages auto-outbound, and naming only the
    // message setting would send the operator to widen a posture that is already wide enough.
    // A launch naming ANOTHER channel is not this case and falls through, as a post's does.
    if (d.isOwnMachineLaunch(a.input, a.channelId)) return 'launch-posture-required';
    const op = a.input && a.input.op;
    // A SLUG lands here too, and that is the single most confusing gate in the product: the
    // agent addressed its own channel by name, isOwnChannelPost compares against the ID, and the
    // safe classification is "another channel". The renderer's copy names the fix (use the id).
    // M4: an OUTBOUND op that got past isOwnChannelOutbound named ANOTHER channel — most often
    // the session's own channel written as a SLUG. It shares the post code deliberately: the
    // fact and the operator's fix are identical ("address your own channel by id"), and a code
    // the operator cannot act on differently is a code that should not exist. (2026-08-24: the
    // list this reads is the UNION, so a slug-addressed `create_thread` lands here too.)
    // (2026-09-02, F-578: the collapse made every outbound shape `op="send"`, so the union this
    // reads is a list of one and the `post` disjunct it used to need is gone with the op.)
    if ((d.OWN_CHANNEL_OUTBOUND_OPS || []).indexOf(op) !== -1) return 'cross-channel-post';
    // M3: a READ op that got here named a channel this session is not bound to (or a slug),
    // which is a DIFFERENT fact from "reads are never auto-run" and now says so.
    // ⚠ ASKED THROUGH THE GATE'S OWN MEMBERSHIP PREDICATE, not by indexing the list: since the
    // five-op collapse the entries are `<op>.<action>` keys (F-578), and a bare `indexOf(op)`
    // here would call a cross-channel `rooms.open` a READ — the one classification the gate
    // itself refuses to make.
    if (d.isOwnChannelReadCall && d.isOwnChannelReadCall(a.input)) return 'cross-channel-read';
    return 'channel-op-approval-required';
  };
  // WHY did a WORK tool stop? "Not in any list this build knows" is a DIFFERENT fact from "known
  // but not covered by the posture you set", and conflating them is what made bypass look broken.
  const toolReason = function (a) {
    // F-139: the SAME canonical name grantDecision matched on. Reading the raw name here would
    // report `unclassified-tool` for a dopl tool the gate had just covered under a different
    // server prefix — the diagnostic and the defect were one bug and must stay one fix.
    const name = d.canonicalDoplName(a.toolName);
    // ⚠ "IN NO LIST THIS BUILD KNOWS" IS ASKED OF THE RUNTIME SINCE 2026-08-31, not of a copied
    // list. `isClassifiedTool` is "allowed at the WIDEST mode this runtime offers", which is the
    // same question the old `BYPASS_TOOLS` membership asked and stays correct on a runtime whose
    // widest mode is not spelled the same way. Injected like every other predicate here, and
    // handed the SESSION'S runtime, or a non-default session would be narrated against another
    // runtime's lists.
    if (!d.isClassifiedTool(name, a.runtime)) return 'unclassified-tool';
    const m = d.normalizeToolMode(a.toolMode, a.runtime);
    return m === 'auto' || m === 'bypass' ? 'not-covered-by-bypass' : 'awaiting-approval';
  };
  return function gateReason(args, decision) {
    const a = args || {};
    const channel = d.isChannelTool(a.toolName);
    // ⚠ 2026-08-25 (F-320): `deny` HAS TWO CAUSES NOW. The profile's hard-deny is one; the LAUNCH
    // DEPTH BOUND is the other, and it is the only one that can deny a channel op (`dopl_channel`
    // is on no profile's deny list). Asked in this order so a hard-denied name can never be
    // narrated as a depth cap, which would be a bound the operator could not find.
    if (decision === 'deny') {
      // ⚠ 2026-08-26: `deny` HAS THREE CAUSES NOW, AND THE ORDER MIRRORS `grantDecision`'S — which
      // is this whole function's standing discipline, and which the first draft of this branch got
      // WRONG. It asked the audience question first, so a HARD-DENIED admin tool that also named
      // another workspace was narrated `container-audience`: both facts true, but the gate refused
      // it at step 1 for a reason that has nothing to do with workspaces, and an operator sent to
      // the audience story would go looking for a roster instead of a profile.
      // ⚠ THE HARD DENY IS ASKED WITH THE GATE'S OWN `buildSessionToolConfig`, injected like every
      // other predicate here — the explainer must not grow a second copy of the deny list.
      const cfg = d.buildSessionToolConfig ? d.buildSessionToolConfig(a.profile, a.runtime) : null;
      const hardDenied = !!cfg && cfg.disallowedTools.indexOf(d.canonicalDoplName(a.toolName)) !== -1;
      if (!hardDenied && d.containerOnlyDenies && d.containerOnlyDenies(a, d.isDoplTool)) {
        return 'container-audience';
      }
      // ⚠ 2026-09-01: `deny` HAS FOUR CAUSES NOW, AND THE ORDER STILL MIRRORS `grantDecision`'S.
      // `await` is refused inside the channel branch, ahead of the launch lane, so it is asked
      // ahead of the depth cap here. The two are disjoint ops, so the order buys nothing today —
      // it is kept because "mirror the gate" is the only rule that has ever kept this function
      // honest, and a branch ordered by coincidence is one nobody can check.
      if (channel && !hardDenied && d.isAwaitOp && d.isAwaitOp(a.input)) return 'await-desktop-session';
      return channel && d.isOwnMachineLaunch(a.input, a.channelId) ? 'launch-depth-capped' : 'hard-denied';
    }
    if (decision === 'preapproved') return 'profile-preapproved';
    if (decision === 'allow') {
      if (grantedFor(a)) return 'granted-for-session';
      // ⚠ THE ORDER MIRRORS `grantDecision` AGAIN: Axis A is consulted BEFORE the op-scoped
      // knowledge branch, so a `dopl_kb` call under `bypass` (where `BYPASS_TOOLS` really does
      // carry the whole tool) is honestly reported as `tool-mode`, and only a call Axis A
      // MISSED can be a `knowledge-read-op`.
      if (!channel) {
        const name = d.canonicalDoplName(a.toolName);
        if (d.toolModeAllows(a.toolMode, name, a.runtime)) return 'tool-mode';
        return d.isKnowledgeReadCall(name, a.input) ? 'knowledge-read-op' : 'tool-mode';
      }
      // ⚠ THE LAUNCH LANE IS ASKED FIRST OF THE CHANNEL ALLOWS (2026-08-25, F-320), because it
      // is the only one that is not a message: nothing left this machine as CONTENT, and an
      // audit line claiming otherwise would put a launch under "what did my agent say".
      if (d.isOwnMachineLaunch(a.input, a.channelId)) return 'auto-launch-own-machine';
      // M3: the Axis-B allows are different rules and the diag must be able to tell them
      // apart — "your outbound setting sent this" vs "your inbound setting read this".
      if (d.isOwnChannelRead(a.input, a.channelId)) return 'auto-inbound-read';
      // M4: a marker keeps its OWN code on the allow side, where the gate codes were merged.
      // The question this line answers in an audit is "what left this machine with no click?",
      // and "the agent proposed a close" is not the same answer as "the agent sent a message".
      // ⚠ 2026-08-24: `create_thread` rides the same lane and takes the SAME treatment — its
      // own code, asked FIRST because the two op sets are disjoint and neither may absorb the
      // other's audit line.
      if (d.isOwnChannelThreadOpen(a.input, a.channelId)) return 'auto-outbound-thread-open';
      if (d.isOwnChannelEscalate(a.input, a.channelId)) return 'auto-outbound-escalate';
      if (d.isOwnChannelMarker(a.input, a.channelId)) return 'auto-outbound-marker';
      return 'auto-outbound';
    }
    if (decision !== 'gate') return null; // an unknown verdict explains nothing, honestly
    return channel ? channelReason(a) : toolReason(a);
  };
}

/**
 * `{ decision, reason }` — the verdict plus a `GATE_REASONS` code, or `null` for a verdict
 * nothing can honestly explain.
 *
 * ⚠ IT MOVED HERE FROM `session-profiles.js` ON 2026-08-26, under the hard 500-line cap that file
 * was sitting exactly on (§1). The seam is the one that file's own comment already named:
 * MAKING a verdict and EXPLAINING one change on different clocks, and the explainer was already
 * built outside the extracted profile table so an explanation could never move a gate.
 *
 * ⚠ IT TAKES `grantDecision` AS AN ARGUMENT RATHER THAN REQUIRING IT, and that is what keeps the
 * two modules acyclic: `session-profiles.js` requires this file, so this file must not require it
 * back. Same injection idiom `makeGateReason` already uses for its predicates, and the same
 * guarantee — the explainer is handed the gate's OWN function, so it can never explain a verdict
 * some second copy of the rules produced.
 */
function makeGrantDetail(grantDecision, predicates) {
  const gateReason = makeGateReason(predicates);
  return function grantDecisionDetail(args) {
    const decision = grantDecision(args);
    return { decision, reason: gateReason(args, decision) };
  };
}

module.exports = { GATE_REASONS, makeGateReason, makeGrantDetail };
