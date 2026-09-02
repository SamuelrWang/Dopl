// THE "NEEDS YOU" SIGNAL — this machine's half (2026-09-01, `docs/specs/needs-you-ping.md`).
//
// A ping arrives on the same per-workspace socket the other two mailboxes ride. This module
// does exactly two things with one, and the ORDER matters:
//
//   1. **IT WRITES ONE `listener.log` LINE, for EVERY ping addressed to this operator**,
//      whatever the recipient kind and whether or not anything is live to receive it. That
//      line is the zero-token wake: a local external agent arms a background `tail -F` on it
//      and is woken by the match, which is the whole reason the operator's own assistant can
//      learn that an agent finished without being asked to go and look.
//   2. **IT WAKES ONE LOCAL AGENT SESSION**, and only when the ping names one.
//
// ── WHAT IS DIFFERENT FROM `agent-directions.js`, WHICH THIS OTHERWISE FOLLOWS ────────────
//   1. **THERE IS NOTHING TO CLAIM.** A direction is WORK, so exactly one machine may take it
//      and a CAS decides which. A ping is a NOTIFICATION: every machine signed in as the
//      recipient should see it, and two of them logging the same line is correct rather than a
//      double delivery. So there is no claim route, no decide route and no refusal vocabulary.
//   2. **IT REPORTS NOTHING BACK.** Nothing answers a ping — the MCP result says so — so there
//      is no reply to capture and no row to update.
//   3. **THERE IS NO CONSENT TOGGLE, DELIBERATELY.** The two existing ones gate capabilities an
//      external agent gains over this machine: launching buys COMPUTE, directing opens a
//      running agent's PRIVATE turn. A ping buys neither — it writes a log line, and on the
//      agent form it feeds one line into a session THIS operator started, on a channel they are
//      a member of, exactly as an `@agent-<id>` mention in that room already would. Adding a
//      toggle would gate the notification an operator is asking for by reading the inbox.
//
// 🔒 **THE LOCAL RECIPIENT RE-CHECK IS GATE 1 AND IS NOT OPTIONAL.** The realtime filter is
// `workspace_id=eq.<id>` — workspace-wide, never recipient-scoped — so frames for OTHER
// members' pings reach this handler. A frame arrives under a SUBSCRIPTION, never under a
// per-row auth answer, which is the same reason both neighbouring mailboxes re-check locally.

const mailboxes = require('./realtime-mailboxes');
const wire = require('./ping-wire');
const { diag } = require('./diag');

const MAX_REMEMBERED = 256;

let started = false;
let deps = {};
const seen = new Set();

/** Bounded, insertion-ordered — the oldest id falls out first. `agent-directions.js ›
 *  remember`'s shape, and for its reason: a Set that only grows is a leak on a process that
 *  runs for days. */
function remember(id) {
  if (seen.size >= MAX_REMEMBERED) seen.delete(seen.values().next().value);
  seen.add(id);
}

/**
 * WHAT A WOKEN AGENT ACTUALLY READS.
 *
 * ⚠ **IT NAMES THE SENDER AND THE KIND, and it has to.** The receiving agent is being woken
 * mid-run by text another agent wrote; a bare body would read as its operator speaking. The
 * private-turn framing (`session-seed.js › frameDirectedTurn`) is the direct lane's answer to
 * the same threat — this lane does not open a private turn, so the labelling is what carries
 * the same fact: this is a SIGNAL from a peer, not an instruction from your operator.
 */
function inboundText(p) {
  const from = p.senderAgentId ? `@agent-${p.senderAgentId}` : 'another member';
  return `[ping · ${p.kind}] ${from}: ${p.body}`;
}

/**
 * THE SESSION THIS PING NAMES, or `null`.
 *
 * ⚠ MATCHED ON BOTH `agentId` AND `channelId`. An agent id is unique per machine, but a ping
 * is ABOUT a channel, and feeding it into that agent's session on a DIFFERENT channel would
 * deliver a signal about work the session is not doing. `null` is the honest answer.
 */
