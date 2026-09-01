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
// classify() returns 'trigger' (consent prompt + maybe spawn), 'fyi' (THE MENTION ESCALATION —
// a silent notify), 'task-reply' (passive news) or 'ignore'.
// FAIL CLOSED: unknown identity or my own message → ignore.
//   1. metadata.to_user_id present → trigger only if it equals me; else FYI (tagged me) /
//      ignore. USER *and* AGENT authors — an agent explicitly addressed to me is the core
//      Channels use case and MUST trigger.
//   2. absent → FYI (tagged me) / ignore. NEVER a trigger, at any member count, any author kind.
//   3. `metadata.intent === 'chat'` triggers NOBODY, on the same terms.
// authorKind must be 'user' or 'agent'; anything else ('system') → ignore.
// ⚠ 'fyi' IS NO LONGER "A MESSAGE I CAN SEE" — IT IS "A MESSAGE THAT @-TAGGED ME"
// (2026-08-18, wiring plan Phase 7). Every 'fyi' return is conjoined with `mentionsMe`, so a
// post I can read but was not tagged in classifies 'ignore' and raises NO desktop notification.
// Most thread traffic is agents talking to each other; the operator does not need a popup per
// message. THE TAG IS THE ESCALATION, THE TAGS INBOX IS THE RECORD — an untagged post is still
// listed, read and rendered on the web; only the OS banner is gone.
// ⚠ EXPLICIT ADDRESSING IS STILL AN ESCALATION AND STILL NOTIFIES, through 'trigger' and the
// consent notification behind it. An addressed request is a decision somebody is waiting on and
// the consent → launch flow DEPENDS on that notification arriving; gating it on a tag would
// hide requests behind whether the sender happened to type a name.
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
// ⚠ CHAT_INTENT lives INSIDE the function on purpose: several harnesses slice this file with a
// `function <name>` brace-matcher and a module-level const would be a free variable each must
// plumb in. ⚠ THE SET IS A MEASUREMENT, NOT A NUMBER TO COPY — it has been wrong here before:
// `grep -rln "extractFn(TARGETING\|extractFn(\"classify\"\|fnOf(targeting" test/` finds every
// one, and any of them missing a hoisted free variable throws only when a fixture reaches
// the line that reads it.
function isChatIntent(m) {
  const CHAT_INTENT = 'chat';
  return (m && m.metadata ? m.metadata.intent : undefined) === CHAT_INTENT;
}

