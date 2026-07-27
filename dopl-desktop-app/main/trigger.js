// Channels listener — trigger handling (consent → spawn → task events → reply).
//
// SPLIT NOTE (§2 refactor): extracted from channel-listener.js. Owns the FYI
// notification, the task-lifecycle events, the result post, and the full
// consent→spawn→reply pipeline (handleTrigger + its sub-steps), plus the
// crash-recovery replay and the orphan-outbound sweep. Imports the I/O layer,
// the targeting helpers, and the consent/spawner/claude-auth modules; it never
// imports channel-listener.js (channel-listener imports this), so there is no
// import cycle.

const { Notification } = require('electron');
const io = require('./listener-io');
const targeting = require('./targeting');
const consent = require('./consent');
const spawner = require('./session-spawner');
const claudeAuth = require('./claude-auth');
const { diag } = require('./diag');

const replayed = new Set(); // channels whose crash-pending record was replayed
const outboundSwept = new Set(); // channels whose orphan outbound rows were cleared (M-6)

// ── Task lifecycle events (Feature 4) ────────────────────────────────────────
// task_started/task_finished/task_failed are just channel_messages with
// kind=task_* and author_kind=agent, grouped by a per-spawn metadata.taskId. They
// render in the web activity-event-row. Best-effort, single attempt (non-critical
// telemetry); the deterministic clientMsgId lets the server dedupe on a crash
// replay. A generic body only — never the reply text or any error detail.
//
// L: metadata here is SHARED with every channel member. `mode` (headless vs
// terminal) and `toolProfile` used to ride along, which told teammates how the
// operator has their own machine configured — local config, not channel content.
// Those stay in diag() only. `bodyText` overrides the generic body for outcomes
// the three kinds don't describe well on their own.
async function postTaskEvent(entry, m, kind, taskId, extra, bodyText) {
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
    clientMsgId: `${kind}-${entry.channel.id}-${m.seq}`,
  };
  try {
    const res = await io.apiFetch(`/api/channels/${entry.channel.id}/messages`, {
      method: 'POST',
      workspaceId: entry.workspaceId,
      body,
      timeoutMs: 15000,
    });
    diag('task event', kind, res.ok ? 'ok' : `failed ${res.status}`, entry.channel.id.slice(0, 8));
  } catch (err) {
    diag('task event', kind, 'error', err && err.message);
  }
}

// Silent FYI notification (Feature C). Fires for a foreign message that is NOT a
// trigger for me (non-addressed, or addressed to someone else) in a multi-member
// channel — but only when my notify scope is 'all'. Never spawns, never prompts.
// myNotifyScope comes from the Channel DTO (the parallel track adds it); absent →
// degrade to 'all'.
function sendFyi(entry, m) {
  const scope = (entry.channel && entry.channel.myNotifyScope) || 'all';
  if (scope !== 'all') {
    diag('fyi muted', entry.channel.id.slice(0, 8), 'seq', m.seq, 'scope', scope);
    return;
  }
  const requester = io.displayNameFor(m.authorUserId);
  const toUserId = targeting.metaStr(m, 'to_user_id');
  const targetName = toUserId ? io.displayNameFor(toUserId) : null;
  const detail = targeting.metaStr(m, 'summary') || targeting.truncate(m.body, 120);
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: entry.channel.name,
        body: `${requester}'s agent asked ${targetName || 'the channel'}: ${detail}`,
        silent: true,
      });
      n.on('click', () => targeting.openChannelForEntry(entry));
      n.show();
    }
  } catch (_) { /* best-effort */ }
  diag('fyi sent', entry.channel.id.slice(0, 8), 'seq', m.seq, 'target', targetName ? 'named' : 'channel');
}

// Local-only notice. Used for failures the operator must know about but that
// must never be posted into the shared channel.
function notifyLocal(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch (_) { /* best-effort */ }
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
  const body = {
    body: consent.clampBody(text),
    authorKind: 'agent',
    clientMsgId: `agent-${entry.channel.id}-${m.seq}`,
    ...(metadata ? { metadata } : {}),
  };
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

// ── Approve-out (Feature 2): the reply does NOT auto-post ────────────────────
// A server row (web review) is raced against the native Send/Cancel dialog +
// notification. On approve → post via postResult; on deny/expire → drop. Every
// path closes the task lifecycle with exactly one task_finished / task_failed.
async function reviewAndPostReply(entry, m, { taskId, startedAt, text }) {
  if (!text) {
    // Nothing to send — still close the lifecycle.
    await postTaskEvent(entry, m, 'task_finished', taskId, { durationMs: Date.now() - startedAt });
    return;
  }
  // M-7: clamp ONCE here so the text the operator reviews is byte-for-byte the
  // text that gets posted.
  const reply = consent.clampBody(text);
  const send = await consent.decideOutbound({
    entry,
    m,
    proposedReply: reply,
    workspaceId: entry.workspaceId,
    onOpenChannel: () => targeting.openChannelForEntry(entry),
  });
  if (!send) {
    // M-4: a cancelled reply is NOT a finished request. Posting "Finished this
    // request." told teammates an answer had been delivered when the operator had
    // just refused to send one.
    diag('outbound review: reply dropped (cancelled/expired)');
    await postTaskEvent(
      entry,
      m,
      'task_failed',
      taskId,
      { durationMs: Date.now() - startedAt, dropped: true },
      'Reply was not sent.'
    );
    return;
  }
  const posted = await postResult(entry, m, reply, { taskId });
  diag('post reply:', posted ? 'ok' : 'FAILED');
  if (posted) {
    await postTaskEvent(entry, m, 'task_finished', taskId, { durationMs: Date.now() - startedAt });
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: `Dopl: replied in "${entry.channel.name}"`,
          body: targeting.truncate(reply, 120),
          silent: true,
        }).show();
      }
    } catch (_) { /* best-effort */ }
  } else {
    // M-7: an approved reply that never landed used to leave only a diag line, so
    // the operator believed they had answered. Say so, on both surfaces, and
    // never claim the request finished.
    await postTaskEvent(entry, m, 'task_failed', taskId, { durationMs: Date.now() - startedAt });
    notifyLocal(
      `Dopl: reply not delivered in "${entry.channel.name}"`,
      'You approved the reply but it could not be posted. Open Dopl and try again.'
    );
  }
}

