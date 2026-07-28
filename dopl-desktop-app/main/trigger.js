// Channels listener — trigger handling (async consent → spawn → reply, Round B).
//
// The channel long-poll loop calls handleTrigger and it RETURNS immediately: it
// creates the inbound consent row, registers a durable pending-request record with
// consent-watcher.js, fires a native notification, and gets out of the way. The
// loop keeps polling messages. consent-watcher.js polls the row off-loop and, when
// the operator answers (notification Allow, or the web Pending Requests list),
// dispatches back into the `resolvers` below to spawn / review / post / echo. This
// is the decoupling that replaced the old up-to-30-minute blocking dialog.
//
// DECISION ECHO (requester sees it live):
//   ALLOW → the spawn's onStart posts `task_started` ("Started working…") — the
//           accepted/working signal, emitted the instant the spawn slot is claimed.
//   DENY  → we post `task_failed` with metadata { declined: true }, body
//           "Request declined" — the web renders this as a calm "Declined", not an
//           error (a real failure posts task_failed WITHOUT the declined flag).
//
// TERMINAL DECISIONS: every resolver ends by calling watcher.settle(key, outcome),
// which persists the terminal outcome and drops the record so the request is never
// re-spawned or re-prompted on a restart / later poll (the replay-bug fix).
//
// PRESERVED INVARIANTS: fail-closed classify (upstream), error suppression (an
// errored spawn posts NO reply and opens NO outbound review), single-resolve +
// (operator,channel,kind,seq) de-dupe (watcher), tool-profile containment, the
// v1.3.1 agent-authored-addressed trigger, seed-vs-missed, deterministic taskId /
// clientMsgId. No import cycle: this file → consent-watcher.js; the watcher never
// imports back (resolvers are injected via start()).

const { Notification } = require('electron');
const io = require('./listener-io');
const targeting = require('./targeting');
const consent = require('./consent');
const watcher = require('./consent-watcher');
const spawner = require('./session-spawner');
const channelDirs = require('./channel-dirs');
const { profileLabel, profileHint } = require('./tool-profiles');
const claudeAuth = require('./claude-auth');
const { postTaskEvent, postResult, notifyLocal } = require('./channel-post');
const { diag } = require('./diag');

const RESEND =
  "I'm still finishing a previous request in this channel — please resend in a moment.";

// Rebuild the minimal `entry` / `m` the post + spawn helpers need from a persisted
// record, so those helpers work identically on the live path and the watcher path.
function entryFromRecord(rec) {
  return {
    channel: { id: rec.channelId, name: rec.channelName },
    workspaceId: rec.workspaceId,
    workspaceSegment: rec.workspaceSegment,
  };
}
function msgFromRecord(rec, body) {
  return { seq: rec.seq, id: rec.messageId, body: body || '' };
}
function taskIdFor(rec) {
  // Deterministic per (channel, seq) — a replay reuses the SAME id so task_started
  // and its end group together instead of splitting across a fresh random id.
  return rec.taskId || `task-${rec.channelId}-${rec.seq}`;
}

// ── FYI (Feature C) — silent notify for a foreign non-trigger message ─────────
// myNotifyScope comes from the Channel DTO; absent → 'all'. Never spawns/prompts.
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

