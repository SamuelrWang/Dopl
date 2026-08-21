// Session dispatch — the listener's pre-classify routing.
//
// ⚠ ONE ROUTE SURVIVES (2026-08-20, F-228). This file held FIVE, and four of them opened on
// `if (!settings.getWindowMode()) return false;` — the master switch Samuel's live-test ruling
// turned permanently off. They are deleted with the machinery they drove:
//
//   (2) maybeOpenRequesterSession   MY OWN thread opener minted a REQUESTER WINDOW on MY OWN
//                                   machine and launched my agent against my own message. This
//                                   is the self-trigger bug the retirement was ruled from.
//   (3) maybeSurfaceRequesterReply  a peer reply on a thread I requested, HELD at that window's
//                                   inbound gate. No window, no gate, no hold.
//   (4) noteRequestLifecycle        advanced the request STRIP in the window chrome.
//   (5) maybeReopenAddressedThread  a peer follow-up reopened the window that answered it,
//                                   via the shell-recreate lane.
//
// `diagRuntimeGateSkip`, `REQUEST_MILESTONES`, `exchangeTag` and `reopenableRecord` were
// helpers of those four alone and went with them.
//
//   (1) feedLiveSession — a LIVE session for this (channel,task) consumes an inbound
//       COUNTERPARTY reply as its NEXT TURN. ⚠ DELIBERATELY UNGATED, and it always was: it
//       claims nothing into existence, and a live session's own existence is the gate. ⚠ ONLY
//       the task's actual other party feeds; a THIRD member in the same channel can never
//       inject a turn. `myUserId` is passed in (the listener owns identity resolution); a null
//       identity fails closed.

const targeting = require('./targeting');
const io = require('./listener-io');
const sessionEngine = require('./session-engine');
const { diag } = require('./diag');

// ─── BEGIN SESSION-DISPATCH-PURE (routing; unit-tested via source extraction) ──

// WHO WROTE THIS MESSAGE, for the wrapper a session is fed it inside.
// ⚠ `io.displayNameFor` names the ACCOUNT a post came from, and a peer's AGENT posts from the
// peer's account — so "<name> replied in the channel…" credits a person for a machine's words.
// `author_kind` tells the two apart and is derived server-side from the caller's credential,
// never claimed on the wire.
// ⚠ Inside the PURE block on purpose: the truth tables slice this block whole and drive the
// real routes, so a helper the routes call must be sliced with them.
function authorLabel(m) {
  const person = String((io.displayNameFor(m && m.authorUserId)) || '').trim();
  if (!(m && m.authorKind === 'agent')) return person;
  return person ? person + "'s agent" : 'an agent';
}
// Node-only routing — every dependency (settings, targeting, sessionEngine, io, notifyLocal,
// diag) is a module-scope binding the test injects, so the truth table is pinned with no
// host-bound import.

function feedLiveSession(entry, m, myUserId) {
  // ⚠ NOT gated on window mode (2026-08-20): windowless sessions are the live sessions
  // now, and a live session's own existence is the gate — nothing here MINTS one.
  // ⚠ THE kind FILTER IS THE LAST WORD ON THIS MACHINE — a non-'message' post reaches no
  // session at all. Safe only because the server refuses task_* kinds from an agent
  // (service-writes.assertLifecycleKindIsServerOwned), so prose can no longer ride in one. What
  // still arrives is a LIFECYCLE marker (a statement about a SESSION, not a person speaking) or
  // a `task_progress` MILESTONE (feeding those spends one peer turn per milestone, on a stream
  // the product tells agents to post freely). Widening it also un-does the loop brake where a
  // loop is cheapest to start. Rendering is unaffected: the web transcript still draws
  // milestones (components/channels-v2/transcript.tsx, via `view-model.ts`). The files this
  // comment used to name — lib/group-thread.ts, components/activity-event-row.tsx — were
  // deleted in wiring plan Phases 5 and 12; the milestone lane itself was never touched.
  if (!m || m.kind !== 'message') return false;
  if (!myUserId || m.authorUserId === myUserId) return false;
  const taskId = targeting.firstClassTaskId(m);
  if (!sessionEngine.hasLiveSession({ channelId: entry.channel.id, taskId })) return false;
  // ⚠ Feed ONLY the session's actual counterparty (the task's other party).
  const counterparty = sessionEngine.counterpartyFor({ channelId: entry.channel.id, taskId });
  if (!counterparty || m.authorUserId !== counterparty) return false;
  return sessionEngine.feedInbound({
    channelId: entry.channel.id,
    taskId,
    message: m.body,
    seq: m.seq, // the turn's seq — the windowless outbound bridge's thread join
    authorName: authorLabel(m), // the AUTHOR, not just the account — see authorLabel
  });
}

// ─── END SESSION-DISPATCH-PURE ─────────────────────────────────────────────────

module.exports = { feedLiveSession };
