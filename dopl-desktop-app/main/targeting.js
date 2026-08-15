// Channels listener — message targeting + window handoff.
//
// ⚠ CRITICAL: test/classify.test.mjs (plus main-audit-targeting / task-notify /
// wake-external-requester) reads THIS file and evaluates the `classify` and `metaStr` function
// bodies verbatim. Keep them plain top-level `function` declarations with NO braces inside
// their strings/comments/regex, or the brace-balancing extractor breaks. classify also calls
// into the LEGACY-THREADS block, sliced whole between its BEGIN/END sentinels.

// ⚠ Required at module scope and NEVER referenced from classify — that is what keeps the
// brace-balancing extractors above workable.
const win = require('./targeting-window');

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
// classify() returns 'trigger' (consent prompt + maybe spawn), 'fyi' (silent notify), or
// 'ignore'. FAIL CLOSED: unknown identity or my own message → ignore.
//   1. metadata.to_user_id present → trigger only if it equals me; else FYI (multi-member) /
//      ignore. USER *and* AGENT authors — an agent explicitly addressed to me is the core
//      Channels use case and MUST trigger.
//   2. absent + USER author + exactly 2 members → implicit target (trigger).
//   3. absent + AGENT author → FYI / ignore, never an implicit trigger. LOOP BRAKE.
//   4. absent + 3+ members → FYI only, never a trigger.
//   5. `metadata.intent === 'chat'` triggers NOBODY, at any member count, any author kind.
// authorKind must be 'user' or 'agent'; anything else ('system') → ignore.
// ⚠ The implicit 2-member trigger FAILS CLOSED: known-exact count of 2 AND explicit
// membership. Absent/invalid count or unknown membership => multi-member (FYI). A stale
// Channel DTO must never mass-prompt a group channel.

// The `intent="chat"` marker.
// ⚠ TWO READERS, ONE PREDICATE: listener-messages.js asks the same question BEFORE classify
// runs (two of its three pre-classify routes START a session). A second copy of the
// comparison is how the readers previously disagreed about the same post.
// ⚠ READ RAW, NOT THROUGH metaStr: metaStr TRIMS, right for an id and wrong for a reserved
// server-validated enum. Restated from src/features/channels/schema.ts MessageIntentSchema.
// Fails toward today's behaviour — only the exact string answers true, so an absent intent
// (older server/desktop, MCP surface) is a request.
// ⚠ CHAT_INTENT lives INSIDE the function on purpose: three harnesses slice this file with a
// `function <name>` brace-matcher (test/_classify-harness.mjs, test/main-audit-targeting,
// test/live/desktop.js) and a module-level const would be a free variable each must plumb in.
function isChatIntent(m) {
  const CHAT_INTENT = 'chat';
  return (m && m.metadata ? m.metadata.intent : undefined) === CHAT_INTENT;
}

