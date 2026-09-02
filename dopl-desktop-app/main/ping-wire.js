// THE "NEEDS YOU" SIGNAL'S WIRE — narrowing a raw realtime row into a ping.
//
// ⚠ **PURE, AND DELIBERATELY SO.** No electron, no network, and its one `require` is another
// pure module. This file is `agent-direction-wire.js`'s role for the ping mailbox, and it
// exists so the narrowing can be unit-tested without a running app — `pings.js` owns
// everything that acts.
//
// ⚠ **IT RETURNS `null`, IT NEVER THROWS.** The input is a realtime frame — a shape the
// server chose, from a table this app may be older than — so a row it does not recognise is a
// row to IGNORE, not an exception that kills the socket handler for every other mailbox on it.
//
// 🔒 **IT VALIDATES THE CLOSED SETS AND THE CHARSETS, and both matter.** `kind` and
// `recipient_kind` are three-word closed sets in the column CHECK, the zod schema and here —
// three statements of one contract. The agent-id charset is `agent-id.js › AGENT_ID_RE`'s, and
// it is enforced because the value is written into a LOG LINE and into a session lookup: a
// value carrying a newline could forge a second line in `listener.log`, which is the artifact a
// local watcher arms a wake on.

// ⚠ **THE SHARED UUID RULE, NOT A LOCAL COPY.** The two neighbouring wires each declare their
// own because their whole body sits inside a sliced PURE block that may hold no `require`
// (`uuid-rule-parity.test.mjs`'s census says so, per file). This module is not sliced — its
// suite requires it normally — so it takes the shared rule, and a copy here would be a fifth
// spelling to keep in step for no reason.
const { isUuid } = require('./ipc-guards');

const KINDS = ['done', 'question', 'blocked'];
const RECIPIENT_KINDS = ['member', 'agent', 'desktop'];
const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

/** ⚠ Mirrors `MAX_PING_BODY` and the column CHECK. A longer body cannot be stored, so one
 *  arriving here is a row this app does not understand rather than a body to truncate. */
const MAX_BODY = 600;

function str(v) {
  return typeof v === 'string' ? v : '';
}

/**
 * A raw `channel_pings` INSERT row -> the shape `pings.js` acts on, or `null`.
 *
 * ⚠ `workspaceId` COMES FROM THE SUBSCRIPTION, not from the row, and that is the same rule
 * every other mailbox here follows: the socket is joined per workspace, so the workspace is a
 * fact about WHICH SOCKET this arrived on, and reading it out of the payload would let a row
 * claim to belong somewhere the subscription is not.
 */
function pingFrom(raw, workspaceId) {
  if (!raw || typeof raw !== 'object') return null;

  const id = str(raw.id);
  const channelId = str(raw.channel_id);
  const recipientUserId = str(raw.recipient_user_id);
  if (!isUuid(id) || !isUuid(channelId) || !isUuid(recipientUserId)) return null;

  const kind = str(raw.kind);
  const recipientKind = str(raw.recipient_kind);
  if (KINDS.indexOf(kind) === -1) return null;
  if (RECIPIENT_KINDS.indexOf(recipientKind) === -1) return null;

  const recipientAgentId = str(raw.recipient_agent_id);
  // 🔒 THE RECIPIENT SHAPE IS ONE FACT, and it is the constraint the table also carries:
  // 'agent' with no agent is undeliverable, and an agent id under any other kind would name a
  // machine this row is not addressed to.
  if (recipientKind === 'agent') {
    if (!AGENT_ID_RE.test(recipientAgentId)) return null;
  } else if (recipientAgentId !== '') {
    return null;
  }

  const body = str(raw.body);
  if (body === '' || body.length > MAX_BODY) return null;

  const seq = Number(raw.seq);
  if (!Number.isInteger(seq) || seq <= 0) return null;

  const senderAgentId = str(raw.sender_agent_id);

  return {
    id: id,
    seq: seq,
    workspaceId: String(workspaceId || ''),
    channelId: channelId,
    // Wire/storage name `task` == domain name `thread`. Absent is normal.
    taskId: isUuid(str(raw.task_id)) ? str(raw.task_id) : '',
    senderUserId: str(raw.sender_user_id),
    // ⚠ A CAPTION ONLY. Nothing here or in `pings.js` may gate, route or authorize on it —
    // it is derived from a header on the SENDER's side and is worth exactly one printed label.
    senderAgentId: AGENT_ID_RE.test(senderAgentId) ? senderAgentId : '',
    recipientKind: recipientKind,
    recipientUserId: recipientUserId,
    recipientAgentId: recipientKind === 'agent' ? recipientAgentId : '',
    kind: kind,
    body: body,
  };
}

/**
 * THE `listener.log` LINE — the zero-token wake.
 *
 * ⚠ **THIS STRING IS A CONTRACT WITH SOMETHING OUTSIDE THIS REPO.** A local external agent
 * arms a background `tail -F` on it and is woken by the match, so the shape is not free to
 * drift with a refactor. It is pinned in `test/ping-delivery.test.mjs`.
 *
 * ⚠ IDS ARE SLICED TO 8, the house style of the `fan-out` and `msg` lines it sits beside —
 * enough to correlate with a channel, never the whole identifier.
 */
function logLineFor(p) {
  const to = p.recipientKind === 'agent' ? p.recipientAgentId : p.recipientUserId;
  return [
    'ping',
    String(p.channelId).slice(0, 8),
    'seq',
    String(p.seq),
    `to=${String(to).slice(0, 8)}`,
    `kind=${p.kind}`,
  ].join(' ');
}

module.exports = { pingFrom, logLineFor, KINDS, RECIPIENT_KINDS, MAX_BODY };
