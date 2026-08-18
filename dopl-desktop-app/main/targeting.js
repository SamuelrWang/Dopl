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
//   2. absent → FYI / ignore. NEVER a trigger, at any member count, any author kind.
//   3. `metadata.intent === 'chat'` triggers NOBODY, on the same terms.
// authorKind must be 'user' or 'agent'; anything else ('system') → ignore.
// ⚠ ADDRESSING IS EXPLICIT NOW, AND RULE 2 IS THE WHOLE OF FAIL-CLOSED. The IMPLICIT
// 1:1 trigger — a known-exact memberCount of 2 plus explicit membership — was REMOVED
// 2026-08-18, together with the server-side DM auto-address it paired with. An ask that
// names nobody reaches nobody, in a DM exactly as in a group channel; the one surface
// that raises an agent request is the web app's New agent thread panel, which always
// names its addressees. Do NOT reinstate a count-keyed trigger: it made the ROSTER a
// behaviour, so one ghost membership row silently changed what a message did.
// ⚠ SHIP ORDER, INVARIANTS §13: the WEB half deploys FIRST. An old desktop against a new
// server keeps triggering on 2-member channels until it updates, which is noisy and safe;
// a new desktop against an old server is the direction that breaks.

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

  // ⚠ THE MEMBER COUNT IS NO LONGER READ. It keyed the implicit 1:1 trigger, retired
  // 2026-08-18 — see the header. `listener-messages.js` still LOGS it as diagnostics.
  // Only an explicit `isMember: false` blocks (public channel the operator sees but is not
  // in); a missing field degrades to member so DTO drift cannot silently stop answering.
  const isMember = !(entry.channel && entry.channel.isMember === false);
  // ⚠ `isDirect` USED TO BE READ HERE and its comment said a DIRECT channel addresses
  // EVERY post automatically, so `to_user_id` there was not evidence anybody addressed
  // anybody. It was already dead when the branch that needed it went; the SERVER
  // behaviour it described was removed 2026-08-18 with the DM auto-address. A direct
  // channel is now just a channel with two members, and `to_user_id` means the same
  // thing in it as anywhere else.

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
  // suppress) and BEFORE every branch that can return 'trigger'. It no longer STOPS anything
  // an unaddressed post could otherwise do — the implicit 2-member rule it used to brake is
  // retired — but it still says which of FYI and ignore an unaddressed post takes, and it
  // still tells the receiving side the sender MEANT to reach nobody.
  if (isChatIntent(m)) return isMember ? 'fyi' : 'ignore';
  if (toUserId) {
    // Explicit address always prompts — USER *and* AGENT authors.
    if (toUserId === myId) return 'trigger';
    if (toUserId === m.authorUserId) return 'ignore'; // self-addressed noise
    return isMember ? 'fyi' : 'ignore';
  }
  // UNADDRESSED — FYI (member) / ignore. ONE branch now, for every author kind.
  // ⚠ THE SECOND CLAUSE OF THIS COMMENT WAS FALSE IN EVERY DM, and the reason it was
  // false is GONE. It used to claim a responder's unaddressed reply landed here as FYI;
  // in a DIRECT channel `resolvePostMetadata` fell back to
  // `peerUserId`, so `to_user_id` WAS stamped, the addressed rule above claimed the
  // message and this branch was never reached. What braked a DM was `intent:"chat"`
  // above (stamped by channel-post.postCourtesy). ⚠ HISTORY, NOT BEHAVIOUR: that
  // fallback was REMOVED 2026-08-18 in the same change as the implicit 1:1 trigger, so an
  // unaddressed DM post really does arrive here now — which is why the LOOP BRAKE that
  // used to be an agent-only special case is simply the rule.
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
