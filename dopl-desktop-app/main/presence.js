// Channels v1.2 — presence heartbeat. ⚠ WIRING ONLY SINCE 2026-09-08.
//
// The loop, the posture rule, the abort-not-skip contract and every backoff live in
// `./presence-core.js`, which is pure and injectable so `node --test` can drive it. This file
// binds that factory to the real transport, the real auth and the real `powerMonitor`, and it
// exists as a separate module for one reason: requiring `./api` pulls in `./auth` and therefore
// `electron`, which does not import outside an Electron process. Read the core's header for the
// bug this replaced (Samuel, 2026-09-08 — "sometimes i see myself go offline").
//
// WHAT THE HEARTBEAT MEANS, unchanged: while the app is running AND signed in, tell the server
// this operator is present, so the roster's dot and `read_sessions`' liveness hedge are true.
// This is a Node/HTTP heartbeat, NOT browser Realtime Presence — the desktop has no browser
// client. Cookie auth via the shared api helper; no tokens logged.
//
// WHAT CHANGED AT THE WIRE: one POST per tick to the USER-SCOPED arm (`/api/channels/presence/all`),
// which stamps every container the caller is an active member of in one statement. The
// per-workspace set is still pushed in by the listener's reconcile (`setWorkspaces`) because it
// is what the FALLBACK loop needs when that arm answers 404 — an older server, or a database
// that has not had `20260930140000_presence_heartbeat_all.sql` applied yet.

const { apiFetch } = require('./api');
const { discardBody } = require('./api-repair');
const auth = require('./auth');
const { diag } = require('./diag');
const { createPresence } = require('./presence-core');

// ⚠ LAZY AND GUARDED. `powerMonitor` is only valid after the app is ready, and it throws in a
// headless/CI Electron — where an unmeasurable idle time must read `active`, not `away` (the
// core's header states why). Returning null is how "cannot measure" is expressed.
function idleSeconds() {
  try {
    const { powerMonitor } = require('electron');
    if (!powerMonitor || typeof powerMonitor.getSystemIdleTime !== 'function') return null;
    return powerMonitor.getSystemIdleTime();
  } catch (_) {
    return null;
  }
}

const presence = createPresence({
  apiFetch,
  discardBody,
  isSignedIn: () => auth.isSignedIn(),
  idleSeconds,
  diag,
});

/**
 * Arm the SLEEP half of the posture. ⚠ The WAKE half is `wake.js`, which already owns
 * `resume` / `unlock-screen` and coalesces the pair — wiring resume here as well would give
 * this machine two uncoordinated wake paths, which is the shape `wake.js` was split out to end.
 * These three events have no such owner, so they are wired at the point of use.
 *
 * Called once, from `channel-listener.js › start`, after the app is ready.
 */
let sleepArmed = false;
function armSleepEvents() {
  if (sleepArmed) return;
  sleepArmed = true;
  try {
    const { powerMonitor } = require('electron');
    // ⚠ `shutdown` is macOS/Linux only and fires BEFORE the app's own quit path, which is why it
    // is listened for separately from `quit-guard.js › teardown` rather than instead of it.
    for (const event of ['suspend', 'lock-screen', 'shutdown']) {
      powerMonitor.on(event, () => { presence.sleep(event).catch(() => {}); });
    }
  } catch (err) {
    // Not fatal, and deliberately not a throw: without these the row simply ages out on the
    // server's own window instead of going away immediately.
    console.warn('[presence] powerMonitor sleep wiring failed:', err && err.message);
  }
}

module.exports = {
  start: () => { armSleepEvents(); presence.start(); },
  stop: () => presence.stop(),
  wake: () => presence.wake(),
  sleep: (reason) => presence.sleep(reason),
  setWorkspaces: (ids) => presence.setWorkspaces(ids),
};