// ── Trigger entry point (non-blocking) ───────────────────────────────────────
// Create the inbound consent row, register it, notify, and return. Everything
// after the operator answers happens in the resolvers, driven by the watcher.
async function handleTrigger(entry, m) {
  // H1: gate on CLI resolution. If claude can't be found, don't prompt and don't
  // post — the one-time "CLI not found" notice already fired at startup.
  if (!(await spawner.claudeAvailable())) {
    diag('trigger skipped: claude CLI unresolved');
    return;
  }

  const key = watcher.requestKey(entry.channel.id, m.seq);
  // Idempotency: never open a second request for a settled or already-pending one.
  if (watcher.isSettled(key)) { diag('trigger skip: settled', key); return; }
  if (watcher.has(key)) { diag('trigger skip: already pending', key); return; }

  const requesterName = io.displayNameFor(m.authorUserId);
  const summary = targeting.metaStr(m, 'summary');
  const bodyPreview = targeting.truncate(m.body, 2000);
  // Snapshot the tool profile at request time — the async approval may land much
  // later; the request was made under this profile's containment.
  const toolProfile = targeting.resolveToolProfile(entry.channel);
  // v1.7: a first-class (UUID) task id on the inbound message threads the whole
  // reply + lifecycle under the requester's task card (taskIdFor prefers it). A
  // legacy/absent id -> '' -> undefined here -> deterministic legacy id, unchanged.
  const inboundTaskId = targeting.firstClassTaskId(m);
  diag('consent create:', entry.channel.id.slice(0, 8), 'seq', m.seq);

  const created = await consent.createConsentRequest(entry.workspaceId, {
    channelId: entry.channel.id,
    kind: 'inbound',
    messageSeq: m.seq,
    summary,
    bodyPreview,
  });
  // Fail closed: no row means no consent surface at all — do NOT spawn. (Unlike
  // v1.1 there is no dialog fallback; the web list is the durable home now.)
  if (!created) {
    diag('consent: no row — fail closed, not spawning');
    return;
  }

  watcher.register({
    key,
    channelId: entry.channel.id,
    workspaceId: entry.workspaceId,
    workspaceSegment: entry.workspaceSegment,
    channelName: entry.channel.name,
    seq: m.seq,
    messageId: m.id,
    requesterName,
    summary,
    toolProfile,
    taskId: inboundTaskId || undefined,
    kind: 'inbound',
    rowId: created.rowId,
  });

  // A row the server already decided (standing trust → auto_allowed) needs no
  // notification; the poke below makes the watcher resolve it at once. A pending
  // row gets the Allow/Dismiss notification — Dismiss PARKS (stays pending).
  if (!created.status || created.status === 'pending') {
    consent.notifyInbound({
      channelName: entry.channel.name,
      requesterName,
      summary,
      bodyPreview,
      // Blast radius surfaced before approval: where this spawn will run (the
      // operator's live per-channel folder, abbreviated, or the sandbox default)
      // and the tool profile it is bounded by. The path is local-only — never sent
      // to the server — so this line exists only on the native notification.
      runsIn: channelDirs.liveChannelDirLabel(entry.channel.id),
      toolLabel: profileLabel(toolProfile),
      // Per-profile capability hint: the REAL headless reach (safe read scope for
      // read_only/dopl_only; "limited headless, use Run-in-Terminal" for full).
      capabilityHint: profileHint(toolProfile),
      onAllow: () => {
        consent.patchDecision(entry.workspaceId, created.rowId, 'allow');
        watcher.poke(key);
      },
      onOpen: () => targeting.openChannelForEntry(entry),
    });
  }
  watcher.poke(key);
}

// ── Message refetch (for spawning off a persisted record) ────────────────────
// The untrusted message body is NOT persisted; we refetch it when the request is
// approved. { m } found · { gone } deleted/unretrievable · { retry } transient.
async function refetchMessage(rec) {
  const since = Math.max(0, (rec.seq || 1) - 1);
  let res;
  try {
    res = await io.apiFetch(
      `/api/channels/${rec.channelId}/messages?since=${since}&limit=1`,
      { workspaceId: rec.workspaceId, timeoutMs: 15000 }
    );
  } catch (err) {
    diag('refetch error', err && err.message);
    return { retry: true };
  }
  if (!res.ok) return { retry: true };
  let data;
  try { data = await res.json(); } catch (_) { return { retry: true }; }
  const msgs = io.normalizeList(data, 'messages');
  const m =
    msgs.find((x) => (x.seq || 0) === rec.seq) ||
    msgs.find((x) => x.id === rec.messageId);
  return m ? { m } : { gone: true };
}

// ── Resolver: inbound ALLOWED → spawn ────────────────────────────────────────
async function inboundApproved(rec) {
  const fetched = await refetchMessage(rec);
  if (fetched.retry) return; // transient — stays await-inbound, retried next poll
  if (fetched.gone) { watcher.settle(rec.key, 'gone'); return; }
  const m = fetched.m;
  const entry = entryFromRecord(rec);
  // Persist the transient spawn phase BEFORE spawning: a crash mid-spawn leaves a
  // 'spawning' record that the watcher drops on restart (never re-spawn).
  watcher.setPhase(rec.key, 'spawning');
  const taskId = taskIdFor(rec);
  const startedAt = Date.now();

  if (spawner.getRunInTerminal()) {
    await runTerminalApproved(entry, m, rec, { taskId, requesterName: rec.requesterName });
    return;
  }
  await runHeadlessApproved(entry, m, rec, { taskId, startedAt, requesterName: rec.requesterName });
}

