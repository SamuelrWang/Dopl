// The device heartbeat: this computer's online/last-seen row under Settings > Connect > Devices.
// Pure and injectable so `node --test` drives it; `device-registry.js` is the wiring.
//
// It has no timer of its own — presence's 30s loop calls `beat(posture)` (presence-core `onBeat`),
// and this throttles to one write per 60s unless the status changed. A `revoked:true` answer means
// the user removed this computer: `onRevoked` runs once and beating stops until `reset()`.

const PATH = '/api/devices/heartbeat';
const MIN_INTERVAL_MS = 60 * 1000;
const UNAVAILABLE_BACKOFF_MS = 5 * 60 * 1000; // 404 = endpoint not deployed on this server
const HTTP_TIMEOUT_MS = 12000;
const OFFLINE_TIMEOUT_MS = 3000; // runs during quit/suspend

/**
 * @param {object} deps
 *  - apiFetch(path, opts)   shared authenticated transport
 *  - discardBody(res)       release an unread body (optional)
 *  - descriptor(status)     the heartbeat body
 *  - onRevoked()            this computer was removed remotely
 *  - now()                  ms
 *  - diag(...)              logging
 */
function createDeviceRegistry(deps) {
  const {
    apiFetch, descriptor, onRevoked,
    discardBody = () => {}, now = () => Date.now(), diag = () => {},
  } = deps;

  let lastSentAt = 0;
  let lastStatus = null;
  let unavailableUntil = 0;
  let revoked = false;
  let inFlight = false;

  function handleRevoked() {
    if (revoked) return;
    revoked = true;
    diag('device: this computer was removed from the account — signing out');
    try {
      const r = onRevoked && onRevoked();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (_) { /* never throws */ }
  }

  /** One POST. Returns 'ok' | 'revoked' | 'unavailable' | 'auth' | 'error'. Never throws. */
  async function post(status, timeoutMs) {
    let body;
    try { body = descriptor(status); } catch (err) {
      diag('device: descriptor failed', err && err.message);
      return 'error';
    }
    let res;
    try {
      res = await apiFetch(PATH, { method: 'POST', body, noStore: true, timeoutMs });
    } catch (err) {
      diag('device: heartbeat error', err && err.message);
      return 'error';
    }
    if (!res || res.status === 404) {
      if (res) discardBody(res);
      unavailableUntil = now() + UNAVAILABLE_BACKOFF_MS;
      diag('device: heartbeat 404 (not deployed) — backing off 5m');
      return 'unavailable';
    }
    if (res.status === 401) { discardBody(res); return 'auth'; }
    if (!res.ok) { discardBody(res); diag('device: heartbeat failed', res.status); return 'error'; }
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (data && data.device && data.device.revoked === true) {
      handleRevoked();
      return 'revoked';
    }
    lastSentAt = now();
    lastStatus = status;
    return 'ok';
  }

  function blocked() {
    if (revoked) return 'revoked';
    if (now() < unavailableUntil) return 'unavailable';
    return null;
  }

  async function beat(status) {
    try {
      const b = blocked();
      if (b) return b;
      if (inFlight) return 'busy';
      if (status === lastStatus && now() - lastSentAt < MIN_INTERVAL_MS) return 'throttled';
      inFlight = true;
      try {
        return await post(status, HTTP_TIMEOUT_MS);
      } finally {
        inFlight = false;
      }
    } catch (_) {
      return 'error';
    }
  }

  // Best-effort, bypasses the throttle; callers race it and never block on it.
  function offline(reason) {
    try {
      const b = blocked();
      if (b) return Promise.resolve(b);
      diag('device: offline —', reason);
      return post('offline', OFFLINE_TIMEOUT_MS).catch(() => 'error');
    } catch (_) {
      return Promise.resolve('error');
    }
  }

  // On sign-in: a new session may be a different user or a re-added computer.
  function reset() {
    revoked = false;
    unavailableUntil = 0;
    lastSentAt = 0;
    lastStatus = null;
  }

  return { beat, offline, reset, _isRevoked: () => revoked };
}

module.exports = {
  createDeviceRegistry,
  PATH,
  MIN_INTERVAL_MS,
  UNAVAILABLE_BACKOFF_MS,
  HTTP_TIMEOUT_MS,
  OFFLINE_TIMEOUT_MS,
};