// ── Terminal spawn (Feature 3): visible interactive session ──────────────────
// The operator WATCHES (the terminal is the approve-out review) and the agent
// posts its own reply (full profile) or prints it (restricted). No stdout capture
// / no outbound gate here. M-3: task_started goes out only AFTER a confirmed
// launch, and a detached terminal has no reliable finish signal, so a successful
// launch emits start only.
async function runTerminalSpawn(entry, m, { toolProfile, taskId, requesterName }) {
  diag('spawn mode: terminal', 'profile', toolProfile);
  const r = await spawner.runInTerminalForChannel({
    channelId: entry.channel.id,
    message: m.body,
    context: { channelName: entry.channel.name, authorName: requesterName },
    toolProfile,
  });
  io.clearPending(entry.channel.id);
  if (r.skipped === 'busy') {
    diag('terminal spawn: skipped=busy');
    await postResult(
      entry,
      m,
      "I'm still finishing a previous request in this channel — please resend in a moment."
    );
    return;
  }
  if (r.skipped) {
    diag('terminal spawn: skipped=' + r.skipped, r.error ? `(${r.error})` : '');
    await postTaskEvent(entry, m, 'task_failed', taskId);
    notifyLocal(
      `Dopl: could not start a terminal session in "${entry.channel.name}"`,
      'The request was approved but no session launched. Open Dopl to check the Claude CLI setup.'
    );
    return;
  }
  diag('terminal spawn: launched');
  await postTaskEvent(entry, m, 'task_started', taskId);
}

// ── Headless spawn (default) — spawn, then review + post ──────────────────────
// D4: task_started is emitted from runForChannel's onStart, which fires only once
// the `active` slot is claimed for a real spawn — so a busy-skip or a no-cli
// return can never leave a task_started with no matching end. Every path that
// actually spawns emits exactly one start + one end.
async function runHeadlessSpawn(entry, m, { toolProfile, taskId, startedAt, requesterName }) {
  diag('spawn mode: headless', 'profile', toolProfile);
  const result = await spawner.runForChannel({
    channelId: entry.channel.id,
    message: m.body,
    context: { channelName: entry.channel.name, authorName: requesterName },
    toolProfile,
    onStart: () => postTaskEvent(entry, m, 'task_started', taskId),
  });

  // L3: a busy skip (another session already running for this channel) is not a
  // silent drop — tell the channel to resend rather than losing the request.
  if (result.skipped === 'busy') {
    await postResult(
      entry,
      m,
      "I'm still finishing a previous request in this channel — please resend in a moment."
    );
    io.clearPending(entry.channel.id);
    return;
  }
  if (result.skipped) {
    // e.g. 'no-cli' — stay silent (H1: no error replies into the channel).
    io.clearPending(entry.channel.id);
    return;
  }
  diag('spawn result:', `text ${String(result.text || '').length} chars${result.isError ? ' (error)' : ''}`);

  // An errored run (expired CLI login, timeout, crash) must NOT reply into the
  // shared channel — that leaks local machine state to teammates and spams the
  // thread. There is NO outbound review for an errored spawn. We still close the
  // task lifecycle with a generic task_failed (Feature 4 — an activity marker, not
  // a reply, carrying no error detail) and surface the failure locally.
  if (result.isError) {
    io.clearPending(entry.channel.id);
    await postTaskEvent(entry, m, 'task_failed', taskId, { durationMs: Date.now() - startedAt });
    // Feature D: an auth-shaped failure (expired CLI login) gets the in-app
    // "Sign in to Claude" flow instead of the generic failure notice. The
    // untruncated errorDetail (local-only, never posted) is matched first.
    const authText = result.errorDetail || result.text || '';
    if (claudeAuth.isAuthShapedError(authText)) {
      diag('spawn auth-shaped error -> sign-in flow');
      claudeAuth.startSignInFlow({
        getClaudeBin: () => spawner.getClaudeBinPath(),
        channelName: entry.channel.name,
      });
      return; // do NOT post a reply, do NOT generic-notify
    }
    diag('error reply suppressed (local notify only)');
    notifyLocal(
      `Dopl: channel request failed in "${entry.channel.name}"`,
      targeting.truncate(result.text || 'The agent could not complete this request.', 160)
    );
    return;
  }

  await reviewAndPostReply(entry, m, { taskId, startedAt, text: result.text });
  io.clearPending(entry.channel.id);
}

