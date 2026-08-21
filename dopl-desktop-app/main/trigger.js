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
const { postTaskEvent, postResult, postCourtesy, notifyLocal } = require('./channel-post');
const queued = require('./queued-notice'); // the in-thread "queued, not ignored" milestone
// §2 SPLIT (2026-08-04): the HEADLESS FALLBACK lane — spawn, then open an outbound
// review — plus the two peer-facing replies both lanes send. Its own module because
// it is its own reason to change: the session lane below is the default executor and
// this is what answers when window mode is off or the engine skips.
const headless = require('./trigger-headless');
const { runHeadlessApproved } = headless;
const { AUTH_HELD_REPLY, RESEND } = outcomes; // the two courtesy replies (moved off trigger-headless, 2026-08-20)
const { diag } = require('./diag');

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

// ── FYI (Feature C) — THE MENTION ESCALATION ─────────────────────────────────
// Never spawns, never prompts: a silent OS banner and nothing else.
//
// 2026-08-18 (wiring plan Phase 7) — IT NARROWED RATHER THAN DIED. This used to fire for every
// foreign non-trigger message the operator could see, which in a channel where two agents work
// a thread is one banner per turn. It now fires ONLY for the 'fyi' verdict, and that verdict is
// conjoined with `targeting.mentionsMe` — the server's own stamped mention set naming this
// operator (INVARIANTS §5, §11). So the function survives and its REACH is what changed: the
// tag is the escalation, the Tags inbox is the record.
// ⚠ THE COPY MOVED WITH THE REACH. It used to read "<name>'s agent asked <target>: …", which
// was a sentence about ADDRESSING; the notice is now about being TAGGED, and it must stay
// author-kind neutral because human-to-human mentions notify on exactly these terms (MAPPING
// ruling: a DM notifies when you are tagged). `to_user_id` is deliberately no longer read here
// — it is not what made this banner happen.
//
// 2026-08-08 (F-170) — THE NOTIFY-SCOPE READ IS GONE FROM HERE TOO. This function held the
// SECOND runtime read of `myNotifyScope` (the audit's C-18 found only `targeting.js`'s), and
// it was the last live consumer of the field once notify scope was removed product-wide —
// the control, the client wiring, the schema field, the DTO and the classify read all went,
// and the column drop is written. A read of a value nothing can set is worse than dead code:
// it degrades to whatever the absent-value fallback happens to be, and a future DTO that
// reintroduces the key under different semantics would silently re-mute this path.
//
// SO THE FALLBACK IS THE BEHAVIOUR: `|| 'all'` was the documented default for an absent
// scope, and 'all' meant "send it", which is exactly what every other reader now relies on.
// Do NOT reinstate any part of the feature — two of its three options did not do what their
// labels said, which is why it was removed rather than fixed in place.
function sendFyi(entry, m) {
  const author = io.displayNameFor(m.authorUserId);
  const detail = targeting.metaStr(m, 'summary') || targeting.truncate(m.body, 120);
  // The thread's own title when the post carries one, so the banner says WHERE — same
  // server-stamped key and same fallback order task-notify.js uses for the passive notice.
  const where = targeting.metaStr(m, 'taskTitle') || entry.channel.name;
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: where,
        body: `${author} mentioned you: ${detail}`,
        silent: true,
      });
      n.on('click', () => targeting.openChannelForEntry(entry));
      n.show();
    }
  } catch (_) { /* best-effort */ }
  diag('mention notify', entry.channel.id.slice(0, 8), 'seq', m.seq, targeting.metaStr(m, 'taskTitle') ? 'titled' : 'channel');
}

