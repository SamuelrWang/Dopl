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
const outcomes = require('./trigger-outcomes'); // §2 split: the no-reply terminal echoes
const channelPrefs = require('./channel-prefs'); // H2: the single-use permission arm
const spawner = require('./session-spawner');
const sessionEngine = require('./session-engine');
const settings = require('./settings');
const channelDirs = require('./channel-dirs');
const { profileLabel, profileHint } = require('./tool-profiles');
const claudeAuth = require('./claude-auth');
const { postTaskEvent, postResult, notifyLocal } = require('./channel-post');
const { diag } = require('./diag');

const RESEND =
  "I'm still finishing a previous request in this channel — please resend in a moment.";

// H1 (LOW): the HONEST version of the above for the one case where "still finishing" is false.
// A session HELD on the sign-in action occupies the registry slot while running nothing, so the
// old copy told the peer to resend into a slot that will not free itself — the operator has to
// sign in on that Mac first, and nothing was saying so. No local detail leaks: it names the
// state, not the machine, the account, or the error.
const AUTH_HELD_REPLY =
  "I can't run this right now — my Claude Code sign-in on this machine needs attention. I'll pick it up once that's sorted.";

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
  // Deterministic per (channel, seq) — a replay reuses the SAME id so task_started and its end
  // group together instead of splitting across a fresh random id. THE one source of a record's
  // thread id, so every outbound tag reads it and not rec.taskId (unset for a legacy inbound).
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
  // Snapshot the tool profile at request time — the async approval may land much later; the
  // request was made under this profile's containment.
  const toolProfile = targeting.resolveToolProfile(entry.channel);
  // v1.7: a first-class (UUID) task id on the inbound message threads the whole reply +
  // lifecycle under the requester's task card (taskIdFor prefers it). A legacy/absent id
  // -> '' -> undefined here -> deterministic legacy id, unchanged.
  const inboundTaskId = targeting.firstClassTaskId(m);
  // Item 8: the (channel,task) key the eventual session will run under, so the pre-consent
  // window registers where launchResponderSession later ADOPTS it. Mirrors taskIdFor.
  const futureTaskId = inboundTaskId || `task-${entry.channel.id}-${m.seq}`;
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
    // Item 8: open the pre-consent window IMMEDIATELY (shows the request + Accept/Deny;
    // runs NO agent work until Accept, when launchResponderSession ADOPTS it). The
    // native notification + web panel remain valid secondary surfaces — all three route
    // through the SAME consent row (first-answer-wins). Window-mode OFF -> no window,
    // today's headless + approve-out path is preserved byte-for-byte.
    if (settings.getWindowMode()) {
      sessionEngine.openConsentWindow({
        channelId: entry.channel.id,
        taskId: futureTaskId,
        workspaceId: entry.workspaceId,
        rowId: created.rowId,
        watcherKey: key,
        requesterName,
        summary,
        bodyPreview,
        taskTitle: targeting.metaStr(m, 'taskTitle') || null,
        toolProfileLabel: profileLabel(toolProfile),
        cwdLabel: channelDirs.liveChannelDirLabel(entry.channel.id),
        channelName: entry.channel.name,
      });
    }
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

// ── Resolver: inbound ALLOWED → session (default) or headless (fallback) ──────
// H2: `meta.humanAllowed` says whether a PERSON just clicked Allow (server status
// `allowed`) or whether the server's standing trust decided it with no card in front of
// anyone (`auto_allowed`). This is THE seam where a stored permission arm may be
// consumed, and only the human branch may consume it — see below.
async function inboundApproved(rec, meta) {
  const fetched = await refetchMessage(rec);
  if (fetched.retry) return; // transient — stays await-inbound, retried next poll
  if (fetched.gone) { watcher.settle(rec.key, 'gone'); return; }
  const m = fetched.m;
  const entry = entryFromRecord(rec);
  // Persist the transient spawn phase BEFORE any side effect: a crash here leaves a
  // 'spawning' record the watcher drops on restart (never re-spawn / re-launch).
  watcher.setPhase(rec.key, 'spawning');
  const taskId = taskIdFor(rec);
  const startedAt = Date.now();

  // H2 — CONSUME the channel's single-use permission arm, here and nowhere else.
  // `consumePermissionPreset` returns the pair AND deletes it, so this exact approval
  // is the only launch it can ever apply to; a peer reply days later finds nothing and
  // the spawn inherits manual/ask. Standing trust (auto_allowed) consumes NOTHING and
  // is not even offered the arm: the whole point of the arm is that a human chose that
  // posture for a request they were looking at, which is not what standing trust is.
  //
  // Consumed BEFORE the launch shape is decided, deliberately: whether we end up in a
  // session window or the headless fallback, the arm is spent either way, so a launch
  // that skips to headless cannot leave a widened posture behind for the next one.
  const startModes = meta && meta.humanAllowed === true
    ? channelPrefs.consumePermissionPreset(entry.channel.id)
    : null;
  if (startModes) diag('inbound approved with an operator-chosen posture:', startModes.tools, '/', startModes.messages);

  // v1.9 DEFAULT EXECUTOR: a native session window (visible turns, live Allow/Deny
  // buttons, steering, cost) REPLACES headless + approve-out for session runs
  // (§G Q1). Window-mode OFF — or an engine skip (window cap / no SDK / disabled) —
  // falls back to today's headless + approve-out path, byte-for-byte.
  if (settings.getWindowMode() && (await launchResponderSession(entry, m, rec, { taskId, startModes }))) {
    return; // a live session (or a busy→resend) now owns this request
  }
  await runHeadlessApproved(entry, m, rec, { taskId, startedAt, requesterName: rec.requesterName });
}

