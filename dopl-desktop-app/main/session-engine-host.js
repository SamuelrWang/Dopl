// THE ENGINE'S HOST SEAMS — §2 SPLIT out of `session-engine.js` (2026-09-14, the 500-line cap):
// the settings read, the tray rebuild and the lifecycle echo. Three edges to main-process
// singletons the engine deliberately holds no structural dependency on; the engine imports all
// four names back and nothing about any of them changed in the move.

const { diag } = require('./diag');

// settings.js owns the window-mode switch + caps; required defensively so the engine still
// loads if it is momentarily absent (unit/E2E harnessing), defaulting to ON.
let settings = null;
try { settings = require('./settings'); } catch (_) { /* absent -> defaults (window-mode ON) */ }

// THE LIFECYCLE HANDLERS `index.js` installs through `setLifecycleHandlers` (trigger-outcomes).
let lifecycle = { onLaunched: null, onEnded: null };

// ⚠ TAKES THE SPEC, FOR TWO REASONS, AND BOTH ARE ABOUT THE TURN CAP (2026-09-05, task 9a).
// (1) ISSUER: `spec.launchDepth` keys which documented default applies when the operator has set
// no cap — 0 is the New Agent button (200), anything else, absent included, is the agent number
// (24). Forwarded, never invented, exactly as the launch funnel forwards it.
// (2) REHYDRATE: a recreate / crash resume passes NO depth (the guard is explicit that a recreate
// must not resurrect a depth it cannot verify), so without this a 200-turn operator session that
// crashed at turn 80 would come back capped at 24 with 80 already spent and end on its first
// `result`. `spec.turnCap` is the cap that session was launched under, persisted beside the turn
// and cost counters it bounds (FIX #9's argument, one field wider), and it wins here for the same
// reason those two do. A fresh launch carries none and reads the setting.
// 🔒 2026-09-07: this read THREE settings and now reads ONE. The turn cap and the cost cap are
// deleted (Samuel's ruling), so there is nothing to resume, nothing to key on `launchDepth`, and
// no reason for a launched session to carry either number. The rehydrate argument above applied
// to a cap that no longer exists; the idle TTL never had it, because parking is not ending.
// ⚠ THE FUNCTION IS KEPT RATHER THAN INLINED so the one remaining read still has a named home and
// the next setting to arrive has somewhere obvious to go.
function readCaps(spec) { // `spec` is kept rather than dropped: see the block above
  if (!settings) return {};
  return { idleMs: settings.getIdleTtlMs() };
}

// Rebuild the tray after a session is hidden / reopened / settled. Lazy-required so the engine holds no top-level tray dependency (tray requires nothing back).
function refreshTray() { try { require('./tray').refresh(); } catch (_) { /* tray optional */ } }

function runLifecycle(s, kind, extra, body) {
  const info = { channelId: s.channelId, taskId: s.taskId, workspaceId: s.workspaceId, side: s.side, sessionId: s.sessionId, key: s.key, sdkSessionId: s.sdkSessionId }; // FIX #2: key+sdkSessionId (cycle) -> echoTargets dedup
  try {
    if (kind === 'task_started') {
      if (lifecycle.onLaunched) lifecycle.onLaunched(info);
    } else if (lifecycle.onEnded) {
      // P3: `body` is the calm one-liner a capped/ended lifecycle carries (undefined -> the handler derives one).
      lifecycle.onEnded(info, kind, extra || {}, body);
    }
  } catch (err) { diag('session-engine: lifecycle handler error', err && err.message); }
}

function setLifecycleHandlers(h) { lifecycle = { onLaunched: h && h.onLaunched, onEnded: h && h.onEnded }; }

module.exports = { readCaps, refreshTray, runLifecycle, setLifecycleHandlers };
