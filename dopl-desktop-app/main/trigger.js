// Channels listener — trigger handling: a peer's addressed ask, and what this machine offers to
// do about it.
//
// ── ⚠ THE INBOUND CONSENT LANE IS DELETED (2026-08-22, Samuel's ruling) ─────────────────────
//
// WHAT USED TO HAPPEN. `handleTrigger` created an INBOUND consent row on the server, registered a
// durable pending-request record with `consent-watcher.js`, fired an Allow notification and
// returned. The watcher polled that row off-loop; when it flipped it dispatched back into a set of
// injected `resolvers` (`inboundApproved` / `inboundDenied` / `inboundExpired` / `onInterrupted`)
// which spawned, echoed a decline, or settled the record. Three modules existed for that lane
// alone and are gone with it: `consent-watcher.js`, `consent-store.js`, `consent-cadence.js`.
//
// WHAT HAPPENS NOW. The ask raises ONE notification with two verbs:
//   LAUNCH AGENT  spawns the responder session directly, with the triggering message as its
//                 first turn. Byte-for-byte what the old approved path did, minus the row.
//   OPEN THREAD   the body click, unchanged: focus the app on the thread (INVARIANTS §11's
//                 "windowing is inverted" ruling).
//   DISMISS       does nothing. It always did — `close` fires on system auto-dismiss, banner
//                 style and Focus mode too, so it was never a decision — but it used to leave a
//                 row pending on a surface somewhere else. There is no row to leave.
//
// ⚠ WHY THE ROW WENT RATHER THAN THE BUTTON. The gate it implemented had TWO halves and neither
// survived contact: the DENY half wrote a `task_failed{declined}` echo nobody asked for, and the
// AUTO-ALLOW half (`agent_trust_rules`, a server-side standing trust that made a row be born
// `auto_allowed`) HAS NEVER FIRED — zero `auto_allowed` rows in the table's history. What is left
// is a durable, replayable, settle-able record of a decision whose only real outcome was "the
// operator clicked the button, or did not". A notification already expresses that.
//
// ⚠ OUTBOUND CONSENT IS UNTOUCHED. A windowless session's own-channel post still bridges to an
// `outbound` row and still waits for a human Send (`session-windowless.js › bridgeOutbound`), and
// the PRIVATE-TURN gate still withdraws Axis B's outbound widening. Approve-OUT is the half that
// stops bytes leaving the machine, and it is the half that works.
//
// PRESERVED INVARIANTS: fail-closed classify (upstream), error suppression (an errored spawn
// posts NO reply), tool-profile containment, the v1.3.1 agent-authored-addressed trigger,
// deterministic taskId / clientMsgId, and the C-3 cursor contract — `handleTrigger` still returns
// a short REASON STRING when it could not act at all, and `listener-messages.drainPage` still
// holds the persisted cursor on that seq.

const { Notification } = require('electron');
const io = require('./listener-io');
const targeting = require('./targeting');
const channelPrefs = require('./channel-prefs'); // the shared windowless message derivation
const sessionModel = require('./session-model'); // the frozen model enum + the id -> alias map
const spawner = require('./session-spawner');
const sessionEngine = require('./session-engine');
const channelDirs = require('./channel-dirs');
const { profileLabel, profileHint } = require('./tool-profiles');
// §2 SPLIT (2026-08-22): the banner shape — one action button, a navigating body click, a Dismiss
// that decides nothing. Shared with `consent.js › notifyOutbound`, which is about a ROW; this one
// is not, which is exactly why the shape does not live in that file.
const { buildActionNotification } = require('./notify-action');
// ⚠ `postTaskEvent` / `postResult` left this list on 2026-08-20: their only reader here was
// `outboundApproved`, which posted the HEADLESS lane's drafted reply on the agent's behalf.
const { postCourtesy, notifyLocal } = require('./channel-post');
const queued = require('./queued-notice'); // the in-thread "queued, not ignored" milestone
const outcomes = require('./trigger-outcomes'); // the peer-facing courtesy replies
// ⚠ THE HEADLESS FALLBACK LANE IS DELETED (2026-08-20, Samuel's ruling). `trigger-headless.js`
// spawned `claude -p` through `session-spawner.runForChannel` and opened an OUTBOUND REVIEW row
// for the reply it produced — a second executor with its own concurrency pool, its own consent
// phase (`await-outbound`) and its own settle vocabulary, kept as the fallback for when the
// engine skipped. One executor is the point: two lanes meant two answers to every question about
// containment, posture and what the peer is told, and the SDK lane is the one with the Agents
// tab, pause/end and the metrics behind it.
const { AUTH_HELD_REPLY, RESEND, CANNOT_RUN } = outcomes; // the peer-facing courtesy replies
const { diag } = require('./diag');

