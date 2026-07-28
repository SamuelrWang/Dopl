// Session-window settings (v1.9). ONE home for the "Run sessions in a window"
// toggle and the loop-safety caps (turn / idle-TTL / cost), so the tray toggle
// (index.js), the launch paths (channel-listener.js / trigger.js), and the session
// engine (session-engine.js, T1) all read the SAME source of truth.
//
// WINDOW MODE DEFAULTS ON (§B.3): with the setting unset, sessions run in a native
// window (the v1.9 default executor). Turning it OFF restores today's behavior
// byte-for-byte — headless spawn + approve-out review. That default lives in
// getWindowMode() below (undefined -> true), so a fresh install is window-mode.
//
// Kept electron-store-only (no electron UI, no fs beyond the store) so it stays a
// thin, dependency-light module the engine can require without pulling BrowserWindow.

const Store = require('electron-store');

const store = new Store();

// electron-store keys (namespaced so they never collide with v1.x keys like
// `runInTerminal` — retired in v1.9 — or `claudeSessions`).
const WINDOW_MODE_KEY = 'sessionWindowMode'; // boolean; unset -> ON
const TURN_CAP_KEY = 'sessionTurnCap'; // number; unset -> DEFAULT_TURN_CAP
const IDLE_TTL_KEY = 'sessionIdleTtlMs'; // number ms; unset -> DEFAULT_IDLE_TTL_MS
const COST_CAP_KEY = 'sessionCostCapUsd'; // number USD; unset / <=0 -> no cap

// Loop-safety defaults (§A.2): 24 turns per session, 15-minute idle TTL, no cost
// cap unless the operator sets one. MAX_SESSION_WINDOWS is the global soft cap
// (§A.7) beyond which a responder launch falls back to headless and a requester
// launch defers to a passive notify — enforced by the engine, homed here.
const DEFAULT_TURN_CAP = 24;
const DEFAULT_IDLE_TTL_MS = 15 * 60 * 1000;
const MAX_SESSION_WINDOWS = 6;

// ── Window mode (the v1.9 executor switch) ───────────────────────────────────
function getWindowMode() {
  const v = store.get(WINDOW_MODE_KEY);
  return v === undefined ? true : v === true; // DEFAULT ON
}
function setWindowMode(v) {
  const val = !!v;
  store.set(WINDOW_MODE_KEY, val);
  return val;
}

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
  getWindowMode,
  setWindowMode,
  getTurnCap,
  setTurnCap,
  getIdleTtlMs,
  setIdleTtlMs,
  getCostCapUsd,
  setCostCapUsd,
  MAX_SESSION_WINDOWS,
  DEFAULT_TURN_CAP,
  DEFAULT_IDLE_TTL_MS,
};
