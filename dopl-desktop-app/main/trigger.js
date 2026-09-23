// Channels listener — trigger handling: a peer's addressed ask raises ONE notification whose
// "Launch agent" button spawns the responder session (the body click opens the thread; dismiss does
// nothing). No consent row: outbound approval still gates what the agent posts
// (`session-windowless.js › bridgeOutbound`). `handleTrigger` returns a REASON STRING only when
// nothing could act, so `listener-messages.drainPage` holds the cursor on that seq (C-3).

const { Notification } = require('electron');
const io = require('./listener-io');
const targeting = require('./targeting');
const spawner = require('./session-spawner');
const sessionEngine = require('./session-engine');
const channelDirs = require('./channel-dirs');
const { profileLabel, profileHint } = require('./tool-profiles');
const { buildActionNotification } = require('./notify-action');
const { postCourtesy, notifyLocal } = require('./channel-post');
const queued = require('./queued-notice'); // the in-thread "queued, not ignored" milestone
const outcomes = require('./trigger-outcomes');
const { AUTH_HELD_REPLY, RESEND, CANNOT_RUN } = outcomes; // the peer-facing courtesy replies
const { diag } = require('./diag');

// Deterministic per (channel, seq) so a replay groups with its first delivery; a first-class id wins.
function taskIdFor(entry, m) {
  return targeting.firstClassTaskId(m) || `task-${entry.channel.id}-${m.seq}`;
}

/**
 * A mention (the 'fyi' verdict, `targeting.mentionsMe`): a silent banner, never a spawn. Its click
 * lands on the message (thread + seq), which `use-message-jump.ts` scrolls to.
 */
function sendFyi(entry, m) {
  const author = io.displayNameFor(m.authorUserId);
  const detail = targeting.metaStr(m, 'summary') || targeting.truncate(m.body, 120);
  // Where: the thread's title when the post carries one, else the channel.
  const where = targeting.metaStr(m, 'taskTitle') || entry.channel.name;
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: where,
        body: `${author} mentioned you: ${detail}`,
        silent: true,
      });
      n.on('click', () => targeting.openChannelForEntry(entry, {
        threadId: targeting.metaStr(m, 'taskId') || null,
        seq: m.seq,
      }));
      n.show();
    }
  } catch (_) { /* best-effort */ }
  diag('mention notify', entry.channel.id.slice(0, 8), 'seq', m.seq, targeting.metaStr(m, 'taskTitle') ? 'titled' : 'channel');
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
  return buildActionNotification({
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

  notifyAsk({
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
  notifyLocal(
    skipped === 'cap' ? 'Dopl: session limit reached' : 'Dopl: cannot run this request',
    `"${entry.channel.name}" was not answered. ${skippedHint(skipped)}`
  );
  await postCourtesy(entry, m, CANNOT_RUN); // P1-5: a no-op must not trigger the peer
  return true;
}

// The LOCAL half of the notice (may name this machine's state); the peer's copy may not. Vendor-free:
// it has only a skip code, no runtime to name.
function skippedHint(skipped) {
  if (skipped === 'cap') return 'Too many agents are already running here — end one and ask them to resend.';
  if (skipped === 'no-sdk') return 'No agent runtime is available on this machine.';
  return 'The agent could not be started.';
}

module.exports = { handleTrigger, sendFyi, notifyAsk, launchResponderSession };