// Deterministic per (channel, seq) — a replay reuses the SAME id so task_started and its end
// group together instead of splitting across a fresh random id. A first-class (UUID) task id on
// the inbound message wins; a legacy/absent one degrades to the deterministic legacy form.
function taskIdFor(entry, m) {
  return targeting.firstClassTaskId(m) || `task-${entry.channel.id}-${m.seq}`;
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

// ── THE ASK NOTIFICATION (2026-08-22) ────────────────────────────────────────
// "<requester>'s agent asks: <summary>", the Round C BLAST-RADIUS line, and a LAUNCH AGENT
// button. ⚠ THE BLAST RADIUS LINE IS INHERITED FROM THE DELETED CONSENT BANNER AND IS THE ONE
// PART OF IT WORTH KEEPING: in plain language, WHERE the agent will run and with WHICH tools, so
// the operator sees the real bound before the spawn rather than after it. `runsIn` is an
// already-abbreviated local path (~/…) or null → "the sandbox folder"; the path is LOCAL-ONLY and
// has never been sent to the server, which is why this line can only ever exist on the native
// banner. The location is context; the tool label is the actual containment.
//
// ⚠ THE BUTTON LAUNCHES. It does not approve, record, or decide anything a second surface could
// also answer — so there is no lost-race case, no 409, and nothing to re-notify about.
function notifyAsk({ channelName, requesterName, summary, bodyPreview, runsIn, toolLabel, capabilityHint, onLaunch, onOpen }) {
  const ask = summary
    ? `${requesterName}'s agent asks: ${targeting.truncate(summary, 200)}`
    : `${requesterName}'s agent: ${targeting.truncate(bodyPreview, 120)}`;
  const where = runsIn || 'the sandbox folder';
  const tools = toolLabel || 'Full-access';
  const hint = capabilityHint ? `\n${capabilityHint}` : '';
  const body = `${ask}\nRuns in ${where} with ${tools} tools${hint}`;
  return buildActionNotification({
    title: channelName, body, actionText: 'Launch agent', onAffirm: onLaunch, onOpen,
  });
}

// ── Trigger entry point (non-blocking) ───────────────────────────────────────
// Notify, and return. The spawn happens later, from the button, or never.
//
// C-3 (2026-08-08) — IT ANSWERS WHETHER THE LISTENER'S CURSOR MAY MOVE PAST THIS MESSAGE.
// Undefined means handled. A short REASON STRING means "I could not open anything for this and
// nothing else will" — and `listener-messages.drainPage` then holds the persisted cursor on this
// seq and re-awaits, so a transient failure during the runtime probe no longer loses the peer's
// request permanently.
// ⚠ ONE DEFERRING RETURN LEFT, DOWN FROM TWO. `'no-consent-row'` went with the row: there is no
// network call on this path any more, so the only thing that can stop a notification is having
// nothing to launch. That also removes the last reason this function needed an idempotency
// ledger — `watcher.isSettled` / `watcher.has` guarded against re-notifying a message a retry
// re-delivered, and the only retry left is the cursor hold above, which happens BEFORE the
// banner is built.
async function handleTrigger(entry, m) {
  // H1: gate on whether a session can be RUN AT ALL; nothing here can run one ->
  // don't notify (the startup notice already fired). FIX 2026-08-04,
  // LAUNCH-CRITICAL: this gated on `spawner.claudeAvailable()` ("an EXTERNAL claude
  // on PATH", which a fresh install has not got), so it returned HERE — before the
  // notification and the window. claude-runtime.js has the story.
  if (!(await spawner.sessionSpawnAvailable())) {
    diag('trigger skipped: no claude runtime at all (bundled or external)');
    // C-3: DEFERRED, not dropped. The bundled-executable probe reads the asar-unpacked
    // bundle and can fail transiently (a first-access unpack race, a volume that has not
    // mounted yet); a machine that genuinely has no runtime simply exhausts the ladder and
    // the escape says so, instead of the request vanishing with no record anywhere.
    return 'no-claude-runtime';
  }

  const requesterName = io.displayNameFor(m.authorUserId);
  const summary = targeting.metaStr(m, 'summary');
  const bodyPreview = targeting.truncate(m.body, 2000);
  // Snapshot the tool profile now — the launch may land much later, and the operator is being
  // shown this profile's containment on the banner they are about to press.
  const toolProfile = targeting.resolveToolProfile(entry.channel);
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
    // ⚠ THE MESSAGE BODY RIDES THE CLOSURE, WHICH IS WHY THERE IS NO REFETCH ANY MORE. The old
    // lane persisted a record WITHOUT the untrusted body and re-fetched it at approval time
    // (`refetchMessage`, deleted) because the approval could arrive days later, on a different
    // run of the app. A notification does not outlive its process, so the message this banner is
    // about is the message that is still in hand.
    onLaunch: () => {
      void launchResponderSession(entry, m, { taskId, toolProfile, requesterName })
        .catch((err) => diag('responder launch error', err && err.message));
    },
    // Body click lands on the THREAD (the strip is the decision surface there);
    // a legacy/absent id degrades to the channel, where the card carries it.
    onOpen: () => targeting.openChannelForEntry(entry, { threadId: inboundTaskId || null }),
  });
}

