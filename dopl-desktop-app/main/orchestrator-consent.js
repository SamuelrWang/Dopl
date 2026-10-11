// THE MACHINE-LOCAL CONSENTS FOR MCP-DRIVEN CAPABILITIES.
//
// Separate from `channel-prefs.js` on a REASON: this file changes when a capability an EXTERNAL
// agent may ask this machine for is added or its grant moves; `channel-prefs.js` changes when a
// CHANNEL preference does. Re-exported from there.
//
// 🔒 **THE SECURITY ARGUMENT IS THE WHOLE REASON THESE ARE NOT SERVER STATE, AND IT APPLIES TO
// EVERY TOGGLE THAT WILL EVER LIVE HERE.** Any surface a Dopl credential can address is
// disqualified — not a `workspace_settings` column, not a member preference, not an MCP op, not
// an authenticated route — because a spawned session has `Bash` under `bypass` and the device
// token is on disk, so a server-stored flag could be flipped by the very agents it governs, on
// every machine the operator owns. **A consent a program can grant itself is not one.**
//
// ⚠ **ONE TOGGLE PER CAPABILITY, NEVER ONE FOR THE FAMILY.** Launching over MCP buys COMPUTE (a
// new process on this machine); DIRECTING over MCP reaches a running agent's PRIVATE lane and
// starts a turn in it. An operator may reasonably want one and not the other, and a shared flag
// could not express that state.
//
// Machine-wide, keyed by nothing: one operator, one Mac, one answer. Default OFF; absent,
// corrupt and non-boolean all read false. Each setter returns the value the store ACTUALLY
// holds (re-read on failure), which is what lets the IPC layer answer `{ok:false}` and the SPA
// revert an optimistic switch.

const Store = require('electron-store');
const { diag } = require('./diag');

// `electron-store` is ONE JSON file per app, so this handle and `channel-prefs.js`'s read and
// write the same document; its own handle avoids importing channel-prefs (which imports this).
const store = new Store();

// ── ⚠ THE ORCHESTRATOR LAUNCH TOGGLE (2026-08-22, Samuel's launch-over-MCP ruling) ──────────
//
// MAY ANOTHER AGENT — an ORCHESTRATOR holding this operator's own Dopl credential — cause this
// MACHINE to spawn a session? Default FALSE. It is the standing consent for the whole
// `channel_launch_directives` lane (`main/launch-directives.js`); with it OFF the watcher reads
// a directive addressed to this operator and IGNORES IT SILENTLY, and the directive expires
// server-side where the orchestrator can see it happen.
//
// ⚠ THE ONLY WRITER IS THE APP-WINDOW IPC PAIR (`channel-dir-ipc.js ›
// orchestrator:getLaunchEnabled / setLaunchEnabled`, `appWindowOnly`), reachable from the
// bundled SPA's top frame and from nothing else. There is no click at directive time, so this
// standing local decision IS the human (Samuel's ruling replaces "the click IS that human" for
// this lane). `Bash` on this machine could rewrite the electron-store file directly — true of
// every local setting and not what this defends against. It defends the REMOTE path (header):
// no request, from any credential, to any Dopl endpoint, can change this value, so a
// compromised workspace cannot arm a fleet.
//
// ⚠ AND IT NARROWS NOTHING ELSE. A directive-driven launch is exactly as contained as a button
// launch: same channel tool profile, same durable posture, same `SESSION_HARD_DENY`, same
// windowless message floor. This toggle decides WHO MAY PRESS, never WHAT IS ALLOWED.
//
// Default OFF — an absent, corrupt or non-boolean record reads false, the same fail-closed rule
// auto-send follows.
const ORCHESTRATOR_LAUNCH_KEY = 'orchestratorLaunchEnabled'; // a bare boolean

function getOrchestratorLaunch() {
  try {
    return store.get(ORCHESTRATOR_LAUNCH_KEY) === true;
  } catch (_err) {
    return false; // an unreadable store is not a grant
  }
}

function setOrchestratorLaunch(on) {
  const next = on === true;
  try {
    store.set(ORCHESTRATOR_LAUNCH_KEY, next);
  } catch (err) {
    diag('channel-prefs: could not persist the orchestrator launch toggle —', err && err.message);
    return getOrchestratorLaunch();
  }
  diag('channel-prefs: orchestrator launch', next ? 'ENABLED' : 'disabled');
  return next;
}

// ── THE PRIVATE DIRECT LANE'S CONSENT (Samuel's ruling, 2026-08-31) ──────────────────────────
//
// ⚠ A SECOND TOGGLE, NOT A REUSE OF THE ONE ABOVE, AND THE SPLIT IS THE RULING (header: one
// toggle per capability). The header's security argument applies unchanged. Default OFF; absent,
// corrupt and non-boolean all read false.
const ORCHESTRATOR_DIRECT_KEY = 'orchestratorDirectEnabled'; // a bare boolean

function getOrchestratorDirect() {
  try {
    return store.get(ORCHESTRATOR_DIRECT_KEY) === true;
  } catch (_err) {
    return false; // an unreadable store is not a grant
  }
}

/** ⚠ Returns the value the store ACTUALLY holds (re-read on failure), which is what lets the
 *  IPC layer answer `{ok:false}` and the SPA revert an optimistic switch. */
function setOrchestratorDirect(on) {
  const next = on === true;
  try {
    store.set(ORCHESTRATOR_DIRECT_KEY, next);
  } catch (err) {
    diag('channel-prefs: could not persist the orchestrator direct toggle —', err && err.message);
    return getOrchestratorDirect();
  }
  diag('channel-prefs: orchestrator direct', next ? 'ENABLED' : 'disabled');
  return next;
}

module.exports = {
  getOrchestratorLaunch,
  setOrchestratorLaunch,
  getOrchestratorDirect,
  setOrchestratorDirect,
};