// ── Trigger entry point (non-blocking) ───────────────────────────────────────
// Create the inbound consent row, register it, notify, and return. Everything
// after the operator answers happens in the resolvers, driven by the watcher.
//
// C-3 (2026-08-08) — IT ANSWERS WHETHER THE LISTENER'S CURSOR MAY MOVE PAST THIS
// MESSAGE. Undefined means handled (a request now exists, or one already did, or the
// operator settled it earlier). A short REASON STRING means "I could not open a request
// for this and nothing else will" — the two failures below — and listener-messages
// .drainPage then holds the persisted cursor on this seq and re-awaits, so a 15-second
// network blip during the consent POST no longer loses the peer's request permanently.
// Both returns are UPSTREAM of watcher.register, and the consent create is de-duped
// server-side on (operator, channel, kind, seq), so retrying is free of side effects.
async function handleTrigger(entry, m) {
  // H1: gate on whether a session can be RUN AT ALL; nothing here can run one ->
  // don't prompt, don't post (the startup notice already fired). FIX 2026-08-04,
  // LAUNCH-CRITICAL: this gated on `spawner.claudeAvailable()` ("an EXTERNAL claude
  // on PATH", which a fresh install has not got), so it returned HERE — before the
  // consent row, the notification and the window. claude-runtime.js has the story.
  if (!(await spawner.sessionSpawnAvailable())) {
    diag('trigger skipped: no claude runtime at all (bundled or external)');
    // C-3: DEFERRED, not dropped. The bundled-executable probe reads the asar-unpacked
    // bundle and can fail transiently (a first-access unpack race, a volume that has not
    // mounted yet); a machine that genuinely has no runtime simply exhausts the ladder and
    // the escape says so, instead of the request vanishing with no record anywhere.
    return 'no-claude-runtime';
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
    // C-3 — THE SINGLE HIGHEST-LEVERAGE LINE IN THE AUDIT. `createConsentRequest` returns
    // null on ANY network error, any non-2xx and a 404, so this branch used to mean "the
    // peer's request is gone, and nobody on either machine will ever know". Failing closed
    // (no spawn without a row) is right; forgetting the message is not.
    return 'no-consent-row';
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
    // ⚠ THE PRE-CONSENT WINDOW STOOD HERE AND IS DELETED (2026-08-20, F-228). Item 8 opened
    // a window on EVERY inbound request — one per thread, minted before anyone had looked at
    // it — which Phase 9 made opt-in and this wave removes outright. The native notification
    // fires and CLICKING it focuses the main app on the channel, where the transcript card and
    // the thread strip are the decision surface (INVARIANTS §6).
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
        // F-067: submitDecision, not patchDecision — a PATCH that does not land
        // re-notifies the operator with the recovery path. Still fire-and-forget
        // (it never rejects); the poke below is unconditional because the watcher
        // reads the row's REAL status either way.
        consent.submitDecision(entry.workspaceId, created.rowId, 'allow', {
          channelName: entry.channel.name,
          onOpen: () => targeting.openChannelForEntry(entry, { threadId: inboundTaskId || null }),
        });
        watcher.poke(key);
      },
      // Body click lands on the THREAD (the strip is the decision surface there);
      // a legacy/absent id degrades to the channel, where the card carries it.
      onOpen: () => targeting.openChannelForEntry(entry, { threadId: inboundTaskId || null }),
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
// ⚠ `releaseConsentWindow` STOOD HERE AND IS DELETED (2026-08-20, F-228). C-9 existed because
// an ACCEPTED pre-consent entry stayed in the registry so `startSession` could reuse its window,
// and every exit that did NOT adopt it had to hand the window budget back or six of them
// deadlocked the app. No card, no window, no budget, nothing to release.

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

  // 2026-08-20 DEFAULT EXECUTOR: a WINDOWLESS SDK session (registers in the engine, so
  // the Agents tab / pause / end / metrics all work; inbound auto-consumed; outbound per
  // the channel's auto-send posture via the consent bridge). An engine skip (session cap /
  // no SDK) falls back to the headless + approve-out path, byte-for-byte.
  if (await launchResponderSession(entry, m, rec, { taskId, startModes })) {
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
  // 2026-08-20 — THE WINDOWLESS POSTURE. There is no Accept UI, so the message axis is
  // floored at auto_inbound; the OUT half is the channel's durable auto-send setting,
  // widened — never narrowed — by an operator-armed auto posture.
  // ⚠ THE RULE LIVES IN channel-prefs (`windowlessMessageMode`) AND IS SHARED WITH THE
  // REQUESTER LANE (`channel-dir-ipc.js › sessions:launch`). It was inlined here while
  // that lane pinned its own answer, which is exactly the drift the shared function
  // removes: the INPUTS differ (this lane's arm vs. that lane's durable posture) and
  // the derivation must not.
  const messages = channelPrefs.windowlessMessageMode(
    entry.channel.id,
    startModes && startModes.messages
  );
  const res = await sessionEngine.launchResponderSession({
    channelId: entry.channel.id,
    taskId: rec.taskId || taskId,
    workspaceId: entry.workspaceId,
    message: m.body,
    windowless: true,
    triggerSeq: m.seq, // the ask's seq — the outbound bridge's seq-join floor
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
      workspaceSegment: entry.workspaceSegment || null, // the outbound bridge's nav target
    },
    toolProfile: rec.toolProfile,
    mode,
    // H2 still holds for the TOOL axis: the operator's armed pick, else manual/ask.
    // The MESSAGE axis is the windowless posture derived above.
    startModes: { tools: (startModes && startModes.tools) || 'manual', messages },
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
    await postCourtesy(entry, m, AUTH_HELD_REPLY); // P1-5: a no-op must not trigger the peer
    watcher.settle(rec.key, 'auth-hold');
    return true; // handled — do NOT also run headless
  }
  if (res && res.skipped === 'busy') {
    diag('responder session: skipped=busy');
    // RESEND is an untagged bubble by design, so the requester watching THIS thread sees
    // nothing there. One milestone inside the thread says queued rather than ignored.
    await queued.announce(entry, m, rec.taskId || taskId, 'session');
    await postCourtesy(entry, m, RESEND); // P1-5: a no-op must not trigger the peer
    watcher.settle(rec.key, 'busy');
    return true; // handled — do NOT also run headless
  }
  // cap / no-sdk / disabled → today's headless fallback answers the request.
  diag('responder session skipped:', (res && res.skipped) || 'unknown', '— headless fallback');
  if (res && res.skipped === 'cap') {
    notifyLocal(
      'Dopl: session limit reached',
      `Answering "${entry.channel.name}" headlessly instead.`
    );
  }
  return false;
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
