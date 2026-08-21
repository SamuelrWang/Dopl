// Session settings — the loop-safety caps, READ-ONLY, and nothing else any more.
//
// ONE home for the turn / idle-TTL / cost caps, so the launch paths
// (channel-listener.js / trigger.js) and the session engine all read the SAME source of truth.
// ⚠ THIS MODULE NO LONGER WRITES ANYTHING — see the block above the keys.
//
// ⚠ THE TWO WINDOW SWITCHES LIVED HERE AND ARE DELETED (2026-08-20). `getWindowMode()` was the
// master switch over the operator's own session windows and `getPreConsentWindow()` gated the
// pre-consent window; both were made to answer hard-OFF on Samuel's live-test ruling, and both
// were kept ONE WAVE LONGER THAN THE MACHINERY THEY GUARDED — deliberately, so that if the
// deletion had missed something it would stay disarmed rather than come back reachable. It did
// not, so they go: there is no window factory, no pre-consent registry, no requester route and
// no renderer left for either of them to refuse.
//
// ⚠ `sessionWindowMode` AND `preConsentWindowMode` ARE RETIRED STORE KEYS — never read, never
// written. A machine that ran an older build may still carry `sessionWindowMode: true` on disk;
// nothing reads it, and re-introducing a reader would resurrect the sender-side session pop-up
// for exactly the installs that used to have it. **Do not add one.** (F-228 is the record.)
// ⚠ `claudeSessions` JOINED THEM ON 2026-08-20 — the `claude -p` lane's resumable-session map,
// orphaned when that lane was deleted (`session-spawner.js`'s header carries the story). It is
// in `test/removed-vocabulary.test.mjs`'s RETIRED_STORE_KEYS with the other two.
//
// Kept electron-store-only (no electron UI, no fs beyond the store) so it stays a thin,
// dependency-light module the engine can require without pulling BrowserWindow.

const Store = require('electron-store');

const store = new Store();

// ⚠ THE THREE SETTERS ARE DELETED, AND WHAT REMAINS ARE COMPILE-TIME DEFAULTS (2026-08-20,
// Samuel's ruling). `setTurnCap` / `setIdleTtlMs` / `setCostCapUsd` had ZERO callers: the tray's
// "Sessions" submenu was the only surface that ever wrote them and it went with window mode
// (F-228). So the three store keys — `sessionTurnCap`, `sessionIdleTtlMs`, `sessionCostCapUsd`
// — became WRITE-NEVER, the getters always returned the compiled defaults, and this module was
// presenting as a settings store while being a constants file with a store in front of it.
//
// ⚠ THE READS STAY, AND THEY ARE NOT DEAD WEIGHT. An operator (or a support session) can still
// hand-edit the store, and the getters' fail-safe coercion is what stops a hand-edited NaN or a
// non-positive cap reaching the engine. Keeping the read path is what makes the value
// recoverable without a build; what is gone is the pretence that the app writes it.
//
// ⚠ A COST-CAP SETTINGS ROW IS A FUTURE BUILD IF SAMUEL WANTS ONE — noted here rather than
// left as an absence, because "there is no way to set this" reads like an oversight and it is
// a decision. The seam is a setter beside each getter and one row on the Settings tab.

// electron-store keys — READ-ONLY from this app's point of view (see above).
const TURN_CAP_KEY = 'sessionTurnCap'; // number; unset -> DEFAULT_TURN_CAP
const IDLE_TTL_KEY = 'sessionIdleTtlMs'; // number ms; unset -> DEFAULT_IDLE_TTL_MS
const COST_CAP_KEY = 'sessionCostCapUsd'; // number USD; unset / <=0 -> no cap

// ⚠ ONE STATEMENT OF EACH DEFAULT, IMPORTED RATHER THAN RETYPED (2026-08-20). These were
// SECOND copies: `session-state.js` declares `DEFAULT_TURN_CAP = 24`, `DEFAULT_IDLE_MS`
// (15 min) and `DEFAULT_COST_CAP_USD = 0` for the reducer's own fail-closed coercion, and this
// file declared the same three numbers again for the getters' fallback. Nothing pinned them
// together, and the drift would have been invisible: `session-engine.js` reads THESE and hands
// them to `applyOpts`, so a divergent pair would simply mean session-state's "documented
// defaults" never applied. `session-state.js` is a pure module with no requires of its own, so
// importing from it here cannot cycle.
// ⚠ `MAX_SESSION_WINDOWS` sat with them and is deleted: it was the WINDOW budget, and the
// ceiling that survives is `session-windowless.js › MAX_CONCURRENT_SESSIONS`, which is about
// running sessions rather than open windows.
const {
  DEFAULT_TURN_CAP,
  DEFAULT_IDLE_MS: DEFAULT_IDLE_TTL_MS,
  DEFAULT_COST_CAP_USD,
} = require('./session-state');

// ── Loop-safety caps (read by the session engine) ────────────────────────────
// Each getter fails safe to its documented default on an absent / malformed value, so a
// hand-edited store can never hand the engine a NaN or a non-positive cap.
function getTurnCap() {
  const n = Number(store.get(TURN_CAP_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TURN_CAP;
}

function getIdleTtlMs() {
  const n = Number(store.get(IDLE_TTL_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_IDLE_TTL_MS;
}

// 0 (or unset / non-positive) means NO cost cap. A positive value caps a session's
// cumulative cost; the engine ends the session (task stays open) when it is crossed.
function getCostCapUsd() {
  const n = Number(store.get(COST_CAP_KEY));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COST_CAP_USD;
}

module.exports = {
  getTurnCap,
  getIdleTtlMs,
  getCostCapUsd,
};
