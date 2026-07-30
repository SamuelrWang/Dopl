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

// C5 (renderer H1) — `init` IS THE WINDOW'S IDENTITY and must never be evicted. It carries
// the peer name, channel, task title and side; the renderer's fold has no other source for
// them, and the composer's @-tag addresses `state.init.from`. Drop-oldest evicted it FIRST
// (it is always entry 0), so after a reload the window came back identity-less and a tag
// went to the operator's own agent instead of the peer. It is pinned as a STICKY HEAD here:
// eviction starts at the entry after it. Returns the index eviction may start from.
function stickyHead(ring) {
  const first = ring.entries.length ? ring.entries[0] : null;
  return first && first.type === 'init' ? 1 : 0;
}

// Append a payload; drop-oldest on overflow, never touching the sticky head. When a dropped
// entry was already sent (sentIdx past it) the cursor decrements so it still points at the
// sent/unsent boundary; dropping an UNSENT entry is the bounded data loss (F-08a).
function ringRecord(ring, payload) {
  ring.entries.push(payload);
  ring.bytes += entryBytes(payload);
  for (;;) {
    const head = stickyHead(ring);
    const over = ring.entries.length > ring.maxEntries || ring.bytes > ring.maxBytes;
    if (!over || ring.entries.length <= head + 1) break; // only the head + newest remain
    const dropped = ring.entries.splice(head, 1)[0];
    ring.bytes -= entryBytes(dropped);
    if (ring.sentIdx > head) ring.sentIdx -= 1;
  }
  return ring;
}

// C5, the other half — the two avatar `data:` URIs (up to ~350KB each) NEVER ride `init`.
// One cold-cache fill used to blow the 1MB bound on its own and evict the sticky head, so
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