function classify(m, entry, myId) {
  // Guard / fail closed. ⚠ The `kind !== 'message'` guard DROPS milestones and lifecycle
  // markers silently — safe only because the server refuses task_* kinds from an agent, so
  // prose can no longer ride in one. session-dispatch.feedLiveSession states the same rule.
  if (!m || m.kind !== 'message' || !m.authorUserId) return 'ignore';
  if (m.authorKind !== 'user' && m.authorKind !== 'agent') return 'ignore';
  if (!myId) return 'ignore';
  if (m.authorUserId === myId) {
    // ⚠ My OWN addressed message is the only place this machine ever learns which LEGACY
    // threads it opened, so record on the way past. Still 'ignore' for targeting.
    noteMyLegacyThread(m, entry, myId);
    return 'ignore';
  }

  const rawCount = Number(entry.channel && entry.channel.memberCount);
  const knownTwo = Number.isFinite(rawCount) && rawCount === 2;
  // Only an explicit `isMember: false` blocks (public channel the operator sees but is not
  // in); a missing field degrades to member so DTO drift cannot silently stop 1:1 answering.
  const isMember = !(entry.channel && entry.channel.isMember === false);
  // ⚠ In a DIRECT channel the server addresses EVERY post automatically, so `to_user_id`
  // there is not evidence anybody addressed anybody.
  const isDirect = !!(entry.channel && entry.channel.isDirect === true);

  const toUserId = metaStr(m, 'to_user_id');
  // TASK-REPLY, requester side: an inbound reply on an INTERACTIVE task I created, addressed
  // back to me, is passive news — no consent, no spawn, silent notification only. task* keys
  // are stamped SERVER-SIDE so they cannot be spoofed. taskCreatedBy === me separates
  // REQUESTER from RESPONDER; taskTarget === author binds the suppression to the responder,
  // so a THIRD member posting into my task still triggers. Sits BEFORE the addressed rules.
  // ⚠ AGENT-ONLY. This predicate is exactly the shape of a HUMAN responder @-tagging the
  // requester back, and a passive notice has no consent row and no Accept — a person's
  // addressed message would be swallowed into a banner. A 'user' author must fall through to
  // the addressed rule and return 'trigger'.
  if (
    m.authorKind === 'agent' &&
    metaStr(m, 'taskId') &&
    metaStr(m, 'taskMode') === 'interactive' &&
    toUserId === myId &&
    metaStr(m, 'taskCreatedBy') === myId &&
    metaStr(m, 'taskTarget') === m.authorUserId
  ) return 'task-reply';
  // LEGACY TASK-REPLY. The branch above only fires for FIRST-CLASS threads: taskMode /
  // taskCreatedBy / taskTarget are stamped ONLY from a resolved channel_tasks row, and a
  // legacy 'task-<channel>-<seq>' id is not a UUID (src/features/channels/server/
  // service-writes-metadata.ts resolvePostMetadata). Without this branch, a session answering
  // a legacy request posts a reply that looks like a fresh request on the requester's machine
  // and spawns a counter-session against itself.
  // ⚠ Provenance cannot come off the wire — a legacy id is caller-settable, so any member
  // could claim one. It comes from the LOCAL registry of threads *I* opened. Same AGENT-ONLY
  // rule as above. Fails safe toward 'trigger' (unknown id, cap eviction, restart, unclassified
  // first-watch backlog all fall to the addressed path where consent is the net).
  if (
    m.authorKind === 'agent' &&
    toUserId === myId &&
    knownLegacyReply(m, myId)
  ) return 'task-reply';
  // CHAT — a post that declared it addresses nobody triggers nobody.
  // ⚠ POSITION IS LOAD-BEARING: after the two task-reply branches (passive notices, nothing to
  // suppress) and BEFORE every branch that can return 'trigger'. Chat is the composer's
  // DEFAULT and under it the server stamps no to_user_id, so without this an ordinary
  // "sounds good" in a DM falls into the implicit 2-member rule and spawns an ASSIST session.
  if (isChatIntent(m)) return isMember ? 'fyi' : 'ignore';
  if (toUserId) {
    // Explicit address always prompts — USER *and* AGENT authors.
    if (toUserId === myId) return 'trigger';
    if (toUserId === m.authorUserId) return 'ignore'; // self-addressed noise
    return isMember ? 'fyi' : 'ignore';
  }
  // LOOP BRAKE: an UNADDRESSED agent can never trigger — FYI (member) / ignore.
  // ⚠ THE SECOND CLAUSE OF THIS COMMENT WAS FALSE IN EVERY DM. It claimed the responder's
  // unaddressed reply lands here as FYI. In a DIRECT channel `resolvePostMetadata` falls back to
  // `peerUserId`, so `to_user_id` IS stamped, the addressed rule above claims the message and
  // this branch is never reached. What brakes a DM is `intent:"chat"` above (stamped by
  // channel-post.postCourtesy). This branch covers group channels and DM posts carrying an
  // explicit intent.
  if (m.authorKind === 'agent') return isMember ? 'fyi' : 'ignore';
  // Implicit 1:1 trigger (USER authors only). ⚠ NOTHING SUPPRESSES IT — there is no
  // per-channel opt-out anywhere. The old `myNotifyScope` read was removed because two of its
  // three options were lies ('addressed' compared nowhere; 'none' never silenced an addressed
  // request). Do NOT reinstate that column; a quiet-in-one-channel feature must be designed.
  if (knownTwo && isMember) return 'trigger';
  return isMember ? 'fyi' : 'ignore';
}

// First-class (UUID) task id off an inbound message, else ''. Legacy task-<uuid>-<seq> ids are
// NOT UUIDs -> '' here, leaving taskIdFor's deterministic fallback path unchanged.
// ⚠ Mirrors the server's isUuid gate — keep in sync.
function firstClassTaskId(m) {
  const id = metaStr(m, 'taskId');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : '';
}

// ── Legacy thread registry ───────────────────────────────────────────────────
// Registry itself lives in legacy-threads.js. ⚠ Destructured HERE at module scope so
// classify's body calls `noteMyLegacyThread` / `knownLegacyReply` as free variables — the
// truth tables slice that body verbatim.
const {
  LEGACY_THREAD_CAP,
  LEGACY_THREAD_TTL_MS,
  LEGACY_THREAD_KEY,
  legacyThreadId,
  noteMyLegacyThread,
  knownLegacyReply,
  useLegacyThreadStore,
} = require('./legacy-threads');