// Terminal mode: the operator WATCHES (the terminal IS the review) and the agent
// posts/prints its own reply. task_started is the accepted echo; no outbound gate.
async function runTerminalApproved(entry, m, rec, { taskId, requesterName }) {
  diag('spawn mode: terminal', 'profile', rec.toolProfile);
  const r = await spawner.runInTerminalForChannel({
    channelId: entry.channel.id,
    message: m.body,
    context: { channelName: entry.channel.name, authorName: requesterName, authorKind: m.authorKind },
    toolProfile: rec.toolProfile,
  });
  if (r.skipped === 'busy') {
    diag('terminal spawn: skipped=busy');
    await postResult(entry, m, RESEND);
    watcher.settle(rec.key, 'busy');
    return;
  }
  if (r.skipped) {
    diag('terminal spawn: skipped=' + r.skipped, r.error ? `(${r.error})` : '');
    await postTaskEvent(entry, m, 'task_failed', taskId);
    notifyLocal(
      `Dopl: could not start a terminal session in "${entry.channel.name}"`,
      'The request was approved but no session launched. Open Dopl to check the Claude CLI setup.'
    );
    watcher.settle(rec.key, 'error');
    return;
  }
  diag('terminal spawn: launched');
  await postTaskEvent(entry, m, 'task_started', taskId);
  watcher.settle(rec.key, 'sent'); // detached interactive session — terminal review
}

// Headless mode: spawn, then (on a clean reply) open an outbound review. D4:
// task_started fires from onStart, which runs only once the `active` slot is
// claimed for a real spawn, so a busy/no-cli skip can never orphan a task_started.
async function runHeadlessApproved(entry, m, rec, { taskId, startedAt, requesterName }) {
  diag('spawn mode: headless', 'profile', rec.toolProfile);
  const result = await spawner.runForChannel({
    channelId: entry.channel.id,
    message: m.body,
    context: { channelName: entry.channel.name, authorName: requesterName, authorKind: m.authorKind },
    toolProfile: rec.toolProfile,
    onStart: () => postTaskEvent(entry, m, 'task_started', taskId),
  });

  if (result.skipped === 'busy') {
    await postResult(entry, m, RESEND);
    watcher.settle(rec.key, 'busy');
    return;
  }
  if (result.skipped) {
    watcher.settle(rec.key, 'no-cli'); // e.g. 'no-cli' — stay silent (H1)
    return;
  }
  diag('spawn result:', `text ${String(result.text || '').length} chars${result.isError ? ' (error)' : ''}`);

  // Error suppression: an errored run (expired CLI login, timeout, crash) must NOT
  // reply into the shared channel and opens NO outbound review — that would leak
  // local machine state. Close the lifecycle with a generic task_failed (no
  // declined flag → a real failure) and surface it locally only.
  if (result.isError) {
    await postTaskEvent(entry, m, 'task_failed', taskId, { durationMs: Date.now() - startedAt });
    const authText = result.errorDetail || result.text || '';
    if (claudeAuth.isAuthShapedError(authText)) {
      diag('spawn auth-shaped error -> sign-in flow');
      claudeAuth.startSignInFlow({
        getClaudeBin: () => spawner.getClaudeBinPath(),
        channelName: entry.channel.name,
      });
    } else {
      diag('error reply suppressed (local notify only)');
      notifyLocal(
        `Dopl: channel request failed in "${entry.channel.name}"`,
        targeting.truncate(result.text || 'The agent could not complete this request.', 160)
      );
    }
    watcher.settle(rec.key, 'error');
    return;
  }

  await openOutboundReview(entry, m, rec, { taskId, startedAt, text: result.text });
}

// Clean reply → create the outbound review row and move the request to its
// await-outbound phase. The drafted reply is carried on the record so a restart
// can still post it on Send. No blocking — Send/Cancel arrive via the notification
// or the web list and the watcher drives the post.
async function openOutboundReview(entry, m, rec, { taskId, startedAt, text }) {
  if (!text) {
    await postTaskEvent(entry, m, 'task_finished', taskId, { durationMs: Date.now() - startedAt });
    watcher.settle(rec.key, 'no-reply');
    return;
  }
  const reply = consent.clampBody(text); // clamp ONCE: review == posted, byte-for-byte
  const created = await consent.createConsentRequest(rec.workspaceId, {
    channelId: entry.channel.id,
    kind: 'outbound',
    messageSeq: rec.seq,
    summary: `Reply from your agent in "${entry.channel.name}"`,
    bodyPreview: targeting.truncate(reply, 2000),
    proposedReply: reply,
  });
  if (!created) {
    // Fail closed: no review row → do not post; tell the operator locally.
    await postTaskEvent(entry, m, 'task_failed', taskId, { durationMs: Date.now() - startedAt });
    notifyLocal(
      `Dopl: couldn't queue a reply for review in "${entry.channel.name}"`,
      'Your agent drafted a reply but the review could not be created. Open Dopl and try again.'
    );
    watcher.settle(rec.key, 'error');
    return;
  }
  watcher.toOutbound(rec.key, { rowId: created.rowId, taskId, startedAt, proposedReply: reply });
  if (!created.status || created.status === 'pending') {
    consent.notifyOutbound({
      channelName: entry.channel.name,
      proposedReply: reply,
      onSend: () => {
        consent.patchDecision(rec.workspaceId, created.rowId, 'allow');
        watcher.poke(rec.key);
      },
      onOpen: () => targeting.openChannelForEntry(entry),
    });
  }
  watcher.poke(rec.key); // resolve a born-decided outbound row at once
}

