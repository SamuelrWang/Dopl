// THE GATE BRIDGE — everything that happens between "a tool call arrived" and "the platform gets
// an answer", with NO platform in it.
//
// §2 SPLIT out of `main/session-io.js › makeCanUseTool` (2026-08-31, runtime-adapter port step 3).
// Asking the gate, logging the verdict, minting the forced thread tag and painting the card are
// Dopl's and identical on every runtime, and live here; writing the answer in one platform's reply
// vocabulary and parking its resolver is the adapter's (`main/runtime/claude/axis-b.js`).
//
// NOTHING HERE DECIDES ANYTHING TWICE. `session-profiles.js › grantDecision` is the one decision;
// this module carries it to a card and to a resolver. A second verdict at this seam is the
// two-place gate F-228 / 1.7.10 bought, and the reason the outbound card and the dock card are two
// PAYLOADS of one decision rather than two decisions.

const { channelOpKey } = require('./channel-op-key'); // <op>.<action> — the classifiers' own key (F-578)
const crypto = require('crypto');
const { grantDecisionDetail, grantKeyFor, isOwnChannelPost, isChannelTool, mcpShortName } = require('./session-profiles');
const outboundTag = require('./session-outbound-tag');
const { isOutboundPost, outboundConsentShape } = outboundTag;
const postSurface = require('./session-post-surface');
const { withPostSurface, postKindOf } = postSurface;
const { denyMessageFor } = require('./session-permissions');
// What a held call IS, recorded beside the opaque id the reducer keeps (2026-09-17). A LEDGER,
// not a decision: nothing below may consult it to decide anything.
const heldGates = require('./session-held-gates');
// `grantArgs` and the two input summarizers stay in `session-io.js` and are asked for rather than
// copied: `grantArgs` is the ONE place both axes are read off a live session, so the prediction
// the stream paints and the decision the gate makes cannot drift, and the summarizers decide how
// much of a tool input may appear on a card, which is a PRIVACY rule. Lazy, because `session-io`
// requires `session-private` -> `session-profiles` and this module loads from the adapter side of
// the seam; `session-io.js` does not require back, so there is no cycle.
const io = () => require('./session-io');

