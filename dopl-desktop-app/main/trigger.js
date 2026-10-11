// Channels listener — trigger handling: a peer's addressed ask raises ONE notification whose
// "Launch agent" button spawns the responder session (the body click opens the thread; dismiss does
// nothing). No consent row: outbound approval still gates what the agent posts
// (`session-windowless.js › bridgeOutbound`). `handleTrigger` returns a REASON STRING only when
// nothing could act, so `listener-messages.drainPage` holds the cursor on that seq (C-3) — today
// 'no-agent-runtime' and 'no-ask-surface'. ⚠ A MUTED `peer_ask` is NOT one of them: a mute
// silences the banner, it does not make the ask unanswerable. See `handleTrigger`.

// ⚠ `electron` is no longer required here: `sendFyi` routes through `notification-route` and
// `notifyAsk` builds its actionable banner in `notify-action.js`. This module raises nothing
// itself.
const io = require('./listener-io');
const targeting = require('./targeting');
const spawner = require('./session-spawner');
const sessionEngine = require('./session-engine');
const channelDirs = require('./channel-dirs');
const { profileLabel, profileHint } = require('./tool-profiles');
// ⚠ `notify-action` is no longer required here: the route decides the surface and builds the
// same banner underneath (`notification-route.js › raiseActionable`).
// The shared passive-mention copy. ⚠ No cycle: task-notify requires targeting + the route, never
// this module.
const { mentionNotice } = require('./task-notify');
const { postCourtesy } = require('./channel-post');
const queued = require('./queued-notice'); // the in-thread "queued, not ignored" milestone
const outcomes = require('./trigger-outcomes');
const { AUTH_HELD_REPLY, RESEND, CANNOT_RUN } = outcomes; // the peer-facing courtesy replies
const { diag } = require('./diag');
const notificationPrefs = require('./notification-prefs'); // the operator's banner switches
const notificationRoute = require('./notification-route'); // which surface a passive notice takes

// Deterministic per (channel, seq) so a replay groups with its first delivery; a first-class id wins.
function taskIdFor(entry, m) {
  return targeting.firstClassTaskId(m) || `task-${entry.channel.id}-${m.seq}`;
}

/**
 * A mention (the 'fyi' verdict, `targeting.mentionsMe`): a silent banner, never a spawn. Its click
 * lands on the message (thread + seq), which `use-message-jump.ts` scrolls to.
 */
function sendFyi(entry, m) {
  // The Notifications tab's switch for this event (mention / decision / direct message). Mutes the
  // BANNER only: the Tags inbox and the thread still hold the message.
  if (!notificationPrefs.allowsMessage(m, entry)) {
    diag('mention notify muted', entry.channel.id.slice(0, 8), 'seq', m.seq, notificationPrefs.eventForMessage(m, entry));
    return;
  }
  // ⚠ ONE BUILDER, TWO CALL SITES. A tag inside a thread reaches `task-notify.js` instead of
  // here (classify ranks 'task-reply' above 'fyi'), and both must read the same, so the copy
  // lives in `task-notify.js › mentionNotice` — pure, and tested without electron.
  const notice = mentionNotice(m, entry.channel.name, io.displayNameFor(m.authorUserId));
  // ⚠ ROUTED, NOT RAISED DIRECTLY (Samuel's spec, 2026-10-09). `mention` and `decision` are both
  // "Mac + popup", which resolves to ONE surface at raise time — the toast while Dopl is in
  // front, the OS banner while it is away (`notification-route.js`). This call site no longer
  // knows or cares which: it names the EVENT and hands over the copy.
  // ⚠ The event id comes from `eventForMessage`, the same server-stamped facts the gate reads, so
  // a decision card routes as `decision` and everything else as `mention` — one classifier, not
  // two. `raise` checks the switch again; the early return above is kept because it also avoids
  // building this copy for a muted event, and it is what the gate's own test pins.
  const went = notificationRoute.raise(notificationPrefs.eventForMessage(m, entry), {
    title: notice.title,
    body: notice.body,
    onClick: () => targeting.openChannelForEntry(entry, {
      threadId: targeting.metaStr(m, 'taskId') || null,
      seq: m.seq,
    }),
  });
  diag('mention notify', entry.channel.id.slice(0, 8), 'seq', m.seq,
    targeting.metaStr(m, 'taskTitle') ? 'titled' : 'channel', '→', went);
}

