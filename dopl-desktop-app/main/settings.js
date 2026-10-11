// Session settings — the session idle TTL, and nothing else.
//
// The session engine reads the idle TTL from here (`session-engine-host.js`). Kept
// electron-store-only (no electron UI, no fs beyond the store) so the engine can require it
// without pulling BrowserWindow.
//
// ⚠ READ-ONLY. Nothing in the app writes `sessionIdleTtlMs`; an operator or support session
// can hand-edit the store, and the getter's fail-safe coercion stops a hand-edited NaN or
// non-positive value reaching the engine. A Settings row would need a setter here.
//
// ⚠ RETIRED STORE KEYS — never read, never written, deleted from the code on purpose:
//   `sessionWindowMode`, `preConsentWindowMode` — the session-window switches (gone with window
//     mode, 2026-08-20, F-228). A reader would resurrect the sender-side session pop-up for every
//     install that still has the value on disk. Do not add one.
//   `claudeSessions` — the deleted `claude -p` lane's resumable-session map (2026-08-20).
//   `sessionTurnCap`, `sessionCostCapUsd` — the turn and cost caps, deleted 2026-09-07 (Samuel's
//     ruling). Not migrated: deleting operator data to tidy a removed feature is worse than an
//     inert key, and a restored cap would find the operator's own answer still there.
// `test/removed-vocabulary.test.mjs` pins the first three as RETIRED_STORE_KEYS.

const Store = require('electron-store');

const store = new Store();

const IDLE_TTL_KEY = 'sessionIdleTtlMs'; // number ms; unset -> DEFAULT_IDLE_TTL_MS

// ⚠ IMPORTED, NOT RETYPED: `session-state.js` owns the default for the reducer's own
// fail-closed coercion, and a second copy here would drift invisibly. session-state.js is pure
// (no requires), so this cannot cycle.
const {
  DEFAULT_IDLE_MS: DEFAULT_IDLE_TTL_MS,
} = require('./session-state');

// Fails safe to the default on an absent / malformed / non-positive value.
function getIdleTtlMs() {
  const n = Number(store.get(IDLE_TTL_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_IDLE_TTL_MS;
}

module.exports = {
  getIdleTtlMs,
};
