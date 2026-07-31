// Transcript replay for the session + consent windows (v2.1 Session Window, item 3).
//
// A Cmd-R reload is NEITHER `close` (hide) NOR `render-process-gone` (crash): the SDK
// query keeps running and `s.state` survives, but the renderer resets to its
// initialState and the engine, having flushed its one-shot emit buffer on the FIRST
// load, never re-sends — so the reloaded window is stuck on "Launching". This module
// replaces that one-shot buffer with a bounded transcript RING that re-sends
// everything a (re)connecting renderer has not yet seen. The renderer's reduceEvent is
// a PURE FOLD over the event stream, so replaying the ordered log rebuilds identical
// state with NO new IPC and NO new reducer state.
//
// SEAM (§B.4, FROZEN): createReplay(webContents, sendFn) -> { deliver, record, onLoad,
// onReload, loaded }. The caller wires the electron webContents listeners
// (did-start-loading -> onReload, did-finish-load -> onLoad) and supplies the guarded
// sendFn; this module owns ONLY the ring + the sent-cursor. Used by BOTH
// session-engine.bindWindow and session-consent.bind.

// ─── BEGIN SESSION-REPLAY-RING (pure; unit-tested via source extraction) ──────
// No electron/fs/path/SDK refs below (§H-7), so test/session-replay.test.mjs slices
// this block and evaluates it verbatim. The ring is a plain value the shell drives.

// Bound the transcript so a very long session cannot grow the buffer without limit
// (F-08a: the EARLIEST turns are dropped on overflow; recent turns + the current
// status/permission/consent always survive, which is what a reload must rebuild).
const RING_MAX_ENTRIES = 2000;
const RING_MAX_BYTES = 1024 * 1024; // ~1MB

function entryBytes(payload) {
  try {
    return JSON.stringify(payload).length;
  } catch (_) {
    return 0;
  }
}

// A fresh ring: the ordered payload log, a byte tally, the sent cursor (index of the
// first payload this renderer has NOT seen), and whether a page is currently loaded.
function createRing(maxEntries, maxBytes) {
  return {
    entries: [],
    bytes: 0,
    sentIdx: 0,
    loaded: false,
    maxEntries: maxEntries > 0 ? maxEntries : RING_MAX_ENTRIES,
    maxBytes: maxBytes > 0 ? maxBytes : RING_MAX_BYTES,
  };
}

// PINNED — the session's IDENTITY + POSTURE, the two things a replay may never come back
// without. Eviction skips them WHEREVER THEY SIT, because position is not a reliable proxy for
// either one (M3): startSession emits `folder` FIRST, so entry 0 is display-only chrome and the
// old position-based sticky head pinned nothing at all.
//   `init`  (C5, renderer H1) is the window's identity — peer name, channel, task title, side.
//           The renderer's fold has no other source for them and the composer's @-tag addresses
//           `state.init.from`, so an evicted init came back identity-less and a tag silently
//           went to the operator's own agent instead of the peer.
//   `modes` (M3) is the ENFORCED permission posture, both axes. The renderer's initialState is
//           the most restrictive pair (manual/ask) and its `modes` fold is the ONLY thing that
//           moves it, while main keeps enforcing the real posture off `s.state` (session-io
//           grantArgs). So an evicted `modes` made the header UNDERSTATE what is actually being
//           allowed — a strictly worse failure than overstating it.
// `folder` is display-only and is deliberately NOT pinned; so are the avatars (see below).
const PINNED_TYPES = ['init', 'modes'];

function isPinned(payload) {
  return !!payload && PINNED_TYPES.indexOf(payload.type) !== -1;
}

// Index of the OLDEST entry eviction may take: the first one that is not pinned, or -1 when
// every entry is pinned (the ring then simply refuses to shrink — it is bounded at one entry
// per pinned type, so this cannot run away).
function oldestEvictable(ring) {
  for (let i = 0; i < ring.entries.length; i += 1) {
    if (!isPinned(ring.entries[i])) return i;
  }
  return -1;
}

// Remove entry `at`, keeping the byte tally and the sent cursor exact. Dropping an entry the
// renderer ALREADY saw (at < sentIdx) shifts every later entry one place left, so the cursor
// decrements to keep pointing at the same sent/unsent boundary; dropping an UNSENT one leaves
// the cursor alone, and that is the bounded data loss (F-08a). This is the ONE place entries
// leave the ring, so the arithmetic holds for arbitrary positions, not just the head.
function ringDrop(ring, at) {
  const dropped = ring.entries.splice(at, 1)[0];
  ring.bytes -= entryBytes(dropped);
  if (ring.sentIdx > at) ring.sentIdx -= 1;
  return dropped;
}