/**
 * The ask banner: the request, then where the agent would run and with which tool profile — the
 * real containment, shown before the spawn. `runsIn` is a LOCAL abbreviated path (never sent to the
 * server). The button launches; it decides nothing another surface could also answer.
 */
function notifyAsk({ channelName, requesterName, summary, bodyPreview, runsIn, toolLabel, capabilityHint, onLaunch, onOpen }) {
  const ask = summary
    ? `${requesterName}'s agent asks: ${targeting.truncate(summary, 200)}`
    : `${requesterName}'s agent: ${targeting.truncate(bodyPreview, 120)}`;
  const where = runsIn || 'the sandbox folder';
  const hint = capabilityHint ? `\n${capabilityHint}` : '';
  const body = `${ask}\nRuns in ${where} with ${toolLabel} tools${hint}`;
  // ⚠ ROUTED (2026-10-09, Samuel's spec). `peer_ask` is "Mac + popup": the banner with its
  // "Launch agent" button when Dopl is away, and when it is in front a toast that only OPENS the
  // channel — where the launch control already lives. A spawn is never moved into a toast that
  // auto-dismisses, and this keeps `notify-action.js`'s rule intact: the click navigates, the
  // button decides, and only the banner has the button.
  // ⚠ ITS ANSWER IS READ BY `handleTrigger` — `MUTED` is not `null`; see there.
  return notificationRoute.raiseActionable('peer_ask', {
    title: channelName, body, actionText: 'Launch agent', onAffirm: onLaunch, onOpen,
  });
}

/**
 * Notify and return; the spawn happens later, from the button, or never. The one deferring return
 * is "no runtime can run anything" (`claude-runtime.js › sessionSpawnAvailable`, over the registry):
 * the cursor holds and the ask is retried rather than lost.
 */
async function handleTrigger(entry, m) {
  if (!(await spawner.sessionSpawnAvailable())) {
    diag('trigger skipped: no agent runtime at all (bundled or external)');
    return 'no-agent-runtime';
  }

  const requesterName = io.displayNameFor(m.authorUserId);
  const summary = targeting.metaStr(m, 'summary');
  const bodyPreview = targeting.truncate(m.body, 2000);
  // Snapshot now — the banner must name the profile the session will start at, NARROWED for a shared
  // room (a peer's ask always comes from one; ruling B7).
  const toolProfile = targeting.resolveLaunchToolProfile(entry.channel);
  const inboundTaskId = targeting.firstClassTaskId(m);
  const taskId = taskIdFor(entry, m);
  diag('ask notify:', entry.channel.id.slice(0, 8), 'seq', m.seq, 'profile', toolProfile);

  const raised = notifyAsk({
    channelName: entry.channel.name,
    requesterName,
    summary,
    bodyPreview,
    runsIn: channelDirs.liveChannelDirLabel(entry.channel.id),
    toolLabel: profileLabel(toolProfile),
    capabilityHint: profileHint(toolProfile),
    // The message rides the closure: a notification does not outlive its process, so nothing refetches.
    onLaunch: () => {
      void launchResponderSession(entry, m, { taskId, toolProfile, requesterName })
        .catch((err) => diag('responder launch error', err && err.message));
    },
    onOpen: () => targeting.openChannelForEntry(entry, { threadId: inboundTaskId || null }),
  });
  // ⚠ A MUTE SILENCES THE SURFACE AND NOTHING ELSE (Samuel's spec; @orchestrator, 2026-10-10).
  // `raiseActionable` runs the operator's switch, so muting `peer_ask` used to answer `null` here
  // — which this line ignored, so the ask was CONSUMED with no launch and no courtesy reply. The
  // route now answers the truthy `MUTED` for that case, and it is HANDLED exactly as an un-pressed
  // banner is: the cursor advances, the thread and the Tags inbox still hold the ask, and the
  // launch control in the channel still launches it. The launch path is untouched — a mute must
  // never auto-launch either.
  if (raised === notificationRoute.MUTED) {
    diag('ask notify muted —', entry.channel.id.slice(0, 8), 'seq', m.seq,
      '— no banner; the thread still holds the ask and the channel still launches it');
    return;
  }
  // ⚠ NOTHING COULD BE RAISED AT ALL (not a mute): no banner, no toast, not even the route's
  // last-resort banner. The operator will never be asked, so the peer waits forever on a message
  // this machine would otherwise mark read. That is exactly C-3's "I could not do this and the
  // message must not be lost": answer a reason and let `drainPage` hold the cursor for a retry.
  if (!raised) {
    diag('ask notify: NO surface could be raised — holding the cursor rather than consuming it');
    return 'no-ask-surface';
  }
}

