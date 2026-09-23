// AGENT CHAINING: the per-channel setting that lifts `session-own-launch.js › MAX_LAUNCH_DEPTH`
// (a launched agent may itself launch agents). Default OFF; absent/corrupt reads false.
// Local only, never server-writable: a spawned session holds the operator's device token (§6), so
// a remote flag is one an agent could flip for itself. It lifts the DEPTH bound and nothing else —
// bypass posture, the outbound half, the orchestrator consent, the tool profile, the hard-deny set
// and `MAX_CONCURRENT_SESSIONS` all still apply. With it on there is no generation bound: the
// concurrency cap and `launch-budget.js` are what stand in, and neither is one.

const Store = require('electron-store');
const { diag } = require('./diag');

const store = new Store();

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

/** Persist the setting. OFF deletes the key: absent and false are one record. */
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