// LAST-WINS, the half that keeps "pinned" from meaning "unbounded". `modes` is emitted
// REPEATEDLY — every axis change, and a park that resets both axes — so pinning every one would
// pack the ring with unevictable entries and starve the transcript. Only the NEWEST `modes` is
// the live posture, so recording one first drops the older entry of that same type: AT MOST ONE
// pinned entry per pinned type, always. That is fold-equivalent because the renderer's `modes`
// case REPLACES both axes and no other case reads them, so replaying just the last one lands on
// exactly the state replaying all of them would. `init` is emit-once so this is a no-op for it;
// it runs anyway, which makes the invariant hold without any caller discipline (and the `init`
// fold likewise replaces state.init wholesale). NOTE this collapses the REPLAY LOG only —
// createReplay.deliver still sends every `modes` live, so a connected renderer misses nothing.
function dropOlderPinned(ring, type) {
  for (let i = ring.entries.length - 1; i >= 0; i -= 1) {
    if (ring.entries[i] && ring.entries[i].type === type) ringDrop(ring, i);
  }
}

// Append a payload; drop-oldest on overflow, never touching a pinned entry.
function ringRecord(ring, payload) {
  if (isPinned(payload)) dropOlderPinned(ring, payload.type);
  ring.entries.push(payload);
  ring.bytes += entryBytes(payload);
  for (;;) {
    const over = ring.entries.length > ring.maxEntries || ring.bytes > ring.maxBytes;
    if (!over) break;
    const at = oldestEvictable(ring);
    // -1 = all pinned; the last index = only the NEWEST entry is evictable and the ring always
    // keeps that. Either way there is nothing left to give and the bound is exceeded knowingly.
    if (at === -1 || at === ring.entries.length - 1) break;
    ringDrop(ring, at);
  }
  return ring;
}

// C5, the other half — the two avatar `data:` URIs (up to ~350KB each) NEVER ride `init`.
// One cold-cache fill used to blow the 1MB bound on its own and evict the identity, so
// pinning alone is not enough: an init that carries them is split into a small init plus the
// `avatars` event the view-model already OR-merges. Everything else passes straight through.
function splitInitAvatars(payload) {
  if (!payload || payload.type !== 'init' || !(payload.selfAvatar || payload.fromAvatar)) return [payload];
  const avatars = { type: 'avatars', self: payload.selfAvatar || null, from: payload.fromAvatar || null };
  return [{ ...payload, selfAvatar: null, fromAvatar: null }, avatars];
}

// The payloads this renderer has not yet seen, advancing the cursor to the end.
function ringDrain(ring) {
  const pending = ring.entries.slice(ring.sentIdx);
  ring.sentIdx = ring.entries.length;
  return pending;
}

// First `did-finish-load`: mark loaded and hand back everything unsent to flush.
function ringOnLoad(ring) {
  ring.loaded = true;
  return ringDrain(ring);
}

// `did-start-loading` on an already-loaded window = a reload: the renderer reset to
// initialState, so REWIND the cursor to 0 and drop `loaded` — the next onLoad re-sends
// the WHOLE transcript. This unifies first-load and reload as "send everything unseen".
function ringOnReload(ring) {
  ring.loaded = false;
  ring.sentIdx = 0;
}
// ─── END SESSION-REPLAY-RING ──────

// The imperative wrapper: binds the ring to a webContents + a guarded sendFn. The
// caller wires the two electron listeners to onReload/onLoad.
function createReplay(webContents, sendFn) {
  const ring = createRing();
  function send(payload) {
    if (webContents && webContents.isDestroyed && webContents.isDestroyed()) return;
    sendFn(payload);
  }
  return {
    // Record every emit, and send immediately once a page is loaded (advancing the
    // cursor). Before first load it only buffers, so the first `init` is never dropped.
    // C5: an init carrying avatars enters the ring as TWO entries (init + `avatars`).
    deliver(payload) {
      for (const p of splitInitAvatars(payload)) {
        ringRecord(ring, p);
        if (ring.loaded) {
          send(p);
          ring.sentIdx = ring.entries.length;
        }
      }
    },
    // Buffer without sending (exposed for completeness/tests; the shells use deliver).
    record(payload) {
      for (const p of splitInitAvatars(payload)) ringRecord(ring, p);
    },
    onLoad() {
      for (const p of ringOnLoad(ring)) send(p);
    },
    onReload() {
      ringOnReload(ring);
    },
    get loaded() {
      return ring.loaded;
    },
  };
}

module.exports = { createReplay };
