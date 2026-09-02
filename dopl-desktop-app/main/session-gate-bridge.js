// THE GATE BRIDGE — everything that happens between "a tool call arrived" and "the platform gets
// an answer", with NO platform in it.
//
// ⚠ §2 SPLIT OUT OF `main/session-io.js › makeCanUseTool` ON 2026-08-31 (runtime-adapter port,
// step 3). That function did two jobs in one closure: it ASKED the gate, logged the verdict,
// minted the forced thread tag and painted the card — all of which are Dopl's and identical on
// every runtime — and it wrote the answer in one platform's reply vocabulary and parked a
// resolver in that platform's promise. The first half is here; the second is the adapter's
// (`main/runtime/claude/axis-b.js`). `session-io.js` was AT the 500-line cap, so the split is
// also the reclaim that pays for the extraction.
//
// ⚠ NOTHING HERE DECIDES ANYTHING TWICE. `session-profiles.js › grantDecision` is the one
// decision; this module carries it to a card and to a resolver. A second verdict at this seam is
// exactly the two-place gate that F-228 / 1.7.10 bought, and the reason the outbound card and the
// dock card are two PAYLOADS of one decision rather than two decisions.

const { channelOpKey } = require('./channel-op-key'); // <op>.<action> — the classifiers' own key (F-578)
const crypto = require('crypto');
const { grantDecisionDetail, grantKeyFor, isOwnChannelPost, isChannelTool, mcpShortName } = require('./session-profiles');
const outboundTag = require('./session-outbound-tag');
const { isOutboundPost, outboundConsentShape } = outboundTag;
const postSurface = require('./session-post-surface');
const { withPostSurface, postKindOf } = postSurface;
const { denyMessageFor } = require('./session-permissions');
// ⚠ `grantArgs` AND THE TWO INPUT SUMMARIZERS STAY IN `session-io.js`, AND THIS FILE ASKS FOR
// THEM RATHER THAN COPYING THEM. `grantArgs` is the ONE place both axes are read off a live
// session, so the prediction the stream paints and the decision the gate makes can never drift;
// the summarizers decide how much of a tool input may appear on a card, which is a PRIVACY rule
// and not a formatting one. `session-io.js` does not require this module back, so there is no
// cycle. ⚠ Lazy, because `session-io` requires `session-private` -> `session-profiles`, and this
// module is loaded from the adapter side of the seam.
const io = () => require('./session-io');

// ── THE GATE DIAG LINE (2026-08-02) ───────────────────────────────────────────────
// "Bypass still asks" had to be diagnosed from SOURCE: a session logged nothing about why it
// stopped, so "the mode never landed" and "the mode landed but does not cover this tool" looked
// identical in the field. One line per verdict fixes that, deliberately THIN: tool NAME (server
// prefix stripped, capped), M3's channel OP, the verdict, the reason code, both postures, and an
// 8-char session prefix to join on. NEVER the tool input, the drafted body, prompt text or a full
// id — listener.log is plaintext. F-139: the strip is `mcpShortName`, the gate's OWN normalizer.
const DIAG_NAME_CAP = 40; const DIAG_OP_CAP = 24;
function shortToolLabel(name) {
  return mcpShortName(name).slice(0, DIAG_NAME_CAP) || 'unnamed';
}
// M3 (2026-08-05) — THE OP, ON THE LINE. `dopl_channel gate channel-op-approval-required` read
// identically for a read, an invite and a DM open, so the read/post incoherence took code
// archaeology to find. THE OP NAME ONLY (a closed vocabulary from the server's enum), sanitized
// because it arrives from model input; never a body, recipient or channel. Non-channel tools get
// no `op=` segment, so every line this file already produced is byte-unchanged.
//
// ⚠ **AND THE ACTION SINCE 2026-09-02 (F-578), BECAUSE `op=rooms` ALONE IS THE 2026-08-05 DEFECT
// AGAIN.** Under the five-op surface, `rooms` is four reads and four writes and `manage` is five
// verbs, so a line naming the bare op reads identically for a roster read and an invite —
// exactly the archaeology this segment exists to prevent. The label is
// `channel-op-key.js › channelOpKey`'s output, the same key the CLASSIFIERS match on, so the
// audit line and the decision can never name different calls.
function channelOpLabel(toolName, callInput) {
  if (!isChannelTool(toolName)) return '';
  const raw = callInput && callInput.op;
  if (typeof raw !== 'string') return raw == null ? 'none' : 'invalid';
  // ⚠ SANITIZED AFTER the key is built, and the dot is in the kept set: both halves arrive from
  // model input, and `slice` bounds the pair rather than each half.
  const key = channelOpKey(callInput);
  return key.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, DIAG_OP_CAP) || 'invalid';
}
function logGateVerdict(log, s, toolName, verdict, op) {
  if (typeof log !== 'function') return;
  const st = (s && s.state) || {};
  log.apply(null, ['session gate:', shortToolLabel(toolName)].concat(op ? ['op=' + op] : [],
    [verdict.decision, verdict.reason || 'no-reason', 'tool=' + (st.toolMode || 'manual'),
      'msg=' + (st.messageMode || 'ask'), 'session=' + String(s && s.sessionId ? s.sessionId : '').slice(0, 8)]));
}