// ── THE GATE DIAG LINE (2026-08-02) ───────────────────────────────────────────────
// One line per verdict, so "the mode never landed" and "the mode landed but does not cover this
// tool" stop looking identical in the field. Deliberately THIN: tool NAME (server prefix stripped
// by `mcpShortName`, the gate's own normalizer — F-139 — and capped), M3's channel OP, the
// verdict, the reason code, both postures, and an 8-char session prefix to join on. NEVER the tool
// input, the drafted body, prompt text or a full id — listener.log is plaintext.
const DIAG_NAME_CAP = 40; const DIAG_OP_CAP = 24;
function shortToolLabel(name) {
  return mcpShortName(name).slice(0, DIAG_NAME_CAP) || 'unnamed';
}
// M3 (2026-08-05) — THE OP, ON THE LINE, because `dopl_channel gate channel-op-approval-required`
// read identically for a read, an invite and a DM open. The OP NAME ONLY (a closed vocabulary from
// the server's enum), sanitized because it arrives from model input; never a body, recipient or
// channel. Non-channel tools get no `op=` segment, so lines this file already produced are
// byte-unchanged.
//
// And the ACTION since 2026-09-02 (F-578), because under the five-op surface `rooms` is four reads
// and four writes and `manage` is five verbs, so a bare op is the 2026-08-05 defect again. The
// label is `channelOpKey`'s output, the same key the CLASSIFIERS match on, so the audit line and
// the decision can never name different calls.
function channelOpLabel(toolName, callInput) {
  if (!isChannelTool(toolName)) return '';
  const raw = callInput && callInput.op;
  if (typeof raw !== 'string') return raw == null ? 'none' : 'invalid';
  // Sanitized AFTER the key is built, and the dot is in the kept set: both halves arrive from
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

// The card an awaited decision paints. TWO PAYLOADS, ONE DECISION: an own-channel post (and, since
// 2026-08-24, an own-channel `create_thread`) answers on its OWN inline stream card so the dock
// stays free for the next non-post request; everything else takes the dock. The POLICY path is
// identical either way — same reducer event, same tracking, same scoped grant name, same
// fail-closed mapping.
function gatePayload(s, name, input, opts, requestId, verdict) {
  const payload = outboundConsentShape(name, input, s.channelId)
    ? withPostSurface({
      type: 'outbound_gate',
      requestId,
      toolUseId: opts && opts.toolUseID,
      ownChannel: true, ...(s.direct === true ? { directChannel: true } : {}), // H2: in a DM the server addresses this post, so the card names who gets it
      // `threadOpen` is DELETED because the case it discriminated is gone (2026-09-02, B8). The
      // collapse made a thread open `send(thread="new")` and an escalation `send(kind="decision")`,
      // so both are `isOutboundPost` now and take the ordinary `outbound_post` frame — F-321's card
      // is minted by the ordinary path and the flag had no reachable arm left.
      text: input && input.body != null ? String(input.body) : '',
    }, input, s.counterpartyName, s.counterpartyId)
    : {
      type: 'permission_request',
      requestId,
      toolUseId: opts && opts.toolUseID,
      name,
      // FIX #9: WHERE an op=post is headed. The dock rendered the body with no target, so a
      // cross-channel post (the exfil shape D2 exists to catch) looked exactly like a normal reply.
      // A boolean, never the other channel's id (§H-9).
      ownChannel: isOwnChannelPost(input, s.channelId),
      inputSummary: io().summarizeInput(input),
      inputFull: io().safeInput(input),
      title: opts && opts.title,
      // MEDIUM-2 belt for the DOCK path (a CROSS-channel post): name a forged lifecycle kind here
      // too. `to` is deliberately left off — this card's destination line already reads "another
      // channel", the louder warning.
      postKind: postKindOf(input),
    };
  if (payload.postKind == null) delete payload.postKind; // absent stays absent
  // 2026-08-02 — WHY this card is on screen, on BOTH gate surfaces: without it every uncovered
  // tool reads as a broken bypass toggle. A CODE, never words — the renderer owns the copy, and a
  // code it does not know renders no line rather than a guess. Absent stays absent, like postKind.
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
 * The forced thread tag is computed here and read only on an ALLOW: it rides a verdict, it never
 * makes one, and both axes resolved above without seeing it. Minted only for a real own-channel
 * post (2026-08-21) — minting on every tool call would spend ids the session never posts under and
 * blunt the bounded lookback that makes the fan-out self-filter cheap.
 */
function gateCall(s, name, input, opts, dispatch, log) {
  // v2.9: BOTH axes resolve inside grantDecision — no post-decision override here any more. A
  // second decision point that knew nothing about which axis a call belonged to is how one switch
  // came to authorize both Bash and outbound messages. The verdict comes back WITH the reason code
  // that explains it (2026-08-02), for the card and for the diag line.
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
    // The staleness clock is stamped HERE, on the VERDICT, not up there with the id (2026-09-02).
    // The tag is minted before the verdict because it has to ride one it cannot make; stamping
    // `lastOwnPostAt` there let every DENIED post reset T51's clock.
    if (outbound) outboundTag.markOwnPost(s);
    return { settled: true, verdict: 'allow', tag };
  }
  // F-320: a deny has two causes now, and the LAUNCH BOUND is not "blocked by the profile"
  if (decision === 'deny') return { settled: true, verdict: 'deny', tag: null, message: denyMessageFor(verdict.reason) };

  const requestId = (opts && opts.requestId) || crypto.randomUUID();
  // v2.5 D2: the GRANT KEY (not always the bare tool name) is what an "Allow for this task" click
  // records, so a post grant stays scoped to own-channel posts. The renderer still sees the real
  // tool name in the payload.
  const grantName = grantKeyFor(name, input, s.channelId);
  const payload = gatePayload(s, name, input, opts, requestId, verdict);
  return {
    settled: false,
    tag,
    park: function park(resolve) {
      // The tag rides the OPERATOR's allow, and only that: a parked post a human says yes to IS
      // speech, their deny is not, and `wrapAllow` fires the hook on neither but the first.
      s.pendingPermissions.set(
        requestId,
        outboundTag.wrapAllow(resolve, tag, outbound ? function () { outboundTag.markOwnPost(s); } : null),
      );
      s.pendingNames.set(requestId, grantName);
      // What the operator is being asked, beside the opaque id (2026-09-17). ONLY the DOCK shape:
      // an `outbound_gate` already has a surface — the held post's own card in the thread's send
      // box — and a second set of buttons is two answers to one question. The label and op key are
      // the SAME ones `logGateVerdict` prints, so card and audit line cannot name different calls.
      if (payload.type === 'permission_request') {
        heldGates.note(s, {
          requestId: requestId,
          tool: shortToolLabel(name),
          op: channelOpLabel(name, input),
          summary: payload.inputSummary,
          reason: verdict.reason,
        });
      }
      dispatch(s, { type: 'permission_request', requestId, name: grantName, payload });
    },
  };
}

module.exports = { gateCall, logGateVerdict, channelOpLabel, shortToolLabel };
