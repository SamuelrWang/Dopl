// Channels listener — channel message posting (task-lifecycle events + replies).
//
// SPLIT NOTE (Round B): extracted from trigger.js so the consent→spawn→reply
// pipeline and the async consent resolvers can share ONE set of POST helpers
// without trigger.js drifting over the 500-line cap. These two functions are the
// only writers to `/api/channels/[id]/messages` from the listener side; both are
// idempotent (deterministic clientMsgId → the server dedupes on a crash/retry),
// so a re-run can never double-post. Tokens are never logged; a message body is
// never logged verbatim.
//
// Both take a synthesized `entry` ({ channel:{id,name}, workspaceId }) and `m`
// ({ seq }) so they work identically whether called from the live trigger path
// (real entry/m in hand) or from the async consent-watcher resolvers (entry/m
// rebuilt from a persisted pending-request record).

const { Notification } = require('electron');
const io = require('./listener-io');
const consent = require('./consent');
const { diag } = require('./diag');

// ── Task lifecycle events (Feature 4) ────────────────────────────────────────
// task_started/task_finished/task_failed are just channel_messages with
// kind=task_* and author_kind=agent, grouped by a per-spawn metadata.taskId. They
// render in the web activity-event-row. Best-effort, single attempt (non-critical
// telemetry); the deterministic clientMsgId lets the server dedupe on a crash
// replay. A generic body only — never the reply text or any error detail.
//
// `extra` rides into metadata for the web to read (e.g. { declined: true } marks
// a DENY so the web renders a calm "Declined" instead of an error — Round B
// decision echo). `bodyText` overrides the generic body when the three kinds
// don't describe the outcome well on their own. Local-only fields (mode /
// toolProfile) stay in diag(), never in the shared metadata.
//
// `opts` (optional) carries the two wire fields the per-(kind,channel,seq) default
// cannot express: `clientMsgId` for a caller whose idempotency unit is NOT the
// message (queued-notice.js keys on the THREAD, so a peer's resend under a new seq
// dedupes against the first notice instead of posting a second copy), and `summary`
// — a TOP-LEVEL schema field, not a metadata key, which the server persists into
// metadata itself and the receiver's notification reads.
//
// Returns true only on a confirmed post, so a caller that reports its own outcome
// can say "posted" or "post failed" honestly. Still best-effort: it never throws.
async function postTaskEvent(entry, m, kind, taskId, extra, bodyText, opts) {
  const bodies = {
    task_started: 'Started working on this request.',
    task_finished: 'Finished this request.',
    task_failed: 'Could not complete this request.',
  };
  const metadata = { taskId, ...(extra || {}) };
  const body = {
    body: bodyText || bodies[kind] || '',
    kind,
    authorKind: 'agent',
    metadata,
    clientMsgId: (opts && opts.clientMsgId) || `${kind}-${entry.channel.id}-${m.seq}`,
    ...(opts && opts.summary ? { summary: opts.summary } : {}),
  };
  try {
    const res = await io.apiFetch(`/api/channels/${entry.channel.id}/messages`, {
      method: 'POST',
      workspaceId: entry.workspaceId,
      body,
      timeoutMs: 15000,
    });
    diag('task event', kind, res.ok ? 'ok' : `failed ${res.status}`, entry.channel.id.slice(0, 8));
    return res.ok === true;
  } catch (err) {
    diag('task event', kind, 'error', err && err.message);
    return false;
  }
}

// M5a: bounded retry with backoff. `clientMsgId` is deterministic per (channel,
// seq) so the server dedupes — retries can never double-post. Returns true on a
// confirmed post. M-7: the body is clamped to the server's 16000-char cap, since
// a longer one 400s on the first attempt and, being a 4xx, is never retried.
//
// `metadata` (optional) rides through to `channel_messages.metadata` (jsonb).
// The agent's ACTUAL reply carries `{ taskId }` so the web thread can group it
// into the same session card as its task_started/finished events; incidental
// posts (e.g. the busy "please resend" notice) pass no metadata and render as
// plain agent bubbles, outside any session. Reserved keys (to_user_id/summary)
// are stripped server-side, so taskId is the only key we set here.
async function postResult(entry, m, text, metadata) {
  return postWithRetry(entry, {
    body: consent.clampBody(text),
    authorKind: 'agent',
    clientMsgId: `agent-${entry.channel.id}-${m.seq}`,
    ...(metadata ? { metadata } : {}),
  });
}

// D2 — THE AGENT'S OWN VOICE. A message this machine posts on behalf of one of the
// operator's `channel_agents` rows: the summon greeting today (session-greeting.js), and
// anything else the desktop itself has to say AS a named agent.
//
// `authorAgentId` is a TOP-LEVEL wire field, never a metadata key: the server strips
// `metadata.author_agent_id` unconditionally and re-stamps it only from the validated
// top-level value (service-writes-metadata.resolvePostMetadata), and the validation is
// ownership — posting as an agent the caller does not own is a 403
// (service-writes-agents.resolveAgentAddressing). This machine owns the row it summons,
// and the fetch carries that operator's own cookies, so the claim is true by construction.
//
// `toUserId` is normally ABSENT: an unaddressed agent post is what keeps the loop brake
// armed (targeting.classify). It is passed only where the server would otherwise address
// the message for us — see session-greeting.directAddressee.
//
// The caller owns the `clientMsgId`, because the idempotency unit here is neither the
// message nor the thread: for a greeting it is (channel, agent, row stamp).
async function postAgentMessage(entry, a) {
  return postWithRetry(entry, {
    body: consent.clampBody(a && a.text),
    authorKind: 'agent',
    authorAgentId: a && a.agentId,
    clientMsgId: a && a.clientMsgId,
    ...(a && a.toUserId ? { toUserId: a.toUserId } : {}),
    ...(a && a.metadata ? { metadata: a.metadata } : {}),
  });
}

// M5a: bounded retry with backoff, shared by both agent-authored writers. The caller's
// `clientMsgId` is what makes it safe — the server dedupes, so a retry can never
// double-post. Returns true only on a confirmed post; never throws.
async function postWithRetry(entry, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await io.apiFetch(`/api/channels/${entry.channel.id}/messages`, {
        method: 'POST',
        workspaceId: entry.workspaceId,
        body,
        timeoutMs: 20000,
      });
      if (res.ok) return true;
      // 4xx (other than rate-limit) won't improve on retry — stop early.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.warn('[listener] post result failed (no retry):', res.status);
        return false;
      }
      console.warn('[listener] post result failed:', res.status, 'attempt', attempt);
    } catch (err) {
      console.error('[listener] post result error attempt', attempt, err && err.message);
    }
    if (attempt < 3) await io.sleep(500 * 2 ** (attempt - 1)); // 500ms, then 1s
  }
  return false;
}

// Local-only notice. Used for failures the operator must know about but that
// must never be posted into the shared channel.
function notifyLocal(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch (_) { /* best-effort */ }
}

module.exports = { postTaskEvent, postResult, postAgentMessage, notifyLocal };
