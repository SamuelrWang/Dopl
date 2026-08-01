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
// (channel-listener.setHandlers, channel-agents / session-dispatch resolveToolProfile) is
// unchanged.

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
// channel DTO (the parallel track exposes the caller's own value like
// myNotifyScope). Absent/unknown → 'full' (documented default that preserves
// v1.1 behavior). session-spawner maps the profile to concrete --allowedTools.
function resolveToolProfile(channel) {
  const p =
    (channel && (channel.myAgentToolProfile || channel.agentToolProfile)) || 'full';
  return p === 'read_only' || p === 'dopl_only' || p === 'full' ? p : 'full';
}

module.exports = { setHandlers, openChannelForEntry, resolveToolProfile };