// Responder SESSION launch (§A.2): hand the framed inbound to the engine, which drives the loop.
// The agent posts its OWN reply + task_progress milestones via the pre-approved dopl_channel tool,
// and the channel listener feeds the thread's later messages into the SAME live session as turns.
// task_started is echoed by the engine's onLaunched (index.js), NOT here.
// ⚠ IT ALWAYS ANSWERS: a launch, or a terminal that tells the peer. The `claude -p` HEADLESS
// FALLBACK that used to catch its skips is deleted (Samuel's ruling); see the tail for why every
// skip became a terminal rather than a second executor.
async function launchResponderSession(entry, m, { taskId, toolProfile, requesterName }) {
  // Loop-continuation knob: mirror the requester task's mode when the inbound
  // carries one (server-stamped), else autonomous — either way the session runs
  // under the turn / idle / cost caps, so it cannot self-sustain unbounded.
  const mode = targeting.metaStr(m, 'taskMode') || 'autonomous';
  // 2026-08-20 — THE WINDOWLESS POSTURE. There is no Accept UI, so the message axis is
  // floored at auto_inbound; the OUT half is the channel's durable auto-send setting.
  // ⚠ THE RULE LIVES IN channel-prefs (`windowlessMessageMode`) AND IS SHARED WITH THE
  // REQUESTER LANE (`session-ipc-ops.js › sessions:launch`). It was inlined here while
  // that lane pinned its own answer, which is exactly the drift the shared function
  // removes. ⚠ Its second argument was the ARM's message axis and is now always null
  // (the arm is deleted) — the parameter STAYS because the requester lane still passes a
  // real value, and one derivation with two inputs is the point.
  const messages = channelPrefs.windowlessMessageMode(entry.channel.id, null);
  const res = await sessionEngine.launchResponderSession({
    channelId: entry.channel.id,
    taskId,
    workspaceId: entry.workspaceId,
    message: m.body,
    windowless: true,
    triggerSeq: m.seq, // the ask's seq — the outbound bridge's seq-join floor
    // FIX L1: the responder's counterparty is the requester who addressed me — the
    // inbound message's author.
    counterpartyId: m.authorUserId,
    // H2: the server's own 1:1 flag off the channel DTO. In a DM the server addresses
    // this session's unaddressed posts, so its outbound approval card names the peer.
    direct: entry.channel.isDirect === true,
    // D1: taskTitle rides the responder context too (the SAME server-stamped meta the
    // banner above already reads), so the session header names the TASK instead of falling
    // back to the channel or a bare "Session".
    // v2.x: the CONCRETE ids ride the context too, because prompt-framing's delivery section
    // reads only the context — a spawn told just the channel's display name could not fill
    // dopl_channel's `channel=` and hunted with op "list". 2026-07-31: taskId rides for the same
    // reason, LEGACY ids included, or the reply reaches the peer as a brand-new request.
    context: {
      channelName: entry.channel.name, authorName: requesterName,
      authorKind: m.authorKind, taskTitle: targeting.metaStr(m, 'taskTitle') || null,
      channelId: entry.channel.id, workspaceId: entry.workspaceId, taskId,
      workspaceSegment: entry.workspaceSegment || null, // the outbound bridge's nav target
    },
    toolProfile,
    mode,
    // ⚠ THE CHANNEL'S CHOSEN MODEL, AND NOT ITS PERMISSION PAIR (2026-08-22, Samuel's ruling).
    // A peer-triggered launch inherits the operator's model choice — it is a fact about how this
    // machine answers, not a grant — while H2 keeps it from inheriting the stored posture, which
    // is why `channel-prefs.js` exposes the two through separate readers.
    model: sessionModel.aliasForModelId(channelPrefs.getLaunchModel(entry.channel.id)),
    // ⚠ H2 IS UNCHANGED AND THIS PATH STILL OBEYS IT. A peer-triggered launch carries NO tool
    // posture: `manual` is the reducer's own most-restrictive value, and the operator's durable
    // pick applies to the launch shape they press themselves (`sessions:launch`) and to nothing
    // a peer can trigger. ⚠ THE WINDOWLESS FLOOR still applies on top of it
    // (`session-profiles.js › floorWindowlessTool`) — that is a fact about having no gate
    // surface, not a posture anybody chose.
    startModes: { tools: 'manual', messages },
  });
  if (res && res.sessionId) {
    diag('responder session launched', String(res.sessionId).slice(0, 8), 'profile', toolProfile);
    return true;
  }
  if (res && res.skipped === 'auth-hold') {
    // H1: a held session owns this slot and is running nothing. Answer honestly rather than
    // leaving the peer waiting on a machine nobody has signed in on.
    diag('responder session: skipped=auth-hold — the slot is held on the sign-in action');
    await postCourtesy(entry, m, AUTH_HELD_REPLY); // P1-5: a no-op must not trigger the peer
    return true; // handled — the request is answered
  }
  if (res && res.skipped === 'busy') {
    diag('responder session: skipped=busy');
    // RESEND is an untagged bubble by design, so the requester watching THIS thread sees
    // nothing there. One milestone inside the thread says queued rather than ignored.
    await queued.announce(entry, m, taskId, 'session');
    await postCourtesy(entry, m, RESEND); // P1-5: a no-op must not trigger the peer
    return true; // handled — the request is answered
  }
  // ⚠ cap / no-sdk / disabled USED TO FALL THROUGH TO THE HEADLESS LANE, AND THAT LANE IS
  // DELETED (2026-08-20, Samuel's ruling). Every engine skip is now a TERMINAL, and it takes the
  // same shape as `busy` and `auth-hold` above, for the same reason: the caller is holding the
  // skip reason, so it is the only layer that can say what happened. A request that reaches this
  // line is ANSWERED — the peer is told — never left waiting against a machine that is not going
  // to run it.
  const skipped = (res && res.skipped) || 'unknown';
  diag('responder session skipped:', skipped, '— answering the peer');
  notifyLocal(
    skipped === 'cap' ? 'Dopl: session limit reached' : 'Dopl: cannot run this request',
    `"${entry.channel.name}" was not answered. ${skippedHint(skipped)}`
  );
  await postCourtesy(entry, m, CANNOT_RUN); // P1-5: a no-op must not trigger the peer
  return true; // handled — there is nothing else to fall through to
}

