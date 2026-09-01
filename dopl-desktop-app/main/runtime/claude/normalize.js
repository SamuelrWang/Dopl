// THE NORMALIZER — one raw platform message in, `CoreEvent[]` out. ⚠ THE LOAD-BEARING FUNCTION.
//
// ⚠ IT OWNS ALL THREE RAW-MESSAGE CONSUMERS, and that is the whole point of the seam. Before
// 2026-08-31 the consume loop called three things on every message and each read the platform's
// schema directly:
//   1. the AUTH SENTINEL check, which short-circuited the loop BEFORE anything else saw the
//      message (`session-auth.js › holdIfAuthMessage`, matching `session-auth-detect.js`);
//   2. the RENDER MAPPING (`session-io.js › handleSdkMessage` / `› sdkRenderEvents`);
//   3. the PER-MESSAGE USAGE watcher (`session-model.js › observe`), which sits in the loop on
//      purpose because it needs the LAST ASSISTANT MESSAGE'S OWN usage, not the turn total.
// If the normalizer owned only the middle one, the golden fixtures would cover a third of the
// surface while two platform-shaped parsers stayed in core.
//
// ⚠ PURE. No I/O, no dispatch, no session mutation, no clock. It READS a context and RETURNS
// events; core applies them. That is what makes every later adapter testable from a recorded
// transcript with nothing installed — which is the only honest answer to "no live installs".
//
// ⚠ SO THE STATE THIS USED TO WRITE IS NOW CARRIED ON EVENTS, AND CORE WRITES IT:
//   `s.sdkSessionId`      -> `launched.sessionId`   (core also persists the durable record)
//   `s.lastTotalCost` etc -> `result.costUsd` / `.sessionTokens`, reported CUMULATIVE. The delta
//                            arithmetic stays in core because it is the twin of the resume
//                            baseline reset — one assumption, one place.
//   `s.promptTokens`      -> a `context` event per assistant message; core keeps the last one and
//                            dispatches it when the turn ends. Exactly what `observe` did, on the
//                            side of the seam that is allowed to have state.

const events = require('../events');
const io = require('../../session-io');
const sessionModel = require('../../session-model');

// ── THE AUTH SENTINELS ───────────────────────────────────────────────────────────────────────
//
// ⚠ THE CONSUMER MOVED HERE; THE MATCHERS DELIBERATELY DID NOT (2026-08-31). What the seam needs
// is that ONE function reads the raw stream — that is what makes the fixtures cover the whole
// surface — and that is now true: nothing in core touches a platform message any more. The
// regexes themselves stayed in `main/session-auth-detect.js` beside the operator COPY they
// belong to, because moving them would have created a second copy of a pattern the headless
// path already pins against (`test/session-auth-recovery.test.mjs` drives both), for no gain
// this wave. They move with the rest of the credential lane in the port's step 6, where the
// banner copy, the five vendor-named modules and the IPC channel are renamed together.
const detect = require('../../session-auth-detect');

// The SYNTHETIC message core mints for a REJECTION rather than a stream item. ⚠ The consume loop
// has two ways to learn about an auth failure — a message and a thrown error — and both are
// platform-shaped, so both come through here. Core does not decide which errors mean "no
// credential"; it hands the text over and reads the answer.
const ERROR_MESSAGE_TYPE = 'error';

