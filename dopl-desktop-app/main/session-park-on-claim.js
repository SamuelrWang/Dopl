'use strict';

// session-park-on-claim.js — RULING 5 (Samuel, 2026-08-26): when a bound claim adds a PEER to a
// container, the container's LIVE sessions stop, and the operator is told.
//
// 🔒 WHY THIS EXISTS AT ALL — THE CARRYOVER INVARIANT (plan §4.5, INVARIANTS §11).
// THE CEILING BOUNDS FUTURE READS, NEVER CONTEXT ALREADY IN THE WINDOW. Layer A tightens at the
// session's very next tool call, so nothing NEW leaks the moment a peer arrives — but a session
// that was running SOLO a second ago has already read whatever it read, and it is still holding
// it, in a room a stranger has just walked into. No fence can un-read that. The only honest
// remedy is to STOP the session, and the only honest report is to say so to the operator.
//
// ⚠ THIS IS NOT A FENCE EITHER, AND IT IS NOT TRYING TO BE. It is a CONSEQUENCE of the
// invariant, not an enforcement of it: the session already holds what it holds, and stopping it
// bounds how much more it accumulates under the wrong assumption. Nothing here would stop a
// determined agent; layer A and the locked credential are what refuse the next READ.
//
// ⚠ IT ENDS RATHER THAN PARKS, AND THE RULING PERMITTED EITHER. Three reasons for `end`:
//   1. `settle` IS the one stop path (INVARIANTS §11, `session-teardown.js`'s own header), and
//      "reuse the one stop path" is the standing rule. A second, parallel way to stop a session
//      is a second set of the orphaned-child bugs that path exists to prevent.
//   2. It gives the CREDENTIAL back. A session that started in a SOLO container is running on the
//      operator's unlocked device token (`session-credential.js › shouldLockSession` said no, and
//      it was RIGHT at the time). Ending it revokes nothing it should not — and the NEXT session
//      in that container mints a locked one, so the fence arrives with the next spawn instead of
//      waiting for a resume.
//   3. A parked session is resumable BY A PEER'S MESSAGE. The whole point is that the room's
//      audience changed while this session was not looking.
//
// ⚠ THE SIGNAL IS A POLL, NOT A PUSH, AND THAT IS RECORDED RATHER THAN GLOSSED. Roster changes
// do not reach the desktop MAIN process at all today: `channel-listener.js` subscribes only
// `channel_messages` and `channel_launch_directives`, and `ui-sync.js` forwards a table NAME to
// the RENDERER for the ONE workspace the UI is currently viewing. What DOES reach main, for every
// workspace, on every reconcile pass, is `GET /api/workspaces` — which since 2026-08-26 carries
// `memberCount` (added for the MCP directory lock, plan §4.4 B3). So this rides a read that
// already happens rather than adding a subscription. **The cost is up to one reconcile interval
// of latency**, which is acceptable precisely because this is not the fence: layer A has already
// tightened at the session's next tool call.

// ─── BEGIN PARK-ON-CLAIM-PURE ──────────────────────────────────────────────

/**
 * Which container ids became SHARED since the last pass?
 *
 * Takes the workspace list and the set of container ids ALREADY known to be shared, and answers
 * the newly-shared ones. Mutates nothing — the caller owns the memo.
 *
 * ⚠ IT ANSWERS EMPTY ON THE FIRST PASS, AND THAT IS THE DESIGN. `seen` is `null` for a
 * cold start, and every container that is already shared at app launch is recorded WITHOUT
 * firing: those sessions do not exist yet, and ending a room's sessions because the app
 * restarted would make a security notice indistinguishable from a routine boot.
 *
 * 🔒 ⚠ AN ABSENT `memberCount` COUNTS AS SHARED. `?? 0`, and zero is not solo — §8's
 * stale-cached-field rule INVERTED, the third place in this wave that applies it that way
 * (`session-credential.js › shouldLockSession` and `factory.ts › bootServer` are the others), for
 * the same reason: the field is new, and the reflex permissive fallback would silently disable
 * the whole behaviour against an older server. ⚠ Combined with the first-pass rule this is
 * strictly safe: an older server reports every container as shared on pass one, records them all,
 * and fires on none of them.
 *
 * ⚠ A container that drops BACK to one member (a peer leaves — §4A's departure-is-removal) is
 * removed from the set, so a LATER re-join fires again. That is one notice per arrival, which is
 * what the operator is actually being told about.
 *
 * Pure: no I/O, no require, no `process`.
 */
function newlySharedContainers(workspaces, seen) {
  const rows = Array.isArray(workspaces) ? workspaces : [];
  const shared = new Set();
  for (const w of rows) {
    if (!w || !w.id || w.kind !== 'link') continue;
    const members = typeof w.memberCount === 'number' ? w.memberCount : 0;
    if (members !== 1) shared.add(String(w.id));
  }
  // First pass: RECORD, never fire.
  if (!seen) return { shared: shared, newly: [] };
  const newly = [...shared].filter((id) => !seen.has(id));
  return { shared: shared, newly: newly };
}

/** The sessions this pass must stop: live, unsettled, and inside a newly-shared container. */
function sessionsToStop(liveSessions, newlyShared) {
  const targets = new Set(newlyShared || []);
  if (targets.size === 0) return [];
  return (Array.isArray(liveSessions) ? liveSessions : []).filter(
    (s) => s && s.workspaceId && targets.has(String(s.workspaceId)) && s.channelId
  );
}

