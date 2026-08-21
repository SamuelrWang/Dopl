// Channels — the consent watcher's DURABLE HALF (electron-store).
//
// §2 SPLIT (2026-08-08, C-7). `consent-watcher.js` sat at 482 lines, and C-7 — routing the
// local 24h expiry through the same resolver the server's expiry uses, so the pre-consent
// window is really closed and the armed permission preset is really cleared — does not fit
// in eighteen. The seam taken is the one §2 lists first and the one `session-store.js`
// already models for the session engine: the STORE is a different reason to change from the
// POLL LOOP. Everything about "which rows to watch, when they are due, and who resolves them"
// stays in consent-watcher.js; everything about "what survives a quit" is here.
//
// TWO STRUCTURES, and the split between them is the whole replay fix:
//   channelWatched  { [requestKey]: record }          — requests still awaiting an answer.
//   channelSettled  { [requestKey]: { outcome, at } } — requests that reached a TERMINAL
//     outcome. The watcher only ever polls rows it has a WATCHED record for, so a settled
//     request is never re-polled and never re-spawned, even though the server's inbound row
//     may stay `allowed` forever. That is the fix for the replay bug where a restart
//     auto-allowed and re-spawned a request whose outbound had already been denied.
//
// PURE-ADJACENT: everything below `BEGIN CONSENT-STORE-PURE` reaches `store` and `diag` as
// free vars, so test/consent-store.test.mjs evaluates it verbatim with fakes — no electron,
// no disk (the session-state-push idiom).

const Store = require('electron-store');
const { diag } = require('./diag');

const store = new Store();

// ─── BEGIN CONSENT-STORE-PURE (injectable; unit-tested via source extraction) ─

const WATCHED_KEY = 'channelWatched'; // { [requestKey]: record }
const SETTLED_KEY = 'channelSettled'; // { [requestKey]: { outcome, at } }

// Settled keys are pruned after this so the record never grows without bound; far longer
// than any request lives, so it cannot cause a re-spawn in practice.
const SETTLED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// A store read that cannot throw and cannot answer something un-iterable. A hand-edited or
// half-written blob degrades to "nothing persisted", which is the same state a fresh install
// is in — never a crash inside the watcher's start path, which runs before the listener does.
function readMap(key) {
  let raw = null;
  try { raw = store.get(key); } catch (err) {
    diag('consent-store: read failed for', key, '—', err && err.message);
    return {};
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function writeMap(key, value) {
  try { store.set(key, value); } catch (err) {
    diag('consent-store: write failed for', key, '—', err && err.message);
  }
}

// `lastPolledAt` is in-memory only — a persisted poll clock would make a record look
// recently-checked across a restart it was never checked in.
function durable(rec) {
  const { lastPolledAt, ...rest } = rec;
  return rest;
}

function loadWatched() {
  return readMap(WATCHED_KEY);
}

function loadSettled() {
  return readMap(SETTLED_KEY);
}

// The whole live map, projected. Written as a set rather than per-key so a record dropped
// in memory is dropped on disk in the same write — the watcher has exactly one in-memory
// source of truth and this mirrors it.
function saveWatched(records) {
  const out = {};
  for (const [k, rec] of records) out[k] = durable(rec);
  writeMap(WATCHED_KEY, out);
}

function saveSettled(settled) {
  writeMap(SETTLED_KEY, settled);
}

// Drop settled keys older than the TTL. MUTATES the caller's object (it is the watcher's
// live one) and returns whether anything went, so the caller only writes when it must.
function pruneSettled(settled, now) {
  const cutoff = (Number(now) || 0) - SETTLED_TTL_MS;
  let changed = false;
  for (const [k, v] of Object.entries(settled)) {
    if (!v || (v.at || 0) < cutoff) { delete settled[k]; changed = true; }
  }
  return changed;
}

// ─── END CONSENT-STORE-PURE ──────────────────────────────────────────────────

module.exports = {
  durable,
  loadWatched,
  loadSettled,
  saveWatched,
  saveSettled,
  pruneSettled,
};