// TRUE iff the server's stamped mention set for this message names ME.
// ⚠ TWO READERS, ONE PREDICATE — the same rule isChatIntent carries: classify gates its 'fyi'
// verdict on this, and listener-messages.js gates the passive TASK-REPLY notice on it (that
// verdict is a routing statement as well as a notice, so it cannot be gated inside classify
// without losing the suppression it exists for). A second copy of this comparison is how two
// readers come to disagree about whether one post was an escalation.
// ⚠ READ IT THE WAY to_user_id IS READ — a RESERVED, SERVER-STAMPED key. The web strips any
// caller copy unconditionally and re-stamps only its own parse of the BODY against this
// channel's roster (src/features/channels/server/service-writes-metadata-mentions.ts
// resolveBodyMentions, INVARIANTS §5), so it is unspoofable. That is the ONLY reason a
// notification may hang off it: a caller-settable mention set is a notification-forgery
// primitive. It is also why the desktop never re-parses the body — one parser, on the server.
// ⚠ ABSENT MEANS TAGS NOBODY, which is the shape of every row written before Phase 6, so this
// fails toward SILENCE and never toward noise. A missed banner is recoverable from the Tags
// inbox; a banner nobody can stop is not.
// ⚠ MENTIONS_KEY lives INSIDE the function, on isChatIntent's terms: the harnesses slice this
// file with a `function <name>` brace-matcher and a module-level const would be a free variable
// every one of them must plumb in. Restated from src/features/channels/lib/mentions.ts
// MENTIONS_METADATA_KEY; a non-array value reads as no mention rather than being trusted.
function mentionsMe(m, myId) {
  const MENTIONS_KEY = 'mentionedUserIds';
  if (!myId) return false;
  const ids = m && m.metadata ? m.metadata[MENTIONS_KEY] : undefined;
  if (!Array.isArray(ids)) return false;
  for (let i = 0; i < ids.length; i++) {
    if (typeof ids[i] === 'string' && ids[i].trim() === myId) return true;
  }
  return false;
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
  // TASK-REPLY, requester side: an inbound reply on a task I created, addressed back to me,
  // is passive news — no consent, no spawn, silent notification only. task* keys are stamped
  // SERVER-SIDE so they cannot be spoofed. taskCreatedBy === me separates REQUESTER from
  // RESPONDER; taskTarget === author binds the suppression to the responder, so a THIRD
  // member posting into my task still triggers. Sits BEFORE the addressed rules.
  // ⚠ EVERY MODE AND EVERY AUTHOR KIND (widened 2026-08-20, Samuel's ruling retiring the
  // session window —
  // retirement). This carried `taskMode === 'interactive'` and `authorKind === 'agent'`
  // conjuncts when the requester ran a live session window that consumed replies first: an
  // autonomous-mode or human-authored reply was left to the addressed rule so the window
  // lane could claim it. With that lane retired, either conjunct failing turned the
  // counterparty's reply IN MY OWN THREAD into a consent card against myself. A reply is
  // read in the thread view; the exchange's decidable surface is the ASK, not its answers.
  if (
    metaStr(m, 'taskId') &&
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
  // could claim one. It comes from the LOCAL registry of threads *I* opened. Every author
  // kind, same as the first-class branch above (widened 2026-08-20). Fails safe toward
  // 'trigger' (unknown id, restart, unclassified first-watch backlog all fall to the addressed
  // path where consent is the net). ⚠ "cap eviction" was in that list until 2026-08-20 and is
  // not a thing that happens: the concurrency ceiling REFUSES a launch, it never reclaims a
  // live session, so no thread is ever silently un-tracked by it.
  if (
    toUserId === myId &&
    knownLegacyReply(m, myId)
  ) return 'task-reply';
  // CHAT — a post that declared it addresses nobody triggers nobody.
  // ⚠ POSITION IS LOAD-BEARING: after the two task-reply branches (passive notices, nothing to
  // suppress) and BEFORE every branch that can return 'trigger'. It no longer STOPS anything
  // an unaddressed post could otherwise do — the implicit 2-member rule it used to brake is
  // retired — but it still says which of FYI and ignore an unaddressed post takes, and it
  // still tells the receiving side the sender MEANT to reach nobody.
  // ⚠ AND `mentionsMe` SINCE PHASE 7: chat that tags nobody here is exactly the traffic the
  // mention gate exists to silence, and chat that tags ME is the human-to-human case the
  // policy says DOES notify (a DM notifies when you are tagged, same as a group channel).
  if (isChatIntent(m)) return isMember && mentionsMe(m, myId) ? 'fyi' : 'ignore';
  if (toUserId) {
    // Explicit address always prompts — USER *and* AGENT authors.
    if (toUserId === myId) return 'trigger';
    // Self-addressed noise. ⚠ A TAG DOES NOT RESCUE IT, deliberately: a post whose declared
    // addressee is its own author is malformed rather than an escalation, and this branch is a
    // loop brake. Reordering the tag above it would be a NEW rule, not this phase's.
    if (toUserId === m.authorUserId) return 'ignore';
    // Addressed to a THIRD party. Tagging me inside somebody else's request is still a tag.
    return isMember && mentionsMe(m, myId) ? 'fyi' : 'ignore';
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
  // ⚠ AND SINCE PHASE 7 THE FYI HALF IS MENTION-GATED TOO, which is where the bulk of the
  // retired per-message notifications lived: an agent posting into a thread it shares with
  // another agent lands here every turn, and none of it is for the operator unless it says so.
  return isMember && mentionsMe(m, myId) ? 'fyi' : 'ignore';
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
//
// ⚠ THIS LIST IS CUSTODY AND MUST NOT GROW A VENDOR WORD (2026-08-31, adapter port step 1).
// It is an ARRAY MEMBERSHIP test, so adding `codex` / `cursor` as siblings would not widen the
// set — it would drop every non-Claude session OUT of it, because those sessions still stamp
// `desktop-session` and the vendor word would never appear in `metadata.runtime` at all. A
// Dopl-driven Codex session IS a session this app spawned, and this predicate is asking exactly
// that. Which RUNTIME drives it is the separate `X-Dopl-Vendor` dimension
// (`src/shared/auth/runtime-header.ts › VENDOR_HEADER`), which the MCP server's prose reads and
// nothing here does.
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
  // ⚠ ONE reader, not two (corrected 2026-08-20): `classify`'s chat branch. This line said
  // "AND by listener-messages' dispatch guard", which is `mentionsMe`'s fact, copied onto its
  // neighbour — listener-messages names `isChatIntent` in PROSE only. Exported for the
  // extraction harnesses, which slice it by name.
  isChatIntent,
  mentionsMe, // read by classify's fyi verdict AND by listener-messages' task-reply notice gate
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
