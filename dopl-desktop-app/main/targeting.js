// Channels listener — message targeting + window handoff.
//
// SPLIT NOTE (§2 refactor): extracted from channel-listener.js. Holds the
// targeting classifier (`classify`/`metaStr`), the tool-profile resolver, and the
// notification→window handoff (`openChannelForEntry` + the `handlers` it uses).
//
// CRITICAL: test/classify.test.mjs reads THIS file and evaluates the `classify`
// and `metaStr` function bodies verbatim (they are private / non-exported). Keep
// them as plain top-level `function` declarations with no braces inside their
// strings/comments/regex, or the test's brace-balancing extractor breaks.

let handlers = {}; // window-control callbacks from index.js (openChannel)

// Register window-control callbacks (from index.js) used when a notification is
// clicked: openChannel(workspaceSegment) shows the window + navigates the webview.
function setHandlers(h) {
  handlers = h || {};
}

function truncate(s, n = 240) {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// A trimmed non-empty string from message metadata, else ''.
function metaStr(m, key) {
  const v = m && m.metadata ? m.metadata[key] : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

// ── Targeting classification (Feature A) ─────────────────────────────────────
// Returns 'trigger' (prompt for consent + maybe spawn), 'fyi' (silent notify
// only), or 'ignore'. FAIL CLOSED: unknown identity or my own message → ignore.
//   1. metadata.to_user_id present → trigger only if it equals me; else FYI
//      (multi-member) / ignore. Applies to USER *and* AGENT authors — an agent
//      EXPLICITLY addressed to me is the core Channels use case (one user's
//      agent asks another user's agent) and MUST trigger.
//   2. absent + USER author + exactly 2 members → implicit target (trigger).
//   3. absent + AGENT author → FYI (member) / ignore — never an implicit
//      trigger. This is the LOOP BRAKE (see the classify body).
//   4. absent + 3+ members → FYI only (documentation / chat), never a trigger.
// authorKind must be 'user' or 'agent'; anything else (e.g. 'system') → ignore.
// memberCount comes from the Channel DTO (refreshed on reconcile). The implicit
// 2-member trigger FAILS CLOSED: it fires only on a known-exact count of 2 and
// explicit channel membership — an absent/invalid count or unknown membership is
// treated as multi-member (FYI, no prompt). Rationale: a stale DTO must never
// mass-prompt a group channel (the exact bug addressing exists to prevent);
// addressed-to-me requests are unaffected and always trigger.
function classify(m, entry, myId) {
  // Guard / fail closed. Agent authors are NO LONGER rejected wholesale (that
  // dropped every ask-another-agent message before addressing was even checked);
  // authorKind must be 'user' or 'agent', so 'system' and friends still ignore.
  if (!m || m.kind !== 'message' || !m.authorUserId) return 'ignore';
  if (m.authorKind !== 'user' && m.authorKind !== 'agent') return 'ignore';
  if (!myId) return 'ignore';
  if (m.authorUserId === myId) return 'ignore';

  const rawCount = Number(entry.channel && entry.channel.memberCount);
  const knownTwo = Number.isFinite(rawCount) && rawCount === 2;
  // Only an explicit `isMember: false` blocks (public channel the operator can
  // see but is not in — never prompt/FYI for those); a missing field degrades
  // to member so a DTO field drift can't silently stop 1:1 answering.
  const isMember = !(entry.channel && entry.channel.isMember === false);

  const toUserId = metaStr(m, 'to_user_id');
  if (toUserId) {
    // Explicit address always prompts — for USER *and* AGENT authors. This is
    // the fix: an agent addressed to me triggers a consented answering turn.
    if (toUserId === myId) return 'trigger';
    if (toUserId === m.authorUserId) return 'ignore'; // self-addressed noise
    return isMember ? 'fyi' : 'ignore';
  }
  // LOOP BRAKE: an UNADDRESSED agent can never trigger — FYI (member) / ignore.
  // The responder posts its reply UNADDRESSED (author_kind=agent, no to_user_id
  // via postResult), so it lands here as FYI and cannot re-trigger the asker.
  // Loop-safe because every trigger is still consent-gated (a human clicks Allow
  // per hop) AND replies are unaddressed; only a deliberately-addressed follow-up
  // re-triggers, which is itself a consented turn. So a two-agent exchange can
  // never self-sustain without a human in the loop.
  if (m.authorKind === 'agent') return isMember ? 'fyi' : 'ignore';
  // Implicit 1:1 trigger (USER authors only) — but an explicit per-channel mute
  // ('none') wins over an IMPLICIT target: the sender never addressed us, and
  // the user asked for silence. Explicitly addressed requests above are never
  // suppressed.
  const scope = (entry.channel && entry.channel.myNotifyScope) || 'all';
  if (knownTwo && isMember) return scope === 'none' ? 'ignore' : 'trigger';
  return isMember ? 'fyi' : 'ignore';
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

module.exports = {
  setHandlers,
  truncate,
  metaStr,
  classify,
  openChannelForEntry,
  resolveToolProfile,
};
