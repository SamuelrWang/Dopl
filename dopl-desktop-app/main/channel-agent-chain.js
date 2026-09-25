// PER-CHANNEL LOCAL FLAGS — `{ [channelId]: true }` records, default OFF, absent/corrupt reads false.
// Local only, never server-writable: a spawned session holds the operator's device token (§6), so a
// remote flag is one an agent could flip for itself.
//   AGENT CHAINING lifts `session-own-launch.js › MAX_LAUNCH_DEPTH` (a launched agent may itself
//     launch agents) and nothing else — bypass posture, the outbound half, the orchestrator consent,
//     the tool profile, the hard-deny set and `MAX_CONCURRENT_SESSIONS` all still apply. With it on
//     there is no generation bound: the concurrency cap and `launch-budget.js` stand in.
//   USE MY TOOLS gives a SHARED channel's sessions the operator's own tooling (`operator-tools.js`);
//     a private channel has it without the flag.

const Store = require('electron-store');
const { diag } = require('./diag');

const store = new Store();

const AGENT_CHAIN_KEY = 'channelAgentChain'; // { [channelId]: true }
const USE_MY_TOOLS_KEY = 'channelUseMyTools'; // { [channelId]: true }

function channelFlag(key, label) {
  function get(channelId) {
    if (!channelId) return false;
    try {
      const map = store.get(key);
      return !!(map && typeof map === 'object' && map[channelId] === true);
    } catch (_err) {
      return false; // an unreadable store is not a grant
    }
  }
  /** Persist the setting. OFF deletes the key: absent and false are one record. */
  function set(channelId, on) {
    if (!channelId) return false;
    try {
      const map = store.get(key);
      const next = map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {};
      if (on === true) next[channelId] = true;
      else delete next[channelId];
      store.set(key, next);
    } catch (err) {
      diag(`channel-prefs: could not persist ${label} —`, err && err.message);
      return false;
    }
    diag(`channel-prefs: ${label}`, String(channelId).slice(0, 8), on === true ? 'on' : 'off');
    return on === true;
  }
  return { get, set };
}

const agentChain = channelFlag(AGENT_CHAIN_KEY, 'agentChain');
const useMyTools = channelFlag(USE_MY_TOOLS_KEY, 'useMyTools');

module.exports = {
  AGENT_CHAIN_KEY,
  getAgentChain: agentChain.get,
  setAgentChain: agentChain.set,
  USE_MY_TOOLS_KEY,
  getUseMyTools: useMyTools.get,
  setUseMyTools: useMyTools.set,
};
