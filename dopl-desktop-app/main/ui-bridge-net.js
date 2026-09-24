// Network failures on the SPA's API bridge (main/ui-bridge.js): classify an undici throw, retry
// only what cannot double-send, and answer an envelope instead of rejecting the IPC.
// No electron here; every side effect (pool, log, clock) is injected.

// Failed before a byte left the machine: any method may be resent.
const CONNECT_PHASE_CODES = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
]);
// A pooled socket died under the request, which may already have reached the server: reads only.
// UND_ERR_DESTROYED is a request killed by our own pool reset (main/wake.js).
const STALE_SOCKET_CODES = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_DESTROYED']);
const RESENDABLE_METHODS = new Set(['GET', 'HEAD']);

const TIMEOUT_CODE = 'UI_BRIDGE_TIMEOUT';
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 250;

// The renderer's decoder (src/shared/api/api-envelope.ts › decodeResponse) keys on these.
const NETWORK_UNAVAILABLE = 'NETWORK_UNAVAILABLE';
const NETWORK_TIMEOUT = 'NETWORK_TIMEOUT';
const BRIDGE_FAILURE = 'BRIDGE_FAILURE';

/** The transport's own deadline, marked so it is never mistaken for a caller's abort. */
function timeoutError(cause) {
  const err = new Error('ui-bridge request timed out');
  err.code = TIMEOUT_CODE;
  err.cause = cause;
  return err;
}

/** First string `code` down the cause chain (undici nests it; happy-eyeballs aggregates it). */
function causeCode(err) {
  let e = err;
  for (let depth = 0; e && typeof e === 'object' && depth < 5; depth += 1) {
    if (typeof e.code === 'string' && e.code) return e.code;
    if (Array.isArray(e.errors)) {
      const hit = e.errors.find((x) => x && typeof x.code === 'string' && x.code);
      if (hit) return hit.code;
    }
    e = e.cause;
  }
  return null;
}

/** `{ network, timeout, code }` for anything `fetch` or a body read threw. */
function classifyFailure(err) {
  const code = causeCode(err);
  if (code === TIMEOUT_CODE) return { network: true, timeout: true, code };
  const fetchFailure = !!err && err.name === 'TypeError' && (code !== null || err.message === 'fetch failed');
  if (fetchFailure) return { network: true, timeout: false, code: code || 'UNKNOWN' };
  return { network: false, timeout: false, code: code || (err && err.name) || 'UNKNOWN' };
}

function resetsPool(cls) {
  return cls.network && (CONNECT_PHASE_CODES.has(cls.code) || STALE_SOCKET_CODES.has(cls.code));
}

/** Resend only when the first attempt provably never reached the server, or it was a read. */
function shouldRetry(method, cls) {
  if (!cls.network || cls.timeout) return false;
  if (CONNECT_PHASE_CODES.has(cls.code)) return true;
  if (STALE_SOCKET_CODES.has(cls.code)) return RESENDABLE_METHODS.has(String(method).toUpperCase());
  return false;
}

/** Path shape for the log: no query string, and any id/token-like segment masked. */
function logPath(href) {
  let pathname;
  try { pathname = new URL(String(href)).pathname; } catch (_err) { return '?'; }
  return pathname
    .split('/')
    .map((seg) => (seg === '' || /^[a-z][a-z-]{0,39}$/.test(seg) ? seg : ':id'))
    .join('/');
}

function statusEnvelope(code) {
  return { status: 0, statusText: '', hasBody: true, body: { error: { code } } };
}

function networkEnvelope(cls) {
  return statusEnvelope(cls.timeout ? NETWORK_TIMEOUT : NETWORK_UNAVAILABLE);
}

/** Already classified and logged by `sendWithRecovery`. */
class NetworkFailure extends Error {
  constructor(cls, cause) {
    super('network failure');
    this.name = 'NetworkFailure';
    this.cls = cls;
    this.cause = cause;
  }
}

function logFailure(ctx, cls, retried, result) {
  if (typeof ctx.diag !== 'function') return;
  const parts = ['ui-bridge: network failure', ctx.method || 'GET', logPath(ctx.href),
    `code=${cls.code}`, `retried=${retried ? 'yes' : 'no'}`];
  if (retried) parts.push(`result=${result}`);
  ctx.diag(...parts);
}

/**
 * The IPC answer for anything `performApiRequest` threw — never a rejection, never raw text.
 * `ctx`: `{ method, href, diag }`.
 */
function failureEnvelope(err, ctx = {}) {
  if (err instanceof NetworkFailure) return networkEnvelope(err.cls);
  const cls = classifyFailure(err);
  if (cls.network) {
    logFailure(ctx, cls, false);
    return networkEnvelope(cls);
  }
  if (typeof ctx.diag === 'function') {
    ctx.diag('ui-bridge: request failed', ctx.method || 'GET', logPath(ctx.href), `error=${cls.code}`);
  }
  return statusEnvelope(BRIDGE_FAILURE);
}

/** One `fetch` bounded by the transport's own deadline. */
async function fetchWithDeadline(href, init, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(href, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (ctrl.signal.aborted) throw timeoutError(err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `send()` once; on a network failure reset the pool it rode and resend at most once when the rule
 * allows. Returns the Response or throws: a non-network error as-is, a network one as NetworkFailure.
 * `ctx`: `{ method, href, diag, currentPool(), resetPool(pool), sleep(ms) }`.
 */
async function sendWithRecovery(send, ctx) {
  const pool = typeof ctx.currentPool === 'function' ? ctx.currentPool() : null;
  let first;
  try {
    return await send();
  } catch (err) {
    first = classifyFailure(err);
    if (!first.network) throw err;
    if (resetsPool(first) && typeof ctx.resetPool === 'function') ctx.resetPool(pool);
    if (!shouldRetry(ctx.method, first)) {
      logFailure(ctx, first, false);
      throw new NetworkFailure(first, err);
    }
  }
  const sleep = typeof ctx.sleep === 'function' ? ctx.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(RETRY_DELAY_MS);
  try {
    const res = await send();
    logFailure(ctx, first, true, 'ok');
    return res;
  } catch (err) {
    const second = classifyFailure(err);
    logFailure(ctx, first, true, second.code);
    if (!second.network) throw err;
    throw new NetworkFailure(second, err);
  }
}

module.exports = {
  classifyFailure,
  shouldRetry,
  logPath,
  failureEnvelope,
  fetchWithDeadline,
  sendWithRecovery,
  NetworkFailure,
  CONNECT_PHASE_CODES,
  STALE_SOCKET_CODES,
  REQUEST_TIMEOUT_MS,
  NETWORK_UNAVAILABLE,
  NETWORK_TIMEOUT,
  BRIDGE_FAILURE,
};
