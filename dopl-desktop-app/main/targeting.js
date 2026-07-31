// Channels listener — message targeting + window handoff.
//
// SPLIT NOTE (§2 refactor): extracted from channel-listener.js. Holds the
// targeting classifier (`classify`/`metaStr`), the tool-profile resolver, and the
// notification→window handoff (`openChannelForEntry` + the `handlers` it uses).
//
// CRITICAL: test/classify.test.mjs (plus main-audit-targeting / task-notify /
// wake-external-requester) reads THIS file and evaluates the `classify` and
// `metaStr` function bodies verbatim. Keep them as plain top-level `function`
// declarations with no braces inside their strings/comments/regex, or the test's
// brace-balancing extractor breaks. classify also calls into the LEGACY-THREADS
// block below, which those harnesses slice whole between its BEGIN/END sentinels
// (it carries module state, so it cannot be extracted function by function).

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
  if (m.authorUserId === myId) {
    // Still 'ignore' for targeting. But my OWN addressed message is the only place
    // this machine ever learns which LEGACY threads it opened, so record it on the
    // way past (noteMyLegacyThread is a no-op for anything else). See the registry.
    noteMyLegacyThread(m, entry, myId);
    return 'ignore';
  }

  const rawCount = Number(entry.channel && entry.channel.memberCount);
  const knownTwo = Number.isFinite(rawCount) && rawCount === 2;
  // Only an explicit `isMember: false` blocks (public channel the operator can
  // see but is not in — never prompt/FYI for those); a missing field degrades
  // to member so a DTO field drift can't silently stop 1:1 answering.
  const isMember = !(entry.channel && entry.channel.isMember === false);

  const toUserId = metaStr(m, 'to_user_id');
  // TASK-REPLY (Feature 4, requester side): an inbound reply that belongs to an
  // INTERACTIVE task *I created* and is addressed back to me is passive news — a
  // reply landed — NOT a fresh request. It must not raise consent or spawn; the
  // dispatcher fires a silent notification instead. The task* keys are stamped
  // SERVER-SIDE (Q4), so they cannot be spoofed by the caller. taskCreatedBy ===
  // me separates the REQUESTER (this branch) from the RESPONDER (taskCreatedBy
  // !== me → falls through to today's 'trigger'); taskTarget === the author
  // binds the suppression to the RESPONDER specifically, so a THIRD member
  // posting into my task (author !== the task's target) still triggers instead
  // of being silently swallowed. This sits BEFORE the addressed rules so it wins
  // over the plain 'trigger'. Anything that is not interactive + mine +
  // addressed-to-me + authored-by-the-target (autonomous mode, an old message
  // with no taskMode, a non-message kind rejected by the guards above) falls
  // through UNCHANGED.
  //
  // AUDIT D1: the suppression is AGENT-ONLY. The predicate below is EXACTLY the shape of
  // a human responder @-tagging the requester back (the 1.7.9 peer-post path posts
  // authorKind 'user' with the same server-stamped task keys), and a passive notice has no
  // consent row, no gate and no Accept, so a person's addressed message could be swallowed
  // into a banner whenever the pre-classify routes missed it (no live session AND no
  // durable record or no window budget). A HUMAN addressing me always gates: a 'user'
  // author falls through to the addressed rule below and returns 'trigger'. Only the
  // AGENT reply this branch was designed for stays passive news.
  if (
    m.authorKind === 'agent' &&
    metaStr(m, 'taskId') &&
    metaStr(m, 'taskMode') === 'interactive' &&
    toUserId === myId &&
    metaStr(m, 'taskCreatedBy') === myId &&
    metaStr(m, 'taskTarget') === m.authorUserId
  ) return 'task-reply';
  // LEGACY TASK-REPLY (incident 2026-07-31). The branch above can only ever fire for a
  // FIRST-CLASS thread, because taskMode / taskCreatedBy / taskTarget are stamped ONLY
  // from a resolved channel_tasks row; a legacy 'task-<channel>-<seq>' id is not a UUID,
  // resolves to no row, and therefore carries NOTHING but the caller-set taskId itself
  // (src/features/channels/server/service-writes-metadata.ts resolvePostMetadata: the
  // four keys are deleted unconditionally and re-stamped only when `task` is non-null).
  // So a session answering a LEGACY request posts an addressed, agent-authored reply that
  // looks EXACTLY like a fresh request on the requester's machine, and the requester's
  // desktop opened consent + spawned a counter-session against its own reply.
  //
  // The missing bit is provenance, and it cannot come off the wire (a legacy id is
  // caller-settable, so any member could claim one). It comes from THIS MACHINE: the
  // registry below holds the legacy ids of threads *I* opened, computed from my own
  // outbound messages, which no peer can author. A reply tagged with one of those ids,
  // from the very member I addressed, back to me, is my own outstanding request being
  // answered. Same passive-notice outcome as the first-class branch, same AGENT-ONLY
  // rule (AUDIT D1: a human addressing me always gates).
  //
  // FAILS SAFE toward 'trigger', never toward silence: an unknown id, an id evicted by
  // the cap, a restart, or a first-watch backlog we never classified all leave the
  // message on today's addressed path, where the consent gate is the safety net.
  if (
    m.authorKind === 'agent' &&
    toUserId === myId &&
    knownLegacyReply(m, myId)
  ) return 'task-reply';
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

