// WHY a session tool call was gated or denied (2026-08-02, the "bypass still asks" round).
//
// grantDecision is CORRECT far more often than it looks: under `bypass` an unclassified tool still
// gates on purpose (FIX F3), a slug-addressed post is classified cross-channel on purpose, and a
// malformed `to`/`kind` refuses to auto-allow on purpose (FIX F9). None of it was ever SAID, so
// each read to the operator as a broken toggle.
//
// This module turns a verdict into a machine-readable REASON CODE. It is deliberately NOT a second
// decision point: it takes the decision `grantDecision` already made and only explains it, so it
// can never disagree about what happens — only about how it is described. The codes are stable
// identifiers; the operator-facing WORDS live in the renderer (`session-render.gateReasonText`)
// and the diag line prints the code, never the words.
//
// PURE + electron-free, like session-profiles: built by FACTORY with the predicates the
// session-profile table already owns, so there is exactly ONE definition of each and this file
// cannot drift into its own copy of the rules — F-139 is what that discipline is for, where the
// matcher and its explanation were wrong in lockstep.

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
  'manage-posture-required', //  2026-09-17 (Samuel's field report): an own-channel
  //                             `manage.rename` / `.end` / `.posture` — and `manage.direct`, since
  //                             later the same day — while the two postures its lane needs are not
  //                             BOTH set. It names the two postures, not the `posture` action. Its
  //                             own code because these answered `channel-op-approval-required`,
  //                             which sent the operator to an approval that exists on no surface:
  //                             the F-320 dead end, one op over. Named for the OP FAMILY rather
  //                             than the `posture` verb, which is what lets it cover four actions.
  'launch-depth-capped', //      ...and the DENY half: this session is at MAX_LAUNCH_DEPTH, so no
  //                             posture can open it (`session-own-launch.js`). NOT `hard-denied`:
  //                             that code means the PROFILE refused a tool, and `dopl_channel` is
  //                             hard-denied on no profile at all.
  'await-desktop-session', //    2026-09-01 (T85): a HELD `dopl_channel(op="read", wait_ms=…)` from
  //                             a session this machine RUNS. Its own code for the reason
  //                             `launch-depth-capped` has one, and because the fix is NOT a
  //                             setting — a wake already arrives as a TURN here
  //                             (`session-profiles.js › isAwaitOp`).
  'container-audience', //       2026-08-26 (plan §4.4 B2): this session runs in a SHARED link
  //                             container and the call named a DIFFERENT workspace. Its own code
  //                             for `launch-depth-capped`'s reason, and the only code that says
  //                             the refusal is about WHICH WORKSPACE. It names a TRIPWIRE: Bash
  //                             can issue the same call as plain HTTP and never reach this gate —
  //                             see `session-audience.js`.
  // allow / preapproved (carried for the diag line, so "never landed" and "landed but not
  // covered" are distinguishable in the field without a source read)
  'profile-preapproved', //      shadowed via allowedTools; never actually reaches canUseTool
  'granted-for-session', //      the operator's scoped allowForTask key covers this exact shape
  'auto-outbound', //            AXIS B auto_outbound / auto_both on an own-channel post
  'auto-inbound-read', //        M3: AXIS B auto_inbound / auto_both on an own-channel READ
  'auto-outbound-marker', //     M4: the same outbound half on an own-channel milestone (its
  //                             sibling `propose_close` went with thread closing, Phase 4)
  'auto-launch-own-machine', //  2026-08-25 (F-320): an own-channel `launch_agent` that BOTH axes
  //                             covered — the audit answer to "what asked this machine for a
  //                             process with no click?", which no outbound code can give.
  'auto-direct-own-machine', //  2026-09-17: an own-channel `manage.direct` that BOTH axes covered
  //                             — an agent steering ANOTHER of this operator's running agents
  //                             through the private mailbox (`session-own-direct.js`). Its own
  //                             code: until this change it answered `auto-outbound`, so every
  //                             private direction in the field was indistinguishable in
  //                             `listener.log` from a post into the room. Not an outbound code, for
  //                             `auto-launch-own-machine`'s reason: nothing left as CONTENT.
  'auto-rename-own-machine', //  2026-09-17: an own-channel `manage.rename` BOTH axes covered.
  'auto-end-own-machine', //     ...an own-channel `manage.end`.
  'auto-posture-own-machine', // ...and an own-channel `manage.posture`. THREE CODES AND NOT ONE,
  //                             where the four `artifact.*` actions got one: this list's grain is
  //                             the ARGUMENT, and these three do not share one — the delivery end
  //                             puts only the posture verb behind the operator's launch toggle
  //                             (`launch-directives.js › KINDS_NEEDING_LAUNCH_CONSENT`). The map is
  //                             the LANE's (`session-own-manage.js › MANAGE_ALLOW_REASONS`),
  //                             injected. None is an outbound code: nothing left as CONTENT.
  'auto-outbound-escalate', //   2026-08-31 (Samuel's ruling): the same outbound half on an
  //                             own-channel `send(kind="decision")` — an agent asking a HUMAN a
  //                             structured question, a different audit answer than a milestone.
  'auto-outbound-artifact', //   2026-09-06: the same outbound half on an own-channel `artifact`
  //                             fold (create / add / remove / dissolve) — the only one of the four
  //                             that changed how the room READS rather than what it says. ONE CODE
  //                             FOR FOUR ACTIONS, deliberately: they share a single admission
  //                             argument, and WHICH action ran is already on the same diag line
  //                             (`session-gate-bridge.js › channelOpLabel` prints
  //                             `op=artifact.dissolve`).
  'auto-outbound-thread-open', //2026-08-24 (Samuel's ruling): the same outbound half on an
  //                             own-channel `create_thread`. Its own code, for the reason the
  //                             marker has one: "the agent opened an exchange with a member" is not
  //                             the same audit answer as "the agent logged a step".
  'tool-mode', //                AXIS A: the current toolMode covers this tool
  'knowledge-read-op', //        2026-08-22 (OQ-1): an OP-SCOPED `dopl_kb` READ. Axis A does NOT
  //                             cover the tool (it is a write tool) and the CALL is a read;
  //                             `tool-mode` here would claim the operator granted the whole tool.
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
    // M4: an own-channel milestone follows the OUTBOUND half of the axis exactly as a post does,
    // so it stops on the same fact and must say the same thing. `create_thread` joined it on
    // 2026-08-24, and `isOwnChannelOutbound` is the union, so the GATE code is shared even though
    // the ALLOW codes are not.
    if (d.isOwnChannelOutbound(a.input, a.channelId)) return 'message-approval-required';
    // 2026-08-25 (F-320): an own-channel LAUNCH stops on a DIFFERENT fact from either half of the
    // message axis — it needs tools=`bypass` AND messages auto-outbound, and naming only the
    // message setting would send the operator to widen a posture that is already wide enough. A
    // launch naming ANOTHER channel is not this case and falls through, as a post's does.
    if (d.isOwnMachineLaunch(a.input, a.channelId)) return 'launch-posture-required';
    // 2026-09-17: and so does `manage.direct`, which had been falling through since the lane
    // shipped (2026-08-31) — `channel-op-approval-required` was the F-320 sentence one op sideways,
    // an approval with no surface over a fix that is TWO settings. It shares the manage code rather
    // than taking a fourth: the remedy is byte-identical. Asked between the launch and manage arms,
    // mirroring `grantDecision`'s own order; the three predicates are disjoint, so the order buys
    // nothing today and is kept because "mirror the gate" keeps this function honest.
    if (d.isOwnMachineDirect && d.isOwnMachineDirect(a.input, a.channelId)) return 'manage-posture-required';
    // 2026-09-17: the three manage verbs stop on the same fact, which is why this arm exists. They
    // fell through to `channel-op-approval-required`, false here twice over — the fix is TWO
    // postures, and that approval has no surface to be given on. A manage op naming ANOTHER channel
    // falls through, as a launch's does.
    if (d.isOwnMachineManage && d.isOwnMachineManage(a.input, a.channelId)) return 'manage-posture-required';
    // A SLUG lands here too, and that is the single most confusing gate in the product: the agent
    // addressed its own channel by name, `isOwnChannelPost` compares against the ID, and the safe
    // classification is "another channel". The renderer's copy names the fix (use the id). It
    // shares the post code deliberately — the fact and the operator's fix are identical.
    //
    // Asked through the MEMBERSHIP PREDICATE since 2026-09-06, not by indexing the list with a bare
    // `input.op` — the correction the READ arm below took at F-578, one op late. The union stopped
    // being a list of one when `artifact.*` joined it, and a bare `'artifact'` matches none of the
    // four dotted keys, so a slug-addressed fold would have fallen past this arm. The predicate is
    // `session-own-outbound.js`'s, injected like every other.
    if (d.isOwnChannelOutboundCall && d.isOwnChannelOutboundCall(a.input)) return 'cross-channel-post';
    // M3: a READ op that got here named a channel this session is not bound to (or a slug), which
    // is a DIFFERENT fact from "reads are never auto-run". Asked through the gate's own membership
    // predicate, not by indexing the list: since the five-op collapse the entries are
    // `<op>.<action>` keys (F-578), and a bare `indexOf(op)` here would call a cross-channel
    // `rooms.open` a READ — the one classification the gate itself refuses to make.
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
    // "In no list this build knows" is asked of the RUNTIME since 2026-08-31, not of a copied list.
    // `isClassifiedTool` is "allowed at the WIDEST mode this runtime offers" — the same question
    // the old `BYPASS_TOOLS` membership asked, and correct on a runtime that spells its widest mode
    // differently. Handed the SESSION's runtime, or a non-default session would be narrated against
    // another runtime's lists.
    if (!d.isClassifiedTool(name, a.runtime)) return 'unclassified-tool';
    const m = d.normalizeToolMode(a.toolMode, a.runtime);
    return m === 'auto' || m === 'bypass' ? 'not-covered-by-bypass' : 'awaiting-approval';
  };
  return function gateReason(args, decision) {
    const a = args || {};
    const channel = d.isChannelTool(a.toolName);
    // 2026-08-25 (F-320): `deny` has more than one cause — the profile's hard-deny, and the LAUNCH
    // DEPTH BOUND, the only one that can deny a channel op. Asked in an order that MIRRORS
    // `grantDecision`'s, so a hard-denied name can never be narrated as a bound nobody can find.
    if (decision === 'deny') {
      // 2026-08-26: the audience deny is asked AFTER the hard deny. The first draft asked it first,
      // so a hard-denied admin tool that also named another workspace was narrated
      // `container-audience` — both facts true, but the gate refused it at step 1 for a reason that
      // has nothing to do with workspaces. The hard deny uses the gate's own
      // `buildSessionToolConfig`, injected: the explainer must not grow a second copy of the list.
      const cfg = d.buildSessionToolConfig ? d.buildSessionToolConfig(a.profile, a.runtime) : null;
      const hardDenied = !!cfg && cfg.disallowedTools.indexOf(d.canonicalDoplName(a.toolName)) !== -1;
      if (!hardDenied && d.containerOnlyDenies && d.containerOnlyDenies(a, d.isDoplTool)) {
        return 'container-audience';
      }
      // 2026-09-01: `await` is refused inside the channel branch ahead of the launch lane, so it is
      // asked ahead of the depth cap here. The two are disjoint ops, so the order buys nothing today
      // — it is kept because "mirror the gate" keeps this function honest.
      if (channel && !hardDenied && d.isAwaitOp && d.isAwaitOp(a.input)) return 'await-desktop-session';
      return channel && d.isOwnMachineLaunch(a.input, a.channelId) ? 'launch-depth-capped' : 'hard-denied';
    }
    if (decision === 'preapproved') return 'profile-preapproved';
    if (decision === 'allow') {
      if (grantedFor(a)) return 'granted-for-session';
      // The order mirrors `grantDecision` again: Axis A before the op-scoped knowledge branch, so a
      // `dopl_kb` call under `bypass` (where `BYPASS_TOOLS` carries the whole tool) is honestly
      // reported as `tool-mode`, and only a call Axis A MISSED can be a `knowledge-read-op`.
      if (!channel) {
        const name = d.canonicalDoplName(a.toolName);
        if (d.toolModeAllows(a.toolMode, name, a.runtime)) return 'tool-mode';
        return d.isKnowledgeReadCall(name, a.input) ? 'knowledge-read-op' : 'tool-mode';
      }
      // The LAUNCH lane is asked first of the channel allows (2026-08-25, F-320): it is the only one
      // that is not a message, and an audit line claiming otherwise would file a launch under "what
      // did my agent say".
      if (d.isOwnMachineLaunch(a.input, a.channelId)) return 'auto-launch-own-machine';
      // 2026-09-17: the DIRECT lane next, for the same reason — until this line it answered the
      // `auto-outbound` fall-through, which claims the agent sent a message into its own channel. A
      // literal and not an injected map, where the manage lane below needs one: this lane is a
      // single op with a single code. The predicate is still the lane's own, injected.
      if (d.isOwnMachineDirect && d.isOwnMachineDirect(a.input, a.channelId)) return 'auto-direct-own-machine';
      // 2026-09-17: the MANAGE lane with it, for its reason — none of the three is a message. WHICH
      // verb ran is answered by the LANE's own map rather than a branch per action here, so the
      // explainer holds no second opinion; `null` means not an own-channel manage op at all.
      const manageCode = d.manageAllowReason && d.manageAllowReason(a.input, a.channelId);
      if (manageCode) return manageCode;
      // M3: the Axis-B allows are different rules and the diag must be able to tell them
      // apart — "your outbound setting sent this" vs "your inbound setting read this".
      if (d.isOwnChannelRead(a.input, a.channelId)) return 'auto-inbound-read';
      // M4: a marker keeps its OWN code on the allow side, where the gate codes were merged — "the
      // agent proposed a close" is not the same audit answer as "the agent sent a message".
      // `create_thread` rides the same lane with the same treatment (2026-08-24), asked FIRST
      // because the op sets are disjoint and neither may absorb the other's audit line.
      if (d.isOwnChannelThreadOpen(a.input, a.channelId)) return 'auto-outbound-thread-open';
      if (d.isOwnChannelEscalate(a.input, a.channelId)) return 'auto-outbound-escalate';
      if (d.isOwnChannelMarker(a.input, a.channelId)) return 'auto-outbound-marker';
      // 2026-09-06: the FOLD takes the same treatment as the three above — its own code, asked here
      // rather than absorbed by the `auto-outbound` fall-through, which means "the agent sent a
      // message into its own channel" and would make every fold indistinguishable from a post in
      // `listener.log`. Its predicate is disjoint from all three above (they match `op="send"`
      // only), so the order among the four buys nothing.
      if (d.isOwnChannelArtifact && d.isOwnChannelArtifact(a.input, a.channelId)) return 'auto-outbound-artifact';
      return 'auto-outbound';
    }
    if (decision !== 'gate') return null; // an unknown verdict explains nothing, honestly
    return channel ? channelReason(a) : toolReason(a);
  };
}

/**
 * `{ decision, reason }` — the verdict plus a `GATE_REASONS` code, or `null` for a verdict nothing
 * can honestly explain.
 *
 * It moved here from `session-profiles.js` on 2026-08-26 under the hard 500-line cap (§1), on the
 * seam that file already named: MAKING a verdict and EXPLAINING one change on different clocks.
 *
 * It takes `grantDecision` as an ARGUMENT rather than requiring it, which is what keeps the two
 * modules acyclic — `session-profiles.js` requires this file. Same injection idiom `makeGateReason`
 * uses for its predicates, and the same guarantee: the explainer is handed the gate's OWN function,
 * so it can never explain a verdict some second copy of the rules produced.
 */
function makeGrantDetail(grantDecision, predicates) {
  const gateReason = makeGateReason(predicates);
  return function grantDecisionDetail(args) {
    const decision = grantDecision(args);
    return { decision, reason: gateReason(args, decision) };
  };
}

module.exports = { GATE_REASONS, makeGateReason, makeGrantDetail };
