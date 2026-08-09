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
// clicked: openChannel(workspaceSegment) shows the window + navigates the webview.
function setHandlers(h) {
  handlers = h || {};
}

// Open the app window and navigate the webview to the channel's page. Wired from
// index.js; no-op until handlers are registered.
function openChannelForEntry(entry) {
  try {
    if (handlers.openChannel && entry.workspaceSegment) handlers.openChannel(entry.workspaceSegment);
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
const { normalizeProfile } = require('./tool-profiles');

function resolveToolProfile(channel) {
  return normalizeProfile(channel && (channel.myAgentToolProfile || channel.agentToolProfile));
}

module.exports = { setHandlers, openChannelForEntry, resolveToolProfile };
