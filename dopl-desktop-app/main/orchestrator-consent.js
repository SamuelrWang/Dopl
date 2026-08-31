// THE MACHINE-LOCAL CONSENTS FOR MCP-DRIVEN CAPABILITIES.
//
// ⚠ **SPLIT OUT OF `channel-prefs.js` ON 2026-08-31**, at the §1 cap and on a REASON rather
// than the count that forced it: this file changes when a capability an EXTERNAL agent may ask
// this machine for is added, or when one of their grants moves; `channel-prefs.js` changes when
// a CHANNEL preference does. Both are re-exported from there, so no caller moved.
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

// ⚠ THE SAME `electron-store` INSTANCE SHAPE `channel-prefs.js` USES — `electron-store` is
// backed by ONE JSON file per app, so two instances read and write the same document. Keeping
// its own handle is what lets this module stand alone without importing the file it was split
// out of (which imports it back, through the re-export).
const store = new Store();

// ── ⚠ THE ORCHESTRATOR LAUNCH TOGGLE (2026-08-22, Samuel's launch-over-MCP ruling) ──────────
//
// MAY ANOTHER AGENT — an ORCHESTRATOR holding this operator's own Dopl credential — cause this
// MACHINE to spawn a session? Default FALSE. It is the standing consent for the whole
// `channel_launch_directives` lane (`main/launch-directives.js`); with it OFF the watcher reads
// a directive addressed to this operator and IGNORES IT SILENTLY, and the directive expires
// server-side where the orchestrator can see it happen.
//
// ⚠ IT IS MACHINE-WIDE, NOT PER CHANNEL, and it is the one record in this file that is. It
// lives here because this is where the local, never-POSTed, default-restrictive launch settings
// already are and a second electron-store module for one boolean would be worse — but it is
// keyed by NOTHING: one operator, one Mac, one answer. A per-channel version was not built
// because the question it answers is "do I let a program press the button on this laptop",
// which is not a fact about a channel.
//
// ── ⚠ WHY IT LIVES OUTSIDE THE SERVER ENTIRELY, AND WHY THAT IS THE POINT (§6 threat) ───────
//
// THE TOGGLE IS THE CONSENT. Samuel's ruling replaces "the click IS that human" for this lane:
// there is no click at directive time, so the standing local decision has to BE the human, and
// a consent that a program can grant itself is not one.
//
// ⚠ A SPAWNED SESSION HAS `Bash` AND THE DEVICE TOKEN IS ON DISK. Under the `bypass` tool
// posture `Bash` is pre-approved, the session runs on this Mac as this user, and this operator's
// Dopl credential is in the app's own store — so an agent that can reach a SERVER-STORED
// setting can reach it with the operator's own authority and flip it. Any surface a Dopl
// credential can address is therefore disqualified: not a `workspace_settings` column, not a
// member preference, not an MCP op, not an authenticated route. **A server-side "allow
// orchestrated launches" flag would let a compromised or merely over-eager agent grant itself
// the right to spawn more agents on every machine the operator owns — which is the escalation
// this whole lane has to not have.**
//
// ⚠ SO THE ONLY WRITER IS THE APP-WINDOW IPC PAIR (`channel-dir-ipc.js ›
// orchestrator:getLaunchEnabled / setLaunchEnabled`, `appWindowOnly`), reachable from the
// bundled SPA's top frame and from nothing else. `Bash` on this machine could of course rewrite
// the electron-store file directly — that is true of every local setting and is not what this
// defends against. What it defends against is the REMOTE path: no request, from any credential,
// to any Dopl endpoint, can change this value, so a compromised workspace cannot arm a fleet.
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
// ⚠ **A SECOND TOGGLE, NOT A REUSE OF THE ONE ABOVE, AND THE SPLIT IS THE RULING.** Launching
// over MCP buys COMPUTE — a new process on this machine. DIRECTING over MCP reaches a running
// agent's PRIVATE lane and starts a turn in it. They are different grants, an operator may
// reasonably want one and not the other, and a single flag cannot express that state.
//
// ⚠ **EVERY ARGUMENT THE LAUNCH TOGGLE MAKES ABOUT WHERE IT MAY LIVE APPLIES HERE UNCHANGED.**
// Any surface a Dopl credential can address is disqualified — not a `workspace_settings`
// column, not a member preference, not an MCP op, not an authenticated route — because a
// spawned session has `Bash` under `bypass` and the device token is on disk, so a server-side
// flag could be flipped by the very agents it governs, on every machine the operator owns.
// **A consent a program can grant itself is not one.**
//
// Machine-wide, keyed by nothing: one operator, one Mac, one answer. Default OFF; absent,
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
  ORCHESTRATOR_LAUNCH_KEY,
  getOrchestratorLaunch,
  setOrchestratorLaunch,
  ORCHESTRATOR_DIRECT_KEY,
  getOrchestratorDirect,
  setOrchestratorDirect,
};
