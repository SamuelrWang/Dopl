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

// A new sign-in may be a re-added computer or another user: clear the revoked latch and throttle.
let subscribed = false;
function arm() {
  registry.reset();
  if (subscribed) return;
  subscribed = true;
  try {
    require('./auth-tokens').subscribe((state) => {
      if (state && state.status === 'signed-in') registry.reset();
    });
  } catch (err) {
    diag('device: auth subscription failed —', err && err.message);
  }
}

module.exports = {
  arm,
  beat: (status) => registry.beat(status),
  offline: (reason) => registry.offline(reason),
  reset: () => registry.reset(),
};