// ── The two DESKTOP runtime stamps (src/shared/auth/runtime-header.ts) ───────
// `desktop-session` — a session THIS APP spawned (sdk-loader / mcp-config send the header on
//   the device token).
// `desktop-ui` — the operator typing in this app's own UI window. Posts leave main, not the
//   renderer (main/ui-bridge.js builds every header; the preload exposes none), on the
//   operator's SESSION credential — the server refuses that value to any agent credential.
// Both are SERVER-written into the reserved `metadata.runtime` key; a caller-supplied copy in
// the message body is always stripped.
const DESKTOP_RUNTIMES = ['desktop-session', 'desktop-ui'];

// TRUE iff this message carries one of the two stamps this app produces.
function desktopRuntime(m) {
  return DESKTOP_RUNTIMES.indexOf(metaStr(m, 'runtime')) !== -1;
}

// ── Spawn-with-handoff ───────────────────────────────────────────────────────
// TRUE iff this message's create DECLARED a handoff — an EXTERNAL agent (the operator's own
// Claude Desktop / Claude Code over MCP) asking that the driving session open on THIS machine.
// `handoff` is a RESERVED metadata key: the server strips any caller copy and re-stamps only
// from the validated create_thread field (src/features/channels/server/
// service-writes-metadata.ts), so read `=== true`, the strict boolean the server writes.
// ⚠ ROUTING HINT, NOT AUTHORIZATION: requesterTaskOpen still demands the unforgeable identity
// pair (author === me AND task creator === me) around it.
function declaresHandoff(m) {
  return !!(m && m.metadata && m.metadata.handoff === true);
}

// ── Requester auto-open detector ─────────────────────────────────────────────
// TRUE iff this message is MY OWN first-class thread opener addressed to a peer, so the
// desktop opens a REQUESTER session window driving the thread. ⚠ Checked by the listener
// SEPARATELY from classify() and never inside classify's body — the 1536-case truth table
// depends on that. task* keys are stamped SERVER-SIDE, so they cannot be spoofed.
//
//   - firstClassTaskId(m) present   → a real first-class (UUID) task, not legacy.
//   - m.authorUserId === myId       → MY message.
//   - taskCreatedBy === myId        → I created the task (requester, not peer).
//   - a DESKTOP runtime stamp       → this app posted it; OR the create DECLARED a handoff,
//     OR a declared handoff           the operator asking an EXTERNAL session to hand the
//                                     thread to a window here.
//   - taskTarget present && !== me  → addressed to a PEER (a self-targeted task has no
//                                     counterparty to drive against).
// De-dupe, backlog suppression and the settled-set are the listener's job; pure predicate.
//
// ⚠ An unstamped create with NO handoff opens NOTHING, deliberately: the operator's external
// Claude Code session sends no runtime header and by default WAITS on the reply itself (a
// long-held MCP await). Opening a window would put two agents on one thread and let the
// window eat the reply the session was armed for.
// ⚠ The stamp is a ROUTING HINT, NOT AUTHORIZATION (src/shared/auth/runtime-header.ts
// §"Header-only, deliberately"): a device-token holder can set the header. Safe only because
// it fails CLOSED and is one conjunct of an AND whose identity checks are the real bound.
// A handoff substitutes for the stamp, NEVER for "this is MY OWN thread".
function requesterTaskOpen(m, myId) {
  if (!m || m.kind !== 'message' || !myId) return false;
  if (!firstClassTaskId(m)) return false;
  if (m.authorUserId !== myId) return false;
  if (metaStr(m, 'taskCreatedBy') !== myId) return false;
  // Stamp conjunct, OR a declared handoff in its place. Nothing else opens anything.
  if (!desktopRuntime(m) && !declaresHandoff(m)) return false;
  const target = metaStr(m, 'taskTarget');
  return !!target && target !== myId;
}

// TRUE iff the OPERATOR typed this in the app's UI, rather than one of their spawned sessions.
// One display-only use: arming the request lifecycle strip (Sent / Accepted / Declined /
// Replied). ⚠ Read ONLY alongside requesterTaskOpen, never as a gate of its own.
function requesterTypedByOperator(m) {
  return metaStr(m, 'runtime') === 'desktop-ui';
}

module.exports = {
  setHandlers: win.setHandlers,
  truncate,
  metaStr,
  classify,
  isChatIntent, // read by classify AND by listener-messages' dispatch guard
  firstClassTaskId,
  LEGACY_THREAD_CAP,
  LEGACY_THREAD_TTL_MS, // registry's two bounds, asserted by the truth tables
  LEGACY_THREAD_KEY,
  legacyThreadId,
  noteMyLegacyThread,
  knownLegacyReply,
  useLegacyThreadStore, // index.js injects electron-store at boot
  DESKTOP_RUNTIMES, // the two stamps this app produces
  declaresHandoff, // reserved handoff flag an external create may set
  requesterTaskOpen,
  requesterTypedByOperator, // lifecycle strip only
  openChannelForEntry: win.openChannelForEntry,
  resolveToolProfile: win.resolveToolProfile,
};
