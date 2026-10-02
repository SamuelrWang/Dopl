// The device heartbeat: this computer's online/last-seen row under Settings > Devices.
// Pure and injectable so `node --test` drives it; `device-registry.js` is the wiring.
//
// It has no timer of its own — presence's 30s loop calls `beat(posture)` (presence-core `onBeat`),
// and this throttles to one write per ~50s unless the status changed (50s, not 60s, so 30s±3s
// jitter still lands a send every other beat). A `revoked:true` answer means
// the user removed this computer: `onRevoked` runs once and beating stops until `reset()`.

const PATH = '/api/devices/heartbeat';
const MIN_INTERVAL_MS = 50 * 1000;
const TOKEN_LABEL_MAX = 120;
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
  let queued = null; // latest status requested while a beat was in flight
  let link = null; // { tokenId } | { tokenLabel }: sent until one send lands, then dropped

  /** Link the current MCP token on the next landed send only. */
  function setLink(next) {
    if (next && typeof next.tokenId === 'string' && next.tokenId) link = { tokenId: next.tokenId };
    else if (next && typeof next.tokenLabel === 'string' && next.tokenLabel) {
      link = { tokenLabel: next.tokenLabel.slice(0, TOKEN_LABEL_MAX) };
    } else link = null;
  }

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
    const sentLink = link;
    if (sentLink) body = { ...body, ...sentLink };
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
    if (sentLink && link === sentLink) link = null;
    return 'ok';
  }

  function blocked() {
    if (revoked) return 'revoked';
    if (now() < unavailableUntil) return 'unavailable';
    return null;
  }

  // A status requested mid-flight is kept (latest wins) and sent once the flight settles, so a
  // lock-screen `away` is never lost.
  function drain() {
    if (queued === null) return;
    const s = queued;
    queued = null;
    beat(s).catch(() => {});
  }

  async function beat(status) {
    try {
      const b = blocked();
      if (b) return b;
      if (inFlight) { queued = status; return 'queued'; }
      if (status === lastStatus && now() - lastSentAt < MIN_INTERVAL_MS) return 'throttled';
      inFlight = true;
      let out;
      try {
        out = await post(status, HTTP_TIMEOUT_MS);
      } finally {
        inFlight = false;
      }
      drain();
      return out;
    } catch (_) {
      return 'error';
    }
  }

  // Best-effort, bypasses the throttle; callers race it and never block on it.
  function offline(reason) {
    try {
      const b = blocked();
      if (b) return Promise.resolve(b);
      queued = null; // nothing may land after offline
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

  return { beat, offline, reset, setLink, _link: () => link };
}

module.exports = {
  createDeviceRegistry,
  PATH,
  MIN_INTERVAL_MS,
  UNAVAILABLE_BACKOFF_MS,
  HTTP_TIMEOUT_MS,
  OFFLINE_TIMEOUT_MS,
};