/**
 * Launch the responder session: the framed ask is its first turn, and the agent posts its own reply.
 * It ALWAYS answers — a launch, or a courtesy reply for every engine skip (there is no second executor).
 */
async function launchResponderSession(entry, m, { taskId, toolProfile, requesterName }) {
  // Mirror the requester task's mode when stamped; the session caps bound it either way.
  const mode = targeting.metaStr(m, 'taskMode') || 'autonomous';
  // No launcher pick and no identity here: the channel's runtime, else the default (ruling 5).
  const launch = await require('./runtime/launch-default').resolveLaunchRuntime({ channelId: entry.channel.id });
  const runtimeId = launch.runtimeId;
  const registry = require('./runtime');
  const res = await sessionEngine.launchResponderSession({
    channelId: entry.channel.id,
    taskId,
    workspaceId: entry.workspaceId,
    runtime: runtimeId,
    message: m.body,
    windowless: true,
    triggerSeq: m.seq, // the ask's seq — the outbound bridge's seq-join floor
    // FIX L1: the counterparty is the requester who addressed me.
    counterpartyId: m.authorUserId,
    // H2: the server's own 1:1 flag; in a DM the approval card names the peer.
    direct: entry.channel.isDirect === true,
    // The concrete ids ride the context: prompt-framing fills `dopl_channel`'s call from it.
    context: {
      channelName: entry.channel.name, authorName: requesterName,
      authorKind: m.authorKind, taskTitle: targeting.metaStr(m, 'taskTitle') || null,
      channelId: entry.channel.id, workspaceId: entry.workspaceId, taskId,
      workspaceSegment: entry.workspaceSegment || null, // the outbound bridge's nav target
    },
    toolProfile,
    mode,
    // No `model` (the runtime default applies). H2: a peer-triggered launch carries NO stored posture —
    // its runtime's narrowest tool word and `ask`, which `startSession` floors for a windowless session.
    startModes: { tools: registry.capability.narrowestToolMode(registry.descriptorFor(runtimeId)), messages: 'ask' },
  });
  if (res && res.sessionId) {
    diag('responder session launched', String(res.sessionId).slice(0, 8), 'profile', toolProfile);
    return true;
  }
  // Every skip is a TERMINAL that answers the peer; the local notice says what the operator can do.
  if (res && res.skipped === 'auth-hold') {
    diag('responder session: skipped=auth-hold — the slot is held on the sign-in action');
    await postCourtesy(entry, m, AUTH_HELD_REPLY); // P1-5: a no-op must not trigger the peer
    return true;
  }
  if (res && res.skipped === 'busy') {
    diag('responder session: skipped=busy');
    await queued.announce(entry, m, taskId, 'session');
    await postCourtesy(entry, m, RESEND); // P1-5: a no-op must not trigger the peer
    return true;
  }
  const skipped = (res && res.skipped) || 'unknown';
  diag('responder session skipped:', skipped, '— answering the peer');
  // ⚠ NO LOCAL BANNER HERE ANY MORE (Samuel's spec, 2026-10-09 — KB dopl-development
  // "Notification Spec Samuel 2026-10-09"). "A request to me went unanswered" is not on his list,
  // so it raises nothing. The FACT IS NOT LOST: `postCourtesy` below tells the peer in the
  // channel, which is the surface that matters — they are the one waiting — and `diag` above
  // keeps it for a log read. Do not re-add a notification here without a ruling.
  await postCourtesy(entry, m, CANNOT_RUN); // P1-5: a no-op must not trigger the peer
  return true;
}

module.exports = { handleTrigger, sendFyi, notifyAsk, launchResponderSession };