// The card an awaited decision paints. ⚠ TWO PAYLOADS, ONE DECISION: an own-channel post (and,
// since 2026-08-24, an own-channel `create_thread`) answers on its OWN inline stream card so the
// dock stays free for the next non-post request; everything else takes the dock. The POLICY path
// is identical either way — same `permission_request` reducer event, same pendingPermissions
// tracking, same scoped grant name, same fail-closed mapping.
function gatePayload(s, name, input, opts, requestId, verdict) {
  const payload = outboundConsentShape(name, input, s.channelId)
    ? withPostSurface({
      type: 'outbound_gate',
      requestId,
      toolUseId: opts && opts.toolUseID,
      ownChannel: true, ...(s.direct === true ? { directChannel: true } : {}), // H2: in a DM the server addresses this post, so the card names who gets it
      // ⚠ `threadOpen` → `entryFor` mints the pending card a create_thread lacks an `outbound_post` to carry, else a gated windowless one hangs to its 24h TTL (F-321).
      ...(isOutboundPost(name, input, s.channelId) ? {} : { threadOpen: true }),
      text: input && input.body != null ? String(input.body) : '',
    }, input, s.counterpartyName, s.counterpartyId)
    : {
      type: 'permission_request',
      requestId,
      toolUseId: opts && opts.toolUseID,
      name,
      // FIX #9: WHERE an op=post is headed. The dock rendered the body with no target,
      // so a cross-channel post (the exfil shape D2 exists to catch) looked exactly
      // like a normal reply, and the 140-char inputSummary usually truncated the
      // channel field away. A boolean, never the other channel's id (§H-9).
      ownChannel: isOwnChannelPost(input, s.channelId),
      inputSummary: io().summarizeInput(input),
      inputFull: io().safeInput(input),
      title: opts && opts.title,
      // MEDIUM-2 belt for the DOCK path (a CROSS-channel post): name a forged
      // lifecycle kind here too. `to` is deliberately left off — this card's
      // destination line already reads "another channel", the louder warning.
      postKind: postKindOf(input),
    };
  if (payload.postKind == null) delete payload.postKind; // absent stays absent
  // 2026-08-02 — WHY THIS CARD IS ON SCREEN, on BOTH gate surfaces. Without it every
  // uncovered tool reads as a broken bypass toggle and every slug-addressed post reads as
  // a random refusal. A CODE, never words: the renderer owns the copy, and a code it does
  // not know renders no line rather than a guess. Absent stays absent, like postKind.
  if (verdict.reason) payload.gateReason = verdict.reason;
  return payload;
}