// ── Resolver: outbound SENT → post the reply ─────────────────────────────────
async function outboundApproved(rec) {
  const entry = entryFromRecord(rec);
  const m = msgFromRecord(rec, '');
  const reply = consent.clampBody(rec.proposedReply || '');
  const posted = await postResult(entry, m, reply, { taskId: rec.taskId });
  diag('post reply:', posted ? 'ok' : 'FAILED');
  if (posted) {
    await postTaskEvent(entry, m, 'task_finished', rec.taskId, { durationMs: Date.now() - rec.startedAt });
    notifyReplied(entry, reply);
    watcher.settle(rec.key, 'sent');
  } else {
    // An approved reply that never landed: say so, never claim the request finished.
    await postTaskEvent(entry, m, 'task_failed', rec.taskId, { durationMs: Date.now() - rec.startedAt });
    notifyLocal(
      `Dopl: reply not delivered in "${entry.channel.name}"`,
      'You approved the reply but it could not be posted. Open Dopl and try again.'
    );
    watcher.settle(rec.key, 'post-failed');
  }
}

// ── Resolver: outbound CANCELLED (web Cancel / expiry) → drop, no re-spawn ────
async function outboundCancelled(rec) {
  const entry = entryFromRecord(rec);
  const m = msgFromRecord(rec, '');
  diag('outbound review: reply dropped (cancelled/expired)');
  // M-4: a cancelled reply is NOT a finished request; do not tell teammates an
  // answer was delivered. task_failed WITHOUT declined → this is a drop, not a deny.
  await postTaskEvent(
    entry, m, 'task_failed', rec.taskId,
    { durationMs: Date.now() - rec.startedAt, dropped: true },
    'Reply was not sent.'
  );
  watcher.settle(rec.key, 'cancelled');
}

// ── Resolver: inbound DENIED → declined echo ─────────────────────────────────
async function inboundDenied(rec) {
  const entry = entryFromRecord(rec);
  const m = msgFromRecord(rec, '');
  // Decision echo: the web renders task_failed + { declined: true } as a calm
  // "Declined", distinct from an error (which carries no declined flag).
  await postTaskEvent(entry, m, 'task_failed', taskIdFor(rec), { declined: true }, 'Request declined');
  watcher.settle(rec.key, 'denied');
}

// ── Resolver: inbound EXPIRED → silent drop ──────────────────────────────────
async function inboundExpired(rec) {
  diag('inbound expired (no decision) — dropping', rec.key);
  watcher.settle(rec.key, 'expired');
}

// ── Resolver: interrupted spawn → terminal echo (FIX 2) ──────────────────────
// The app died mid-spawn AFTER task_started was posted; on the next launch the
// watcher settles that 'spawning' record 'interrupted' and calls this so the
// requester's session card stops pulsing "active". We post the SAME deterministic
// taskId as task_started so they group, with metadata { interrupted: true } — the
// web renders that as a calm "Interrupted" (a bare task_failed = a real error).
// Error-suppression semantics, like deny: no reply text, generic body only. The
// record is already settled by the watcher, so there is nothing to settle here.
async function onInterrupted(rec) {
  const entry = entryFromRecord(rec);
  const m = msgFromRecord(rec, '');
  await postTaskEvent(entry, m, 'task_failed', taskIdFor(rec), { interrupted: true }, 'Request interrupted');
}

function notifyReplied(entry, reply) {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: `Dopl: replied in "${entry.channel.name}"`,
        body: targeting.truncate(reply, 120),
        silent: true,
      }).show();
    }
  } catch (_) { /* best-effort */ }
}

// Injected into consent-watcher.start() by channel-listener.js. The watcher stays
// decoupled from the channel-post path — it only ever calls these injected fns.
const resolvers = {
  inboundApproved,
  inboundDenied,
  inboundExpired,
  outboundApproved,
  outboundCancelled,
  onInterrupted, // FIX 2: dispatched from resume() for a mid-spawn interrupt
};

module.exports = { handleTrigger, sendFyi, resolvers };