// ── THE RENDER MAPPING ───────────────────────────────────────────────────────────────────────
//
// Only assistant (text turns + tool_use cards + op=post outbound messages) and user (tool_result
// fills) produce render events. Unknown types -> []. `ctx.channelId` + `ctx.peerName` classify an
// own-channel post as an `outbound_post` addressed to the peer; `ctx.willGatePost` (optional —
// absent reads as "never gates") marks that post PENDING so the renderer paints the decision card.
function renderEvents(msg, ctx) {
  const out = [];
  const blocks = (msg && msg.message && msg.message.content) || [];
  if (msg && msg.type === 'assistant') {
    for (const b of blocks) {
      if (b && b.type === 'text' && b.text) {
        out.push(events.assistant(b.text));
      } else if (b && b.type === 'thinking' && b.thinking) {
        out.push(events.thinking(b.thinking)); // work lane, bounded downstream
      } else if (b && b.type === 'tool_use') {
        if (io.isOutboundPost(b.name, b.input, ctx.channelId)) {
          // The agent wants to SEND a message to the peer. Emit ONE `outbound_post` and SUPPRESS
          // the generic tool card for the same tool_use, so a sent message never double-renders
          // as a tool call. It flows THROUGH the reducer (case 'outbound_post') so it can set
          // postedThisTurn: recorded optimistically here, un-counted on the two paths that
          // retract a post — a failing tool_result (FIX F3) and a park (FIX F6). MEDIUM-2: `to`
          // is the call's REAL addressee when it set one, the bound counterparty otherwise;
          // `postKind` rides along for a lifecycle-kinded post.
          const payload = io.withPostSurface({
            type: 'outbound_post',
            toolUseId: b.id,
            text: b.input && b.input.body != null ? String(b.input.body) : '',
          }, b.input, ctx.peerName, ctx.peerId);
          // v2.7 L3: the SAME item becomes the inline Send / Deny card while it waits,
          // then resolves in place. `ownChannel` feeds the card's destination line (the
          // renderer is fail-suspicious: anything but an explicit true reads as another
          // channel), and it is a boolean — never another channel's id (§H-9).
          if (typeof ctx.willGatePost === 'function' && ctx.willGatePost(b.input, b.name) === true) {
            payload.pending = true;
            payload.ownChannel = true;
          }
          out.push(events.outboundPost(payload));
        } else {
          out.push(events.toolUse({
            type: 'tool_use',
            toolUseId: b.id,
            name: b.name,
            inputSummary: io.summarizeInput(b.input),
            inputFull: io.safeInput(b.input),
          }));
        }
      }
    }
  } else if (msg && msg.type === 'user') {
    for (const b of blocks) {
      if (b && b.type === 'tool_result') {
        out.push(events.toolResult({
          type: 'tool_result',
          toolUseId: b.tool_use_id,
          ok: !b.is_error,
          resultSummary: io.summarizeResult(b.content),
        }));
      }
    }
  }
  return out;
}

/**
 * ONE raw platform message -> the CoreEvents it means.
 *
 * ⚠ THE AUTH SENTINEL IS CHECKED FIRST AND RETURNS ALONE. It short-circuits the consume loop:
 * core stops reading, holds the session and swaps the dead-end bubble for the sign-in action.
 * Emitting render events beside it would paint the very bubble the hold exists to replace.
 */
function normalize(msg, ctx) {
  const context = ctx || {};
  if (!msg || !msg.type) return [];

  if (msg.type === ERROR_MESSAGE_TYPE) {
    const text = String(msg.text == null ? '' : msg.text);
    const authShaped = detect.isAuthShapedError(text) || detect.CLI_LOGIN_SENTINEL.test(text);
    return authShaped ? [events.authHold(text)] : [];
  }

  const authText = detect.authFailureText(msg);
  if (authText) return [events.authHold(authText)];

  if (msg.type === 'system' && msg.subtype === 'init') {
    // The FIRST honest statement of which model is really running (the picker asked; the platform
    // decides). It is also the denominator for the very first turn, and it carries the
    // conversation handle every resume depends on.
    return [events.launched(msg.session_id, msg.model)];
  }

  if (msg.type === 'assistant' || msg.type === 'user') {
    const out = renderEvents(msg, context);
    // ⚠ A SUBAGENT'S MESSAGES STILL RENDER BUT NEVER METER. A delegated run has its own context
    // window, so counting its prompt as the session's makes the meter jump and then snap back.
    if (msg.type === 'assistant' && msg.parent_tool_use_id == null) {
      const m = msg.message || {};
      const tokens = sessionModel.promptTokens(m.usage);
      const model = typeof m.model === 'string' && m.model ? m.model : null; // mid-session switch
      if (tokens > 0 || model) out.push(events.context(tokens, model));
    }
    return out;
  }

  if (msg.type === 'result') {
    // ⚠ REPORTED CUMULATIVE, DELTA'D IN CORE. `total_cost_usd` and `usage` are this QUERY's
    // running totals, so a resumed query restarts them from zero — and summing DELTAS is what
    // makes the figure survive a park+resume where the raw total would collapse it. The
    // arithmetic and the resume baselines are one assumption and live together in core.
    const total = Number(msg.total_cost_usd);
    return [events.result(
      Number.isFinite(total) ? total : null,
      sessionModel.sessionTokens(msg.usage),
      msg.model || (msg.modelUsage && Object.keys(msg.modelUsage)[0]) || null
    )];
  }

  return []; // unknown types ignored
}

module.exports = { normalize, renderEvents, ERROR_MESSAGE_TYPE };
