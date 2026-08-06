// Wake-from-sleep fast catch-up: the one place that decides what has to be
// kicked when this Mac comes back.
//
// SPLIT NOTE: moved out of index.js, which was AT the 500-line ENGINEERING §2
// cap when the minimum-version gate landed (the app-menu.js / auth-actions.js
// idiom). Nothing about the behavior changed in the move; the gate is the one
// new participant.
//
// WHY EACH KICK. On resume the listener's long-polls are holding sockets that
// died while the lid was shut, and both network stacks in this process (Chromium
// in the renderer, undici in main) can be sitting on dead keepalive connections.
// Left alone, every request hangs until its AbortController timeout, which is
// the multi-minute "presence: beat error This operation was aborted" storm after
// an unlock. So:
//
//   listener       abort in-flight awaits so they re-await from their cursors
//   pool-reset     (2b) main-process undici pool
//   token          (2d) refresh a stale access token NOW, not at the late alarm
//   ui-sync        (2e) rejoin the SPA's sync feed on fresh sockets
//   version-gate   re-ask for the minimum version: the machine may have been
//                  asleep across a release, and the next scheduled ask is 4h out
//   guard          (2a) renderer pool + (2c) retry a hung load
//
// COALESCED. `resume` and `unlock-screen` fire together, and reconcile is
// single-flight, so a resume+unlock pair does ONE pass rather than two. Every
// kick is independently swallowed: one module failing to wake must not stop the
// rest of the app from waking.

const { powerMonitor } = require('electron');
const { diag } = require('./diag');

const COALESCE_MS = 3000;

// `deps`: listener, api, authTokens, uiSync, versionGate.
// Returns the handler, so a caller (or a test) can drive a wake directly.
// powerMonitor is only valid after the app is ready.
function arm(deps) {
  let lastWakeAt = 0;

  const kick = (name, fn) => {
    try { fn(); } catch (err) { diag('wake', name, 'error', err && err.message); }
  };

  const onWake = (reason) => {
    const now = Date.now();
    if (now - lastWakeAt < COALESCE_MS) return; // resume+unlock / rapid unlocks
    lastWakeAt = now;
    diag('powerMonitor:', reason, '— waking listener + resetting pools');
    kick('listener', () => deps.listener.wake());
    kick('pool-reset', () => deps.api.resetPool());
    kick('token', () => deps.authTokens.onWake());
    kick('ui-sync', () => deps.uiSync.onWake());
    kick('version-gate', () => deps.versionGate.onWake());
  };

  try {
    powerMonitor.on('resume', () => onWake('resume'));
    powerMonitor.on('unlock-screen', () => onWake('unlock-screen'));
  } catch (err) {
    console.warn('[powerMonitor] wiring failed:', err && err.message);
  }
  return onWake;
}

module.exports = { arm, COALESCE_MS };
