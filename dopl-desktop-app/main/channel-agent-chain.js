// AGENT CHAINING — THE ONE-GENERATION LAUNCH BOUND, MADE A PER-CHANNEL SETTING.
//
// ⚠ **§1 SPLIT OUT OF `channel-prefs.js` ON 2026-09-21 (U5)**, at the 500-line cap and on the
// same seam `orchestrator-consent.js` (2026-08-31) and `identity-approval.js` (2026-08-31) moved
// on: this record changes when the rules for HOW FAR A CHAIN OF LAUNCHES MAY REACH change, where
// the rest of that file changes when the shape of a channel's launch settings does. It is also
// the only record in that family that is neither a posture nor a pick — it lifts a BOUND.
// Re-exported from `channel-prefs.js`, so no caller moved.
//
// PRIVACY — electron-store, local to this Mac. Never POSTed, never in a channel message.

const Store = require('electron-store');
const { diag } = require('./diag');

const store = new Store();

// ── ⚠ AGENT CHAINING (2026-08-31, Samuel's ruling) — THE ONE-GENERATION BOUND, MADE A SETTING ──
//
// `session-own-launch.js › MAX_LAUNCH_DEPTH` limits a chain of launches to ONE generation: an
// operator's orchestrator may staff itself and its staff may not staff themselves. Samuel ruled
// that bound a CHANNEL SETTING after a field run where five worker-launch attempts by a launched
// agent were all refused — the operator wanted an orchestrator that staffs supervisors that staff
// workers, in the ONE room they run orchestrators in.
//
// DEFAULT OFF, which is the CURRENT bound. An absent, corrupt or non-boolean record reads false,
// the same fail-closed rule auto-send, the identity approvals and the two orchestrator toggles all
// follow — so nothing about a machine that has never seen this key changes.
//
// ⚠ IT IS PER CHANNEL AND IT IS LOCAL, for auto-send's reason and for `orchestratorLaunch`'s. A
// spawned session has `Bash` and this operator's device token on disk (§6), so a SERVER-STORED
// version of this flag is one an agent holding the operator's own credential could flip for
// itself. There is no route, no MCP op and no column, deliberately.
//
// ⚠ WHAT IT DOES **NOT** DO, and the list is the whole safety argument. It lifts a DEPTH bound and
// nothing else. A launch still needs, unchanged and in conjunction: the Axis-A `bypass` posture,
// the Axis-B outbound half, the machine-wide `orchestratorLaunchEnabled` consent that turns a
// directive into a process, this channel's tool profile, `SESSION_HARD_DENY`, and the machine's
// `MAX_CONCURRENT_SESSIONS` ceiling. With this ON and any one of those closed, nothing launches.
//
// ⚠ AND WITH IT ON THERE IS NO GENERATION BOUND LEFT — SAID PLAINLY RATHER THAN IMPLIED. Depth
// cannot cross the wire (`session-own-launch.js`'s header carries the argument), so "N
// generations" is not a bound this build can express. What stands in its place is stated where it
// is enforced: `MAX_CONCURRENT_SESSIONS` (fifteen live sessions, instantaneous — 6 until 2026-09-01) and
// `launch-budget.js` (a rolling per-channel launch budget, over time). Neither is a generation
// count and neither is described as one.
const AGENT_CHAIN_KEY = 'channelAgentChain'; // { [channelId]: true }

/** May a LAUNCHED session in this channel launch further agents? Default false. */
function getAgentChain(channelId) {
  if (!channelId) return false;
  try {
    const map = store.get(AGENT_CHAIN_KEY);
    return !!(map && typeof map === 'object' && map[channelId] === true);
  } catch (_err) {
    return false; // an unreadable store is not a grant
  }
}

/** Persist the channel's chaining setting. ⚠ OFF DELETES THE KEY — the same "absent and false are
 *  the same record" rule the auto-send map follows, so nothing distinguishes never-set from
 *  turned-off and no reader can grow a third state to get wrong. */
function setAgentChain(channelId, on) {
  if (!channelId) return false;
  try {
    const map = store.get(AGENT_CHAIN_KEY);
    const next = map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {};
    if (on === true) next[channelId] = true;
    else delete next[channelId];
    store.set(AGENT_CHAIN_KEY, next);
  } catch (err) {
    diag('channel-prefs: could not persist agent chaining —', err && err.message);
    return false;
  }
  diag('channel-prefs: agentChain', String(channelId).slice(0, 8), on === true ? 'on' : 'off');
  return on === true;
}

module.exports = { AGENT_CHAIN_KEY, getAgentChain, setAgentChain };
