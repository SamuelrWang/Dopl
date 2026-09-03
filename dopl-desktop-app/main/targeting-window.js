// Channels listener — the notification→window handoff, and the tool-profile resolver.
//
// §2 SPLIT (2026-07-31): targeting.js was at 493 lines and had to grow the CHAT suppression,
// so the two halves of it that are not the classifier moved here. What is left there is one
// thing — how a message is classified — and this is the other two: what a clicked notification
// DOES to the window, and which tool scope a session for this channel starts with.
//
// It is also the seam that keeps targeting.js's extraction harnesses honest. Four test files
// brace-balance `classify` / `metaStr` out of that source and evaluate them standalone, so
// anything living beside them has to be either in their evaluated scope or genuinely
// unrelated. These two are genuinely unrelated: neither is reachable from classify.
//
// Re-exported from targeting.js verbatim, so every existing caller
// (`channel-listener.setHandlers`, `session-dispatch`'s `resolveToolProfile`) is unchanged.
// `channel-agents.js` was a third caller and is deleted (channels rollback §1).

let handlers = {}; // window-control callbacks from index.js (openChannel)

// Register window-control callbacks (from index.js) used when a notification is
// clicked: openChannel(workspaceSegment, channelId) shows the window + navigates
// the renderer.
function setHandlers(h) {
  handlers = h || {};
}

// WIRING PLAN PHASE 9 — WINDOWING INVERTS, AND THIS IS THE SEAM IT INVERTS AT.
// A clicked notification used to be the thing that opened a NEW per-thread
// window; now it focuses the main app and lands on the channel the notification
// was about. The mechanism (show window + navigate) already existed; the CHANNEL
// is what this hop was throwing away — every caller's `entry` has carried
// `entry.channel.id` the whole time.
//
// ONE DESTINATION FOR EVERY PRODUCER, deliberately. Three call sites reach here
// — the inbound REQUEST notification (trigger.js), the silent FYI (trigger.js
// › sendFyi) and the passive task-reply notice (task-notify.js) — and the
// per-kind alternative would be the Inbox for requests only. The ruling names
// the channel first ("auto-navigates to the channel/DM where the request was
// made" — the port's intent doc, deleted at the Phase 12 cutover; the live
// statement is INVARIANTS §11), the Inbox is WORKSPACE-WIDE by construction and would discard the
// one fact the notification carried, and `entry` does not distinguish the kinds
// anyway. The sidebar's Inbox badge is visible the moment the operator lands.
//
// Wired from index.js; no-op until handlers are registered.
function openChannelForEntry(entry, opts) {
  try {
    if (!handlers.openChannel || !entry || !entry.workspaceSegment) return;
    // Never fabricated: an entry with no channel navigates to the page, which is
    // what this did for every entry until Phase 9. The id's character check is
    // the navigator's (shell-mode → deep-link-target.isSafeSegment), not ours.
    // 2026-08-20: an optional THREAD lands the operator on the thread view —
    // the outbound send box's home — over the same one destination.
    handlers.openChannel(
      entry.workspaceSegment,
      (entry.channel && entry.channel.id) || null,
      (opts && opts.threadId) || null
    );
  } catch (_) { /* window may be gone */ }
}

// ── Tool profile (Feature 6) ─────────────────────────────────────────────────
// The operator's own responding-agent tool scope for this channel, read from the
// channel DTO, which exposes the caller's OWN value under `myAgentToolProfile`.
// session-spawner maps the profile to concrete --allowedTools.
//
// C-11 (2026-08-08) — ONE DEFINITION OF "WHAT DOES AN UNKNOWN PROFILE MEAN", AND IT IS
// tool-profiles'. This function carried its OWN copy of the enum check and its own
// fallback, and that fallback was `'full'`: a DTO that had not refreshed, a non-member
// read, or any out-of-enum column value silently resolved to the WIDEST scope, with
// nothing logged — while `session-park.knownProfile`, one file over, answered the same
// question with `read_only` and called it fail-restrictive. Delegating removes the second
// answer rather than making it agree by hand, and the fail-closed report comes with it.
//
// `tool-profiles.js` has no top-level requires, so this costs targeting.js none of the
// dependency-freedom its four extraction harnesses rely on.
//
// The parallel track this used to name — `myNotifyScope` — no longer exists anywhere
// (F-170, 2026-08-08): the control, the schema field, the DTO and both runtime reads are
// gone, so pointing at it as the shape to follow would send the next reader looking for a
// field nothing sets.
const { normalizeProfile, profileForChannel } = require('./tool-profiles');

function resolveToolProfile(channel) {
  return normalizeProfile(channel && (channel.myAgentToolProfile || channel.agentToolProfile));
}

/**
 * IS THIS ROOM SHARED — i.e. is there a second audience for what a session here does?
 * (2026-09-02, Samuel's ruling on F-513.)
 *
 * ⚠ THE FACT IS THE CHANNEL'S MEMBER COUNT, NOT THE CONTAINER'S KIND, and the ruling is what
 * changed: ruling B7 says *"a session launched into a SHARED channel"*, and the predicate the
 * first lane borrowed — `session-park-on-claim.js › isSharedContainer`, `kind === 'link' &&
 * memberCount !== 1` — answers a DIFFERENT question. It called a nine-member `standard`
 * workspace solo, so the room with the most people in it was the one that kept its shell.
 * ⚠ THE OTHER TWO READERS OF THAT CONTAINER PREDICATE ARE UNCHANGED and must stay so: the
 * credential lock and the park-on-claim stop are both about the CLAIM lane, where a link
 * container gaining a peer IS the event. Same word, two questions; this one is the room's.
 *
 * 🔒 ⚠ AN ABSENT COUNT READS AS SHARED, matching every other stale-field direction on this
 * machine: the only thing this answer can do is REMOVE the shell from a launch, so an unknown
 * that reads "solo" would hand a stranger's room a session that has one. `!== 1` rather than
 * `> 1` says that in one term — 0 and `undefined` are the unknown, and only an exact 1 is solo.
 */
function isSharedChannel(channel) {
  const n = channel && typeof channel.memberCount === 'number' ? channel.memberCount : 0;
  return n !== 1;
}

/**
 * 🔒 THE PROFILE A LAUNCH INTO THIS CHANNEL REALLY STARTS AT — the channel's stored scope, with
 * ruling B7's narrowing already applied.
 *
 * ⚠ IT EXISTS BECAUSE THE RULE HAD THREE CALL SITES AND LANDED ON ONE (F-510). Every launch lane
 * on this machine — the directive spawn, the New Agent button and the responder trigger — reads
 * its profile through here, so "shared room ⇒ no shell" cannot be true on one lane and false on
 * the next. The C-11 argument, one level up: a rule spelled beside three resolvers is a rule two
 * of them will stop spelling.
 * ⚠ `resolveToolProfile` STAYS the stored read and is still exported — the narrowing is a
 * LAUNCH-TIME derivation and nothing writes it back, so the channel's own enum is still three
 * values and an operator who moves it moves what this reads.
 */
function resolveLaunchToolProfile(channel) {
  return profileForChannel(resolveToolProfile(channel), isSharedChannel(channel));
}

module.exports = {
  setHandlers,
  openChannelForEntry,
  resolveToolProfile,
  isSharedChannel,
  resolveLaunchToolProfile,
};
