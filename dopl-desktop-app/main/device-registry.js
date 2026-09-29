// Wiring for `device-registry-core.js` (like presence.js for presence-core): the real transport,
// this install's descriptor, and the remote-removal sign-out. Driven by presence's loop, not a
// timer of its own.

const { apiFetch } = require('./api');
const { discardBody } = require('./api-repair');
const { diag } = require('./diag');
const identity = require('./device-identity');
const { createDeviceRegistry } = require('./device-registry-core');

function step(label, fn) {
  try {
    const r = fn();
    return r && typeof r.then === 'function'
      ? r.catch((err) => diag('device: revoke step failed —', label, err && err.message))
      : r;
  } catch (err) {
    diag('device: revoke step failed —', label, (err && err.message) || String(err));
    return undefined;
  }
}

// Mirrors ui-bridge's 'dopl:sign-out'. Lazy requires: auth/auth-tokens/channel-listener close cycles.
async function onRevoked() {
  step('rotate', () => identity.rotateInstallId());
  await step('sign-out', () => require('./auth').signOut());
  step('auth-tokens', () => require('./auth-tokens').onSignOut());
  step('listener', () => require('./channel-listener').restart());
}

const registry = createDeviceRegistry({
  apiFetch,
  discardBody,
  descriptor: (status) => identity.descriptor(status),
  onRevoked,
  diag,
});

// Read the token link once (a store decrypt), never per beat. Lazy: mcp-config → api → us.
function loadLink() {
  try {
    registry.setLink(require('./mcp-config').deviceTokenLink());
  } catch (err) {
    diag('device: token link read failed —', err && err.message);
  }
}

// A new sign-in may be a re-added computer or another user: clear the revoked latch and throttle.
let subscribed = false;
function arm() {
  registry.reset();
  identity.refresh(); // async; descriptor() uses the hostname until it lands
  loadLink();
  if (subscribed) return;
  subscribed = true;
  try {
    // Only a real sign-in (new user or after signed-out), not each token refresh's
    // refreshing→signed-in, so the link is re-sent once per session.
    let user;
    require('./auth-tokens').subscribe((state) => {
      if (!state) return;
      if (state.status === 'signed-out') { user = null; return; }
      if (state.status !== 'signed-in' || state.userId === user) return;
      user = state.userId;
      registry.reset();
      loadLink();
    });
  } catch (err) {
    diag('device: auth subscription failed —', err && err.message);
  }
  try {
    require('./mcp-config').onDeviceTokenMinted((l) => registry.setLink(l));
  } catch (err) {
    diag('device: mint subscription failed —', err && err.message);
  }
}

module.exports = {
  arm,
  beat: (status) => registry.beat(status),
  offline: (reason) => registry.offline(reason),
  reset: () => registry.reset(),
};