/**
 * ONE tool call, carried from the gate to an answer — with no platform vocabulary in the result.
 *
 * Returns either
 *   `{ settled: true, verdict: 'allow'|'deny', tag, message }` — answerable immediately, or
 *   `{ settled: false, park(resolve), tag }`   — a card is on screen and the caller must hand
 *                                                 `park` the platform's own resolver.
 *
 * ⚠ THE FORCED THREAD TAG IS COMPUTED HERE AND READ ONLY ON AN ALLOW. It rides a verdict, it
 * never makes one, and both axes resolved above without seeing it. ⚠ MINTED ONLY FOR A REAL
 * OWN-CHANNEL POST (2026-08-21): minting on every tool call would spend ids the session never
 * posts under and blunt the bounded lookback that makes the fan-out self-filter cheap.
 */
function gateCall(s, name, input, opts, dispatch, log) {
  // v2.9: BOTH axes resolve inside grantDecision — no post-decision override here any more.
  // The old item-10 `gate && autoApprove -> allow` line is gone: a second decision point that
  // knew nothing about which axis a call belonged to is exactly how one switch came to
  // authorize both Bash and outbound messages. 2026-08-02: the verdict comes back WITH the
  // reason code that explains it, for the card and for the diag line.
  const verdict = grantDecisionDetail(io().grantArgs(s, name, input));
  const decision = verdict.decision;
  logGateVerdict(log, s, name, verdict, channelOpLabel(name, input));
  const outbound = isOutboundPost(name, input, s.channelId);
  const tag = outbound ? outboundTag.threadTagFor(input, s.taskId, outboundTag.nextOwnPostId(s)) : null;
  if (tag && tag.action === 'conflict' && typeof log === 'function') {
    log('session: outbound post names thread', String(tag.supplied).slice(0, 24),
      'but this session drives', String(tag.wanted).slice(0, 24), '— leaving the call as written');
  }
  if (decision === 'preapproved' || decision === 'allow') {
    // ⚠ THE STALENESS CLOCK IS STAMPED HERE, ON THE VERDICT, NOT UP THERE WITH THE ID
    // (2026-09-02). The tag is minted BEFORE the verdict because it has to ride one it cannot
    // make; stamping `lastOwnPostAt` there meant every DENIED post reset T51's clock, so a
    // session wedged against a tool it is refused looked freshly talkative once per denial.
    if (outbound) outboundTag.markOwnPost(s);
    return { settled: true, verdict: 'allow', tag };
  }
  // F-320: a deny has two causes now, and the LAUNCH BOUND is not "blocked by the profile"
  if (decision === 'deny') return { settled: true, verdict: 'deny', tag: null, message: denyMessageFor(verdict.reason) };

  const requestId = (opts && opts.requestId) || crypto.randomUUID();
  // v2.5 D2: the GRANT KEY (not always the bare tool name) is what an "Allow for
  // this task" click records, so a post grant stays scoped to own-channel posts.
  // The renderer still sees the real tool name in the payload.
  const grantName = grantKeyFor(name, input, s.channelId);
  const payload = gatePayload(s, name, input, opts, requestId, verdict);
  return {
    settled: false,
    tag,
    park: function park(resolve) {
      // The tag rides the OPERATOR's allow here; a deny (park included) carries nothing.
      // ⚠ AND ON THE OPERATOR'S OWN ALLOW TOO — a parked post a human says yes to IS speech;
      // their deny is not, and `wrapAllow` fires the hook on neither but the first.
      s.pendingPermissions.set(
        requestId,
        outboundTag.wrapAllow(resolve, tag, outbound ? function () { outboundTag.markOwnPost(s); } : null),
      );
      s.pendingNames.set(requestId, grantName);
      dispatch(s, { type: 'permission_request', requestId, name: grantName, payload });
    },
  };
}

module.exports = { gateCall, logGateVerdict, channelOpLabel, shortToolLabel };
