// Which agent runtime a channel's agents launch on: the `runtime` field of the channel's launch
// selection (written only by `channel-prefs.js › setLaunchSelection`). Local only.
// A runtime pick widens nothing — every adapter re-derives its whole gate and `runtime/contract.js`
// refuses one that cannot — so, unlike the posture, peer wakes and resumes may inherit it.
// Fail-closed means the DEFAULT runtime (`''`), never a refusal that would strand the channel.

const runtimeRegistry = require('./runtime');

// Lazy: channel-prefs opens an electron-store at load, and plain-node callers must keep working.
const prefs = () => require('./channel-prefs');

/** A REGISTERED runtime id (validated against `runtime/index.js › ids()`), or `''` — the one spelling of "no pick". */
function normalizeRuntimeId(raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return '';
  return runtimeRegistry.ids().indexOf(id) === -1 ? '' : id;
}

/** The channel's runtime, or `''` for the default. An unknown stored id reads `''` and is not repaired. */
function getChannelRuntime(channelId) {
  if (!channelId) return '';
  try {
    return normalizeRuntimeId(prefs().getLaunchSelection(channelId).runtime);
  } catch (_err) {
    return ''; // an unreadable store is the default runtime, never a refusal
  }
}


module.exports = {
  normalizeRuntimeId,
  getChannelRuntime,
};