function slotFor(p) {
  const list = typeof deps.listLiveSessions === 'function' ? deps.listLiveSessions() : [];
  for (const s of list || []) {
    if (String(s.agentId || '') !== p.recipientAgentId) continue;
    if (String(s.channelId || '') !== p.channelId) continue;
    return s;
  }
  return null;
}

/**
 * WAKE THE NAMED AGENT — **through the EXISTING belt, never a second one.**
 *
 * ⚠ `feedInbound` with `wake: true` and an `addressing` naming this agent is EXACTLY where the
 * `@agent-<id>` fan-out door terminates (`session-dispatch.js`, the per-reader loop). Reusing
 * it means a ping is subject to the same gate every other addressed inbound is — the belt reads
 * the verdict and never re-derives it — and it means there is one wake path on this machine to
 * reason about rather than two that can disagree.
 *
 * ⚠ NO LIVE SESSION IS NOT A FAILURE. The agent finished, was ended, or never ran here. The
 * row still stands in the operator's inbox and the log line is already written, so nothing is
 * lost; the MCP result told the sender exactly this would happen.
 */
function wakeAgent(p) {
  const s = slotFor(p);
  if (!s) {
    diag('ping: no live session for', p.recipientAgentId, 'on', p.channelId.slice(0, 8));
    return false;
  }
  if (typeof deps.feedInbound !== 'function') return false;
  return (
    deps.feedInbound({
      channelId: p.channelId,
      taskId: String(s.taskId || ''),
      agentId: p.recipientAgentId,
      message: inboundText(p),
      seq: p.seq,
      authorName: p.senderAgentId ? `@agent-${p.senderAgentId}` : 'Ping',
      // ⚠ The shape `session-dispatch.js › addressingFor` produces for a directly-addressed
      // agent. Restating it as a literal here would be a second definition of "addressed".
      addressing: { me: true, ids: [p.recipientAgentId] },
      wake: true,
    }) === true
  );
}

/**
 * ONE INBOUND PING.
 *
 * Gate order, and each gate is here for a different failure:
 *   1. narrow — a row this app does not understand is ignored, never thrown on.
 *   2. 🔒 RECIPIENT — the subscription is workspace-wide, so this is what makes the line and
 *      the wake the operator's own. Silent: logging a drop would log other members' traffic.
 *   3. dedupe — a reconnect can replay a frame, and a duplicated log line is a duplicated wake.
 */
function handle(raw, workspaceId) {
  if (!started) return;
  const p = wire.pingFrom(raw, workspaceId);
  if (!p) return;

  const me = (typeof deps.getUserId === 'function' && deps.getUserId()) || null;
  if (!me || p.recipientUserId !== String(me)) return;

  if (seen.has(p.id)) return;
  remember(p.id);

  // ⚠ FIRST, AND UNCONDITIONALLY. The wake below may find nothing; the line is what an
  // external watcher is holding on, so it must not be contingent on a live session existing.
  diag(wire.logLineFor(p));

  if (p.recipientKind !== 'agent') return;
  try {
    wakeAgent(p);
  } catch (err) {
    diag('ping: wake threw —', (err && err.message) || String(err));
  }
}

/**
 * ARM THE MAILBOX.
 *
 * ⚠ **THE BINDING IS UNCONDITIONAL IN `realtime-mailboxes.js`, unlike the other two**, which
 * is what lets this need no `setX`/rejoin pair: `postgres_changes` bindings are fixed at JOIN
 * time, and a mailbox with no consent toggle never has to be flipped after one. Registering
 * the handler here is therefore the whole of the arming.
 */
function start(options) {
  deps = options || {};
  started = true;
  mailboxes.setPingHandler(handle);
  diag('pings: mailbox armed');
}

function stop() {
  started = false;
  seen.clear();
  mailboxes.setPingHandler(null);
}

module.exports = { start, stop, handle, inboundText };
