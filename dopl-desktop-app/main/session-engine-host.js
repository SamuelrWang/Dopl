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

// The per-session settings a launch reads: today only the idle TTL (the turn and cost caps were
// deleted, Samuel 2026-09-07). `spec` is unused; callers and test harnesses still pass it.
function readCaps(spec) {
  if (!settings) return {};
  return { idleMs: settings.getIdleTtlMs() };
}

// Rebuild the tray after a session is hidden / reopened / settled. Lazy-required so the engine holds no top-level tray dependency (tray requires nothing back).
function refreshTray() { try { require('./tray').refresh(); } catch (_) { /* tray optional */ } }

function runLifecycle(s, kind, extra, body) {
  const info = { channelId: s.channelId, threadId: s.threadId, workspaceId: s.workspaceId, side: s.side, sessionId: s.sessionId, key: s.key, sdkSessionId: s.sdkSessionId }; // FIX #2: key+sdkSessionId (cycle) -> echoTargets dedup
  try {
    if (kind === 'thread_started') {
      if (lifecycle.onLaunched) lifecycle.onLaunched(info);
    } else if (lifecycle.onEnded) {
      // P3: `body` is the calm one-liner a capped/ended lifecycle carries (undefined -> the handler derives one).
      lifecycle.onEnded(info, kind, extra || {}, body);
    }
  } catch (err) { diag('session-engine: lifecycle handler error', err && err.message); }
}

function setLifecycleHandlers(h) { lifecycle = { onLaunched: h && h.onLaunched, onEnded: h && h.onEnded }; }

module.exports = { readCaps, refreshTray, runLifecycle, setLifecycleHandlers };