// A first-class (UUID) task id off an inbound message, else '' — the desktop
// threads its reply + lifecycle under it so a responder's turn groups into the
// requester's task card. Legacy task-<uuid>-<seq> ids are NOT UUIDs -> '' here,
// so the deterministic legacy id path (taskIdFor's fallback) is unchanged.
// Mirrors the server's isUuid gate so only a real first-class task threads.
function firstClassTaskId(m) {
  const id = metaStr(m, 'taskId');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : '';
}

// ── Legacy thread registry (incident 2026-07-31) ─────────────────────────────
// THE ONLY LOCAL RECORD OF A THREAD I OPENED WITHOUT create_thread.
//
// A legacy exchange has no channel_tasks row, so the server stamps NO task metadata
// for it at all: resolvePostMetadata deletes taskMode / taskCreatedBy / taskTitle /
// taskTarget unconditionally and re-adds them only from a resolved (UUID) task, and a
// 'task-<channel>-<seq>' id is not a UUID, so it resolves to nothing and is passed
// through verbatim (it is also NOT rejected: only an unresolved UUID 400s). The wire
// therefore tells the requester nothing about who owns a legacy thread.
//
// What the requester DOES own is the fact that it authored the opening message. The
// legacy id is deterministic from (channel, seq) alone (trigger.taskIdFor's fallback,
// and handleTrigger's futureTaskId), so this machine can compute the exact id a peer's
// desktop will mint for MY message the moment it sees that message go by, and store it
// with the member I addressed. Matching a later reply against that store is provenance
// no peer can forge, because no peer can author a message as me.
//
// DURABLE SINCE Q11, VIA AN INJECTED STORE. It used to be memory-only, on the argument
// that a miss costs only a consent prompt. In practice the miss it produced was a
// SPURIOUS one: quitting the app mid-exchange (or an update installing on quit) meant the
// peer's next reply — to a question this operator had already asked — raised a consent
// prompt for their own outstanding request. One restart, one bogus prompt, every time.
//
// So the registry now round-trips through electron-store. THE PERSISTENCE IS INJECTED,
// never required: this module stays dependency-free so the truth tables can slice this
// block into a `new Function` scope, and index.js hands it the store at boot
// (useLegacyThreadStore). With no store injected the behavior is byte-for-byte the old
// in-memory registry, which is also what every unit test gets by default.
//
// Writes are rare by construction — only an OPENER writes, and openers are the messages
// that start an exchange, not every message that passes. The one read-triggered write is
// knownLegacyReply dropping an EXPIRED entry, which can happen at most once per entry.
//
// Bounded by LEGACY_THREAD_CAP *and* LEGACY_THREAD_TTL_MS (FIX S5), oldest evicted
// first, on load as well as on write — a banked id cannot be smuggled back in through
// the store file, and neither can an over-cap one.
//
// FIX S5 (Q5 review) — THE REGISTRY WAS FAR TOO BROAD, AND ENTRIES NEVER DIED.
//
// It recorded EVERY addressed message of mine, and in a DM the server auto-addresses
// every post (since v2.6), so in the ordinary 1:1 case that is literally every message
// the operator sends — each one minting a legacy id a peer may later claim. And
// `metadata.taskId` is CALLER-SETTABLE for a legacy id with no participation check
// (F-083: only the calm flags are gated), so a peer could stamp a genuinely NEW request
// with an old legacy id of mine and have it classified 'task-reply' — a passive banner
// with NO consent row, NO gate and NO Accept — for as long as the process lived.
//
// Two bounds close that, both in the fail-safe direction (a miss costs a consent
// prompt, never a swallowed message):
//   OPENERS ONLY. A message carrying an inbound taskId is a CONTINUATION, not the
//     start of a thread, so it opens nothing. The legacy id is derived from the
//     OPENER's seq, so a multi-turn exchange still matches the one record — every
//     later turn of mine carries `thread=<that id>` and is skipped here.
//   A TTL. Six hours: long enough for a real exchange (a session that runs longer than
//     that has a first-class thread), short enough that a legacy id cannot be banked
//     and replayed days later. The 500-entry cap stays as the memory bound.
//
// ─── BEGIN LEGACY-THREADS (sliced verbatim by the classify truth tables) ─────
const LEGACY_THREAD_CAP = 500;
const LEGACY_THREAD_TTL_MS = 6 * 60 * 60 * 1000;
const LEGACY_THREAD_KEY = 'legacyThreads'; // electron-store key (Q11)
const legacyThreads = new Map(); // legacy task id -> { owner, target, at }
// The injected persistence, or null for the in-memory registry. Duck-typed to
// { get(key), set(key, value) } so a test can hand in a plain object and this block
// never has to know electron-store exists.
let legacyStore = null;