// The LOCAL half of the notice above: what the operator can do about it. Local-only, so it may
// name this machine's state; the peer's copy (`CANNOT_RUN`) may not.
function skippedHint(skipped) {
  if (skipped === 'cap') return 'Too many agents are already running here — end one and ask them to resend.';
  if (skipped === 'no-sdk') return 'Claude Code is not available on this machine.';
  return 'The agent could not be started.';
}

// ⚠ `outboundApproved(rec)` STOOD HERE AND IS DELETED (2026-08-20, Samuel's ruling). It posted
// the reply the HEADLESS lane had drafted, once a human clicked Send on its review row — the
// desktop posting on the agent's behalf, because a `claude -p` run hands back a string and then
// exits.
//
// ⚠ APPROVE-OUT IS NOT GONE — it moved INTO the session. A windowless agent's own-channel post
// is held at its tool gate, bridged to an `outbound` consent row, and RELEASED when the human
// decides; the agent then posts its own bytes. Nothing writes on its behalf any more, which is
// the stronger shape: what the operator approved is exactly what leaves the machine.
//
// ⚠ AND `resolvers` STOOD BELOW IT, DELETED 2026-08-22 WITH THE INBOUND LANE. It was the
// injection seam `consent-watcher.start()` took — `inboundApproved`, `inboundDenied`,
// `inboundExpired`, `onInterrupted` — and every one of those four is a terminal for a DECISION
// nobody makes any more. `channel-listener.js` no longer starts a watcher, so there is nothing
// left to inject into.

module.exports = { handleTrigger, sendFyi, notifyAsk, launchResponderSession };