// Responder SESSION launch (§A.2): hand the framed inbound to the engine, which
// opens a window and drives the loop. The agent posts its OWN reply + task_progress
// milestones via the pre-approved dopl_channel tool (approve-out is gone for session
// runs), and the channel listener feeds the peer's later replies into the SAME live
// session as turns — no per-hop consent modal. task_started is echoed by the
// engine's onLaunched (index.js), NOT here. Returns true when the request is handled
// (a session launched, or a busy channel got the resend notice); false when the
// caller should fall back to headless (window cap / no SDK / disabled).
async function launchResponderSession(entry, m, rec, { taskId, startModes }) {
  // Loop-continuation knob: mirror the requester task's mode when the inbound
  // carries one (server-stamped), else autonomous — either way the session runs
  // under the turn / idle / cost caps, so it cannot self-sustain unbounded.
  const mode = targeting.metaStr(m, 'taskMode') || 'autonomous';
  const res = await sessionEngine.launchResponderSession({
    channelId: entry.channel.id,
    taskId: rec.taskId || taskId,
    workspaceId: entry.workspaceId,
    message: m.body,
    // FIX L1: the responder's counterparty is the requester who addressed me — the
    // inbound message's author. The listener only feeds this member's later replies.
    counterpartyId: m.authorUserId,
    // H2: the server's own 1:1 flag off the channel DTO. In a DM the server addresses
    // this session's unaddressed posts, so its outbound approval card names the peer.
    direct: entry.channel.isDirect === true,
    // D1: taskTitle rides the responder context too (the SAME server-stamped meta the
    // consent payload above already reads), so the session header names the TASK
    // instead of falling back to the channel or a bare "Session".
    // v2.x: the CONCRETE ids ride the context too, because prompt-framing's delivery section
    // reads only the context — a spawn told just the channel's display name could not fill
    // dopl_channel's `channel=` and hunted with op "list". 2026-07-31: taskId rides for the same
    // reason, LEGACY ids included, or the reply reaches the peer as a brand-new request.
    context: {
      channelName: entry.channel.name, authorName: rec.requesterName,
      authorKind: m.authorKind, taskTitle: targeting.metaStr(m, 'taskTitle') || null,
      channelId: entry.channel.id, workspaceId: entry.workspaceId, taskId: rec.taskId || taskId,
    },
    toolProfile: rec.toolProfile,
    mode,
    // H2: the posture the operator picked on the card they just approved, or absent.
    // startSession applies it ONLY when it is handed in like this; every other spawn
    // shape passes nothing and starts at the reducer's own manual/ask.
    startModes: startModes || undefined,
  });
  if (res && res.sessionId) {
    diag('responder session launched', String(res.sessionId).slice(0, 8), 'profile', rec.toolProfile);
    // Hand lifecycle ownership to the engine: the watcher must never re-spawn OR
    // re-echo for this request — the engine owns interrupted echoes + resume. This
    // is the consent-watcher 'session' settle phase.
    watcher.toSession(rec.key, { sessionId: res.sessionId });
    return true;
  }
  if (res && res.skipped === 'auth-hold') {
    // H1: a held session owns this slot and is running nothing. Headless would fail on the
    // same missing credential, so answer honestly and settle rather than falling through.
    diag('responder session: skipped=auth-hold — the slot is held on the sign-in action');
    await postResult(entry, m, AUTH_HELD_REPLY);
    watcher.settle(rec.key, 'auth-hold');
    return true; // handled — do NOT also run headless
  }
  if (res && res.skipped === 'busy') {
    diag('responder session: skipped=busy');
    await postResult(entry, m, RESEND);
    watcher.settle(rec.key, 'busy');
    return true; // handled — do NOT also run headless
  }
  // cap / no-sdk / disabled → today's headless fallback answers the request.
  diag('responder session skipped:', (res && res.skipped) || 'unknown', '— headless fallback');
  if (res && res.skipped === 'cap') {
    notifyLocal(
      'Dopl: session window limit reached',
      `Answering "${entry.channel.name}" headlessly instead.`
    );
  }
  return false;
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
  const posted = await postResult(entry, m, reply, { taskId: taskIdFor(rec) });
  diag('post reply:', posted ? 'ok' : 'FAILED');
  if (posted) {
    await postTaskEvent(entry, m, 'task_finished', taskIdFor(rec), { durationMs: Date.now() - rec.startedAt });
    outcomes.notifyReplied(entry, reply);
    watcher.settle(rec.key, 'sent');
  } else {
    // An approved reply that never landed: say so, never claim the request finished.
    await postTaskEvent(entry, m, 'task_failed', taskIdFor(rec), { durationMs: Date.now() - rec.startedAt });
    notifyLocal(
      `Dopl: reply not delivered in "${entry.channel.name}"`,
      'You approved the reply but it could not be posted. Open Dopl and try again.'
    );
    watcher.settle(rec.key, 'post-failed');
  }
}

// The terminal echoes for a request that produced NO reply (deny / expiry / cancel /
// interrupt) live in trigger-outcomes.js (§2 split). They share the three record→shape
// helpers above, which are injected rather than re-derived.
outcomes.bind({ entryFromRecord, msgFromRecord, taskIdFor });

// Injected into consent-watcher.start() by channel-listener.js. The watcher stays
// decoupled from the channel-post path — it only ever calls these injected fns.
const resolvers = {
  inboundApproved,
  inboundDenied: outcomes.inboundDenied,
  inboundExpired: outcomes.inboundExpired,
  outboundApproved,
  outboundCancelled: outcomes.outboundCancelled,
  onInterrupted: outcomes.onInterrupted, // FIX 2: dispatched from resume() for a mid-spawn interrupt
};

module.exports = { handleTrigger, sendFyi, resolvers };