// Write the live registry through. Map insertion order IS age order and JSON preserves
// array order, so a reload rebuilds the same eviction queue rather than a reshuffled
// one. A store that throws (a full or read-only disk) is swallowed: losing durability
// costs a consent prompt, and a targeting classifier must never fail on a disk error.
function saveLegacyThreads() {
  if (!legacyStore) return;
  const rows = [];
  for (const [id, rec] of legacyThreads) {
    rows.push({ id: id, owner: rec.owner, target: rec.target, at: rec.at });
  }
  try { legacyStore.set(LEGACY_THREAD_KEY, rows); } catch (_) { /* durability is best-effort */ }
}

// Adopt a store and load what survived, PURGING anything expired or over the cap on the
// way in — the same two bounds a live write applies, because a store file is untrusted
// input like any other (a clock change, an older build, or a hand-edited config could
// otherwise reintroduce a banked id). Every row is validated field by field and a
// malformed one is skipped rather than repaired: a dropped record fails toward 'trigger'.
// `nowMs` is injectable for the same reason the rest of this block's clock is.
// Returns how many records were adopted.
function useLegacyThreadStore(store, nowMs) {
  const usable = store && typeof store.get === 'function' && typeof store.set === 'function';
  legacyStore = usable ? store : null;
  legacyThreads.clear();
  if (!legacyStore) return 0;
  let rows = null;
  try { rows = legacyStore.get(LEGACY_THREAD_KEY); } catch (_) { rows = null; }
  const now = Number(nowMs) || Date.now();
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r || typeof r.id !== 'string' || !r.id) continue;
      if (typeof r.owner !== 'string' || !r.owner) continue;
      if (typeof r.target !== 'string' || !r.target) continue;
      const at = Number(r.at);
      if (!Number.isFinite(at)) continue;
      if (now - at > LEGACY_THREAD_TTL_MS) continue; // expired on disk stays expired
      legacyThreads.delete(r.id); // a duplicated id keeps the LAST row, as a live write would
      legacyThreads.set(r.id, { owner: r.owner, target: r.target, at: at });
    }
  }
  for (const oldest of legacyThreads.keys()) {
    if (legacyThreads.size <= LEGACY_THREAD_CAP) break;
    legacyThreads.delete(oldest);
  }
  saveLegacyThreads(); // the purge is durable — a second restart must not resurrect it
  return legacyThreads.size;
}

// The legacy thread id a peer's desktop mints for a message at (channel, seq). MUST stay
// byte-identical to trigger.js taskIdFor / handleTrigger's futureTaskId, since matching a
// reply is a plain string lookup. Built by concatenation, not a template literal, so the
// brace-balancing extractor the truth tables use never has to reason about `${`.
function legacyThreadId(channelId, seq) {
  return 'task-' + String(channelId) + '-' + String(seq);
}

// Record a thread I opened: MY OWN message, explicitly addressed to someone else. Called
// from classify's self-authored branch, which is the one place every message this
// operator posts (web composer, desktop session, or an EXTERNAL Claude Code session
// posting through MCP) passes through. Unaddressed own messages are NOT recorded: with
// no addressee there is no member to bind a later reply to, and an unbound entry would
// let any channel member's tag suppress their own consent prompt. In a DM the server
// auto-addresses the peer, so the ordinary 1:1 case is covered.
// FIX S5: `nowMs` is injectable so the TTL is a truth table rather than a sleep.
function noteMyLegacyThread(m, entry, myId, nowMs) {
  const to = metaStr(m, 'to_user_id');
  const channelId = entry && entry.channel ? String(entry.channel.id || '') : '';
  const seq = Number(m.seq);
  if (!to || to === myId || !channelId) return;
  // OPENERS ONLY. A message already carrying a thread id continues someone's thread;
  // it does not open one, and recording it would mint a second id for the same
  // exchange that no reply will ever match anyway.
  if (metaStr(m, 'taskId')) return;
  if (!Number.isInteger(seq) || seq <= 0) return;
  const at = Number(nowMs) || Date.now();
  const id = legacyThreadId(channelId, seq);
  legacyThreads.delete(id); // re-insert so a re-seen message refreshes its eviction age
  legacyThreads.set(id, { owner: myId, target: to, at: at });
  // Insertion order is age order, so one pass from the front drops whatever is over
  // the cap AND whatever has aged out, and stops at the first entry that is neither.
  for (const [oldest, rec] of legacyThreads) {
    if (legacyThreads.size <= LEGACY_THREAD_CAP && at - rec.at <= LEGACY_THREAD_TTL_MS) break;
    legacyThreads.delete(oldest);
  }
  saveLegacyThreads(); // Q11: an opener survives a restart (no-op with no store injected)
}

