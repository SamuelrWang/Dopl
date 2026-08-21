// Session settings — the loop-safety caps, and nothing else any more.
//
// ONE home for the turn / idle-TTL / cost caps, so the launch paths
// (channel-listener.js / trigger.js) and the session engine all read the SAME source of truth.
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
//
// Kept electron-store-only (no electron UI, no fs beyond the store) so it stays a thin,
// dependency-light module the engine can require without pulling BrowserWindow.

const Store = require('electron-store');

const store = new Store();

// electron-store keys (namespaced so they never collide with v1.x keys like
// `runInTerminal` — retired in v1.9 — or the two retired window keys named in the header).
const TURN_CAP_KEY = 'sessionTurnCap'; // number; unset -> DEFAULT_TURN_CAP
const IDLE_TTL_KEY = 'sessionIdleTtlMs'; // number ms; unset -> DEFAULT_IDLE_TTL_MS
const COST_CAP_KEY = 'sessionCostCapUsd'; // number USD; unset / <=0 -> no cap

// Loop-safety defaults (§A.2): 24 turns per session, 15-minute idle TTL, no cost cap unless
// the operator sets one. ⚠ `MAX_SESSION_WINDOWS` sat here and is deleted with the switches: it
// was the WINDOW budget, and the ceiling that survives is `session-windowless.js ›
// MAX_CONCURRENT_SESSIONS`, which is about running sessions rather than open windows.
const DEFAULT_TURN_CAP = 24;
const DEFAULT_IDLE_TTL_MS = 15 * 60 * 1000;

// ── Loop-safety caps (read by the session engine) ────────────────────────────
// Each getter fails safe to its documented default on an absent / malformed value,
// so a hand-edited store can never hand the engine a NaN or a non-positive cap.
function getTurnCap() {
  const n = Number(store.get(TURN_CAP_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TURN_CAP;
}
function setTurnCap(n) {
  const val = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : DEFAULT_TURN_CAP;
  store.set(TURN_CAP_KEY, val);
  return val;
}

function getIdleTtlMs() {
  const n = Number(store.get(IDLE_TTL_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_IDLE_TTL_MS;
}
function setIdleTtlMs(n) {
  const val = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : DEFAULT_IDLE_TTL_MS;
  store.set(IDLE_TTL_KEY, val);
  return val;
}

// 0 (or unset / non-positive) means NO cost cap. A positive value caps a session's
// cumulative cost; the engine ends the session (task stays open) when it is crossed.
function getCostCapUsd() {
  const n = Number(store.get(COST_CAP_KEY));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function setCostCapUsd(n) {
  const val = Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0;
  store.set(COST_CAP_KEY, val);
  return val;
}

module.exports = {
  getTurnCap,
  setTurnCap,
  getIdleTtlMs,
  setIdleTtlMs,
  getCostCapUsd,
  setCostCapUsd,
  DEFAULT_TURN_CAP,
  DEFAULT_IDLE_TTL_MS,
};