async function handleTrigger(entry, m) {
  // H1: gate on CLI resolution. If claude can't be found, don't prompt and don't
  // post — the one-time "CLI not found" notice already fired at startup.
  if (!(await spawner.claudeAvailable())) {
    diag('trigger skipped: claude CLI unresolved');
    return;
  }

  // M5b: persist the pending request BEFORE consent so a crash between consent
  // and post can be recovered on next launch.
  io.setPending(entry.channel.id, {
    seq: m.seq,
    messageId: m.id,
    workspaceId: entry.workspaceId,
  });

  // ── Approve-in (Feature 1): decoupled consent. A server row is created first;
  // if the SERVER already decided it (standing trust, or the operator answered on
  // the web first) we honor that with no dialog, otherwise the web surface is
  // raced against the native dialog + notification and the first answer wins. If
  // the endpoints 404, this degrades to dialog-only local consent (v1.1
  // behavior). H-3: there is no desktop-side trust evaluation any more.
  const requesterName = io.displayNameFor(m.authorUserId);
  const summary = targeting.metaStr(m, 'summary');
  diag('consent prompt:', entry.channel.id.slice(0, 8), 'seq', m.seq);
  const approved = await consent.decideInbound({
    entry,
    m,
    requesterName,
    summary,
    workspaceId: entry.workspaceId,
    onOpenChannel: () => targeting.openChannelForEntry(entry),
  });
  diag('consent result:', approved ? 'ALLOWED' : 'denied');
  if (!approved) {
    io.clearPending(entry.channel.id); // Deny = no replay
    return; // cursor already advanced — we won't re-prompt for this message
  }

  const toolProfile = targeting.resolveToolProfile(entry.channel);
  // D3: deterministic per (channelId, seq), matching the clientMsgId determinism.
  // A crash replay reuses the SAME taskId, so task_started and task_finished group
  // together instead of splitting across a fresh random id.
  const taskId = `task-${entry.channel.id}-${m.seq}`;
  const startedAt = Date.now();

  if (spawner.getRunInTerminal()) {
    await runTerminalSpawn(entry, m, { toolProfile, taskId, requesterName });
    return;
  }
  await runHeadlessSpawn(entry, m, { toolProfile, taskId, startedAt, requesterName });
}

// M-6: on first watch of a channel, clear any outbound review row this machine
// orphaned by crashing between "row created" and "reply posted". Those rows sit
// 'pending' forever with a live Send button on web that can never do anything —
// the drafted reply died with the process. Runs before replay so a recovered
// request cannot stack a second card on top of a dead one. Once per channel per
// app run; failures are non-fatal (worst case the stale card survives one more
// launch).
async function sweepStaleOutbound(entry) {
  const id = entry.channel.id;
  if (outboundSwept.has(id)) return;
  outboundSwept.add(id);
  try {
    // Spare the row belonging to the message replayPendingFor is about to
    // re-run: outbound creates de-dupe server-side at ANY status, so denying it
    // now would make the replayed spawn's own reply come back pre-denied.
    const pending = io.getPending()[id];
    await consent.cancelStaleOutbound(entry.workspaceId, id, pending && pending.seq);
  } catch (err) {
    diag('outbound sweep error', err && err.message);
  }
}

// M5b recovery: on first watch of a channel, if a pending-consent record survived
// a crash, fetch that exact message and re-prompt for it. Runs at most once per
// channel per app run.
async function replayPendingFor(entry) {
  const id = entry.channel.id;
  if (replayed.has(id)) return;
  const pending = io.getPending()[id];
  if (!pending) return;
  replayed.add(id);
  try {
    const since = Math.max(0, (pending.seq || 1) - 1);
    const res = await io.apiFetch(
      `/api/channels/${id}/messages?since=${since}&limit=1`,
      { workspaceId: entry.workspaceId, timeoutMs: 15000 }
    );
    if (!res.ok) return; // leave the record; try again next launch
    const data = await res.json();
    const msgs = io.normalizeList(data, 'messages');
    const m =
      msgs.find((x) => (x.seq || 0) === pending.seq) ||
      msgs.find((x) => x.id === pending.messageId);
    if (m) {
      await handleTrigger(entry, m);
    } else {
      io.clearPending(id); // message no longer retrievable — drop the stale record
    }
  } catch (err) {
    console.error('[listener] replay pending error:', err && err.message);
  }
}

module.exports = {
  handleTrigger,
  sendFyi,
  sweepStaleOutbound,
  replayPendingFor,
};