// TRUE iff this message is tagged with a legacy thread id THIS machine opened, and is
// authored by the very member that thread addresses. `owner` pins the entry to the
// operator who recorded it, so a sign-out and sign-in as somebody else cannot inherit
// another account's threads. Fails closed on every miss.
// FIX S5: an entry past its TTL is dropped on read and answers false, so a banked
// legacy id cannot suppress consent indefinitely.
function knownLegacyReply(m, myId, nowMs) {
  const id = metaStr(m, 'taskId');
  if (!id) return false;
  const rec = legacyThreads.get(id);
  if (!rec) return false;
  const now = Number(nowMs) || Date.now();
  if (now - rec.at > LEGACY_THREAD_TTL_MS) {
    legacyThreads.delete(id);
    saveLegacyThreads(); // at most ONE write per entry, ever: it is gone after this
    return false;
  }
  return rec.owner === myId && rec.target === m.authorUserId;
}
// ─── END LEGACY-THREADS ──────────────────────────────────────────────────────

// ── Requester auto-open detector (v1.9, Q4) ──────────────────────────────────
// TRUE iff this message is MY OWN first-class create_task addressed to a peer, so
// the desktop opens a REQUESTER session window that drives the task. Checked by the
// listener SEPARATELY from classify() — it never touches classify's body, so the
// 1536-case truth table stays intact and a self-message still classifies 'ignore'
// for trigger/fyi. The task* keys are stamped SERVER-SIDE (metaStr reads them off
// metadata), so they cannot be spoofed by the caller.
//
//   - firstClassTaskId(m) present   → a real first-class (UUID) task, not legacy.
//   - m.authorUserId === myId       → MY message (my agent posted the create_task).
//   - taskCreatedBy === myId        → I created the task (the requester, not a peer).
//   - runtime === 'desktop-session' → a session THIS APP spawned opened the thread
//                                     (WAKE-V1; see below).
//   - taskTarget present && !== me  → it is addressed to a PEER (a self-targeted
//                                     task has no counterparty to drive against).
// De-dupe (one window per taskId) + backlog suppression + the settled-set are the
// listener's job; this helper is a pure predicate only.
//
// WAKE-V1 RUNTIME GATE. My own agent can open a thread from EITHER runtime: a window
// this app spawned (sdk-loader sends `X-Dopl-Runtime: desktop-session`, and the server
// stamps metadata.runtime off that header alone — `runtime` is RESERVED, so a value in
// the caller's message body is stripped) or the operator's own EXTERNAL Claude Code
// session, which sends no such header and therefore carries no runtime key at all. An
// external session now WAITS on the reply itself (it arms a long-held MCP await that
// wakes it when the peer answers), so auto-opening a desktop requester window for that
// thread put two agents on one thread and let the window consume the reply the waiting
// session was armed for. Unstamped (= external, or any non-desktop writer) therefore
// never auto-opens; the reply reaches the external agent through its await, and this
// machine's existing passive path (classify 'task-reply' → task-notify's silent banner)
// is the fallback when nothing is listening.
//
// THE STAMP IS A ROUTING HINT, NOT AN AUTHORIZATION SIGNAL (src/shared/auth/
// runtime-header.ts §"Header-only, deliberately"). Any holder of a device token can set
// that header, so `runtime` cannot attest WHO called — it only labels the expected
// origin. This gate is safe for two other reasons: it fails CLOSED (absence, a
// near-miss, or a non-string → no window, never a window), and it is one conjunct of an
// AND whose identity checks are the real bound — the message must be authored by ME and
// belong to a thread I created. Read alone, the stamp decides nothing.
function requesterTaskOpen(m, myId) {
  if (!m || m.kind !== 'message' || !myId) return false;
  if (!firstClassTaskId(m)) return false;
  if (m.authorUserId !== myId) return false;
  if (metaStr(m, 'taskCreatedBy') !== myId) return false;
  if (metaStr(m, 'runtime') !== 'desktop-session') return false;
  const target = metaStr(m, 'taskTarget');
  return !!target && target !== myId;
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
  firstClassTaskId,
  LEGACY_THREAD_CAP,
  LEGACY_THREAD_TTL_MS, // S5: the registry's two bounds, asserted by the truth tables
  LEGACY_THREAD_KEY,
  legacyThreadId,
  noteMyLegacyThread,
  knownLegacyReply,
  useLegacyThreadStore, // Q11: index.js injects electron-store at boot
  requesterTaskOpen,
  openChannelForEntry,
  resolveToolProfile,
};
