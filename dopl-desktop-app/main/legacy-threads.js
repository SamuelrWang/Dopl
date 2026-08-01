// legacy-threads.js — THE LOCAL RECORD OF THREADS THIS MACHINE OPENED WITHOUT create_thread.
//
// SPLIT NOTE (§2, 2026-07-31): lifted verbatim out of targeting.js, which went past the
// 500-line cap when classify grew the CHAT branch and the registry grew its authorship guard.
// The seam is the honest one — two reasons to change, not one:
//   THERE  the targeting CLASSIFIER: what verdict a message earns (targeting.js).
//   HERE   the durable REGISTRY it consults: which legacy thread ids this operator opened,
//          how they are bounded, and how they survive a restart.
// targeting.js requires this module and re-exports every name, so no caller moved and no
// exported behaviour changed.
//
// THE metaStr FREE VARIABLE. The block below calls `metaStr` without declaring it — it is a
// module-scope binding here, ABOVE the sentinel, exactly the way session-reducer.js consumes
// session-effects.js and channel-agents.js consumes channel-roster.js. That is what lets the
// classify truth tables keep slicing this block into a bare `new Function` scope alongside
// targeting.js's own copy of the same three lines. It is restated rather than imported for one
// reason only: importing it back from targeting.js would be a require cycle, and this module
// must have no dependency at all for the slicing to work.

// A trimmed non-empty string from message metadata, else '' — targeting.metaStr, restated.
// See the header for why it is not imported. Any change here changes there.
function metaStr(m, key) {
  const v = m && m.metadata ? m.metadata[key] : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : '';
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
// from classify's self-authored branch AND from the dispatcher ahead of every route
// (listener-messages.js), because an untagged line of mine claimed by an engaged agent
// short-circuits above classify. Unaddressed own messages are NOT recorded: with
// no addressee there is no member to bind a later reply to, and an unbound entry would
// let any channel member's tag suppress their own consent prompt. In a DM the server
// auto-addresses the peer, so the ordinary 1:1 case is covered.
// AUTHORSHIP IS CHECKED HERE, not left to the caller, and that is what makes the second call
// site safe: the dispatcher sees EVERY message, and a peer's message addressed to a THIRD
// member would otherwise bank as owner=me/target=them, which is FIX S5's forgery again.
// FIX S5: `nowMs` is injectable so the TTL is a truth table rather than a sleep.
function noteMyLegacyThread(m, entry, myId, nowMs) {
  if (!m || !myId || m.authorUserId !== myId) return;
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

module.exports = {
  LEGACY_THREAD_CAP,
  LEGACY_THREAD_TTL_MS,
  LEGACY_THREAD_KEY,
  legacyThreadId,
  noteMyLegacyThread,
  knownLegacyReply,
  useLegacyThreadStore,
};