/**
 * What the operator is told. ONE notice per container per arrival, naming the count rather than
 * the person — the peer's display name is not on the workspace row this ran off, and inventing a
 * second read to fetch it would put a name in a banner the operator can already see in the
 * channel.
 */
function claimNotice(count) {
  const n = Number(count) || 0;
  return {
    title: 'Someone joined this channel',
    body:
      n === 1
        ? 'A person just joined a channel your agent was working in, so that session was ended. Start a new one and it will only reach knowledge you have shared into the channel.'
        : `A person just joined a channel ${n} of your agent sessions were working in, so those sessions were ended. Start new ones and they will only reach knowledge you have shared into the channel.`,
  };
}

// ─── END PARK-ON-CLAIM-PURE ────────────────────────────────────────────────

/** `null` until the first reconcile records a baseline — see `newlySharedContainers`. */
let seenShared = null;

/**
 * IS THIS CONTAINER SHARED, as of the last reconcile pass that answered?
 *
 * ⚠ A READ OF THE MEMO THIS MODULE ALREADY KEEPS, AND THAT IS WHY IT LIVES HERE (2026-09-02,
 * ruling B7). `newlySharedContainers` recomputes `kind === 'link' && memberCount !== 1` on every
 * pass and stores the answer; a caller that re-read `GET /api/workspaces` to ask the same question
 * would be a FOURTH copy of that predicate (`session-credential.js › shouldLockSession` and
 * `factory.ts › bootServer` are the other two) plus a network round trip inside a spawn.
 *
 * 🔒 ⚠ UNKNOWN COUNTS AS SHARED, in both of its spellings — no baseline yet, and no id named.
 * This is the same INVERTED stale-field direction the whole module already takes, and here the
 * cost of each answer is asymmetric: the caller is `tool-profiles.js › profileForContainer`, so
 * "shared" only ever removes the SHELL from a launch, while "solo" would hand a stranger's room a
 * session that has one. ⚠ It is not reachable in practice — a directive spawn needs a WATCHED
 * channel, which needs a reconcile that has already called `noteWorkspaces` — which is exactly
 * why it needed to be written down rather than left to the caller.
 *
 * ⚠ IT ANSWERS ABOUT CONTAINERS, NOT CHANNELS, and a `kind='standard'` workspace is therefore
 * never "shared" here however many members it has. That is this predicate's shipped meaning on
 * all three of its readers, not a judgement about standard workspaces — F-513 carries the gap.
 */
function isSharedContainer(workspaceId) {
  const id = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (!id || !seenShared) return true; // fail closed: unknown is not solo
  return seenShared.has(id);
}

/**
 * Called once per reconcile pass with the workspace list that pass already fetched.
 *
 * ⚠ LAZY `require`s, both of them. `session-engine.js` is at the 500-line cap and cannot take a
 * bind line, and a top-level require of it from a module the LISTENER requires would close a
 * cycle. The tray does exactly this, for exactly this reason.
 *
 * ⚠ BEST-EFFORT THROUGHOUT. This runs inside the reconcile pass that keeps every channel loop
 * alive; a throw here would take the listener down to end a session, which is a worse outcome
 * than the one it is preventing.
 */
function noteWorkspaces(workspaces, diag) {
  const log = typeof diag === 'function' ? diag : () => {};
  let ended = 0;
  try {
    const { shared, newly } = newlySharedContainers(workspaces, seenShared);
    const first = seenShared === null;
    seenShared = shared;
    if (first || newly.length === 0) return 0;

    const engine = require('./session-engine');
    const targets = sessionsToStop(engine.listLiveSessions(), newly);
    for (const s of targets) {
      try {
        engine.controlByTask({ channelId: s.channelId, taskId: s.taskId, agentId: s.agentId, action: 'end' });
        ended += 1;
      } catch (err) {
        log('park-on-claim: could not end session', s.key, err && err.message);
      }
    }
    log('park-on-claim: container(s) gained a peer —', newly.length, 'container(s),', ended, 'session(s) ended');
    if (ended > 0) notifyOperator(ended, log);
  } catch (err) {
    log('park-on-claim: pass failed —', (err && err.message) || err);
  }
  return ended;
}

/**
 * ⚠ A BANNER IS NEVER LOAD-BEARING (`notify-action.js`'s standing rule), and this one has no
 * durable surface behind it beyond the ended pills the Agents tab already shows. It carries NO
 * action button — there is nothing for the operator to decide, the sessions are already gone —
 * so it is the passive shape (`task-notify.js`'s), not the actionable one.
 */
function notifyOperator(count, log) {
  try {
    const { Notification } = require('electron');
    if (!Notification || !Notification.isSupported()) return;
    const { title, body } = claimNotice(count);
    new Notification({ title: title, body: body, silent: true }).show();
  } catch (err) {
    log('park-on-claim: notification failed —', err && err.message);
  }
}

/** Test seam: drop the memo so a suite can replay a cold start. */
function resetForTests() {
  seenShared = null;
}

module.exports = {
  newlySharedContainers,
  isSharedContainer, // B7: the memo, read by the launch lane's profile narrowing
  sessionsToStop,
  claimNotice,
  noteWorkspaces,
  resetForTests,
};
